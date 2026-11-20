// -----------------------------------------------------------------------------
// The hub: one BACnet/IP device, its objects, and what Gladys sees of them.
//
// - A timer of the container polls the device (should_poll stays false: the
//   core's poller skips devices created without it, see CLAUDE.md). The first
//   successful cycle reads the instance (when not given), the names, units,
//   number of states and priority arrays, publishes the device (one Gladys
//   device, one feature per object), and caches that under /data so a
//   restart with the device off still publishes the same device.
// - Each cycle then reads presentValue and statusFlags with
//   ReadPropertyMultiple and publishes the changed values, never faster than
//   the 300 states a minute Gladys accepts.
// - Writes and releases go through the declared objects only, and only when
//   the user turned writing on, at the configured priority.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ERROR_CLASS, ERROR_CODE, LinkError, PROPERTY } from './bacnet/client.js';
import { normalizeConfig, parseAddress } from './config.js';
import { pick } from './i18n.js';
import { createIssueLog } from './issues.js';
import { KINDS, publishedUnit } from './kinds.js';
import { STATUS, bacnetErrorName, objectError } from './messages.js';
import { parseObjectId, parseObjects, uniqueNames } from './objects.js';
import { TAG, WriteError, resolveKind, toState, toWrite } from './values.js';

const logger = createLogger({ name: 'bacnet-hub' });

export const TRIGGERS = {
  DISCONNECTED: 'device_disconnected',
  RECONNECTED: 'device_reconnected',
  OBJECT_ALARM: 'object_alarm',
};

const DEVICE_TYPE = 8;
// Gladys accepts 300 states a minute per integration: keep a margin.
const STATES_PER_MINUTE = 240;
// Re-send unchanged values: the dashboard says "no recent value" after 48 h.
const HEARTBEAT_MS = 6 * 3600 * 1000;
// A single lost UDP answer is not a lost device: two failed cycles in a row.
const FAILURES_BEFORE_DOWN = 2;

/** statusFlags (BACnet bit string): bit 0 in-alarm, 1 fault, 2 overridden, 3 out-of-service. */
export function readFlags(bits) {
  const byte = Array.isArray(bits?.value) ? Number(bits.value[0] ?? 0) : 0;
  return {
    inAlarm: (byte & 1) !== 0,
    fault: (byte & 2) !== 0,
    overridden: (byte & 4) !== 0,
    outOfService: (byte & 8) !== 0,
  };
}

export class BacnetHub {
  /**
   * @param {object} options
   * @param {object} options.gladys
   * @param {object} options.store
   * @param {(options: object) => object} options.createLink
   * @param {() => number} [options.now]
   * @param {boolean} [options.timers] run the polling timer
   * @param {() => void} [options.onChange] the widget has something new to show
   */
  constructor({ gladys, store, createLink, now = Date.now, timers = true, onChange = () => {} }) {
    this.gladys = gladys;
    this.store = store;
    this.createLink = createLink;
    this.now = now;
    this.timers = timers;
    this.onChange = onChange;
    this.config = normalizeConfig({});
    this.link = null;
    this.address = null;
    this.instance = null;
    this.ids = null;
    this.deviceInfo = {};
    this.objects = [];
    this.configErrors = [];
    this.latest = new Map();
    this.status = { connected: null, code: null, lastValueAt: null };
    this.failures = 0;
    this.metaReady = false;
    this.issues = createIssueLog(logger);
    this.timer = null;
    this.cycle = Promise.resolve();
    this.cycling = false;
    this.configuring = Promise.resolve();
    // Objects whose alarm was already reported: kept across configurations,
    // so a save or a restart does not fire the trigger again.
    this.alarmed = new Set();
  }

  // --- Configuration ---------------------------------------------------------

  /** Apply a configuration; two quick saves run one after the other. */
  configure(config) {
    // A failed configuration must not block the next ones.
    const run = this.configuring.catch(() => {}).then(() => this.#configure(config));
    this.configuring = run;
    return run;
  }

  async #configure(config) {
    this.#stopLink();
    // A cycle of the old device still running must not land on the new one.
    await this.cycle;
    this.config = config;
    this.latest.clear();
    this.status = { connected: null, code: null, lastValueAt: null };
    this.failures = 0;
    this.issues = createIssueLog(logger);
    this.metaReady = false;
    this.instance = null;
    this.ids = null;
    this.deviceInfo = {};
    const { objects, errors } = parseObjects(config.objects);
    for (const object of objects) {
      object.needsMeta = true;
    }
    this.objects = objects;
    this.cache = {};
    this.configErrors = errors;

    const address = config.badInstance
      ? { error: 'badInstance' }
      : parseAddress(config.address, config.port);
    if (address.error) {
      this.address = null;
      this.status.code = address.error;
      await this.gladys.publishDiscoveredDevices([]);
      await this.#setConnectionStatus(false, STATUS[address.error]);
      return;
    }
    this.address = address;
    const cache = (await this.store.get(this.#cacheKey())) ?? {};
    const instance = config.device_instance ?? cache.instance ?? null;
    if (instance !== null && (config.device_instance === null || cache.instance === instance)) {
      this.deviceInfo = cache.device ?? {};
      this.cache = { ...cache.objects };
      for (const object of objects) {
        if (cache.objects?.[object.key]) {
          this.#resolve(object, cache.objects[object.key]);
        }
      }
    }
    if (instance !== null) {
      this.#setInstance(instance);
      await this.publishDevice();
    }

    const link = this.createLink({
      host: address.host,
      port: address.port,
      onError: (err) => this.#onSocketError(link, err),
    });
    this.link = link;
    this.#startTimer();
    // First cycle right away, without waiting for the timer.
    this.poll().catch(() => {});
  }

  #cacheKey() {
    return `${this.address.host}:${this.address.port}`;
  }

  #setInstance(instance) {
    const owner = `${this.#cacheKey()}/${instance}`;
    if (owner !== this.alarmOwner) {
      // Another device: its objects have their own alarms.
      this.alarmOwner = owner;
      this.alarmed.clear();
    }
    this.instance = instance;
    this.ids = this.gladys.externalIds('device', String(instance));
  }

  #stopLink() {
    clearInterval(this.timer);
    this.timer = null;
    const link = this.link;
    this.link = null;
    link?.close();
  }

  async stop() {
    this.#stopLink();
    await this.cycle;
  }

  /** Time between two cycles: the interval, or slower with many objects. */
  periodMs() {
    const count = Math.max(1, this.objects.length);
    return Math.max(
      Number(this.config.interval) * 1000,
      Math.ceil((count * 60_000) / STATES_PER_MINUTE),
    );
  }

  #startTimer() {
    if (!this.timers) {
      return;
    }
    this.timer = setInterval(() => this.poll().catch(() => {}), this.periodMs());
    this.timer.unref?.();
  }

  #onSocketError(link, err) {
    if (link !== this.link) {
      return;
    }
    logger.error(`BACnet/IP socket error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      this.status.code = 'portInUse';
      this.#setConnectionStatus(false, STATUS.portInUse);
    }
  }

  // --- Polling -----------------------------------------------------------------

  /** One cycle: metadata when needed, then the values. Resolves when done. */
  poll() {
    if (this.cycling || !this.link) {
      return this.cycle;
    }
    this.cycling = true;
    const link = this.link;
    this.cycle = this.#cycle(link).finally(() => {
      this.cycling = false;
    });
    return this.cycle;
  }

  async #cycle(link) {
    const stale = () => link !== this.link;
    try {
      if (this.config.device_instance === null && !this.metaReady) {
        const instance = await link.readDeviceInstance();
        if (stale()) {
          return;
        }
        if (instance !== this.instance) {
          // Another device than the cached one: forget its objects.
          this.cache = {};
          this.objects.forEach((object) => this.#unresolve(object));
          this.#setInstance(instance);
        }
      } else if (this.instance === null) {
        this.#setInstance(this.config.device_instance);
      }
      const results = await link.readObjects(this.#specs());
      if (stale()) {
        return;
      }
      const deviceResult = results[0];
      if (isUnknownObject(deviceResult[PROPERTY.OBJECT_NAME])) {
        throw new LinkError('wrongInstance', 'Unknown device instance');
      }
      if (!this.metaReady || this.objects.some((object) => object.needsMeta)) {
        await this.#applyMeta(deviceResult, results.slice(1));
        if (stale()) {
          return;
        }
      }
      this.#applyValues(results.slice(1));
      await this.#up();
      await this.flush();
    } catch (err) {
      if (stale()) {
        return;
      }
      await this.#failed(err);
    }
  }

  /** The read requests of a cycle: the device first, then each object. */
  #specs() {
    const deviceProps = this.metaReady
      ? [PROPERTY.OBJECT_NAME]
      : [PROPERTY.OBJECT_NAME, PROPERTY.VENDOR_NAME, PROPERTY.MODEL_NAME];
    const specs = [
      { objectId: { type: DEVICE_TYPE, instance: this.instance }, properties: deviceProps },
    ];
    for (const object of this.objects) {
      const properties = [PROPERTY.PRESENT_VALUE, PROPERTY.STATUS_FLAGS];
      if (object.needsMeta) {
        properties.push(PROPERTY.OBJECT_NAME);
        if (object.family === 'analog') {
          properties.push(PROPERTY.UNITS);
        }
        if (object.family === 'multistate') {
          properties.push(PROPERTY.NUMBER_OF_STATES, PROPERTY.STATE_TEXT);
        }
        if (!object.input) {
          properties.push(PROPERTY.RELINQUISH_DEFAULT);
        }
      }
      specs.push({ objectId: { type: object.type, instance: object.instance }, properties });
    }
    return specs;
  }

  /**
   * Read the metadata of the objects that need it. An object that cannot be
   * read keeps its cached metadata (a controller still booting answers errors
   * for a while) and is read again on the next cycles; it is never dropped
   * from the published device on an error.
   */
  async #applyMeta(deviceResult, results) {
    const text = (result) => {
      const value = result?.values?.[0];
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    };
    let changed = !this.metaReady;
    if (!this.metaReady) {
      this.deviceInfo = {
        name: text(deviceResult[PROPERTY.OBJECT_NAME]) ?? this.deviceInfo.name,
        vendor: text(deviceResult[PROPERTY.VENDOR_NAME]) ?? this.deviceInfo.vendor,
        model: text(deviceResult[PROPERTY.MODEL_NAME]) ?? this.deviceInfo.model,
      };
      this.metaReady = true;
    }
    for (const [index, object] of this.objects.entries()) {
      if (!object.needsMeta) {
        continue;
      }
      const result = results[index];
      const presentValue = result[PROPERTY.PRESENT_VALUE];
      if (presentValue?.error) {
        if (!object.resolved) {
          object.problem = isUnknownObject(presentValue)
            ? { code: 'notFound', params: { object: object.text } }
            : {
                code: 'unreadable',
                params: {
                  object: object.text,
                  error: bacnetErrorName(presentValue.error.errorCode),
                },
              };
        }
        continue;
      }
      const meta = {
        name: text(result[PROPERTY.OBJECT_NAME]),
        units: Number(result[PROPERTY.UNITS]?.values?.[0] ?? NaN),
        numberOfStates: Number(result[PROPERTY.NUMBER_OF_STATES]?.values?.[0] ?? NaN),
        stateText: (result[PROPERTY.STATE_TEXT]?.values ?? []).map((value) => String(value)),
        commandable: Boolean(result[PROPERTY.RELINQUISH_DEFAULT]?.values),
      };
      if (!Number.isFinite(meta.units)) {
        delete meta.units;
      }
      if (!Number.isInteger(meta.numberOfStates) || meta.numberOfStates < 1) {
        delete meta.numberOfStates;
      }
      object.needsMeta = false;
      if (JSON.stringify(this.cache[object.key]) !== JSON.stringify(meta) || !object.resolved) {
        changed = true;
      }
      this.cache[object.key] = meta;
      this.#resolve(object, meta);
    }
    if (!changed) {
      return;
    }
    await this.store.set(this.#cacheKey(), {
      instance: this.instance,
      device: this.deviceInfo,
      objects: this.cache,
    });
    await this.publishDevice();
  }

  #resolve(object, meta) {
    delete object.problem;
    const { kind, unit } = resolveKind(object, meta);
    object.meta = meta;
    object.resolvedKind = kind;
    object.publishUnit = unit;
    object.numberOfStates = meta.numberOfStates;
    object.stateText = meta.stateText ?? [];
    object.commandable = meta.commandable;
    object.resolved = true;
  }

  #unresolve(object) {
    object.resolved = false;
    delete object.meta;
  }

  #applyValues(results) {
    for (const [index, object] of this.objects.entries()) {
      const result = results[index];
      if (!object.resolved || !result) {
        continue;
      }
      const presentValue = result[PROPERTY.PRESENT_VALUE];
      if (presentValue?.error) {
        logger.debug(`${object.text}: ${bacnetErrorName(presentValue.error.errorCode)}`);
        continue;
      }
      const flags = readFlags(result[PROPERTY.STATUS_FLAGS]?.values?.[0]);
      this.#onFlags(object, flags);
      const state = toState(this.#valueObject(object), presentValue?.values?.[0]);
      if (state === null) {
        continue;
      }
      this.latest.set(object.key, state);
      this.status.lastValueAt = this.now();
    }
  }

  /** The object as values.js wants it: kind and unit resolved. */
  #valueObject(object) {
    return { ...object, unit: object.publishUnit };
  }

  #onFlags(object, flags) {
    object.flags = flags;
    const alarm = flags.inAlarm || flags.fault;
    if (alarm && !this.alarmed.has(object.key)) {
      this.alarmed.add(object.key);
      this.#fireTrigger(TRIGGERS.OBJECT_ALARM, {
        object_name: this.#nameOf(object),
        flag: flags.fault ? 'fault' : 'in-alarm',
      });
    } else if (!alarm) {
      this.alarmed.delete(object.key);
    }
  }

  async #up() {
    this.failures = 0;
    if (this.status.connected === true) {
      return;
    }
    const wasDown = this.status.connected === false;
    this.status.connected = true;
    this.status.code = null;
    const where = `${this.address.host}:${this.address.port}`;
    if (wasDown && this.issues.isFailing('link')) {
      this.issues.ok('link', `BACnet device ${this.instance} at ${where} answers again`);
    } else {
      const count = this.objects.filter((object) => object.resolved).length;
      logger.info(`Connected to the BACnet device ${this.instance} at ${where} (${count} objects)`);
    }
    await this.#setConnectionStatus(true);
    await this.#publishTransport('local');
    if (wasDown) {
      this.#fireTrigger(TRIGGERS.RECONNECTED, {});
    }
    this.onChange();
  }

  async #failed(err) {
    let code;
    if (err.code === 'wrongInstance') {
      code = 'wrongInstance';
    } else if (err.code === 'timeout' || err.code === 'closed') {
      code = 'unreachable';
    } else if (this.config.device_instance === null && this.instance === null) {
      code = 'noInstance';
    } else {
      code = 'failed';
    }
    this.failures += 1;
    const where = this.address ? `${this.address.host}:${this.address.port}` : '?';
    if (code === 'failed') {
      logger.debug(`BACnet cycle failed: ${err.message}`);
    }
    if (this.status.connected === true && this.failures < FAILURES_BEFORE_DOWN) {
      logger.debug(`BACnet device at ${where} missed one cycle (${err.message})`);
      return;
    }
    if (this.status.connected === false && this.status.code === code) {
      return;
    }
    const wasUp = this.status.connected === true;
    this.status.connected = false;
    this.status.code = code;
    // Old values must not be re-sent by the heartbeat while the device is away.
    this.latest.clear();
    this.issues.fail('link', `BACnet device at ${where} unavailable (${code}: ${err.message})`);
    await this.#setConnectionStatus(false, STATUS[code]);
    await this.#publishTransport('unreachable');
    if (wasUp) {
      this.#fireTrigger(TRIGGERS.DISCONNECTED, {
        error: pick(STATUS[code], this.config.language),
      });
    }
    this.onChange();
  }

  async #setConnectionStatus(connected, message) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`setConnectionStatus failed: ${err.message}`);
    }
  }

  async #publishTransport(transport) {
    if (!this.#createdDevice()) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: this.ids.device, transport }]);
    } catch (err) {
      logger.debug(`publishTransports failed: ${err.message}`);
    }
  }

  #fireTrigger(key, data) {
    if (!this.ids) {
      return;
    }
    const payload = { device: this.ids.device, device_name: this.deviceName(), ...data };
    this.gladys.publishSceneEvent(key, payload).catch((err) => {
      logger.debug(`Scene event ${key} refused: ${err.message}`);
    });
  }

  // --- Device ----------------------------------------------------------------

  /** The name of the device: the one given in Gladys, else its objectName. */
  deviceName() {
    return this.#createdDevice()?.name ?? this.#defaultName();
  }

  #defaultName() {
    return (this.deviceInfo.name ?? `BACnet ${this.instance ?? ''}`.trim()).slice(0, 80);
  }

  #createdDevice() {
    return (
      this.ids &&
      (this.gladys.devices ?? []).find((device) => device.external_id === this.ids.device)
    );
  }

  /** Declared bounds, else those of the kind (a °F setpoint: 32 to 212). */
  boundsOf(object) {
    const kind = KINDS[object.resolvedKind];
    const fahrenheit = object.resolvedKind === 'setpoint' && object.publishUnit === 'fahrenheit';
    return {
      min: object.min ?? (fahrenheit ? 32 : kind.min),
      max: object.max ?? (fahrenheit ? 212 : kind.max),
    };
  }

  /** The objects published as features, with their final names. */
  features() {
    if (!this.ids) {
      return [];
    }
    const resolved = this.objects.filter((object) => object.resolved);
    const names = uniqueNames(resolved.map((o) => o.name ?? o.meta?.name ?? o.text));
    return resolved.map((object, index) => {
      const kind = KINDS[object.resolvedKind];
      const { unit } = publishedUnit(object.resolvedKind, object.publishUnit);
      const writable = Boolean(kind.writable && object.write && this.config.allow_write);
      let { min, max } = this.boundsOf(object);
      if (object.resolvedKind === 'state') {
        max = Math.max(min, object.numberOfStates ?? 1);
      }
      if (min > max) {
        [min, max] = [max, min];
      }
      return {
        object,
        feature: {
          name: names[index],
          external_id: this.ids.feature(object.key),
          category: kind.category,
          type: kind.type,
          ...(unit ? { unit } : {}),
          min,
          max,
          read_only: !writable,
          has_feedback: true,
          keep_history: !kind.text,
        },
      };
    });
  }

  buildDevice() {
    const features = this.features().map(({ feature }) => feature);
    if (features.length === 0) {
      return null;
    }
    const model = [this.deviceInfo.vendor, this.deviceInfo.model].filter(Boolean).join(' ');
    return {
      name: this.#defaultName(),
      external_id: this.ids.device,
      model: (model || 'BACnet/IP').slice(0, 80),
      should_poll: false,
      features,
    };
  }

  async publishDevice() {
    const device = this.buildDevice();
    await this.gladys.publishDiscoveredDevices(device ? [device] : []);
  }

  async rescan() {
    await this.publishDevice();
  }

  /** A device was added in Gladys: its features exist now, send every value. */
  async onDeviceCreated(device) {
    if (this.ids && device?.external_id === this.ids.device) {
      this.gladys.forgetPublishedStates(this.ids.device);
      await this.flush();
      await this.#publishTransport(this.status.connected ? 'local' : 'unreachable');
    }
  }

  /** Publish the latest values of the features Gladys has. */
  async flush() {
    const created = this.#createdDevice();
    if (!created) {
      return;
    }
    const known = new Set((created.features ?? []).map((feature) => feature.external_id));
    const states = [];
    for (const [key, state] of this.latest) {
      const externalId = this.ids.feature(key);
      if (known.size > 0 && !known.has(externalId)) {
        continue;
      }
      states.push(
        typeof state === 'object'
          ? { device_feature_external_id: externalId, text: state.text }
          : { device_feature_external_id: externalId, state },
      );
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      this.issues.ok('publish', 'Gladys accepts the values again');
    } catch (err) {
      this.issues.fail('publish', `Gladys refused the values: ${err.message}`);
    }
  }

  // --- Writes ----------------------------------------------------------------

  /** A declared object by feature name, configured name, objectName or identifier. */
  findObject(text) {
    const wanted = String(text ?? '').trim();
    const lower = wanted.toLowerCase();
    const entry = this.features().find(
      ({ object, feature }) =>
        feature.name.toLowerCase() === lower || object.name?.toLowerCase() === lower,
    );
    if (entry) {
      return entry.object;
    }
    const id = parseObjectId(wanted);
    return this.objects.find(
      (object) =>
        (id && object.type === id.type && object.instance === id.instance) ||
        object.name?.toLowerCase() === lower ||
        object.meta?.name?.toLowerCase() === lower,
    );
  }

  /** The object of a feature external id. */
  objectOfFeature(externalId) {
    return this.objects.find((object) => this.ids && this.ids.feature(object.key) === externalId);
  }

  #nameOf(object) {
    return (
      this.features().find((entry) => entry.object === object)?.feature.name ??
      object.name ??
      object.text
    );
  }

  #checkWritable(object) {
    if (!object) {
      throw new WriteError('unknownObject', { name: '?' });
    }
    const name = this.#nameOf(object);
    if (!this.config.allow_write) {
      throw new WriteError('writeDisabled');
    }
    if (!object.write) {
      throw new WriteError('notDeclaredWritable', { name });
    }
    if (!object.resolved) {
      throw new WriteError('notResolved', { name });
    }
    if (!this.link || this.status.connected !== true) {
      throw new WriteError('notConnected');
    }
    return name;
  }

  /** The priority of a write: the one given, else the configured one. */
  priorityOf(text) {
    const given = String(text ?? '').trim();
    if (given === '') {
      return this.config.write_priority;
    }
    const number = Number(given);
    if (!Number.isInteger(number) || number < 1 || number > 16) {
      throw new WriteError('badPriority', { value: given });
    }
    return number;
  }

  /**
   * Write a value to a declared object. Throws a WriteError.
   * @returns {Promise<{ name: string, shown: unknown, priority: number }>}
   */
  async write(object, input, priorityText) {
    const name = this.#checkWritable(object);
    const priority = this.priorityOf(priorityText);
    const kind = KINDS[object.resolvedKind];
    const target = this.#valueObject(object);
    if (kind.writable) {
      // A dashboard control or a scene "set value" is held to the bounds the
      // feature was published with: the core never enforces them.
      Object.assign(target, this.boundsOf(object));
    }
    const { tag, value, shown } = toWrite(target, input);
    await this.#send(object, { type: tag, value }, priority);
    logger.info(`Wrote ${shown} to ${name} (${object.text}) at priority ${priority}`);
    return { name, shown, priority };
  }

  /** Relinquish a priority of a declared object. Throws a WriteError. */
  async release(object, priorityText) {
    const name = this.#checkWritable(object);
    const priority = this.priorityOf(priorityText);
    if (!object.commandable) {
      throw new WriteError('notCommandable', { name });
    }
    await this.#send(object, { type: TAG.NULL, value: null }, priority);
    logger.info(`Released priority ${priority} of ${name} (${object.text})`);
    return { name, priority };
  }

  async #send(object, tagged, priority) {
    const objectId = { type: object.type, instance: object.instance };
    try {
      await this.link.writePresentValue(objectId, tagged, priority);
    } catch (err) {
      if (err.code === 'bacnet') {
        throw new WriteError('refused', { error: bacnetErrorName(err.errorCode) });
      }
      if (err.code === 'timeout') {
        throw new WriteError('noAnswer');
      }
      throw new WriteError('failed', { detail: String(err.message).slice(0, 120) });
    }
    // Feedback: read the value the device now has, publish it at once.
    try {
      const [result] = await this.link.readObjects([
        { objectId, properties: [PROPERTY.PRESENT_VALUE] },
      ]);
      const state = toState(this.#valueObject(object), result[PROPERTY.PRESENT_VALUE]?.values?.[0]);
      if (state !== null) {
        this.latest.set(object.key, state);
        await this.flush();
        this.onChange();
      }
    } catch (err) {
      logger.debug(`Reading back ${object.text} failed: ${err.message}`);
    }
  }

  // --- Reports ---------------------------------------------------------------

  /** Every problem of the configuration, as multi-language texts. */
  problems() {
    return [
      ...this.configErrors.map((error) => objectError(error)),
      ...this.objects
        .filter((object) => object.problem)
        .map((object) =>
          objectError({ entry: object.entry, name: object.name, ...object.problem }),
        ),
    ];
  }

  /** The current connection message, or null when connected. */
  statusMessage() {
    if (this.status.connected === true) {
      return null;
    }
    return this.status.code ? (STATUS[this.status.code] ?? STATUS.unreachable) : null;
  }

  /** Objects read, and how many are in alarm or fault. */
  counts() {
    const read = this.objects.filter((object) => object.resolved);
    return {
      total: read.length,
      alarms: read.filter((object) => object.flags?.inAlarm || object.flags?.fault).length,
    };
  }
}

function isUnknownObject(result) {
  return (
    result?.error?.errorClass === ERROR_CLASS.OBJECT &&
    result?.error?.errorCode === ERROR_CODE.UNKNOWN_OBJECT
  );
}

// -----------------------------------------------------------------------------
// The pure pieces: the Objects field, the configuration, BACnet values ↔
// Gladys states, and the widget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { normalizeConfig, parseAddress } from '../src/config.js';
import { readFlags } from '../src/hub.js';
import { parseObjectId, parseObjects, uniqueNames } from '../src/objects.js';
import { WriteError, resolveKind, toState, toWrite } from '../src/values.js';
import { WIDGET_KEY } from '../src/widgets.js';
import { createWorld } from './helpers/world.js';
import { AHU, AHU_OBJECTS } from './fixtures/devices.js';

test('object identifiers in every common spelling', () => {
  for (const text of ['analog-input:1', 'ai:1', 'AI1', 'OBJECT_ANALOG_INPUT:1', 'analog_input,1']) {
    assert.deepEqual(parseObjectId(text), { type: 0, instance: 1 }, text);
  }
  assert.deepEqual(parseObjectId('msv:12'), { type: 19, instance: 12 });
  assert.deepEqual(parseObjectId('multi-state-output:4194302'), { type: 14, instance: 4194302 });
  for (const text of ['', 'ai', 'ai:-1', 'ai:4194303', 'schedule:1', 'device:1', 'ai:1.5']) {
    assert.equal(parseObjectId(text), null, text);
  }
});

test('the Objects field: names, kinds, options, and every mistake', () => {
  const { objects, errors } = parseObjects(
    ' Supply air: ai:1 ;bo:2 switch; Mode: msv:3 text write; Heat: ai:4 energy unit=Wh scale=0,1 precision=2; ai:1; xx; Bad: ai:5 scale=0; av:6 min=5 max=1; bi:7 write; ai:8 switch; ai:9 temperature unit=bar; ai:10 foo=1; ai:11 unit=parsec;',
  );
  assert.deepEqual(
    objects.map((o) => [o.name, o.key, o.kind, o.write]),
    [
      ['Supply air', 'ai-1', null, false],
      [null, 'bo-2', 'switch', true],
      ['Mode', 'msv-3', 'text', true],
      ['Heat', 'ai-4', 'energy', false],
    ],
  );
  assert.deepEqual(
    [objects[3].unit, objects[3].scale, objects[3].precision],
    ['watt-hour', 0.1, 2],
  );
  assert.deepEqual(
    errors.map((e) => [e.entry, e.code]),
    [
      [5, 'duplicateObject'],
      [6, 'badObject'],
      [7, 'badNumber'],
      [8, 'minMax'],
      [9, 'inputNotWritable'],
      [10, 'kindOfObject'],
      [11, 'unitOfKind'],
      [12, 'unknownWord'],
      [13, 'unknownUnit'],
    ],
  );
});

test('more than 100 objects: the rest is refused', () => {
  const text = Array.from({ length: 102 }, (_, i) => `av:${i}`).join(';');
  const { objects, errors } = parseObjects(text);
  assert.equal(objects.length, 100);
  assert.deepEqual(
    errors.map((e) => e.code),
    ['tooMany', 'tooMany'],
  );
});

test('names are cut to 40 characters and made distinct', () => {
  assert.deepEqual(uniqueNames(['A', 'A', 'B', 'x'.repeat(50)]), ['A', 'A 2', 'B', 'x'.repeat(40)]);
});

test('the configuration: defaults, an empty instance is not instance 0, the address', () => {
  const config = normalizeConfig({ device_instance: '', port: null, write_priority: 30 });
  assert.equal(config.device_instance, null);
  assert.equal(config.badInstance, false);
  assert.equal(config.port, 47808);
  assert.equal(config.write_priority, 8);
  assert.equal(config.interval, '30');
  assert.equal(normalizeConfig({ device_instance: 0 }).device_instance, 0);
  assert.equal(normalizeConfig({ device_instance: '12.5' }).badInstance, true);
  assert.equal(normalizeConfig({ allow_write: 'true' }).allow_write, true);

  assert.deepEqual(parseAddress('192.0.2.5'), { host: '192.0.2.5', port: 47808 });
  assert.deepEqual(parseAddress('192.0.2.5:47809'), { host: '192.0.2.5', port: 47809 });
  assert.deepEqual(parseAddress('plc.local', 47810), { host: 'plc.local', port: 47810 });
  assert.deepEqual(parseAddress(''), { error: 'noAddress' });
  for (const bad of ['bacnet://192.0.2.5', '192.0.2.5:99999', 'a b', '192.0.2.5/24']) {
    assert.deepEqual(parseAddress(bad), { error: 'badAddress' }, bad);
  }
});

test('kinds and units from the BACnet units, or as declared', () => {
  const analog = { family: 'analog', kind: null, write: false };
  assert.deepEqual(resolveKind(analog, { units: 62 }), { kind: 'temperature', unit: 'celsius' });
  assert.deepEqual(resolveKind({ ...analog, write: true }, { units: 62 }), {
    kind: 'setpoint',
    unit: 'celsius',
  });
  assert.deepEqual(resolveKind(analog, { units: 95 }), { kind: 'value', unit: null });
  assert.deepEqual(resolveKind(analog, { units: 96 }), { kind: 'value', unit: 'ppm' });
  assert.deepEqual(resolveKind({ ...analog, kind: 'co2' }, { units: 96 }), {
    kind: 'co2',
    unit: 'ppm',
  });
  assert.deepEqual(resolveKind({ ...analog, unit: 'kilowatt' }, { units: 98 }), {
    kind: 'power',
    unit: 'kilowatt',
  });
  assert.deepEqual(resolveKind({ family: 'binary', write: true }), { kind: 'switch', unit: null });
  assert.deepEqual(resolveKind({ family: 'multistate' }), { kind: 'state', unit: null });
});

test('values read: REAL noise, scale and offset, Wh to kWh, binary, states', () => {
  const temperature = { family: 'analog', resolvedKind: 'temperature', unit: 'celsius' };
  assert.equal(toState(temperature, 21.299999237060547), 21.3);
  assert.equal(toState({ ...temperature, scale: 0.1, offset: -1 }, 215), 20.5);
  assert.equal(toState({ ...temperature, precision: 0 }, 21.6), 22);
  assert.equal(toState({ family: 'analog', resolvedKind: 'energy', unit: 'watt-hour' }, 1500), 1.5);
  assert.equal(toState({ family: 'binary', resolvedKind: 'binary' }, 1), 1);
  assert.equal(toState({ family: 'binary', resolvedKind: 'binary' }, 0), 0);
  const states = { family: 'multistate', stateText: ['Off', 'On'] };
  assert.equal(toState({ ...states, resolvedKind: 'state' }, 2), 2);
  assert.deepEqual(toState({ ...states, resolvedKind: 'text' }, 2), { text: 'On' });
  assert.deepEqual(toState({ ...states, resolvedKind: 'text' }, 5), { text: '5' });
  assert.equal(toState(temperature, null), null);
  assert.equal(toState(temperature, 'NaN'), null);
});

test('values written: the BACnet tag, the reverse scale, every refusal', () => {
  const setpoint = { family: 'analog', resolvedKind: 'setpoint', unit: 'celsius' };
  assert.deepEqual(toWrite(setpoint, '21,5'), { tag: 4, value: 21.5, shown: 21.5 });
  assert.deepEqual(toWrite({ ...setpoint, scale: 0.1 }, 21.5).value, 215);
  const energy = { family: 'analog', resolvedKind: 'energy', unit: 'watt-hour' };
  assert.equal(toWrite(energy, 2).value, 2000);
  assert.deepEqual(toWrite({ family: 'binary' }, 'ON'), { tag: 9, value: 1, shown: 1 });
  assert.deepEqual(toWrite({ family: 'binary' }, 'inactive').value, 0);
  const mode = { family: 'multistate', numberOfStates: 3, stateText: ['Off', 'Auto', 'On'] };
  assert.deepEqual(toWrite(mode, 'auto'), { tag: 2, value: 2, shown: 'Auto' });
  assert.equal(toWrite(mode, '3').value, 3);
  const refusals = [
    [setpoint, 'hot', 'notANumber'],
    [{ ...setpoint, min: 5, max: 30 }, '35', 'outOfBounds'],
    [{ family: 'binary' }, '2', 'notBoolean'],
    [mode, '4', 'notAState'],
    [mode, 'Eco', 'notAState'],
    [mode, '1.5', 'notAState'],
  ];
  for (const [object, input, code] of refusals) {
    assert.throws(
      () => toWrite(object, input),
      (err) => err instanceof WriteError && err.code === code,
      `${input}`,
    );
  }
});

test('statusFlags: bit 0 in alarm, bit 1 fault, bit 3 out of service (as bacserv sends them)', () => {
  assert.deepEqual(readFlags({ value: [8], bitsUsed: 4 }), {
    inAlarm: false,
    fault: false,
    overridden: false,
    outOfService: true,
  });
  assert.equal(readFlags({ value: [3], bitsUsed: 4 }).fault, true);
  assert.equal(readFlags(undefined).inAlarm, false);
});

test('the widget: tiles of the device, the link status, hidden on demand', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    const settings = { device: world.device.external_id };
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language: 'fr' });
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
    assert.equal(content.components.length, 7);
    const ids = new Set(world.device.features.map((f) => f.external_id));
    for (const component of content.components.slice(0, 6)) {
      assert.ok(ids.has(component.device_feature), 'tile of a published feature');
    }
    const status = content.components[6];
    assert.deepEqual(status.items.map((item) => item.value).slice(0, 2), ['Répond', '0/12']);

    const hidden = await world.fake.widgetGet(WIDGET_KEY, {
      settings: { ...settings, hide_status: true },
    });
    assert.equal(hidden.data.content.components.length, 6);

    const none = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
    assert.match(none.data.content.components[0].text.en, /Choose the BACnet device/);
    const foreign = await world.fake.widgetGet(WIDGET_KEY, { settings: { device: 'x' } });
    assert.match(foreign.data.content.components[0].text.en, /no longer/);
  } finally {
    await world.stop();
  }
});

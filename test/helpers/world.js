// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake BACnet device, an
// in-memory /data, and the integration wired on top through registerHandlers
// — the very wiring index.js uses.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { MemoryStore } from '../../src/store.js';
import { createFakeDevice } from './fakeBacnet.js';

// Keep the test output readable (LOG_LEVEL is read on every log call).
// LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const ADDRESS = '192.0.2.10';

/**
 * @param {object} options
 * @param {object} options.fixture device served by the fake link
 * @param {object} [options.config] integration config (address added)
 * @param {boolean} [options.connect]
 * @param {boolean} [options.createAll] add the discovered device to Gladys
 * @param {object} [options.store]
 * @param {(device: object) => void} [options.before] adjust the device before connecting
 * @param {() => number} [options.now]
 */
export async function createWorld({
  fixture,
  config = {},
  connect = true,
  createAll = true,
  store = new MemoryStore(),
  before = () => {},
  now,
} = {}) {
  const device = createFakeDevice(fixture);
  before(device);
  const gladys = createFakeGladys({ config: { address: ADDRESS, ...config } });
  const app = registerHandlers(gladys, {
    store,
    createLink: device.createLink,
    timers: false,
    now,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    app,
    hub: app.hub,
    bacnet: device,
    store,
    /** Run one polling cycle (the timer's job) and wait for it. */
    async poll() {
      await app.hub.cycle;
      await app.hub.poll();
    },
    async settle() {
      await app.hub.cycle;
    },
    async createDevices(devices = gladys.fake.discoveredDevices) {
      for (const discovered of devices) {
        await gladys.fake.deviceCreated(discovered);
      }
    },
    get device() {
      return gladys.fake.discoveredDevices[0];
    },
    feature(name) {
      const feature = world.device?.features.find((candidate) => candidate.name === name);
      if (!feature) {
        throw new Error(`No feature ${name}`);
      }
      return feature;
    },
    /** The last state published for a feature, by name. */
    state(name) {
      return gladys.fake.lastState(world.feature(name).external_id);
    },
    async stop() {
      await app.stop();
    },
  };
  if (connect) {
    await gladys.connect();
    await world.settle();
    if (createAll && world.device) {
      await world.createDevices();
      await world.settle();
    }
  }
  return world;
}

/**
 * Capture the log lines written at `level` and above while `run` runs.
 * @returns {Promise<string[]>}
 */
export async function captureLogs(t, run, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  try {
    await run();
  } finally {
    process.env.LOG_LEVEL = previous;
    console.log.mock.restore();
    console.error.mock.restore();
  }
  return lines;
}

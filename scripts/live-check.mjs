// -----------------------------------------------------------------------------
// Live check against a real BACnet/IP device (or the bacnet-stack simulator),
// through the SDK's fake Gladys and the very wiring of index.js. Not part of
// the test suite (the tests never touch the network).
//
//   node scripts/live-check.mjs <ip[:port]> "<objects>" [instance]
//
// It reads the device, adds it to the fake Gladys, lists the objects, writes
// and releases the first writable object, then prints what Gladys received.
// -----------------------------------------------------------------------------

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';

const [address, objects = '', instance = ''] = process.argv.slice(2);
if (!address) {
  console.error('Usage: node scripts/live-check.mjs <ip[:port]> "<objects>" [instance]');
  process.exit(2);
}
const dataDir = await mkdtemp(join(process.env.LIVE_DATA_DIR ?? tmpdir(), 'bacnet-'));
const gladys = createFakeGladys({
  config: {
    address,
    objects,
    device_instance: instance,
    allow_write: true,
    language: 'en',
  },
});
const app = registerHandlers(gladys, { store: new Store(dataDir), timers: false });
const show = (label, value) => console.log(`${label}:`, JSON.stringify(value, null, 1));
const step = async (label, run) => {
  try {
    show(label, await run());
  } catch (err) {
    show(`${label} (error)`, err.message);
  }
};

await gladys.connect();
await app.hub.cycle;
show('connection', gladys.fake.connectionStatus ?? app.hub.status);
const device = gladys.fake.discoveredDevices[0];
show('device', device);
if (device) {
  await gladys.fake.deviceCreated(device);
  await app.hub.poll();
  show(
    'states',
    device.features.map((feature) => [feature.name, gladys.fake.lastState(feature.external_id)]),
  );
}
await step('list_objects', async () => (await gladys.fake.action('list_objects', {})).data);
await step('check_config', async () => await gladys.fake.action('check_config', {}));
const writable = app.hub.objects.find((object) => object.write);
if (writable) {
  const value = process.env.LIVE_VALUE ?? '1';
  await step('write_value', () =>
    gladys.fake.action('write_value', { object: writable.text, value }),
  );
  await step('release_value', () => gladys.fake.action('release_value', { object: writable.text }));
}
await step('scene events', async () => gladys.fake.sceneEvents);
await app.stop();

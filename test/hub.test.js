// -----------------------------------------------------------------------------
// The hub against a fake BACnet device: discovery, values, polling by the
// container's own timer, loss and return of the device, alarms, writes from
// the dashboard, the cache under /data, and quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { normalizeConfig } from '../src/config.js';
import { MemoryStore } from '../src/store.js';
import { createFakeDevice, flagsOf } from './helpers/fakeBacnet.js';
import { ADDRESS, captureLogs, createWorld } from './helpers/world.js';
import { AHU, AHU_OBJECTS, BACSERV, BACSERV_OBJECTS } from './fixtures/devices.js';

test('one device for the BACnet device, one feature per object, the values published on creation', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    const device = world.device;
    assert.equal(device.name, 'AHU-01');
    assert.equal(device.model, 'Example Controls HVAC controller');
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
    assert.ok(device.external_id.endsWith(':2001'), 'keyed on the device instance');
    const byName = Object.fromEntries(device.features.map((f) => [f.name, f]));
    assert.deepEqual(
      [byName['Supply air temperature'].category, byName['Supply air temperature'].unit],
      ['temperature-sensor', 'celsius'],
    );
    assert.equal(byName.Humidity.category, 'humidity-sensor');
    assert.deepEqual([byName.CO2.category, byName.CO2.unit], ['co2-sensor', 'ppm']);
    assert.deepEqual([byName['Filter pressure drop'].unit], ['pascal']);
    assert.deepEqual([byName.Heat.type, byName.Heat.unit], ['index', 'kilowatt-hour']);
    assert.deepEqual([byName['Fan power'].type, byName['Fan power'].unit], ['power', 'kilowatt']);
    assert.equal(byName['Filter alarm'].category, 'input');
    assert.equal(byName.Mode.category, 'text');
    assert.deepEqual([byName['Fan stage'].min, byName['Fan stage'].max], [1, 3]);
    // Feature keys: the object identifier, stable whatever the name.
    assert.ok(byName.Setpoint.external_id.endsWith(':av-10'));

    // REAL float noise rounded, Wh converted to kWh, state text.
    assert.equal(world.state('Supply air temperature'), 19.3);
    assert.equal(world.state('Heat'), 15234.57);
    assert.deepEqual(world.fake.lastState(byName.Mode.external_id), 'Comfort');
    assert.equal(world.state('Fan stage'), 2);
    assert.equal(world.state('Fan'), 1);
  } finally {
    await world.stop();
  }
});

test('nothing is published for a device not added to Gladys yet', async () => {
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS },
    createAll: false,
  });
  try {
    assert.equal(world.fake.states.length, 0);
    await world.createDevices();
    await world.settle();
    assert.ok(world.fake.states.length > 0, 'values sent once the device exists');
  } finally {
    await world.stop();
  }
});

test('each poll publishes the changed values only', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    const before = world.fake.states.length;
    await world.poll();
    assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');
    world.bacnet.set('0:1', 85, 18.5);
    await world.poll();
    assert.equal(world.fake.states.length, before + 1);
    assert.equal(world.state('Supply air temperature'), 18.5);
  } finally {
    await world.stop();
  }
});

test('the container polls by its own timer, without the core calling onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const device = createFakeDevice(AHU);
  const gladys = createFakeGladys({ config: { address: ADDRESS, objects: AHU_OBJECTS } });
  const app = registerHandlers(gladys, {
    store: new MemoryStore(),
    createLink: device.createLink,
  });
  try {
    await gladys.connect();
    await app.hub.cycle;
    await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
    device.set('0:2', 85, 25);
    assert.equal(app.hub.periodMs(), 30_000);
    t.mock.timers.tick(30_000);
    await app.hub.cycle;
    const feature = gladys.fake.discoveredDevices[0].features.find((f) =>
      f.external_id.endsWith(':ai-2'),
    );
    assert.equal(gladys.fake.lastState(feature.external_id), 25);
  } finally {
    await app.stop();
  }
});

test('the interval slows down with many objects, to stay under 300 states a minute', async () => {
  const objects = Array.from({ length: 100 }, (_, i) => `av:${i + 1}`).join('; ');
  const world = await createWorld({
    fixture: AHU,
    config: { objects, interval: '10' },
    connect: false,
  });
  try {
    await world.gladys.connect();
    await world.settle();
    assert.equal(world.hub.periodMs(), 25_000);
  } finally {
    await world.stop();
  }
});

test('the instance is read from the device when not given, or taken from the field', async () => {
  const read = await createWorld({ fixture: BACSERV, config: { objects: BACSERV_OBJECTS } });
  const given = await createWorld({
    fixture: BACSERV,
    config: { objects: BACSERV_OBJECTS, device_instance: 1234 },
    before: (device) => {
      device.noWildcard = true;
    },
  });
  try {
    assert.equal(read.hub.instance, 1234);
    assert.equal(given.hub.instance, 1234);
    assert.equal(read.device.external_id, given.device.external_id);
  } finally {
    await read.stop();
    await given.stop();
  }
});

test('a wrong instance, or a device that hides its instance, is said in the status', async () => {
  const wrong = await createWorld({
    fixture: BACSERV,
    config: { objects: BACSERV_OBJECTS, device_instance: 77 },
  });
  const hidden = await createWorld({
    fixture: BACSERV,
    config: { objects: BACSERV_OBJECTS },
    before: (device) => {
      device.noWildcard = true;
    },
  });
  try {
    assert.match(wrong.fake.connectionStatus.message.en, /has no such instance/);
    assert.match(hidden.fake.connectionStatus.message.fr, /saisissez-la/);
    assert.equal(hidden.fake.discoveredDevices.length, 0);
  } finally {
    await wrong.stop();
    await hidden.stop();
  }
});

test('an object missing on the device is left out and reported', async () => {
  const world = await createWorld({
    fixture: BACSERV,
    config: { objects: `${BACSERV_OBJECTS}; Ghost: ai:99` },
  });
  try {
    assert.equal(world.device.features.length, 7);
    const problems = world.hub.problems();
    assert.equal(problems.length, 1);
    assert.match(problems[0].en, /^Entry 8 \(Ghost\): ai:99 does not exist on the device/);
  } finally {
    await world.stop();
  }
});

test('a restart with the device off publishes the same device, from the cache', async () => {
  const store = new MemoryStore();
  const first = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS }, store });
  const published = first.device;
  await first.stop();

  const second = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS },
    store,
    createAll: false,
    before: (device) => {
      device.off = true;
    },
  });
  try {
    assert.deepEqual(second.device, published);
    assert.equal(second.fake.connectionStatus.connected, false);
    assert.match(second.fake.connectionStatus.message.en, /does not answer/);
  } finally {
    await second.stop();
  }
});

test('losing and getting back the device fires the triggers once each, and resumes the values', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    world.bacnet.off = true;
    await world.poll();
    assert.equal(world.hub.status.connected, true, 'one missed answer is not a loss');
    await world.poll();
    await world.poll();
    assert.equal(world.hub.status.connected, false);
    const lost = world.fake.sceneEvents.filter((e) => e.key === 'device_disconnected');
    assert.equal(lost.length, 1);
    assert.equal(lost[0].data.device_name, 'AHU-01');
    assert.match(lost[0].data.error, /ne répond pas/, 'in the configured language (fr)');
    assert.deepEqual(world.fake.transports.at(-1), {
      device_external_id: world.device.external_id,
      transport: 'unreachable',
    });

    world.bacnet.off = false;
    world.bacnet.set('0:1', 85, 17);
    await world.poll();
    assert.equal(world.hub.status.connected, true);
    const back = world.fake.sceneEvents.filter((e) => e.key === 'device_reconnected');
    assert.equal(back.length, 1);
    assert.equal(world.state('Supply air temperature'), 17);
    assert.equal(world.fake.connectionStatus.connected, true);
  } finally {
    await world.stop();
  }
});

test('an object in alarm or fault fires the trigger once, until it clears', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    world.bacnet.set('3:5', 111, flagsOf(1)); // in-alarm
    await world.poll();
    await world.poll();
    let alarms = world.fake.sceneEvents.filter((e) => e.key === 'object_alarm');
    assert.equal(alarms.length, 1);
    assert.deepEqual(
      { object: alarms[0].data.object_name, flag: alarms[0].data.flag },
      { object: 'Filter alarm', flag: 'in-alarm' },
    );
    assert.deepEqual(world.hub.counts(), { total: 12, alarms: 1 });
    world.bacnet.set('3:5', 111, flagsOf(0));
    await world.poll();
    world.bacnet.set('3:5', 111, flagsOf(2)); // fault
    await world.poll();
    alarms = world.fake.sceneEvents.filter((e) => e.key === 'object_alarm');
    assert.equal(alarms.length, 2);
    assert.equal(alarms[1].data.flag, 'fault');
  } finally {
    await world.stop();
  }
});

test('the dashboard switch and setpoint write at the configured priority, only when allowed', async () => {
  const off = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  const on = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS, allow_write: true, write_priority: 12 },
  });
  try {
    assert.equal(off.feature('Fan').read_only, true, 'read-only while writing is off');
    const fan = on.feature('Fan');
    const setpoint = on.feature('Setpoint');
    assert.equal(fan.read_only, false);
    assert.deepEqual([setpoint.category, setpoint.type], ['water-heater', 'target-temperature']);

    await on.fake.setValue(on.device, fan, 0);
    await on.fake.setValue(on.device, setpoint, 21.5);
    assert.deepEqual(on.bacnet.writes, [
      { key: '4:1', type: 9, value: 0, priority: 12 },
      { key: '2:10', type: 4, value: 21.5, priority: 12 },
    ]);
    assert.equal(on.state('Fan'), 0, 'the value read back is published at once');
    assert.equal(on.state('Setpoint'), 21.5);

    const refused = await off.fake.setValue(off.device, off.feature('Fan'), 0);
    assert.equal(refused?.success ?? false, false);
    assert.equal(off.bacnet.writes.length, 0);
  } finally {
    await off.stop();
    await on.stop();
  }
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    const lines = await captureLogs(t, async () => {
      world.bacnet.set('0:1', 85, 20.5);
      await world.poll();
      await world.poll();
    });
    assert.deepEqual(lines, []);
  } finally {
    await world.stop();
  }
});

test('no address or a wrong one: the status asks for it, and nothing is discovered', async () => {
  for (const [address, expected] of [
    ['', /Enter the IP address/],
    ['http://192.0.2.1', /must be an IP address/],
  ]) {
    const world = await createWorld({ fixture: AHU, config: { address, objects: AHU_OBJECTS } });
    try {
      assert.equal(world.fake.discoveredDevices.length, 0);
      assert.match(world.fake.connectionStatus.message.en, expected);
      assert.equal(world.bacnet.links.length, 0, 'no socket opened');
    } finally {
      await world.stop();
    }
  }
});

test('a configuration change closes the old link and reads the new device', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    const [first] = world.bacnet.links;
    await world.fake.configUpdated({
      address: '192.0.2.11:47809',
      objects: 'ai:1',
      language: 'en',
    });
    await world.settle();
    assert.equal(first.closed, true);
    const second = world.bacnet.links.at(-1);
    assert.deepEqual([second.options.host, second.options.port], ['192.0.2.11', 47809]);
    assert.equal(world.device.features.length, 1);
  } finally {
    await world.stop();
  }
});

test('the values of a lost device are not re-sent', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    world.bacnet.off = true;
    await world.poll();
    await world.poll();
    const before = world.fake.states.length;
    await world.hub.flush();
    assert.equal(world.fake.states.length, before);
  } finally {
    await world.stop();
  }
});

test('an object unreadable for a while keeps its feature, and is read again', async () => {
  const store = new MemoryStore();
  const first = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS }, store });
  const published = first.device;
  await first.stop();
  // Restart while the controller boots: av:10 answers errors for a while.
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS },
    store,
    before: (device) => device.failing.add('2:10'),
  });
  try {
    assert.deepEqual(world.device, published, 'the feature is still published');
    world.bacnet.failing.clear();
    world.bacnet.set('2:10', 85, 22);
    await world.poll();
    assert.deepEqual(world.device, published);
    assert.equal(world.state('Setpoint'), 22);
    assert.ok((await store.get('192.0.2.10:47808')).objects['av-10'], 'still cached');
  } finally {
    await world.stop();
  }
});

test('an object unreadable at the very first start appears once it answers', async () => {
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS },
    before: (device) => device.failing.add('2:10'),
  });
  try {
    assert.equal(world.device.features.length, 11);
    assert.match(world.hub.problems()[0].en, /av:10 cannot be read \(operational-problem\)/);
    world.bacnet.failing.clear();
    await world.poll();
    assert.equal(world.fake.discoveredDevices.at(-1).features.length, 12);
    assert.deepEqual(world.hub.problems(), []);
  } finally {
    await world.stop();
  }
});

test('two quick saves leave one link open, the last one', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    world.bacnet.off = true;
    await Promise.all([
      world.fake.configUpdated({ address: ADDRESS, objects: 'ai:1' }),
      world.fake.configUpdated({ address: ADDRESS, objects: 'ai:2' }),
    ]);
    await world.settle();
    const open = world.bacnet.links.filter((link) => !link.closed);
    assert.equal(open.length, 1);
    assert.equal(open[0], world.hub.link);
    assert.equal(world.hub.objects[0].key, 'ai-2');
  } finally {
    await world.stop();
  }
});

test('every loss of the device is one warning, every return one info line', async (t) => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    const lines = await captureLogs(t, async () => {
      for (let round = 0; round < 2; round += 1) {
        world.bacnet.off = true;
        await world.poll();
        await world.poll();
        await world.poll();
        world.bacnet.off = false;
        await world.poll();
      }
    });
    assert.equal(lines.filter((line) => line.includes('[WARN]')).length, 2, lines.join('\n'));
    assert.equal(lines.filter((line) => line.includes('answers again')).length, 2);
  } finally {
    await world.stop();
  }
});

test('a dashboard setpoint is held to the published bounds when none is declared', async () => {
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS, allow_write: true },
  });
  try {
    const setpoint = world.feature('Setpoint');
    await world.fake.setValue(world.device, setpoint, 500);
    assert.equal(world.bacnet.writes.length, 0, '500 °C never reaches the device');
    await world.fake.setValue(world.device, setpoint, 21);
    assert.equal(world.bacnet.writes.length, 1);
  } finally {
    await world.stop();
  }
});

test('an object already in alarm does not fire the trigger again after a save', async () => {
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS },
    before: (device) => device.set('3:5', 111, flagsOf(1)),
  });
  try {
    await world.fake.configUpdated({ address: ADDRESS, objects: AHU_OBJECTS, language: 'en' });
    await world.settle();
    await world.poll();
    const alarms = world.fake.sceneEvents.filter((e) => e.key === 'object_alarm');
    assert.equal(alarms.length, 1);
  } finally {
    await world.stop();
  }
});

test('a configuration that fails does not block the next one', async () => {
  const world = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  try {
    const publish = world.gladys.publishDiscoveredDevices.bind(world.gladys);
    let fail = true;
    world.gladys.publishDiscoveredDevices = async (...args) => {
      if (fail) {
        fail = false;
        throw new Error('HTTP 429');
      }
      return publish(...args);
    };
    await assert.rejects(
      world.hub.configure(normalizeConfig({ address: ADDRESS, objects: 'ai:1' })),
    );
    await world.hub.configure(normalizeConfig({ address: ADDRESS, objects: 'ai:2' }));
    await world.settle();
    assert.equal(world.hub.objects[0].key, 'ai-2');
    assert.ok(world.hub.link, 'polling again');
    assert.equal(world.hub.status.connected, true);
  } finally {
    await world.stop();
  }
});

test('a Fahrenheit setpoint is bounded 32 to 212 °F, published and written', async () => {
  const fixture = structuredClone(AHU);
  fixture.objects['2:10'][117] = 64; // degrees-fahrenheit
  const world = await createWorld({ fixture, config: { objects: AHU_OBJECTS, allow_write: true } });
  try {
    const setpoint = world.feature('Setpoint');
    assert.deepEqual([setpoint.unit, setpoint.min, setpoint.max], ['fahrenheit', 32, 212]);
    await world.fake.setValue(world.device, setpoint, 130);
    assert.equal(world.bacnet.writes.at(-1).value, 130);
  } finally {
    await world.stop();
  }
});

test('the alarms of another device are its own', async () => {
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS },
    before: (device) => device.set('3:5', 111, flagsOf(1)),
  });
  try {
    await world.fake.configUpdated({ address: '192.0.2.11', objects: AHU_OBJECTS });
    await world.settle();
    const alarms = world.fake.sceneEvents.filter((e) => e.key === 'object_alarm');
    assert.equal(alarms.length, 2, 'the same object on a new address fires again');
  } finally {
    await world.stop();
  }
});

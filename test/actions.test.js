// -----------------------------------------------------------------------------
// The actions of the Configuration screen and the scene actions: a real
// success shows in green (resolved), every failure in red (thrown, with the
// four languages).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers/world.js';
import { AHU, AHU_OBJECTS, BACSERV, BACSERV_OBJECTS } from './fixtures/devices.js';

const failed = (ack) => {
  assert.equal(ack.success, false, JSON.stringify(ack.data));
  for (const lang of ['en', 'fr', 'de', 'es']) {
    assert.equal(typeof ack.error[lang], 'string', `error.${lang}`);
  }
  return ack.error;
};
const succeeded = (ack) => {
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  return ack.data.message;
};

test('list_objects gives the usable objects, ready to copy', async () => {
  const world = await createWorld({ fixture: BACSERV, config: { objects: '' } });
  try {
    const message = succeeded(await world.fake.action('list_objects', {}));
    assert.match(message.en, /^Device 1234: 9 usable object\(s\) of 13, as Name: object:/);
    assert.match(message.en, /\nANALOG-INPUT-1: analog-input:1\n/);
    assert.match(message.fr, /MULTI-STATE-VALUE-1: multi-state-value:1/);
    assert.doesNotMatch(message.en, /SCHEDULE|CALENDAR/);
  } finally {
    await world.stop();
  }
});

test('list_objects fails in red when the device does not answer', async () => {
  const world = await createWorld({ fixture: BACSERV, config: { objects: '' } });
  try {
    world.bacnet.off = true;
    await world.poll();
    await world.poll();
    assert.match(
      failed(await world.fake.action('list_objects', {})).fr,
      /^L'équipement BACnet n'est pas connecté/,
    );
  } finally {
    await world.stop();
  }
});

test('check_config: green when everything is right, red with the mistakes', async () => {
  const good = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  const bad = await createWorld({
    fixture: AHU,
    config: { objects: 'ai:1; Ghost: av:99; xx:1; ai:2 nonsense; bi:5 write; ai:3 unit=bar' },
  });
  const empty = await createWorld({ fixture: AHU, config: { objects: '' } });
  try {
    const message = succeeded(await good.fake.action('check_config', {}));
    assert.match(message.en, /^Connected to device 2001: 12 of 12 object\(s\) read\./);
    assert.match(message.en, /No mistake/);

    const error = failed(await bad.fake.action('check_config', {})).en;
    assert.match(error, /2 of 6 object\(s\) read/);
    assert.match(error, /Entry 3: "xx:1" is not a supported object/);
    assert.match(error, /Entry 4: unknown word "nonsense"/);
    assert.match(error, /Entry 5: bi:5 is an input/);
    assert.match(error, /Entry 2 \(Ghost\): av:99 does not exist/);

    // ai:3 unit=bar: a declared unit wins over the BACnet one (%RH), kind included.
    const feature = bad.device.features.find((f) => f.external_id.endsWith(':ai-3'));
    assert.deepEqual([feature.category, feature.unit], ['pressure-sensor', 'bar']);

    assert.match(failed(await empty.fake.action('check_config', {})).en, /No object declared/);
  } finally {
    await good.stop();
    await bad.stop();
    await empty.stop();
  }
});

test('write_value: green on a real write, red on every refusal', async () => {
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS, allow_write: true },
  });
  try {
    let message = succeeded(
      await world.fake.action('write_value', { object: 'Setpoint', value: '21,5' }),
    );
    assert.equal(message.en, 'Setpoint: 21.5 written at priority 8.');
    assert.equal(world.state('Setpoint'), 21.5);

    message = succeeded(
      await world.fake.action('write_value', { object: 'Mode', value: 'night purge' }),
    );
    assert.equal(message.fr, 'Mode : Night purge écrit en priorité 8.');
    assert.equal(world.bacnet.value('19:1'), 4);

    succeeded(
      await world.fake.action('write_value', { object: 'bo:1', value: 'off', priority: '13' }),
    );
    assert.deepEqual(world.bacnet.writes.at(-1), { key: '4:1', type: 9, value: 0, priority: 13 });

    const cases = [
      [{ object: '', value: '1' }, /Give the name or the identifier/],
      [{ object: 'Setpoint', value: '' }, /Give the value/],
      [{ object: 'Nope', value: '1' }, /"Nope" is not one of the declared objects/],
      [{ object: 'Humidity', value: '1' }, /not declared "write"/],
      [{ object: 'Setpoint', value: 'warm' }, /"warm" is not a number/],
      [{ object: 'Fan', value: '2' }, /expected 0 or 1/],
      [{ object: 'Mode', value: '5' }, /expected a state from 1 to 4/],
      [{ object: 'Setpoint', value: '20', priority: '17' }, /priority is a whole number/],
    ];
    for (const [fields, expected] of cases) {
      assert.match(failed(await world.fake.action('write_value', fields)).en, expected);
    }

    world.bacnet.writeDenied = true;
    assert.match(
      failed(await world.fake.action('write_value', { object: 'Setpoint', value: '20' })).fr,
      /L'équipement a refusé l'écriture \(write-access-denied\)/,
    );
  } finally {
    await world.stop();
  }
});

test('write_value: writing off, or the device lost', async () => {
  const off = await createWorld({ fixture: AHU, config: { objects: AHU_OBJECTS } });
  const lost = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS, allow_write: true },
  });
  try {
    assert.match(
      failed(await off.fake.action('write_value', { object: 'Setpoint', value: '20' })).en,
      /Writing is off/,
    );
    lost.bacnet.off = true;
    await lost.poll();
    await lost.poll();
    assert.match(
      failed(await lost.fake.action('write_value', { object: 'Setpoint', value: '20' })).en,
      /not connected/,
    );
  } finally {
    await off.stop();
    await lost.stop();
  }
});

test('release_value: the device goes back to the next priority, or its default', async () => {
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS, allow_write: true },
  });
  try {
    succeeded(await world.fake.action('write_value', { object: 'Setpoint', value: '23' }));
    succeeded(
      await world.fake.action('write_value', { object: 'Setpoint', value: '18', priority: '6' }),
    );
    assert.equal(world.state('Setpoint'), 18);
    const message = succeeded(
      await world.fake.action('release_value', { object: 'Setpoint', priority: '6' }),
    );
    assert.equal(message.en, 'Setpoint: priority 6 released.');
    assert.equal(world.state('Setpoint'), 23, 'back to priority 8');
    succeeded(await world.fake.action('release_value', { object: 'av:10' }));
    assert.equal(world.state('Setpoint'), 20, 'back to relinquishDefault');
    assert.deepEqual(world.bacnet.writes.at(-1), {
      key: '2:10',
      type: 0,
      value: null,
      priority: 8,
    });
  } finally {
    await world.stop();
  }
});

test('release_value fails in red on an object without priority array (bacserv analog value)', async () => {
  const world = await createWorld({
    fixture: BACSERV,
    config: { objects: BACSERV_OBJECTS, allow_write: true },
  });
  try {
    assert.match(
      failed(await world.fake.action('release_value', { object: 'Setpoint' })).en,
      /has no priority array/,
    );
    succeeded(await world.fake.action('release_value', { object: 'ao:1' }));
  } finally {
    await world.stop();
  }
});

test('the scene actions write and release, and fail the action (not the scene) on a refusal', async () => {
  const world = await createWorld({
    fixture: AHU,
    config: { objects: AHU_OBJECTS, allow_write: true },
  });
  try {
    const written = await world.fake.sceneAction('write_value', { object: 'Fan', value: '0' });
    assert.equal(written.success, true, JSON.stringify(written));
    assert.equal(world.bacnet.value('4:1'), 0);
    const released = await world.fake.sceneAction('release_value', { object: 'Fan' });
    assert.equal(released.success, true);
    assert.equal(world.bacnet.value('4:1'), 0, 'relinquishDefault of the fan');
    const refused = await world.fake.sceneAction('write_value', { object: 'Humidity', value: '1' });
    assert.equal(refused.success, false);
    assert.match(refused.error.en, /not declared "write"/);
  } finally {
    await world.stop();
  }
});

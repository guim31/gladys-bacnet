// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: the bacnet-stack demo server (bacserv), an air handling unit, and
// one object of every kind, writable or not, in every message language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BACNET_UNITS, KINDS } from '../src/kinds.js';
import { createWorld } from './helpers/world.js';
import { AHU, AHU_OBJECTS, BACSERV, BACSERV_OBJECTS } from './fixtures/devices.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

// One object per kind, of a family that fits it (writable ones on values).
const FAMILY_TYPE = { analog: 2, binary: 5, multistate: 19 };
const kindDevice = { instance: 77, device: { 77: 'Kinds' }, objects: {} };
const kindEntries = [];
Object.entries(KINDS).forEach(([kind, definition], index) => {
  const family = definition.objects[0];
  const type = FAMILY_TYPE[family];
  kindDevice.objects[`${type}:${index + 1}`] = {
    77: `OBJ-${index + 1}`,
    85: family === 'analog' ? 12.5 : 1,
    111: { value: [0], bitsUsed: 4 },
    ...(family === 'multistate' ? { 74: 3, 110: ['A', 'B', 'C'] } : {}),
    104: family === 'analog' ? 0 : 1,
  };
  const short = { analog: 'av', binary: 'bv', multistate: 'msv' }[family];
  kindEntries.push(`${kind}: ${short}:${index + 1} ${kind} write`);
});
// One analog input per BACnet unit the code maps.
const unitDevice = { instance: 78, device: { 77: 'Units' }, objects: {} };
const unitEntries = [];
Object.keys(BACNET_UNITS).forEach((units, index) => {
  unitDevice.objects[`0:${index + 1}`] = {
    77: `Unit ${units}`,
    85: 3.5,
    111: { value: [0], bitsUsed: 4 },
    117: Number(units),
  };
  unitEntries.push(`ai:${index + 1}`);
});

const fleets = {
  bacserv: { fixture: BACSERV, objects: BACSERV_OBJECTS },
  ahu: { fixture: AHU, objects: AHU_OBJECTS },
  kinds: { fixture: kindDevice, objects: kindEntries.join('; ') },
  units: { fixture: unitDevice, objects: unitEntries.join('; ') },
};

const scenarios = [];
for (const [fleet, spec] of Object.entries(fleets)) {
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const allowWrite of [false, true]) {
      scenarios.push({ fleet, spec, language, allowWrite });
    }
  }
}

for (const { fleet, spec, language, allowWrite } of scenarios) {
  test(`every discovered device follows the Gladys rules (${fleet}, ${language}, writing ${allowWrite ? 'on' : 'off'})`, async () => {
    const world = await createWorld({
      fixture: spec.fixture,
      config: { objects: spec.objects, language, allow_write: allowWrite },
    });
    try {
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, 1, 'one device for the BACnet device');
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(feature.external_id.startsWith(`${device.external_id}:`), `${at}: foreign id`);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
          assert.ok(feature.name.length <= 40, `${at}: name longer than 40 characters`);
        }
      }
    } finally {
      await world.stop();
    }
  });
}

test('the writable features are the declared switches and setpoints, nothing else', async () => {
  const world = await createWorld({
    fixture: kindDevice,
    config: { objects: kindEntries.join('; '), allow_write: true },
  });
  try {
    const writable = world.device.features
      .filter((feature) => !feature.read_only)
      .map((f) => f.name);
    assert.deepEqual(writable.sort(), ['setpoint', 'switch']);
    // Not voice-controllable: never a switch, thermostat or light category.
    for (const feature of world.device.features) {
      assert.ok(
        !['switch', 'thermostat', 'light', 'air-conditioning'].includes(feature.category),
        feature.name,
      );
    }
    assert.equal(world.device.features.length, Object.keys(KINDS).length);
  } finally {
    await world.stop();
  }
});

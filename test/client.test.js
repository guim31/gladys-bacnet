// -----------------------------------------------------------------------------
// The link over @bacnet-js/client, with a stand-in for the library's client:
// errors turned into codes, ReadPropertyMultiple answers decoded, the
// property-by-property fallback, the object list read item by item, and the
// requests the device receives. The answers are shaped like the ones the
// library decoded from bacserv (see CLAUDE.md, "Live check").
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBacnetLink, linkError } from '../src/bacnet/client.js';

const errorPdu = (errorClass, errorCode) => ({
  type: 105,
  value: { errorClass, errorCode },
  len: 0,
});

function fakeClient(behaviour) {
  const calls = [];
  const client = {
    calls,
    on() {},
    close() {
      calls.push(['close']);
    },
    async readProperty(receiver, objectId, propertyId, options) {
      calls.push(['readProperty', receiver, objectId, propertyId, options]);
      return behaviour.readProperty(objectId, propertyId, options);
    },
    async readPropertyMultiple(receiver, specs) {
      calls.push(['readPropertyMultiple', receiver, specs]);
      return behaviour.readPropertyMultiple(specs);
    },
    async writeProperty(receiver, objectId, propertyId, values, options) {
      calls.push(['writeProperty', receiver, objectId, propertyId, values, options]);
    },
  };
  return client;
}

test('library errors become link codes', () => {
  const pdu = linkError(new Error('BacnetError - Class:2 - Code:40'));
  assert.deepEqual([pdu.code, pdu.errorClass, pdu.errorCode], ['bacnet', 2, 40]);
  assert.equal(linkError(new Error('ERR_TIMEOUT')).code, 'timeout');
  assert.equal(linkError(new Error('BacnetAbort - Reason:4')).code, 'abort');
  assert.equal(linkError(new Error('ERR_CLOSED')).code, 'closed');
  assert.equal(linkError(new Error('boom')).code, 'failed');
});

test('ReadPropertyMultiple: values and per-property errors, by chunks of 8 objects', async () => {
  const client = fakeClient({
    readPropertyMultiple: (specs) => ({
      values: specs.map((spec) => ({
        objectId: spec.objectId,
        values: [
          { id: 85, index: 0xffffffff, value: [{ type: 4, value: spec.objectId.instance }] },
          { id: 117, index: 0xffffffff, value: [errorPdu(2, 32)] },
        ],
      })),
    }),
  });
  const link = createBacnetLink({ host: '192.0.2.5', port: 47808, createClient: () => client });
  const specs = Array.from({ length: 10 }, (_, i) => ({
    objectId: { type: 0, instance: i + 1 },
    properties: [85, 117],
  }));
  const results = await link.readObjects(specs);
  assert.equal(results.length, 10);
  assert.deepEqual(results[9][85], { values: [10] });
  assert.deepEqual(results[0][117], { error: { errorClass: 2, errorCode: 32 } });
  const rpm = client.calls.filter(([name]) => name === 'readPropertyMultiple');
  assert.deepEqual(
    rpm.map(([, , chunk]) => chunk.length),
    [8, 2],
  );
  assert.deepEqual(rpm[0][1], { address: '192.0.2.5' });
});

test('a device without ReadPropertyMultiple is read property by property, once refused', async () => {
  const client = fakeClient({
    readPropertyMultiple: () => {
      throw new Error('BacnetAbort - Reason:9');
    },
    readProperty: (objectId, propertyId) => {
      if (propertyId === 117) {
        throw new Error('BacnetError - Class:2 - Code:32');
      }
      return { values: [{ type: 4, value: 20 }] };
    },
  });
  const link = createBacnetLink({ host: '192.0.2.5', port: 47809, createClient: () => client });
  const spec = { objectId: { type: 0, instance: 1 }, properties: [85, 117] };
  const first = await link.readObjects([spec]);
  const second = await link.readObjects([spec]);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0][85], { values: [20] });
  assert.deepEqual(first[0][117], { error: { errorClass: 2, errorCode: 32 } });
  assert.equal(client.calls.filter(([name]) => name === 'readPropertyMultiple').length, 1);
  assert.deepEqual(client.calls[1][1], { address: '192.0.2.5:47809' });
});

test('the instance comes from the wildcard device 4194303', async () => {
  const client = fakeClient({
    readProperty: () => ({ values: [{ type: 12, value: { type: 8, instance: 1234 } }] }),
  });
  const link = createBacnetLink({ host: '192.0.2.5', port: 47808, createClient: () => client });
  assert.equal(await link.readDeviceInstance(), 1234);
  assert.deepEqual(client.calls[0].slice(2, 4), [{ type: 8, instance: 4194303 }, 75]);
});

test('the object list, whole or item by item when too long for one answer', async () => {
  const items = [
    { type: 8, instance: 7 },
    { type: 0, instance: 1 },
    { type: 5, instance: 2 },
  ];
  const client = fakeClient({
    readProperty: (objectId, propertyId, { arrayIndex }) => {
      if (arrayIndex === 0xffffffff) {
        throw new Error('BacnetAbort - Reason:4'); // segmentation not supported
      }
      if (arrayIndex === 0) {
        return { values: [{ type: 2, value: items.length }] };
      }
      return { values: [{ type: 12, value: items[arrayIndex - 1] }] };
    },
  });
  const link = createBacnetLink({ host: '192.0.2.5', port: 47808, createClient: () => client });
  assert.deepEqual(await link.readObjectList(7), { ids: items, total: 3 });
});

test('a write carries the tag, the value and the priority; a release is a NULL', async () => {
  const client = fakeClient({});
  const link = createBacnetLink({ host: '192.0.2.5', port: 47808, createClient: () => client });
  await link.writePresentValue({ type: 2, instance: 3 }, { type: 4, value: 21.5 }, 8);
  await link.writePresentValue({ type: 2, instance: 3 }, { type: 0, value: null }, 8);
  link.close();
  assert.deepEqual(client.calls[0].slice(2), [
    { type: 2, instance: 3 },
    85,
    [{ type: 4, value: 21.5 }],
    { priority: 8 },
  ]);
  assert.deepEqual(client.calls[1][4], [{ type: 0, value: null }]);
  assert.deepEqual(client.calls.at(-1), ['close']);
});

test('an answer too big for the device: the chunk is read object by object, RPM kept', async () => {
  const client = fakeClient({
    readPropertyMultiple: (specs) => {
      if (specs.length > 1) {
        throw new Error('BacnetAbort - Reason:4'); // segmentation not supported
      }
      return {
        values: [
          { objectId: specs[0].objectId, values: [{ id: 85, value: [{ type: 4, value: 1 }] }] },
        ],
      };
    },
    readProperty: () => {
      throw new Error('should not be used');
    },
  });
  const link = createBacnetLink({ host: '192.0.2.5', port: 47808, createClient: () => client });
  const specs = [1, 2, 3].map((instance) => ({
    objectId: { type: 0, instance },
    properties: [85],
  }));
  assert.equal((await link.readObjects(specs)).length, 3);
  await link.readObjects(specs);
  const sizes = client.calls
    .filter(([name]) => name === 'readPropertyMultiple')
    .map(([, , chunk]) => chunk.length);
  assert.deepEqual(sizes, [3, 1, 1, 1, 3, 1, 1, 1]);
});

test('a property too long for one answer is missing, the object is still read', async () => {
  const client = fakeClient({
    readPropertyMultiple: () => {
      throw new Error('BacnetAbort - Reason:4');
    },
    readProperty: (objectId, propertyId) => {
      if (propertyId === 110) {
        throw new Error('BacnetAbort - Reason:4');
      }
      return { values: [{ type: 2, value: 2 }] };
    },
  });
  const link = createBacnetLink({ host: '192.0.2.5', port: 47808, createClient: () => client });
  const [result] = await link.readObjects([
    { objectId: { type: 19, instance: 1 }, properties: [85, 111, 77, 74, 110] },
  ]);
  assert.deepEqual(result[85], { values: [2] });
  assert.ok(result[110].error);
});

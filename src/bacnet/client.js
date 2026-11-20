// -----------------------------------------------------------------------------
// The BACnet/IP link to one device, over @bacnet-js/client (MIT).
//
// - Unicast only: the Gladys sandbox runs on a bridge network, where a Who-Is
//   broadcast never reaches the building network. The user gives the IP
//   address; the device instance is read from the device itself when not
//   given (the wildcard instance 4194303 of ASHRAE 135, clause 12.11.1).
// - Values are read with ReadPropertyMultiple, by chunks of objects; a device
//   that refuses that service (small controllers) is read property by
//   property, which the link remembers.
// - Every failure becomes a LinkError with a code the hub knows: timeout (no
//   answer), bacnet (an Error PDU, with its class and code), abort, reject.
// -----------------------------------------------------------------------------

import bacnet from '@bacnet-js/client';

const BacnetClient = bacnet.default ?? bacnet;
const ARRAY_ALL = 0xffffffff;
const WILDCARD_INSTANCE = 4194303;
const DEVICE = 8;
// Objects per ReadPropertyMultiple: small enough for an unsegmented answer of
// 480 bytes (the smallest maxApdu), with a handful of properties each.
const CHUNK = 8;

export const PROPERTY = {
  OBJECT_IDENTIFIER: 75,
  OBJECT_LIST: 76,
  OBJECT_NAME: 77,
  PRESENT_VALUE: 85,
  STATUS_FLAGS: 111,
  UNITS: 117,
  NUMBER_OF_STATES: 74,
  STATE_TEXT: 110,
  RELINQUISH_DEFAULT: 104,
  VENDOR_NAME: 121,
  MODEL_NAME: 70,
};

// BACnet error classes and codes the messages name (ASHRAE 135, clause 18).
export const ERROR_CLASS = { DEVICE: 0, OBJECT: 1, PROPERTY: 2, SERVICES: 5 };
export const ERROR_CODE = {
  UNKNOWN_OBJECT: 31,
  UNKNOWN_PROPERTY: 32,
  VALUE_OUT_OF_RANGE: 37,
  WRITE_ACCESS_DENIED: 40,
  INVALID_DATA_TYPE: 9,
  SERVICE_REQUEST_DENIED: 29,
};

export class LinkError extends Error {
  /**
   * @param {string} code timeout | bacnet | abort | reject | closed | failed
   * @param {object} [details] errorClass, errorCode, reason
   */
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

/** The LinkError of an error thrown by the library. */
export function linkError(err) {
  if (err instanceof LinkError) {
    return err;
  }
  const message = String(err?.message ?? err);
  const pdu = message.match(/Class:(\d+) - Code:(\d+)/);
  if (pdu && message.startsWith('BacnetError')) {
    return new LinkError('bacnet', message, {
      errorClass: Number(pdu[1]),
      errorCode: Number(pdu[2]),
    });
  }
  if (message === 'ERR_TIMEOUT') {
    return new LinkError('timeout', 'No answer');
  }
  if (message.startsWith('BacnetAbort')) {
    return new LinkError('abort', message);
  }
  if (message.startsWith('BacnetReject')) {
    return new LinkError('reject', message);
  }
  if (message === 'ERR_CLOSED') {
    return new LinkError('closed', message);
  }
  return new LinkError('failed', message);
}

/** The result of one property of a ReadPropertyMultiple answer. */
function propertyResult(entry) {
  const values = entry?.value ?? [];
  const first = values[0];
  if (first && first.type === 105) {
    return {
      error: { errorClass: first.value?.errorClass, errorCode: first.value?.errorCode },
    };
  }
  return { values: values.map((item) => item.value) };
}

/**
 * @param {object} options
 * @param {string} options.host IP address of the device
 * @param {number} options.port its BACnet/IP port (47808)
 * @param {number} [options.timeoutMs] APDU timeout
 * @param {(options: object) => object} [options.createClient] test seam
 * @param {(err: Error) => void} [options.onError] socket errors (port in use)
 */
export function createBacnetLink({
  host,
  port,
  timeoutMs = 3000,
  createClient = (options) => new BacnetClient(options),
  onError = () => {},
}) {
  const receiver = { address: port === 47808 ? host : `${host}:${port}` };
  let client = null;
  let rpmRefused = false;

  const open = () => {
    if (!client) {
      client = createClient({ apduTimeout: timeoutMs });
      client.on?.('error', (err) => onError(err));
    }
    return client;
  };
  const call = async (fn) => {
    try {
      return await fn(open());
    } catch (err) {
      throw linkError(err);
    }
  };

  /** Read every property of one object, one request each. */
  async function readOneByOne(spec) {
    const results = {};
    for (const id of spec.properties) {
      try {
        const answer = await call((c) =>
          c.readProperty(receiver, spec.objectId, id, { arrayIndex: ARRAY_ALL }),
        );
        results[id] = { values: answer.values.map((item) => item.value) };
      } catch (err) {
        if (err.code !== 'bacnet') {
          throw err;
        }
        results[id] = { error: { errorClass: err.errorClass, errorCode: err.errorCode } };
      }
    }
    return results;
  }

  return {
    host,
    port,

    /** The instance of the device answering at this address. */
    async readDeviceInstance() {
      const answer = await call((c) =>
        c.readProperty(
          receiver,
          { type: DEVICE, instance: WILDCARD_INSTANCE },
          PROPERTY.OBJECT_IDENTIFIER,
        ),
      );
      const id = answer.values?.[0]?.value;
      if (id?.type !== DEVICE || !Number.isInteger(id.instance)) {
        throw new LinkError('failed', 'No device identifier in the answer');
      }
      return id.instance;
    },

    /**
     * Read properties of several objects.
     * @param {Array<{ objectId: { type: number, instance: number }, properties: number[] }>} specs
     * @returns {Promise<Array<Record<number, { values?: unknown[], error?: object }>>>}
     *   one map per spec, by property id
     */
    async readObjects(specs) {
      const out = [];
      for (let start = 0; start < specs.length; start += CHUNK) {
        const chunk = specs.slice(start, start + CHUNK);
        if (!rpmRefused) {
          try {
            const answer = await call((c) =>
              c.readPropertyMultiple(
                receiver,
                chunk.map((spec) => ({
                  objectId: spec.objectId,
                  properties: spec.properties.map((id) => ({ id, index: ARRAY_ALL })),
                })),
              ),
            );
            for (const [index, spec] of chunk.entries()) {
              const result = answer.values?.[index];
              const map = {};
              for (const id of spec.properties) {
                map[id] = propertyResult(result?.values?.find((entry) => entry.id === id));
              }
              out.push(map);
            }
            continue;
          } catch (err) {
            // A device without ReadPropertyMultiple rejects it, or answers
            // "service request denied / unrecognized service".
            const refused =
              err.code === 'reject' ||
              (err.code === 'bacnet' && err.errorClass === ERROR_CLASS.SERVICES) ||
              err.code === 'abort';
            if (!refused) {
              throw err;
            }
            rpmRefused = true;
          }
        }
        for (const spec of chunk) {
          out.push(await readOneByOne(spec));
        }
      }
      return out;
    },

    /** The objects of the device: whole list, else entry by entry. */
    async readObjectList(instance, max = 500) {
      const objectId = { type: DEVICE, instance };
      try {
        const answer = await call((c) =>
          c.readProperty(receiver, objectId, PROPERTY.OBJECT_LIST, { arrayIndex: ARRAY_ALL }),
        );
        return { ids: answer.values.map((item) => item.value), total: answer.values.length };
      } catch (err) {
        // Too long for an unsegmented answer: read the length, then each item.
        if (err.code !== 'abort' && !(err.code === 'bacnet' && err.errorClass === 5)) {
          throw err;
        }
      }
      const count = await call((c) =>
        c.readProperty(receiver, objectId, PROPERTY.OBJECT_LIST, { arrayIndex: 0 }),
      );
      const total = Number(count.values?.[0]?.value ?? 0);
      const ids = [];
      for (let index = 1; index <= Math.min(total, max); index += 1) {
        const item = await call((c) =>
          c.readProperty(receiver, objectId, PROPERTY.OBJECT_LIST, { arrayIndex: index }),
        );
        ids.push(item.values[0].value);
      }
      return { ids, total };
    },

    /** Write the presentValue at a priority (1-16); `null` relinquishes it. */
    async writePresentValue(objectId, tagged, priority) {
      await call((c) =>
        c.writeProperty(receiver, objectId, PROPERTY.PRESENT_VALUE, [tagged], { priority }),
      );
    },

    close() {
      try {
        client?.close();
      } catch {
        // already closed
      }
      client = null;
    },
  };
}

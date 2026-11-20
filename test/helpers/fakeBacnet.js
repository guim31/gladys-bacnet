// -----------------------------------------------------------------------------
// A fake BACnet/IP device behind the link interface of src/bacnet/client.js:
// readDeviceInstance, readObjects, readObjectList, writePresentValue, close.
// It keeps a priority array for commandable objects (presentValue = highest
// priority set, else relinquishDefault), answers unknown-object errors like
// bacserv, and can be switched off, refuse ReadPropertyMultiple, or deny
// writes.
// -----------------------------------------------------------------------------

import { ERROR_CLASS, ERROR_CODE, LinkError } from '../../src/bacnet/client.js';

const unknownObject = { errorClass: ERROR_CLASS.OBJECT, errorCode: ERROR_CODE.UNKNOWN_OBJECT };
const unknownProperty = {
  errorClass: ERROR_CLASS.PROPERTY,
  errorCode: ERROR_CODE.UNKNOWN_PROPERTY,
};

export function createFakeDevice(fixture) {
  const state = structuredClone(fixture);
  const device = {
    state,
    off: false,
    noWildcard: false,
    writeDenied: false,
    writes: [],
    reads: 0,
    links: [],
    priorities: {},

    /** The current presentValue of an object ("type:instance"). */
    value(key) {
      return state.objects[key][85];
    },
    set(key, property, value) {
      state.objects[key][property] = value;
    },

    createLink: (options) => {
      const link = {
        options,
        closed: false,
        async readDeviceInstance() {
          check();
          if (device.noWildcard) {
            throw new LinkError('bacnet', 'unknown object', unknownObject);
          }
          return state.instance;
        },
        async readObjects(specs) {
          check();
          device.reads += 1;
          return specs.map((spec) => {
            const props = readable(spec.objectId);
            const result = {};
            for (const id of spec.properties) {
              if (!props) {
                result[id] = { error: unknownObject };
              } else if (props[id] === undefined) {
                result[id] = { error: unknownProperty };
              } else {
                const value = props[id];
                result[id] = { values: Array.isArray(value) ? [...value] : [value] };
              }
            }
            return result;
          });
        },
        async readObjectList(instance) {
          check();
          if (instance !== state.instance) {
            throw new LinkError('bacnet', 'unknown object', unknownObject);
          }
          const ids = [
            { type: 8, instance: state.instance },
            ...Object.keys(state.objects).map((key) => {
              const [type, number] = key.split(':').map(Number);
              return { type, instance: number };
            }),
          ];
          return { ids, total: ids.length };
        },
        async writePresentValue(objectId, tagged, priority) {
          check();
          const key = `${objectId.type}:${objectId.instance}`;
          const props = state.objects[key];
          if (!props) {
            throw new LinkError('bacnet', 'unknown object', unknownObject);
          }
          if (device.writeDenied || objectId.type === 0 || objectId.type === 3) {
            throw new LinkError('bacnet', 'write access denied', {
              errorClass: ERROR_CLASS.PROPERTY,
              errorCode: ERROR_CODE.WRITE_ACCESS_DENIED,
            });
          }
          device.writes.push({ key, ...tagged, priority });
          if (props[104] === undefined) {
            // Not commandable: the priority is ignored, a null is ignored.
            if (tagged.value !== null) {
              props[85] = tagged.value;
            }
            return;
          }
          const array = (device.priorities[key] ??= Array(17).fill(null));
          array[priority] = tagged.value;
          const active = array.find((value, index) => index > 0 && value !== null);
          props[85] = active ?? props[104];
        },
        close() {
          link.closed = true;
        },
      };
      device.links.push(link);
      return link;
    },
  };

  function check() {
    if (device.off) {
      throw new LinkError('timeout', 'No answer');
    }
  }

  function readable({ type, instance }) {
    if (type === 8) {
      return instance === state.instance ? state.device : null;
    }
    return state.objects[`${type}:${instance}`] ?? null;
  }

  return device;
}

/** A status flags bit string. */
export const flagsOf = (byte) => ({ value: [byte], bitsUsed: 4 });

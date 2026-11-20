// -----------------------------------------------------------------------------
// The "Objects" field of the configuration: one entry per BACnet object,
// separated by semicolons.
//
//   [Name:] type:instance [kind] [write] [unit=...] [scale=...] [offset=...]
//           [min=...] [max=...] [precision=...]
//
//   Supply air: analog-input:1; Fan: binary-output:3 switch write; av:12
//
// The type is written in full (analog-input), in short (ai), or the way YABE
// and most tools write it (OBJECT_ANALOG_INPUT:1). The name is followed by a
// colon AND a space ("Name: ai:1"): the object identifier has a colon of its
// own. Without a name, the object takes its objectName on the device.
// -----------------------------------------------------------------------------

import { KINDS, unitOfSymbol } from './kinds.js';

export const MAX_OBJECTS = 100;
const MAX_NAME = 40;
const NUMBER_OPTIONS = ['scale', 'offset', 'min', 'max', 'precision'];
// BACnet instance numbers are 22 bits; 4194303 is the wildcard.
export const MAX_INSTANCE = 4194302;

/** The object types Gladys can use, by BACnet number. */
export const OBJECT_TYPES = {
  0: { slug: 'analog-input', short: 'ai', family: 'analog', input: true },
  1: { slug: 'analog-output', short: 'ao', family: 'analog', input: false },
  2: { slug: 'analog-value', short: 'av', family: 'analog', input: false },
  3: { slug: 'binary-input', short: 'bi', family: 'binary', input: true },
  4: { slug: 'binary-output', short: 'bo', family: 'binary', input: false },
  5: { slug: 'binary-value', short: 'bv', family: 'binary', input: false },
  13: { slug: 'multi-state-input', short: 'msi', family: 'multistate', input: true },
  14: { slug: 'multi-state-output', short: 'mso', family: 'multistate', input: false },
  19: { slug: 'multi-state-value', short: 'msv', family: 'multistate', input: false },
};

const TYPE_BY_WORD = new Map();
for (const [number, info] of Object.entries(OBJECT_TYPES)) {
  TYPE_BY_WORD.set(info.slug, Number(number));
  TYPE_BY_WORD.set(info.short, Number(number));
  TYPE_BY_WORD.set(info.slug.replace(/-/g, ''), Number(number));
}

/**
 * The BACnet object of a text: "analog-input:1", "ai:1", "AI1",
 * "OBJECT_ANALOG_INPUT:1", "analog-input,1".
 * @returns {{ type: number, instance: number } | null}
 */
export function parseObjectId(text) {
  const match = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/^object[_-]/, '')
    .replace(/_/g, '-')
    .match(/^([a-z-]+?)[:,\s]?(\d+)$/);
  if (!match) {
    return null;
  }
  const type = TYPE_BY_WORD.get(match[1]) ?? TYPE_BY_WORD.get(match[1].replace(/-/g, ''));
  const instance = Number(match[2]);
  if (type === undefined || !Number.isInteger(instance) || instance > MAX_INSTANCE) {
    return null;
  }
  return { type, instance };
}

/** "ai:1": the short text of an object, also its stable feature key "ai-1". */
export function objectText({ type, instance }) {
  return `${OBJECT_TYPES[type]?.short ?? `type${type}`}:${instance}`;
}

export function featureKey({ type, instance }) {
  return `${OBJECT_TYPES[type].short}-${instance}`;
}

/**
 * Parse the field.
 * @param {string} text
 * @returns {{ objects: Array<object>, errors: Array<{ entry: number, name?: string, code: string, params?: object }> }}
 */
export function parseObjects(text) {
  const objects = [];
  const errors = [];
  const seen = new Set();
  String(text ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .forEach((raw, index) => {
      const entry = index + 1;
      const fail = (code, params = {}, name = undefined) =>
        errors.push({ entry, name: name ?? undefined, code, params });

      let name = null;
      let rest = raw;
      const colon = raw.indexOf(': ');
      if (colon > 0) {
        name = raw.slice(0, colon).trim();
        rest = raw.slice(colon + 2).trim();
      }
      const [idText, ...options] = rest.split(/\s+/).filter(Boolean);
      if (!idText) {
        fail('noObject', {}, name);
        return;
      }
      const id = parseObjectId(idText);
      if (!id) {
        fail('badObject', { object: idText }, name);
        return;
      }
      const key = featureKey(id);
      if (seen.has(key)) {
        fail('duplicateObject', { object: objectText(id) }, name);
        return;
      }
      const info = OBJECT_TYPES[id.type];
      const object = {
        entry,
        name,
        ...id,
        family: info.family,
        input: info.input,
        key,
        text: objectText(id),
        kind: null,
        write: false,
      };
      let valid = true;
      for (const option of options) {
        const lower = option.toLowerCase();
        if (KINDS[lower]) {
          object.kind = lower;
          continue;
        }
        if (lower === 'write') {
          object.write = true;
          continue;
        }
        const match = option.match(/^([a-z]+)=(.+)$/i);
        const key = match?.[1].toLowerCase();
        if (key === 'unit') {
          const unit = unitOfSymbol(match[2]);
          if (!unit) {
            fail('unknownUnit', { unit: match[2] }, name);
            valid = false;
          } else {
            object.unit = unit;
          }
        } else if (NUMBER_OPTIONS.includes(key)) {
          const number = Number(match[2].replace(',', '.'));
          if (
            !Number.isFinite(number) ||
            (key === 'precision' && (!Number.isInteger(number) || number < 0 || number > 6)) ||
            (key === 'scale' && number === 0)
          ) {
            fail('badNumber', { option: key, value: match[2] }, name);
            valid = false;
          } else {
            object[key] = number;
          }
        } else {
          fail('unknownWord', { word: option }, name);
          valid = false;
        }
      }
      if (!valid) {
        return;
      }
      const kind = object.kind && KINDS[object.kind];
      if (kind && !kind.objects.includes(object.family)) {
        fail('kindOfObject', { kind: object.kind, object: object.text }, name);
        return;
      }
      if (kind?.writable) {
        object.write = true;
      }
      if (object.write && object.input) {
        fail('inputNotWritable', { object: object.text }, name);
        return;
      }
      if (object.unit && kind && !kind.units.includes(object.unit)) {
        fail('unitOfKind', { unit: object.unit, kind: object.kind }, name);
        return;
      }
      if (object.min !== undefined && object.max !== undefined && object.min >= object.max) {
        fail('minMax', {}, name);
        return;
      }
      if (objects.length >= MAX_OBJECTS) {
        fail('tooMany', { max: MAX_OBJECTS }, name);
        return;
      }
      if (name) {
        object.name = name.slice(0, MAX_NAME);
      } else {
        object.name = null;
      }
      seen.add(key);
      objects.push(object);
    });
  return { objects, errors };
}

/** Give each object a distinct name of 40 characters at most. */
export function uniqueNames(names) {
  const used = new Set();
  return names.map((wanted) => {
    let name = String(wanted).slice(0, MAX_NAME);
    for (let n = 2; used.has(name); n += 1) {
      const suffix = ` ${n}`;
      name = `${String(wanted).slice(0, MAX_NAME - suffix.length)}${suffix}`;
    }
    used.add(name);
    return name;
  });
}

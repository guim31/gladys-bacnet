// -----------------------------------------------------------------------------
// BACnet values ↔ Gladys states.
//
// Read: an analog presentValue is a REAL (32-bit float): scale and offset
// apply, then the float noise is rounded away; a binary one is an ENUMERATED
// (0 inactive, 1 active); a multi-state one an UNSIGNED from 1 to
// numberOfStates. Write: the reverse, with the application tag BACnet expects
// (REAL 4, ENUMERATED 9, UNSIGNED 2), checked before it leaves the container.
// -----------------------------------------------------------------------------

import { KINDS, NUMERIC_KINDS, kindOfUnits, publishedUnit } from './kinds.js';

export const TAG = {
  NULL: 0,
  BOOLEAN: 1,
  UNSIGNED: 2,
  SIGNED: 3,
  REAL: 4,
  DOUBLE: 5,
  ENUMERATED: 9,
};

/** A failed write, with the code of its message (messages.js WRITE_ERRORS). */
export class WriteError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

/**
 * The kind and unit of an object once its metadata is read.
 * @param {object} object parsed object (family, kind, unit, write)
 * @param {{ units?: number }} meta
 */
export function resolveKind(object, meta = {}) {
  if (object.family === 'binary') {
    return { kind: object.kind ?? (object.write ? 'switch' : 'binary'), unit: null };
  }
  if (object.family === 'multistate') {
    return { kind: object.kind ?? 'state', unit: null };
  }
  const suggested = kindOfUnits(meta.units);
  let kind = object.kind;
  if (
    !kind &&
    object.unit &&
    (suggested.kind === 'value' || !KINDS[suggested.kind].units.includes(object.unit))
  ) {
    // A declared unit the BACnet units do not tell (or contradict): the unit chooses.
    kind =
      Object.keys(KINDS).find(
        (candidate) =>
          KINDS[candidate].objects.includes('analog') &&
          !KINDS[candidate].writable &&
          candidate !== 'value' &&
          KINDS[candidate].units.includes(object.unit),
      ) ?? 'value';
  }
  if (!kind) {
    kind = suggested.kind;
    // A writable temperature is the one number Gladys can set from a device.
    if (object.write && kind === 'temperature' && suggested.unit !== 'kelvin') {
      kind = 'setpoint';
    }
  }
  const definition = KINDS[kind];
  let unit = object.unit;
  if (!unit) {
    unit = definition.units.includes(suggested.unit) ? suggested.unit : definition.units[0];
  }
  return { kind, unit };
}

/** Round away the float noise (a REAL 21.3 reads 21.299999237). */
function tidy(number, object) {
  if (object.precision !== undefined) {
    const factor = 10 ** object.precision;
    return Math.round(number * factor) / factor;
  }
  return Number(number.toPrecision(7));
}

/** A BACnet application value as a plain JS value. */
function plain(value) {
  if (value && typeof value === 'object' && 'value' in value) {
    return value.value;
  }
  return value;
}

/**
 * The Gladys state of a presentValue.
 * @param {object} object resolved object (family, resolvedKind, unit, scale...)
 * @param {unknown} raw the value read
 * @returns {number | { text: string } | null} null: nothing to publish
 */
export function toState(object, raw) {
  const value = plain(raw);
  if (value === null || value === undefined) {
    return null;
  }
  const kind = object.resolvedKind;
  const definition = KINDS[kind];
  if (object.family === 'binary') {
    const number = typeof value === 'boolean' ? Number(value) : Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    return number !== 0 ? 1 : 0;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (object.family === 'multistate') {
    if (definition.text) {
      const text = String(object.stateText?.[number - 1] ?? number)
        .trim()
        .slice(0, 255);
      return text === '' ? { text: String(number) } : { text };
    }
    return number;
  }
  const { factor } = publishedUnit(kind, object.unit);
  return tidy((number * (object.scale ?? 1) + (object.offset ?? 0)) * factor, object);
}

/**
 * The BACnet value to write for a value given by Gladys or typed in an action.
 * @returns {{ tag: number, value: number, shown: string|number }}
 */
export function toWrite(object, input) {
  const text = String(input ?? '')
    .trim()
    .toLowerCase();
  if (object.family === 'multistate') {
    const states = (object.stateText ?? []).map((state) => String(state).toLowerCase());
    const byText = states.indexOf(text);
    const number = byText >= 0 ? byText + 1 : Number(text.replace(',', '.'));
    if (text === '' || !Number.isInteger(number)) {
      throw new WriteError('notAState', {
        value: String(input),
        max: object.numberOfStates ?? '?',
      });
    }
    if (number < 1 || (object.numberOfStates && number > object.numberOfStates)) {
      throw new WriteError('notAState', {
        value: String(input),
        max: object.numberOfStates ?? '?',
      });
    }
    return { tag: TAG.UNSIGNED, value: number, shown: object.stateText?.[number - 1] ?? number };
  }
  const words = { true: 1, false: 0, on: 1, off: 0, active: 1, inactive: 0 };
  const number = text in words ? words[text] : Number(text.replace(',', '.'));
  if (text === '' || !Number.isFinite(number)) {
    throw new WriteError('notANumber', { value: String(input) });
  }
  if (object.family === 'binary') {
    if (number !== 0 && number !== 1) {
      throw new WriteError('notBoolean', { value: String(input) });
    }
    return { tag: TAG.ENUMERATED, value: number, shown: number };
  }
  if (
    (object.min !== undefined && number < object.min) ||
    (object.max !== undefined && number > object.max)
  ) {
    throw new WriteError('outOfBounds', { min: object.min ?? '-∞', max: object.max ?? '∞' });
  }
  let raw = number;
  if (NUMERIC_KINDS.includes(object.resolvedKind)) {
    const { factor } = publishedUnit(object.resolvedKind, object.unit);
    raw = (number / factor - (object.offset ?? 0)) / (object.scale ?? 1);
  }
  // A REAL holds about 7 significant digits.
  if (!Number.isFinite(raw) || Math.abs(raw) > 3.4e38) {
    throw new WriteError('notANumber', { value: String(input) });
  }
  return { tag: TAG.REAL, value: raw, shown: number };
}

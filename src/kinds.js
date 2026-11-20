// -----------------------------------------------------------------------------
// What a BACnet value is, in Gladys terms: the "kinds" an object can be
// declared as (temperature, power, energy...), each with its feature category
// and type, its default unit and the units it accepts; and the BACnet
// engineering units (the `units` property of an analog object) that choose a
// kind and a unit by themselves.
//
// Choices worth knowing (see CLAUDE.md):
// - `energy` is an `energy-sensor/index` in kWh: the core then derives the
//   30-minute consumption and its cost by itself. Wh and MWh are converted.
// - A writable on/off (`switch`) is an `input/binary`, not a `switch/binary`:
//   the voice assistants and HomeKit expose `switch` and `thermostat`
//   features, and a binary output of a building controller may start a fan,
//   a pump or a boiler. `input/binary` keeps the dashboard toggle, no voice.
// - A writable temperature (`setpoint`) is a `water-heater/target-temperature`:
//   the one setpoint control of the core that is neither a room thermostat
//   (averaged into the room temperature, exposed to the assistants) nor bound
//   to a vehicle.
// - A multi-state object is a whole number (`state`, 1 to numberOfStates), or
//   its state text (`text`) when declared so.
// -----------------------------------------------------------------------------

/** Unit symbols the user may write (option unit=), and the Gladys unit of each. */
export const UNIT_SYMBOLS = {
  '°c': 'celsius',
  c: 'celsius',
  degc: 'celsius',
  celsius: 'celsius',
  '°f': 'fahrenheit',
  f: 'fahrenheit',
  fahrenheit: 'fahrenheit',
  k: 'kelvin',
  kelvin: 'kelvin',
  '%': 'percent',
  percent: 'percent',
  w: 'watt',
  kw: 'kilowatt',
  wh: 'watt-hour',
  kwh: 'kilowatt-hour',
  mwh: 'megawatt-hour',
  v: 'volt',
  mv: 'millivolt',
  a: 'ampere',
  ma: 'milliampere',
  va: 'volt-ampere',
  kva: 'kilovolt-ampere',
  var: 'volt-ampere-reactive',
  bar: 'bar',
  mbar: 'milli-bar',
  hpa: 'hPa',
  kpa: 'kPa',
  pa: 'pascal',
  psi: 'psi',
  l: 'liter',
  ml: 'milliliter',
  m3: 'cubicmeter',
  'm³': 'cubicmeter',
  'm3/h': 'cubic-meter-per-hour',
  'm/s': 'meter-per-second',
  ms: 'milliseconds',
  s: 'seconds',
  min: 'minutes',
  h: 'hours',
  d: 'days',
  lux: 'lux',
  ppm: 'ppm',
  db: 'decibel',
};

/** Energy values are published in kWh: factor from the unit read. */
const TO_KWH = { 'watt-hour': 0.001, 'kilowatt-hour': 1, 'megawatt-hour': 1000 };

const BIG = 1_000_000;

/**
 * The kinds. `units`: the Gladys units accepted (first = default); `publish`:
 * a fixed published unit, the value being converted (energy). `objects`: the
 * families of BACnet objects the kind fits (analog, binary, multistate).
 */
export const KINDS = {
  temperature: {
    category: 'temperature-sensor',
    type: 'decimal',
    units: ['celsius', 'fahrenheit', 'kelvin'],
    min: -50,
    max: 150,
    objects: ['analog'],
  },
  humidity: {
    category: 'humidity-sensor',
    type: 'decimal',
    units: ['percent'],
    min: 0,
    max: 100,
    objects: ['analog'],
  },
  pressure: {
    category: 'pressure-sensor',
    type: 'decimal',
    units: ['pascal', 'hPa', 'kPa', 'bar', 'milli-bar', 'psi'],
    min: 0,
    max: 100000,
    objects: ['analog'],
  },
  co2: {
    category: 'co2-sensor',
    type: 'decimal',
    units: ['ppm'],
    min: 0,
    max: 10000,
    objects: ['analog'],
  },
  illuminance: {
    category: 'light-sensor',
    type: 'decimal',
    units: ['lux'],
    min: 0,
    max: 200000,
    objects: ['analog'],
  },
  power: {
    category: 'energy-sensor',
    type: 'power',
    units: ['watt', 'kilowatt'],
    min: -BIG,
    max: BIG,
    objects: ['analog'],
  },
  energy: {
    category: 'energy-sensor',
    type: 'index',
    units: ['kilowatt-hour', 'watt-hour', 'megawatt-hour'],
    publish: 'kilowatt-hour',
    min: 0,
    max: 1_000_000_000,
    objects: ['analog'],
  },
  voltage: {
    category: 'energy-sensor',
    type: 'voltage',
    units: ['volt', 'millivolt'],
    min: 0,
    max: 1000,
    objects: ['analog'],
  },
  current: {
    category: 'energy-sensor',
    type: 'current',
    units: ['ampere', 'milliampere'],
    min: -1000,
    max: 1000,
    objects: ['analog'],
  },
  volume: {
    category: 'volume-sensor',
    type: 'decimal',
    units: ['liter', 'milliliter', 'cubicmeter'],
    min: 0,
    max: 1_000_000_000,
    objects: ['analog'],
  },
  duration: {
    category: 'duration',
    type: 'decimal',
    units: ['seconds', 'milliseconds', 'minutes', 'hours', 'days'],
    min: 0,
    max: 1_000_000_000,
    objects: ['analog'],
  },
  // Any other number: shown as is ("unknown" category), with any known unit.
  value: {
    category: 'unknown',
    type: 'unknown',
    units: [null, ...new Set(Object.values(UNIT_SYMBOLS))],
    min: -BIG,
    max: BIG,
    objects: ['analog', 'multistate'],
  },
  setpoint: {
    category: 'water-heater',
    type: 'target-temperature',
    units: ['celsius', 'fahrenheit'],
    min: 0,
    max: 100,
    writable: true,
    objects: ['analog'],
  },
  binary: {
    category: 'input',
    type: 'binary',
    units: [null],
    min: 0,
    max: 1,
    boolean: true,
    objects: ['binary'],
  },
  switch: {
    category: 'input',
    type: 'binary',
    units: [null],
    min: 0,
    max: 1,
    boolean: true,
    writable: true,
    objects: ['binary'],
  },
  // The number of the active state (1 to numberOfStates).
  state: {
    category: 'unknown',
    type: 'unknown',
    units: [null],
    min: 1,
    max: 1,
    objects: ['multistate'],
  },
  // The text of the active state ("Auto", "Occupied"...), from stateText.
  text: {
    category: 'text',
    type: 'text',
    units: [null],
    min: 0,
    max: 0,
    text: true,
    objects: ['multistate'],
  },
};

/**
 * BACnet engineering units (ASHRAE 135, `units` property) → [kind, Gladys unit].
 * Units missing here give a plain `value` without unit.
 */
export const BACNET_UNITS = {
  62: ['temperature', 'celsius'],
  64: ['temperature', 'fahrenheit'],
  63: ['temperature', 'kelvin'],
  29: ['humidity', 'percent'],
  98: ['value', 'percent'],
  53: ['pressure', 'pascal'],
  133: ['pressure', 'hPa'],
  54: ['pressure', 'kPa'],
  134: ['pressure', 'milli-bar'],
  55: ['pressure', 'bar'],
  56: ['pressure', 'psi'],
  96: ['value', 'ppm'],
  37: ['illuminance', 'lux'],
  47: ['power', 'watt'],
  48: ['power', 'kilowatt'],
  18: ['energy', 'watt-hour'],
  19: ['energy', 'kilowatt-hour'],
  146: ['energy', 'megawatt-hour'],
  5: ['voltage', 'volt'],
  124: ['voltage', 'millivolt'],
  3: ['current', 'ampere'],
  2: ['current', 'milliampere'],
  8: ['value', 'volt-ampere'],
  9: ['value', 'kilovolt-ampere'],
  11: ['value', 'volt-ampere-reactive'],
  82: ['volume', 'liter'],
  197: ['volume', 'milliliter'],
  80: ['volume', 'cubicmeter'],
  135: ['value', 'cubic-meter-per-hour'],
  74: ['value', 'meter-per-second'],
  159: ['duration', 'milliseconds'],
  73: ['duration', 'seconds'],
  72: ['duration', 'minutes'],
  71: ['duration', 'hours'],
  70: ['duration', 'days'],
  199: ['value', 'decibel'],
};

/** The kinds of a number (everything but on/off and text). */
export const NUMERIC_KINDS = Object.keys(KINDS).filter(
  (kind) => !KINDS[kind].boolean && !KINDS[kind].text,
);

/**
 * Turn a value read in `unit` into the value published for the kind.
 * @returns {{ factor: number, unit: string|null }}
 */
export function publishedUnit(kind, unit) {
  const definition = KINDS[kind];
  if (definition.publish) {
    return { factor: TO_KWH[unit] ?? 1, unit: definition.publish };
  }
  return { factor: 1, unit: unit ?? null };
}

/** The Gladys unit of a symbol the user wrote, or undefined. */
export function unitOfSymbol(symbol) {
  return UNIT_SYMBOLS[symbol.toLowerCase()];
}

/** The kind and unit an analog object's BACnet units suggest. */
export function kindOfUnits(units) {
  const [kind, unit] = BACNET_UNITS[units] ?? ['value', null];
  return { kind, unit };
}

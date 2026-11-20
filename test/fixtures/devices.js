// -----------------------------------------------------------------------------
// BACnet devices for the tests, as the fake link serves them.
//
// - BACSERV: the bacnet-stack demo server (bacserv 1234 Test-Device), as read
//   live with @bacnet-js/client on 2026-11-20 (see CLAUDE.md, "Live check"):
//   names, units (percent), state texts, which objects have a priority array
//   (outputs and multi-state values do, analog and binary values do not).
// - AHU: an air handling unit as an HVAC controller presents it (supply and
//   extract temperatures, humidity, CO2, fan command, energy meter, operating
//   mode). Names and values are invented; units are the ASHRAE ones.
//
// Object keys: "<type>:<instance>" with the BACnet type number.
// Properties: 77 objectName, 85 presentValue, 111 statusFlags (bit 0 in-alarm,
// 1 fault, 2 overridden, 3 out-of-service), 117 units, 74 numberOfStates,
// 110 stateText, 104 relinquishDefault (present: commandable).
// -----------------------------------------------------------------------------

const flags = (byte = 0) => ({ value: [byte], bitsUsed: 4 });

export const BACSERV = {
  instance: 1234,
  device: { 77: 'Test-Device', 121: 'BACnet Stack at SourceForge', 70: 'GNU' },
  objects: {
    '0:1': { 77: 'ANALOG-INPUT-1', 85: 0, 111: flags(), 117: 98 },
    '1:1': { 77: 'ANALOG-OUTPUT-1', 85: 0, 111: flags(), 117: 98, 104: 0 },
    '2:1': { 77: 'ANALOG-VALUE-1', 85: 42.5, 111: flags(), 117: 98 },
    '3:1': { 77: 'BINARY-INPUT-1', 85: 0, 111: flags() },
    '4:1': { 77: 'BINARY-OUTPUT-1', 85: 0, 111: flags(), 104: 0 },
    '5:1': { 77: 'BINARY-VALUE-1', 85: 0, 111: flags() },
    '13:1': {
      77: 'MULTI-STATE-INPUT-1',
      85: 1,
      111: flags(),
      74: 3,
      110: ['State 1', 'State 2', 'State 3'],
    },
    '14:1': {
      77: 'MULTI-STATE-OUTPUT-1',
      85: 1,
      111: flags(),
      74: 3,
      110: ['State 1', 'State 2', 'State 3'],
      104: 1,
    },
    '19:1': {
      77: 'MULTI-STATE-VALUE-1',
      85: 1,
      111: flags(),
      74: 3,
      110: ['State 1', 'State 2', 'State 3'],
      104: 1,
    },
    // objects Gladys does not use (calendar, schedule, trend log)
    '6:1': { 77: 'CALENDAR-1' },
    '17:1': { 77: 'SCHEDULE-1' },
    '20:1': { 77: 'TRENDLOG-1' },
  },
};

export const BACSERV_OBJECTS =
  'Supply: ai:1; Setpoint: av:1 write; ao:1 write; Fan: bo:1 write; bi:1; msv:1 text; Mode: mso:1 write';

export const AHU = {
  instance: 2001,
  device: { 77: 'AHU-01', 121: 'Example Controls', 70: 'HVAC controller' },
  objects: {
    '0:1': { 77: 'Supply air temperature', 85: 19.299999237060547, 111: flags(), 117: 62 },
    '0:2': { 77: 'Extract air temperature', 85: 22.100000381469727, 111: flags(), 117: 62 },
    '0:3': { 77: 'Extract air humidity', 85: 41.5, 111: flags(), 117: 29 },
    '0:4': { 77: 'Extract air CO2', 85: 612, 111: flags(), 117: 96 },
    '0:5': { 77: 'Filter pressure drop', 85: 84.5, 111: flags(), 117: 53 },
    '0:6': { 77: 'Heat meter', 85: 15234567, 111: flags(), 117: 18 },
    '0:7': { 77: 'Fan power', 85: 1.25, 111: flags(), 117: 48 },
    '2:10': { 77: 'Supply air setpoint', 85: 20, 111: flags(), 117: 62, 104: 20 },
    '4:1': { 77: 'Supply fan command', 85: 1, 111: flags(), 104: 0 },
    '3:5': { 77: 'Filter alarm', 85: 0, 111: flags() },
    '19:1': {
      77: 'Operating mode',
      85: 2,
      111: flags(),
      74: 4,
      110: ['Off', 'Comfort', 'Economy', 'Night purge'],
      104: 1,
    },
    '14:2': {
      77: 'Fan stage',
      85: 2,
      111: flags(),
      74: 3,
      110: ['Low', 'Medium', 'High'],
      104: 1,
    },
  },
};

export const AHU_OBJECTS = [
  'ai:1',
  'ai:2',
  'Humidity: ai:3',
  'CO2: ai:4 co2',
  'ai:5',
  'Heat: ai:6',
  'ai:7',
  'Setpoint: av:10 write',
  'Fan: bo:1 write',
  'bi:5',
  'Mode: msv:1 text write',
  'Fan stage: mso:2',
].join('; ');

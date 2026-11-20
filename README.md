# BACnet/IP for Gladys Assistant

Read and write the objects of a **BACnet/IP device** from
[Gladys Assistant](https://gladysassistant.com): air handling units, heat pumps
and chillers, room and plant controllers, meters, BACnet gateways (Siemens
Desigo, Daikin, Flexit, Distech, Honeywell...).

> **Developed without real building equipment: feedback welcome.** It was
> tested against the [bacnet-stack](https://github.com/bacnet-stack/bacnet-stack)
> demo server (`bacserv`) in Docker, not against a real controller.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

- One Gladys device per BACnet device, one feature per declared object: analog
  objects as numbers with their unit, chosen from the BACnet engineering units
  (temperature, humidity, pressure, CO2, power, energy in kWh...), binary
  objects as on/off, multi-state objects as a state number or the state text.
- Values polled with **ReadPropertyMultiple** at 10 s to 5 min (property by
  property on devices without it); only the changes reach Gladys, under its 300
  values a minute.
- The device instance read from the device (wildcard 4194303), or typed in.
- **List the objects** reads the objectList and gives the usable objects with
  their name, ready to paste; **Check the configuration** lists the mistakes
  entry by entry.
- **Writing, off by default**, at a configurable **priority** (8 by default):
  dashboard on/off inputs and temperature setpoints, "Write a value" and
  "Release a priority" buttons and scene actions, for the objects declared
  `write` only.
- Scene triggers: device lost, device back, object in alarm or fault
  (statusFlags). A dashboard widget with the first values and the link health.
- Device still published, from a cache, when it is off at startup.

Unlike [gladys-flexit](https://github.com/LM1LC3N7/gladys-flexit), which knows
the objects of Flexit ventilation units, this integration talks to any
BACnet/IP device: the user picks the objects.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A BACnet/IP device (UDP 47808 by default) with a fixed IP address, reachable
  in unicast from the Gladys server. BACnet MS/TP devices need a BACnet/IP
  router.

## Installation

In Gladys: **Integrations → Install from GitHub**, then the address of this
repository, `https://github.com/guim31/gladys-bacnet`. Then follow the
[documentation](docs/en.md).

## How it works

- The Gladys sandbox runs the container on a bridge network: a Who-Is broadcast
  never reaches the building network, so every request is unicast to the
  address typed by the user.
- The container polls by its own timer (`should_poll: false`): the first cycle
  reads the names, units, number of states, state texts and whether each
  object is commandable (relinquishDefault present), publishes the device and
  caches that under `/data`; the next ones read `presentValue` and
  `statusFlags`.
- A write sends `presentValue` with the BACnet tag of the object (REAL,
  ENUMERATED, UNSIGNED) at the chosen priority, then reads the value back and
  publishes it; a release writes `NULL` at that priority.

## Checked, and what was not

- Checked against `bacserv` (bacnet-stack, Docker, bridge network), from the
  integration image run with the Gladys sandbox constraints: instance read with
  the wildcard, objectList, ReadPropertyMultiple, a wrong instance, a missing
  object, writes with priority, a release, an object without priority array, a
  device switched off then back.
- Not checked: real controllers and gateways, devices without
  ReadPropertyMultiple, segmented object lists, devices that answer on a fixed
  port, a real Gladys instance. Reports welcome in the issues.

## Limitations

- No Who-Is discovery, no COV subscription, no BBMD or foreign device
  registration.
- One BACnet device per installation of the integration.
- Analog, binary and multi-state objects only.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK
(`@gladysassistant/integration-sdk/testing`) and a fake BACnet device behind the
link interface (`test/helpers/fakeBacnet.js`), with fixtures read from
`bacserv` (`test/fixtures/devices.js`). `scripts/live-check.mjs` runs the
integration against a real device or the simulator:

```bash
# bacserv image: bacnet-stack built with `make server` (see CLAUDE.md)
docker network create gladys-test-bacnet
docker run -d --name gladys-test-bacnet-server --network gladys-test-bacnet \
  gladys-test-bacnet-bacserv 1234 Test-Device
docker run --rm --network gladys-test-bacnet -v "$PWD:/app:ro" -w /app \
  mirror.gcr.io/library/node:24-alpine \
  node scripts/live-check.mjs gladys-test-bacnet-server "ai:1; av:1 write; ao:1 write; msv:1 text"
```

See [`CLAUDE.md`](CLAUDE.md) for the project rules. Releases go through
**Actions → Release** (it bumps `package.json`, the manifest `version` and
`docker_image`, and rolls `CHANGELOG.md`). A hand-pushed `vX.Y.Z` tag only
builds the image: bump `version` in `package.json` and in the manifest (with
the `docker_image` tag) and commit it before tagging.

## Credits

- [@bacnet-js/client](https://github.com/bacnet-js/client) (MIT), maintained by
  Innovation-System, fork of [node-bacstack](https://github.com/fh1ch/node-bacstack)
  by Fabio Huser: the BACnet/IP stack.
- [bacnet-stack](https://github.com/bacnet-stack/bacnet-stack) by Steve Karg
  and contributors: the demo server used for the tests and the fixtures.
- The architecture and the conformity tests follow
  [gladys-opcua](https://github.com/guim31/gladys-opcua) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

BACnet® is a registered trademark of ASHRAE. This project is not affiliated
with, endorsed or sponsored by ASHRAE, Siemens, Daikin, Flexit, Distech
Controls or Honeywell; their names are trademarks of their owners.

## License

Apache-2.0

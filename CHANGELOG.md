# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-20

### Added

- Read the objects of a BACnet/IP device (air handling units, heat pumps,
  controllers, meters): one Gladys device, one feature per declared object —
  analog values with their unit taken from the BACnet units, binary values,
  multi-state values as a number or as the state text.
- Polling with ReadPropertyMultiple at 10 s to 5 min, property by property on
  devices without it; device instance read from the device or typed in.
- "List the objects" (from the objectList, ready to copy) and "Check the
  configuration".
- Writing, off by default, at a configurable BACnet priority (8 by default):
  dashboard on/off inputs and setpoints, "Write a value" and "Release a
  priority" buttons and scene actions, for the objects declared `write` only.
- Scene triggers: device lost, device back, object in alarm or fault.
- "BACnet device" dashboard widget.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-bacnet/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-bacnet/releases/tag/v1.0.0

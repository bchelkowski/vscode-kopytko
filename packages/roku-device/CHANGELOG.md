# Changelog


## [1.3.0] - 2026-07-27

### Added
- `ConsoleStream` — raw streaming transport for the interactive debug consoles (TCP 8085 and 8080)
- Command catalog for ports 8085 and 8080 with completion and destructive-command detection
- Port 8080 catalog reconciled with a live `help` capture (firmware 15.2.4.3442): adds `clear_launch_caches`,
  `type`, and `?` as a `help` alias; corrects the `press` and `target` argument hints

## [1.2.1] - 2026-07-17

### Added
- RALE TrackerTask client for live SceneGraph editing

## [1.2.0] - 2026-07-16

### Added
- Add queryAppUi (GET /query/app-ui) to EcpClient and CLI

## [1.1.0] - 2026-07-06

### Added
- Complete ECP coverage and add kopytko-roku CLI
## [1.0.0] - 2026-07-06

### Added
- Add ECP key simulation, text entry, active-app and media-player queries
- Add developer web-admin automation (InstallerClient)
- Add ECP launch/input/icon methods for deep linking
- Move DeviceManager behind DeviceStorage/NetworkWatcher interfaces
- Migrate device communication modules and tests into package

### Changed
- Keep the package Kopytko-ecosystem-unaware

### Maintenance
- Add release workflow
- Scaffold kopytko-roku-device package


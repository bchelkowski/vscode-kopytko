# Changelog


## [0.3.1] - 2026-06-11

### Fixed
- Align scope building with extension for parity

## [0.3.0] - 2026-06-11

### Changed
- Async I/O for 2.7x faster CLI linting

## [0.2.0] - 2026-06-11

### Added
- Add XML component scope and extends chain resolution

## [0.1.4] - 2026-06-11

### Fixed
- Add test globals, resolution caching, and performance optimization

## [0.1.3] - 2026-06-11

### Fixed
- Fix CLI import resolution with kopytkoModuleDir and walk-up node_modules

## [0.1.2] - 2026-06-11

### Fixed
- Fix import resolution and transitive function scope

## [0.1.1] - 2026-06-11

### Added
- Add standalone BrightScript linter package
All notable changes to kopytko-linter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-11

### Added

- 19 BrightScript diagnostic rules covering imports, identifiers, syntax, and test structure
- CLI tool (`kopytko-lint`) with `--check` mode for CI pipelines
- Three output formats: text, JSON, SARIF (GitHub Code Scanning)
- Configurable per-rule severity via `kopytko-linter.json` or `.vscode/settings.json`
- Library API: `lintProject()` and `lintFile()` for editor/tool integration
- Config resolution from `kopytko-linter.json`, `.vscode/settings.json` (`kopytko.lint.*` keys), or `--config` flag

# Changelog


## [1.6.4] - 2026-06-24

### Fixed
- Skip m.top method calls in mtop/undefined-field rule

## [1.6.3] - 2026-06-24

- Release 1.6.3

## [1.6.2] - 2026-06-24

### Added
- Wire getMtopFields in CLI context for mtop/undefined-field

## [1.6.1] - 2026-06-24

- Release 1.6.1

## [1.6.0] - 2026-06-24

### Added
- Add goto as unreachable terminator, m-field diagnostics, migrate unreachableCode out of legacyRules

## [1.5.3] - 2026-06-24

- Release 1.5.3

## [1.5.2] - 2026-06-24

### Fixed
- Fix loop-variable-leak false positives for writes and re-assignments

## [1.5.1] - 2026-06-23

- Release 1.5.1

## [1.5.0] - 2026-06-23

### Added
- Add loop-variable-leak, duplicate-function, unreachable-code rules; fix import/unused false positives

### Fixed
- Fix 4 bugs found in code review of new lint rules

### Changed
- Single-pass file analysis and per-rule descriptor modules

## [1.4.0] - 2026-06-19

### Added
- Add identifier/unused-function dead-code diagnostic rule

## [1.3.2] - 2026-06-18

- Release 1.3.2

## [1.3.1] - 2026-06-18

### Fixed
- Allow trailing suppression comment on @import/@mock lines

## [1.3.0] - 2026-06-18

### Added
- Add inline suppression comments

## [1.2.0] - 2026-06-18

### Added
- Add identifier/shadows-function rule

## [1.1.3] - 2026-06-18

### Fixed
- Align SARIF output with --check run

## [1.1.2] - 2026-06-18

### Added
- Accept an optional pre-parsed CST in lintFile

## [1.1.1] - 2026-06-17

### Added
- Add import/missing-promise-deps rule

### Fixed
- Fix import/unused false positives for function-as-value and split test suites

## [1.1.0] - 2026-06-17

### Added
- Add import/unused, entry-point exemption, throw and scope fixes

## [1.0.8] - 2026-06-17

- Release 1.0.8

## [1.0.7] - 2026-06-16

- Release 1.0.7

## [1.0.6] - 2026-06-15

### Fixed
- Correct unused-param fix column on lines with end sub

## [1.0.5] - 2026-06-15

### Fixed
- Handle AA/array literals in param default values

## [1.0.4] - 2026-06-15

- Release 1.0.4

## [1.0.3] - 2026-06-15

### Added
- Add identifier/unused-variable diagnostic rule

### Changed
- Remove unused code in typeAnnotationRules

## [1.0.2] - 2026-06-14

### Added
- Validate callback function names in observeField and Kopytko events

## [1.0.1] - 2026-06-14

### Fixed
- Cast severity to LintSeverity in type rules
- Add roRenderThreadQueue to component catalog

## [1.0.0] - 2026-06-14

### Fixed
- Correct column for unused parameter diagnostic
- Prevent stripNumericLiterals from corrupting identifiers with digits

## [0.5.6] - 2026-06-14

- Release 0.5.6

## [0.5.5] - 2026-06-13

- Release 0.5.5

## [0.5.4] - 2026-06-12

### Added
- Add auto-fix for import/duplicate rule

### Fixed
- Change import/duplicate default severity to warning

## [0.5.3] - 2026-06-12

- Release 0.5.3

## [0.5.2] - 2026-06-12

### Fixed
- Skip XML attribute access operator @ in identifier checks
- Resolve @mock imports in function scope, add Cdbl builtin, --fix mode, severity defaults

## [0.5.1] - 2026-06-12

### Fixed
- Count AA and array literals as arguments in countCallArgs

## [0.5.0] - 2026-06-11

### Added
- Auto-import mock config files for @mock annotations

## [0.4.0] - 2026-06-11

### Added
- Add Mock() as test framework global for mock files

## [0.3.4] - 2026-06-11

### Fixed
- Parse params with nested parens in default values

## [0.3.3] - 2026-06-11

### Fixed
- Add generatedModules functions to knownFuncNames in CLI

## [0.3.2] - 2026-06-11

### Fixed
- Fix scope analysis and config reading

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

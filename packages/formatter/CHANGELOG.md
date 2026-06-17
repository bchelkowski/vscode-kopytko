# Changelog


## [1.1.1] - 2026-06-17

- Release 1.1.1

## [1.1.0] - 2026-06-17

### Added
- Migrate to brightscript-parser CST

### Changed
- Rename directory to packages/formatter

## [1.0.10] - 2026-06-16

### Fixed
- Fix depth tracking for chained anonymous callbacks

## [1.0.9] - 2026-06-16

### Fixed
- Count only inline closers in anonymous function detection

## [1.0.8] - 2026-06-16

### Fixed
- Correct indentation for inline anonymous subs and AA keyword keys

## [1.0.7] - 2026-06-15

- Release 1.0.7

## [1.0.6] - 2026-06-15

### Fixed
- Handle : statement separators in indentation pass

## [1.0.5] - 2026-06-14

### Fixed
- Make bracket depth tracking string-aware

## [1.0.4] - 2026-06-14

### Breaking Changes
- Remove catchParenStyle setting

### Changed
- Remove catchParenStyle setting

## [1.0.3] - 2026-06-14

### Fixed
- Remove invalid catchParenStyle always option

## [1.0.2] - 2026-06-14

### Fixed
- Handle nested parens in anon function params

## [1.0.1] - 2026-06-14

- Release 1.0.1

## [1.0.0] - 2026-06-14

- Release 1.0.0

## [0.1.9] - 2026-06-14

- Release 0.1.9

## [0.1.8] - 2026-06-12

- Release 0.1.8

## [0.1.7] - 2026-06-11

### Fixed
- Parse .vscode/settings.json as JSONC with inline comments, block comments, and trailing commas
- Convert anonymous function() as Void to sub() with functionVsSubForVoid option

## [0.1.6] - 2026-06-11

### Fixed
- Do not apply builtin casing to non-call identifiers
- Indent multi-line function arguments with mixed [] and {} correctly

## [0.1.5] - 2026-06-10

### Added
- Add aaCommaSpacing and catchParenStyle formatting options

### Fixed
- Remove spurious blank lines before lone return with not-alone setting

## [0.1.4] - 2026-06-10

### Fixed
- Fix chain indentation, multi-line return blank line, and parenthesisIfCase comment wrapping

## [0.1.3] - 2026-06-09

### Fixed
- Fix indentation and spacing edge cases

## [0.1.2] - 2026-06-09

- Release 0.1.2

## [0.1.1] - 2026-06-09

- Release 0.1.1
All notable changes to kopytko-formatter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-09

### Added

- 11-pass BrightScript formatting engine with 40+ configurable rules
- CLI tool (`kopytko-format`) with `--check` and `--write` modes
- Config resolution from `kopytko-formatter.json`, `.vscode/settings.json`, or `--config` flag
- VS Code `kopytko.format.*` settings key mapping (casing keys)
- `--ignore` flag and config `ignore` array for excluding paths
- Library API: `formatText()` and `checkFormatting()`

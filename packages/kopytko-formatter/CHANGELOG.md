# Changelog


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

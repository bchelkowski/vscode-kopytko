# Changelog

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

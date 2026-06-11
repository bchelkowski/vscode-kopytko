# Changelog


## [0.1.7] - 2026-06-11

### Added
- Add diagnostic for variables shadowing built-in functions

### Fixed
- Recognize anonymous function params as callable local names
- Recognize anonymous function params on end-function lines
- Skip readOnlyPaths in formatting provider
- Remove undocumented builtins and add docsUrl to all entries

## [0.1.6] - 2026-06-11

### Fixed
- Resolve false-positive undefined-variable on scope-boundary lines

## [0.1.5] - 2026-06-10

### Added
- PascalCase test file resolution with service suffix
- Suppress undefined-function in main.brs and entry-point functions
- Per-function scope isolation, throw validation, and catch variable scope
- Add generatedModules setting for build-generated imports
- Add aaCommaSpacing and catchParenStyle VS Code settings

## [0.1.4] - 2026-06-09

### Fixed
- Files not validated on initization

## [0.1.3] - 2026-06-09

### Fixed
- Extension is not working in the VS Code

## [0.1.2] - 2026-06-09

- Release 0.1.2

## [0.1.1] - 2026-06-09

- 8d65859 chore: use published kopytko-formatter@0.1.2 from npm
- d8e2443 feat: BrightScript language support for VS Code with standalone formatter
- 9a66604 feat: initial release
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-09

### Added

- BrightScript syntax highlighting and language configuration
- IntelliSense completions for built-in functions, keywords, ro* components, and user-defined functions
- Hover documentation for components, methods, built-in functions, and Kopytko exports
- `CreateObject` type inference with member completions
- Go-to-definition for `@import`/`@mock` paths and user-defined functions
- Find References and Rename across workspace
- Diagnostics for `@import` resolution, undefined variables, and undefined functions
- Document formatting — multi-pass engine with 40+ configurable rules
- Standalone `kopytko-formatter` CLI for CI format checking
- Kopytko module catalog with package name completions
- `@import` / `@mock` sorting and annotation completions
- Roku device discovery via SSDP
- BrightScript debugger (deploy, breakpoints, variable inspection)
- Code snippets for BrightScript and Kopytko test framework

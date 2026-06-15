# Changelog


## [1.0.8] - 2026-06-15

### Fixed
- Remove quick fix for unused-variable diagnostic

## [1.0.7] - 2026-06-15

### Added
- Add unused-variable code action and update docs
- Add unused-variable code action and update docs

## [1.0.6] - 2026-06-14

### Added
- Add Roku OS 15.0+ data transfer APIs and roUtils

### Fixed
- Remove unused imports breaking CI lint
- Add missing since property to component and SgNodeMethod types
- Nodes are not expandable variables during debugging

## [1.0.5] - 2026-06-14

- Release 1.0.5

## [1.0.4] - 2026-06-14

### Fixed
- Sync catchParenStyle with formatter package

## [1.0.3] - 2026-06-14

- Release 1.0.3

## [1.0.2] - 2026-06-14

- Release 1.0.2

## [1.0.1] - 2026-06-14

- Release 1.0.1

## [1.0.0] - 2026-06-14

### Breaking Changes
- Normalize settings names and implement 13 formatter passes

### Added
- Add roRenderThreadQueue component to catalog
- Show all channels in registry viewer
- Normalize settings names and implement 13 formatter passes

### Fixed
- Remove unused parseAppsXml import
- Deduplicate Go to Definition results

## [0.2.4] - 2026-06-14

### Added
- Add per-device environment selection and upload

### Fixed
- Replace numeric literals with zeros instead of spaces

## [0.2.3] - 2026-06-13

### Added
- Add registry viewer for Roku devices
- Split toggle commands into state-dependent pairs
- Redesign device tree view and identification
- Add BrightScript numeric literal type support

### Fixed
- Rewrite debug protocol to match Roku spec
- Roku device discovery and debugging not working at all
- Roku device discovery and debugging not working at all

## [0.2.2] - 2026-06-12

### Added
- Add quick fix for duplicate imports

### Fixed
- Fix all lint errors in test files
- Read server version from package.json
- Wire scanTimeout and showNotifications device discovery settings
- Normalize paths case-insensitively to fix macOS duplicate definitions
- Auto-import functions from _mocks/*.mock.brs in test files

### Changed
- Delete deprecated modules.ts and backport granular keyword casing

## [0.2.1] - 2026-06-12

### Fixed
- Use env var instead of inline single quotes for changelog entry
- Use project's kopytko-packager for build/deploy and fix device detection

## [0.2.0] - 2026-06-12

### Added
- Migrate debugger to socket-based debug protocol (port 8081)
- Reliable Roku device discovery with SSDP, persistence, and sidebar UI

## [0.1.8] - 2026-06-11

### Fixed
- Suppress unused-import warning for PromiseResolve/PromiseReject when resolvedValue/rejectedValue is used
- Fix Roku device discovery with per-NIC sockets and triple M-SEARCH
- Deduplicate go-to-definition results for project functions

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

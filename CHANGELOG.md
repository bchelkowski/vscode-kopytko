# Changelog


## [1.4.0] - 2026-06-25

### Added
- Add sort toggle to rendezvous panel
- Add group time summary and drop count warning to rendezvous panel
- Add rendezvous debugging panel

### Fixed
- Navigate to rendezvous files inside node_modules
- Replace context-key sort buttons with always-visible toggle
- Correct sgrendezvous ECP endpoints and XML parser

## [1.3.1] - 2026-06-24

### Added
- Add call hierarchy provider
- Add CST-driven folding range and selection range providers

### Fixed
- Remove unused isNode imports in folding and selection range providers
- Include SG node methods in m.top valid-member set
- Normalize paths in collectMtopItems to fix mtop/undefined-field on Windows

### Maintenance
- Bump kopytko-linter to v1.6.6
- Bump kopytko-formatter to v1.1.12
- Bump kopytko-linter to v1.6.5
- Bump kopytko-formatter to v1.1.11
- Bump kopytko-linter to v1.6.4
- Bump kopytko-linter to v1.6.3
- Bump kopytko-linter to v1.6.2
- Bump kopytko-formatter to v1.1.10
- Bump kopytko-linter to v1.6.1
- Bump kopytko-linter to v1.6.0
- Add .gitattributes file

## [1.3.0] - 2026-06-24

- Release 1.3.0

## [1.2.6] - 2026-06-23

### Added
- Wire new linter rules, fix references false positives, add m.top field validation

### Fixed
- Fix 2 bugs in diagnosticsProvider found in code review

### Changed
- Split activation and debug adapter, fix client resource leaks
- Decompose LSP server and share symbol resolution

## [1.2.5] - 2026-06-19

- Release 1.2.5

## [1.2.4] - 2026-06-19

### Added
- Add WorkspaceCallIndex to power dead-code diagnostic

### Fixed
- Implement kopytko.lint.readOnlyPaths to skip linting only

## [1.2.3] - 2026-06-19

- Release 1.2.3

## [1.2.2] - 2026-06-19

### Added
- Treat source/ directory functions as globally accessible

### Fixed
- Rename ts to getTestSuite in test framework catalog

## [1.2.1] - 2026-06-18

### Fixed
- Add missing file icon and syntax color setup

## [1.2.0] - 2026-06-18

### Added
- Add semantic tokens provider

## [1.1.3] - 2026-06-18

### Changed
- Reuse the cached CST for linter diagnostics
- Cache file reads/parses across documents and tighten LSP caching

## [1.1.2] - 2026-06-17

### Fixed
- ParseImports callback now parses sibling content correctly

## [1.1.1] - 2026-06-17

### Added
- Add debug-alt sidebar button, play icon for upload, and Ctrl+Shift+F5 keybinding

### Fixed
- Missing verifySyntax field in formatting config

## [1.1.0] - 2026-06-17

### Added
- Migrate extension to use brightscript-parser

## [1.0.9] - 2026-06-16

### Fixed
- Combine unused-parameter fixes into a single code action
- Stop false unused-variable warning for AA args after end function

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

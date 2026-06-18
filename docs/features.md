# vscode-kopytko — Feature Overview

This document is the canonical list of extension features. Each feature links to its dedicated documentation file. New features must be documented here before being considered complete.

## Language Support

| Feature | Status | Doc |
|---|---|---|
| BrightScript syntax highlighting (keywords, types, strings, numbers, operators) | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |
| Function call and `m` variable highlighting (distinct scopes) | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |
| `as <type>` annotations highlighted as types, including `Function` | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |
| `@import` / `@mock` annotation highlighting (distinct colours) | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |
| Language configuration (brackets, comments, indent rules) | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |
| Code snippets — general BrightScript + test framework | ✅ Implemented | [brightscript-support.md](./brightscript-support.md) |

## Completions

| Feature | Status | Doc |
|---|---|---|
| BrightScript built-in functions and keywords | ✅ Implemented | [language-server.md](./language-server.md) |
| User-defined functions from file scope (`@import` chain, XML siblings, extends chain) | ✅ Implemented | [language-server.md](./language-server.md) |
| Local variables (function parameters, assignments, for-loop vars) | ✅ Implemented | [language-server.md](./language-server.md) |
| `as <type>` annotations (primitive types + ro\* components) | ✅ Implemented | [language-server.md](./language-server.md) |
| `CreateObject("…")` component name completions (inside string only) | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Component member completion via `CreateObject` / typed-param / numeric literal type inference | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Inner method completion on dot-access (`obj.` and `Constructor().`) | ✅ Implemented | [language-server.md](./language-server.md) |
| `m.top.` member completion (own XML interface, parent components, SG node catalog) | ✅ Implemented | [language-server.md](./language-server.md) |
| `@import` / `@mock` annotation snippets and path auto-complete | ✅ Implemented | [language-server.md](./language-server.md) |
| Kopytko module exports with auto-insert `@import` | ✅ Implemented | [language-server.md](./language-server.md) |
| Configurable identifier casing (builtins, keywords, types, methods, user functions) | ✅ Implemented | [language-server.md](./language-server.md) |

## Hover & Navigation

| Feature | Status | Doc |
|---|---|---|
| Hover docs for built-in functions, component names, and component methods | ✅ Implemented | [language-server.md](./language-server.md) |
| Hover docs for user-defined functions (signature, source file) | ✅ Implemented | [language-server.md](./language-server.md) |
| Hover docs for Kopytko module exports | ✅ Implemented | [language-server.md](./language-server.md) |
| Hover type info for numeric literals and variables assigned from them | ✅ Implemented | [language-server.md](./language-server.md) |
| Component catalog with firmware `since`, deprecation, Roku docs links | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
| Go-to-definition for `@import`/`@mock` paths and user-defined functions | ✅ Implemented | [language-server.md](./language-server.md) |
| Signature help (`textDocument/signatureHelp`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Find All References — workspace-wide symbol references (via VS Code built-in) | ✅ Implemented | [language-server.md](./language-server.md) |
| Outline view — functions, subs, and AA methods | ✅ Implemented | [language-server.md](./language-server.md) |
| Workspace symbol search (`Ctrl+T`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Document links — `@import` / `@mock` as clickable URLs | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |

## Diagnostics

| Feature | Status | Doc |
|---|---|---|
| Undefined function calls (`identifier/undefined-function`) — suppressed for the entire `main.brs` file and inside Roku entry-point functions | ✅ Implemented | [language-server.md](./language-server.md) |
| Undefined variables (`identifier/undefined-variable`) with per-function scope isolation — outer variables are not visible inside inner anonymous functions (no closures) | ✅ Implemented | [language-server.md](./language-server.md) |
| Unused function parameters with `_` prefix quick-fix (`identifier/unused-parameter`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Unused local variables warning (`identifier/unused-variable`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Built-in function arity check (`identifier/wrong-arg-count`) | ✅ Implemented | [language-server.md](./language-server.md) |
| `CreateObject` unknown component (`createobject/unknown-component`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Loop flow control validation (`syntax/flow-outside-loop`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Trailing comma syntax errors (`syntax/trailing-comma`) | ✅ Implemented | [language-server.md](./language-server.md) |
| `catch` variable scope — variable defined by `catch e` / `catch (e)` is recognised in the catch block | ✅ Implemented | [language-server.md](./language-server.md) |
| `throw` validation — warns for non-string/non-AA values and AAs missing `message` field (`throw/invalid-value`, `throw/missing-message`) | ✅ Implemented | [language-server.md](./language-server.md) |
| `@import` diagnostics — unresolved, duplicate, unused, malformed, build-generated | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Conditional compilation lines (`#if`, `#const`) skipped by diagnostics | ✅ Implemented | [language-server.md](./language-server.md) |
| SceneGraph `extends` inheritance in diagnostic scope | ✅ Implemented | [language-server.md](./language-server.md) |
| XML sibling scope and pattern sibling scope for diagnostics | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Component name lookup by `<component name>` attribute (handles dotted filenames) | ✅ Implemented | [language-server.md](./language-server.md) |
| Observer callback validation (`callback/undefined-observer-callback`) — verifies `observeField`/`observeFieldScoped` 2nd argument names a reachable function | ✅ Implemented | [language-server.md](./language-server.md) |
| Kopytko events callback validation (`callback/undefined-event-callback`) — verifies `events: {}` values in template render objects name reachable functions | ✅ Implemented | [language-server.md](./language-server.md) |

## Refactoring & Formatting

| Feature | Status | Doc |
|---|---|---|
| Rename symbol (`textDocument/rename`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Code actions — quick fixes for import diagnostics, unused parameters, and unused variables | ✅ Implemented | [language-server.md](./language-server.md) |
| Document formatting — multi-pass engine with 60+ configurable rules | ✅ Implemented | [formatting.md](./formatting.md) |
| Conditional compilation indentation (`#if`/`#else if`/`#else`/`#end if`, `#const`) | ✅ Implemented | [formatting.md](./formatting.md) |
| Increment (`++`) and decrement (`--`) operators preserved by spacing pass | ✅ Implemented | [formatting.md](./formatting.md) |
| Comment lines never affect indentation depth (commented-out blocks are inert) | ✅ Implemented | [formatting.md](./formatting.md) |
| Method-chain continuation (`.method(…)`) lines indent one level deeper than the chain start | ✅ Implemented | [formatting.md](./formatting.md) |
| `emptyLineBeforeReturn` skips blank between a comment and its following return | ✅ Implemented | [formatting.md](./formatting.md) |
| Standalone formatter CLI (`kopytko-format --check`, `--write`) | ✅ Implemented | [kopytko-formatter README](../packages/kopytko-formatter/README.md) |
| CLI ignore patterns (`--ignore`, config `ignore` array) | ✅ Implemented | [formatting.md](./formatting.md#cli--ci-usage) |
| Granular identifier casing with exact-casing overrides | ✅ Implemented | [language-server.md](./language-server.md) |
| `Function` after `as` uses type casing, not keyword casing | ✅ Implemented | [language-server.md](./language-server.md) |
| `@import` / `@mock` sorting and `emptyLineAfterImports` | ✅ Implemented | [formatting.md](./formatting.md) |
| Catch parentheses always stripped (`catch (e)` → `catch e`) | ✅ Implemented | [formatting.md](./formatting.md) |
| `associativeArrayCommaSpacing` — control spaces around commas in inline `{}` associative arrays | ✅ Implemented | [formatting.md](./formatting.md) |

## Standalone Linter (CI)

| Feature | Status | Doc |
|---|---|---|
| Standalone linter package (`kopytko-linter`) with all 25 diagnostic rules | ✅ Implemented | [kopytko-linter README](../packages/kopytko-linter/README.md) |
| CLI tool (`kopytko-lint --check`) for CI pipelines | ✅ Implemented | [kopytko-linter README](../packages/kopytko-linter/README.md) |
| Configurable per-rule severity via `kopytko-linter.json` or `.vscode/settings.json` | ✅ Implemented | [kopytko-linter README](../packages/kopytko-linter/README.md) |
| Three output formats: text, JSON, SARIF (GitHub Code Scanning) | ✅ Implemented | [kopytko-linter README](../packages/kopytko-linter/README.md) |
| Library API: `lintProject()` and `lintFile()` | ✅ Implemented | [kopytko-linter README](../packages/kopytko-linter/README.md) |
| Extension `diagnosticsProvider` uses `kopytko-linter` as thin LSP adapter | ✅ Implemented | [language-server.md](./language-server.md) |

## Kopytko Import Resolution

| Feature | Status | Doc |
|---|---|---|
| `@import` / `@mock` annotation parsing and resolution (internal, external, transitive) | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| `kopytkoModuleDir` and `sourceDir` support | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Configurable `generatedPaths` glob patterns | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| `generatedModules` — declare functions in build-generated imports (suppresses both path and undefined-function errors) | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Sibling file scope (`kopytko.imports.siblingPatterns`) | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Dynamic Kopytko module catalog (runtime scan of installed packages) | ✅ Implemented | [language-server.md](./language-server.md) |
| `.kopytkorc` JSON schema validation | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |

## Kopytko Unit Testing Framework

| Feature | Status | Doc |
|---|---|---|
| Test file detection and scope resolution (tested file, extends, XML siblings, split suites) | ✅ Implemented | [language-server.md](./language-server.md) |
| Nested `_tests/` subdirectory support | ✅ Implemented | [language-server.md](./language-server.md) |
| `@mock` annotation support (links, completions, highlighting, sorting) | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| `@mock` auto-import of `_mocks/*.mock.brs` and `_mocks/*.config.brs` functions | ✅ Implemented | [kopytko-imports.md](./kopytko-imports.md) |
| Test framework completions (`expect()` matchers, `mockFunction()` methods, globals) | ✅ Implemented | [language-server.md](./language-server.md) |
| Test framework hover docs | ✅ Implemented | [language-server.md](./language-server.md) |
| Test case symbols in Outline (`it()`, `test()`, `itEach()`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Test diagnostics — missing `return ts`, missing `@mock` for `mockFunction` calls | ✅ Implemented | [language-server.md](./language-server.md) |

## Roku Device Management

| Feature | Status | Doc |
|---|---|---|
| SSDP device discovery (active M-SEARCH + passive NOTIFY) | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Network change detection and auto-rescan | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Sleep/wake detection with auto-rescan | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Device health checks via ECP | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Sidebar tree view with device info | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Favorite/saved devices (persisted globally) | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Manual device entry by IP | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Secure password storage (OS keychain via SecretStorage) | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Set/unset active device for debug/deploy | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Per-device environment selection from .kopytkorc | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Package upload via sidebar UI (play icon, `Ctrl+Shift+F5` keybinding for active device) | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Start debug session from sidebar (debug-alt icon per device, equivalent to F5) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Context menu actions (copy IP, open web portal, set password) | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Registry viewer (read device registry via ECP, all channels) | ✅ Implemented | [device-discovery.md](./device-discovery.md) |
| Device info webview panel | ⬜ Planned | — |
| Remote control | ⬜ Planned | — |

## Debugging

| Feature | Status | Doc |
|---|---|---|
| Build and deploy via project's kopytko-packager with `remotedebug=1` manifest injection | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Socket-based debug protocol (port 8081, protocol 3.3.0) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Dynamic breakpoints (add/remove at runtime, no source injection) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Conditional breakpoints (BrightScript expressions) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Hit-count breakpoints | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Breakpoint verification events | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Exception breakpoints (caught/uncaught) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Variable inspection — typed, expandable containers, virtual variables | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Multi-thread inspection (SceneGraph threads) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Call stack with per-thread support | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Stepping (over, into, out) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Pause command (STOP) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Debug console REPL (EXECUTE command) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Hover-to-evaluate | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Compile errors as VS Code diagnostics | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Program output via dedicated IO channel | ✅ Implemented | [roku-debug.md](./roku-debug.md) |

## Performance & Caching

| Feature | Status | Notes |
|---|---|---|
| Per-document cache (true LRU) | ✅ Implemented | `utils/documentCache.ts` caches split lines, parsed CST, type map, imports, and collected functions per `{uri, version, length}`, evicting the least-recently-used document. Every provider reads through it (`getCachedLines`, `getCachedParseResult`, `getCachedAllFunctions`, …) rather than recomputing. |
| Cross-document file parse cache | ✅ Implemented | `utils/fileParseCache.ts` reads and parses each `.brs`/`.xml` file once and shares the text + definitions across all documents and providers. Find References, Rename, and the `@import`/sibling/extends collectors consume it instead of re-reading from disk. The edited document always parses its own live buffer. |
| Component-XML resolution cache | ✅ Implemented | `findComponentXml` memoizes `componentName → XML path` (including negative results), keyed by search roots, avoiding repeated recursive directory walks during `extends`-chain resolution. |
| Import-path directory cache | ✅ Implemented | Import-path completion lists each directory once per session via `readCachedDir`. |
| Granular cache invalidation | ✅ Implemented | A watched-file change evicts only the changed files from the file cache and recomputes per-document state, keeping unaffected files warm. Plain settings changes no longer trigger a full installed-package re-walk (that runs once at startup; `package.json`/`node_modules` changes still rescan). |

## Planned / Future

### Roku Device & Debugging

| Feature | Notes |
|---|---|
| Device info webview panel | Detailed device information in a dedicated webview panel. |
| Remote control | Send key presses to the active Roku from the command palette or a webview panel. |
| Channel screenshot | Capture a screenshot via ECP and open in VS Code. |
| Roku log streaming panel | Always-on output channel streaming Roku syslog, independent of debug sessions. |

### Debugger — future enhancements

See [roku-debug.md — Future possibilities](./roku-debug.md#future-possibilities) for the full roadmap including source map support, profiling, SceneGraph inspector, logpoints, and more.

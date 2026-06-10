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
| Component member completion via `CreateObject` / typed-param inference | ✅ Implemented | [brightscript-components.md](./brightscript-components.md) |
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
| Undefined function calls (`identifier/undefined-function`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Undefined variables (`identifier/undefined-variable`) with per-function scope isolation — outer variables are not visible inside inner anonymous functions (no closures) | ✅ Implemented | [language-server.md](./language-server.md) |
| Unused function parameters with `_` prefix quick-fix (`identifier/unused-parameter`) | ✅ Implemented | [language-server.md](./language-server.md) |
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

## Refactoring & Formatting

| Feature | Status | Doc |
|---|---|---|
| Rename symbol (`textDocument/rename`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Code actions — quick fixes for import diagnostics and unused parameters | ✅ Implemented | [language-server.md](./language-server.md) |
| Document formatting — multi-pass engine with 12+ configurable rules | ✅ Implemented | [formatting.md](./formatting.md) |
| Conditional compilation indentation (`#if`/`#else if`/`#else`/`#end if`, `#const`) | ✅ Implemented | [formatting.md](./formatting.md) |
| Increment (`++`) and decrement (`--`) operators preserved by spacing pass | ✅ Implemented | [formatting.md](./formatting.md) |
| Comment lines never affect indentation depth (commented-out blocks are inert) | ✅ Implemented | [formatting.md](./formatting.md) |
| Method-chain continuation (`.method(…)`) lines indent one level deeper than the chain start | ✅ Implemented | [formatting.md](./formatting.md) |
| `blankLineBeforeReturn` skips blank between a comment and its following return | ✅ Implemented | [formatting.md](./formatting.md) |
| Standalone formatter CLI (`kopytko-format --check`, `--write`) | ✅ Implemented | [kopytko-formatter README](../packages/kopytko-formatter/README.md) |
| CLI ignore patterns (`--ignore`, config `ignore` array) | ✅ Implemented | [formatting.md](./formatting.md#cli--ci-usage) |
| Granular identifier casing with exact-casing overrides | ✅ Implemented | [language-server.md](./language-server.md) |
| `Function` after `as` uses type casing, not keyword casing | ✅ Implemented | [language-server.md](./language-server.md) |
| `@import` / `@mock` sorting and `emptyLineAfterImports` | ✅ Implemented | [formatting.md](./formatting.md) |
| `catchParenStyle` — normalise `catch e` ↔ `catch (e)` | ✅ Implemented | [formatting.md](./formatting.md) |
| `aaCommaSpacing` — control spaces around commas in inline `{}` associative arrays | ✅ Implemented | [formatting.md](./formatting.md) |

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
| Test framework completions (`expect()` matchers, `mockFunction()` methods, globals) | ✅ Implemented | [language-server.md](./language-server.md) |
| Test framework hover docs | ✅ Implemented | [language-server.md](./language-server.md) |
| Test case symbols in Outline (`it()`, `test()`, `itEach()`) | ✅ Implemented | [language-server.md](./language-server.md) |
| Test diagnostics — missing `return ts`, missing `@mock` for `mockFunction` calls | ✅ Implemented | [language-server.md](./language-server.md) |

## Roku Device Management

| Feature | Status | Doc |
|---|---|---|
| SSDP device discovery with Roku Devices tree view | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Active device selection (persisted per workspace, auto-fills launch config) | ✅ Implemented | [roku-debug.md](./roku-debug.md) |

## Debugging

| Feature | Status | Doc |
|---|---|---|
| Deploy via kopytko-packager with source breakpoints | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Variable inspection (Local/Global), call stack, stepping | ✅ Implemented | [roku-debug.md](./roku-debug.md) |
| Hover-to-evaluate, compilation errors, runtime errors, program output | ✅ Implemented | [roku-debug.md](./roku-debug.md) |

## Planned / Future

### Architecture & Performance

| Feature | Notes |
|---|---|
| Workspace file index for all providers | Extend `WorkspaceFunctionIndex` to cache file contents and share across all providers, eliminating redundant `readFileSync` calls. |

### Roku Device & Debugging

| Feature | Notes |
|---|---|
| ECP remote control | Send key presses to the active Roku from the command palette or a webview panel. |
| Channel screenshot | Capture a screenshot via ECP and open in VS Code. |
| Roku log streaming panel | Always-on output channel streaming Roku syslog, independent of debug sessions. |

### Debugger — socket-based protocol migration

The current debugger uses the older Roku telnet interface (port 8085). Migrating to the [socket-based debug protocol](https://developer.roku.com/dev/docs/socket-based-debugger) unlocks:

| Feature | Notes |
|---|---|
| Socket-based transport | Binary-framed protocol with versioned handshake. Foundation for all items below. |
| Compile errors as inline diagnostics | Structured `{file, line, message}` events → VS Code `Diagnostic` squiggles. |
| Breakpoint verification | Rejected breakpoints shown as unverified grey circles. |
| Typed variable values | `Integer`, `roArray[12]`, expandable `roAssociativeArray` in Variables panel. |
| Pause (STOP command) | Interrupt running channel without a breakpoint. |
| Multi-thread inspection | Show all SceneGraph threads (main, render, Task nodes) in Threads panel. |
| Logpoints | Evaluate expressions on hit without pausing execution. |
| BrightScript REPL | Evaluate arbitrary expressions via `COMMAND_EXECUTE` in debug console. |

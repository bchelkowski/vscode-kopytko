# vscode-kopytko — Feature Overview

Canonical list of extension and package features. Each row links to its topic doc. **A feature is not "done" until it appears here.** Status legend: ✅ Implemented · 🟡 Partial · ⬜ Planned.

> Package layout: the BrightScript engine ships as three npm packages — `kopytko-brightscript-parser` (`packages/brightscript-parser/`), `kopytko-formatter` (`packages/formatter/`), and `kopytko-linter` (`packages/linter/`). The extension's LSP server is a thin adapter over them.

---

## Language Support

| Feature | Status | Doc |
|---|---|---|
| Syntax highlighting (keywords, types, strings, numbers, operators) | ✅ | [brightscript-support.md](./brightscript-support.md) |
| Distinct scopes for function calls, `m`, and `as <type>` annotations (incl. `Function`) | ✅ | [brightscript-support.md](./brightscript-support.md) |
| `@import` / `@mock` annotation highlighting (distinct colours) | ✅ | [brightscript-support.md](./brightscript-support.md) |
| Semantic tokens — parser-driven highlighting separating params, locals, calls, and `m`-fields | ✅ | [language-server.md](./language-server.md) |
| Language configuration (brackets, comments, indent rules) | ✅ | [brightscript-support.md](./brightscript-support.md) |
| Code snippets — general BrightScript + test framework | ✅ | [brightscript-support.md](./brightscript-support.md) |

## Completions

| Feature | Status | Doc |
|---|---|---|
| Built-in functions and keywords | ✅ | [language-server.md](./language-server.md) |
| User-defined functions in scope (`@import` chain, XML siblings, `extends` chain) | ✅ | [language-server.md](./language-server.md) |
| `source/` directory functions (globally accessible, no `@import` required) | ✅ | [language-server.md](./language-server.md) |
| Local variables (params, assignments, for-loop vars) | ✅ | [language-server.md](./language-server.md) |
| `as <type>` annotations (primitives + `ro*` components) | ✅ | [language-server.md](./language-server.md) |
| `CreateObject("…")` component names (inside string only) | ✅ | [brightscript-components.md](./brightscript-components.md) |
| Member completion via type inference (`CreateObject` / typed-param / numeric literal) | ✅ | [brightscript-components.md](./brightscript-components.md) |
| Dot-access member completion (`obj.`, `Constructor().`) | ✅ | [language-server.md](./language-server.md) |
| `m.top.` members (own XML interface, parent components, SG node catalog) | ✅ | [language-server.md](./language-server.md) |
| `@import` / `@mock` snippets with path auto-complete | ✅ | [language-server.md](./language-server.md) |
| Kopytko module exports with auto-insert `@import` | ✅ | [language-server.md](./language-server.md) |

> Inserted identifiers respect the configured casing — see [Formatting & Casing](#formatting--casing).

## Hover & Navigation

| Feature | Status | Doc |
|---|---|---|
| Hover docs — builtins, components, component methods | ✅ | [language-server.md](./language-server.md) |
| Hover docs — user functions (signature + source file) | ✅ | [language-server.md](./language-server.md) |
| Hover docs — Kopytko module exports | ✅ | [language-server.md](./language-server.md) |
| Hover type info — numeric literals and variables assigned from them | ✅ | [language-server.md](./language-server.md) |
| Component catalog with firmware `since`, deprecation, Roku docs links | ✅ | [brightscript-components.md](./brightscript-components.md) |
| Go-to-definition — `@import`/`@mock` paths and user functions | ✅ | [language-server.md](./language-server.md) |
| Go-to-definition — `source/` directory functions (workspace-wide, no `@import` required) | ✅ | [language-server.md](./language-server.md) |
| Signature help | ✅ | [language-server.md](./language-server.md) |
| Find All References — workspace-wide | ✅ | [language-server.md](./language-server.md) |
| Outline / Document symbols — functions, subs, AA methods | ✅ | [language-server.md](./language-server.md) |
| Workspace symbol search (`Ctrl+T`) | ✅ | [language-server.md](./language-server.md) |
| Document links — `@import` / `@mock` as clickable paths | ✅ | [kopytko-imports.md](./kopytko-imports.md) |

## Diagnostics

Backed by the standalone linter's 31 rules (shared by the editor and CI). Full rule reference: [kopytko-linter README](../packages/linter/README.md).

| Group | Rules | Status | Doc |
|---|---|---|---|
| Imports | unresolved · duplicate · unused · missing-path · path-not-absolute · build-generated · missing-promise-deps | ✅ | [kopytko-imports.md](./kopytko-imports.md) |
| Identifiers | undefined-function · undefined-variable · shadows-builtin · shadows-function · unused-parameter · unused-variable · wrong-arg-count · **unused-function** (off by default) · **loop-variable-leak** · **duplicate-function** | ✅ | [language-server.md](./language-server.md) |
| Syntax | trailing-comma · flow-outside-loop · **unreachable-code** | ✅ | [language-server.md](./language-server.md) |
| Type annotations | missing-return-type · missing-param-type | ✅ | [language-server.md](./language-server.md) |
| `throw` | invalid-value · missing-message | ✅ | [language-server.md](./language-server.md) |
| `CreateObject` | unknown-component | ✅ | [language-server.md](./language-server.md) |
| Callbacks | undefined-observer-callback · undefined-event-callback | ✅ | [language-server.md](./language-server.md) |
| Test structure | missing-return-ts · missing-mock-annotation | ✅ | [language-server.md](./language-server.md) |
| m.top fields | **undefined-field** (extension mode only — warns on `m.top.<field>` not in XML interface or ancestor chain) | ✅ | [language-server.md](./language-server.md) |
| Inline suppression | `' kopytko-disable-next-line <rule>` and `' kopytko-disable-line <rule>` comments; glob patterns supported; omit rule to suppress all | ✅ | — |

**Scope-resolution details that keep diagnostics accurate:**

| Detail | Status |
|---|---|
| Per-function scope isolation (no closures — inner anonymous functions can't see outer locals) | ✅ |
| `main.brs` and Roku entry-point functions exempt from undefined-function | ✅ |
| `catch e` / `catch (e)` variable recognised inside the catch block | ✅ |
| `#if` / `#const` conditional-compilation lines skipped | ✅ |
| SceneGraph `extends` inheritance included in scope | ✅ |
| XML sibling and pattern-sibling scope included | ✅ |
| `source/` directory functions treated as globally accessible (no false `undefined-function` errors) | ✅ |
| Component lookup by `<component name>` attribute (handles dotted filenames) | ✅ |

## Refactoring & Formatting

| Feature | Status | Doc |
|---|---|---|
| Rename symbol (workspace-wide) | ✅ | [language-server.md](./language-server.md) |
| Code actions — quick fixes for imports, unused params, unused vars | ✅ | [language-server.md](./language-server.md) |

### Formatting & Casing

Multi-pass engine (27 CST passes + text passes, 60+ configurable rules), shared by the editor and the `kopytko-format` CLI. Full settings: [formatting.md](./formatting.md).

| Feature | Status |
|---|---|
| Document formatting — `kopytko.format.*` rules | ✅ |
| Granular identifier casing with exact-casing overrides (`Function` after `as` uses type casing) | ✅ |
| Conditional-compilation indentation (`#if`/`#else if`/`#else`/`#end if`, `#const`) | ✅ |
| `++` / `--` preserved; comment lines never affect indent depth | ✅ |
| Method-chain continuation indented one level deeper | ✅ |
| `emptyLineBeforeReturn` skips the blank between a comment and its return | ✅ |
| `@import` / `@mock` sorting and `emptyLineAfterImports` | ✅ |
| Catch parentheses always stripped (`catch (e)` → `catch e`) | ✅ |
| `associativeArrayCommaSpacing` — spaces around commas in inline `{}` | ✅ |
| Standalone CLI (`kopytko-format --check` / `--write`) with ignore patterns | ✅ |

## Standalone Linter (CI)

| Feature | Status | Doc |
|---|---|---|
| `kopytko-linter` package — all 31 rules, shared with the editor | ✅ | [kopytko-linter README](../packages/linter/README.md) |
| `kopytko-lint --check` CLI for CI pipelines | ✅ | [kopytko-linter README](../packages/linter/README.md) |
| Per-rule severity via `kopytko-linter.json` or `.vscode/settings.json` | ✅ | [kopytko-linter README](../packages/linter/README.md) |
| Output formats: text, JSON, SARIF (GitHub Code Scanning) | ✅ | [kopytko-linter README](../packages/linter/README.md) |
| Library API: `lintProject()` / `lintFile()` | ✅ | [kopytko-linter README](../packages/linter/README.md) |

## Kopytko Import Resolution

| Feature | Status | Doc |
|---|---|---|
| `@import` / `@mock` parsing & resolution (internal, external, transitive) | ✅ | [kopytko-imports.md](./kopytko-imports.md) |
| `kopytkoModuleDir` and `sourceDir` support | ✅ | [kopytko-imports.md](./kopytko-imports.md) |
| Configurable `generatedPaths` globs and `generatedModules` declarations | ✅ | [kopytko-imports.md](./kopytko-imports.md) |
| Sibling file scope (`kopytko.imports.siblingPatterns`) | ✅ | [kopytko-imports.md](./kopytko-imports.md) |
| Dynamic Kopytko module catalog (runtime package scan) | ✅ | [language-server.md](./language-server.md) |
| `.kopytkorc` JSON schema validation | ✅ | [kopytko-imports.md](./kopytko-imports.md) |

## Kopytko Unit Testing Framework

| Feature | Status | Doc |
|---|---|---|
| Test file detection & scope (tested file, extends, XML siblings, split suites, nested `_tests/`) | ✅ | [language-server.md](./language-server.md) |
| `@mock` support (links, completions, highlighting, sorting) | ✅ | [kopytko-imports.md](./kopytko-imports.md) |
| `@mock` auto-import of `_mocks/*.mock.brs` and `_mocks/*.config.brs` | ✅ | [kopytko-imports.md](./kopytko-imports.md) |
| Framework completions (`expect()` matchers, `mockFunction()` methods, globals) + hover docs | ✅ | [language-server.md](./language-server.md) |
| Test cases in Outline (`it()`, `test()`, `itEach()`) | ✅ | [language-server.md](./language-server.md) |
| Test diagnostics — missing `return ts`, missing `@mock` for `mockFunction` calls | ✅ | [language-server.md](./language-server.md) |

## Roku Device Management

| Feature | Status | Doc |
|---|---|---|
| SSDP discovery (active M-SEARCH + passive NOTIFY) | ✅ | [device-discovery.md](./device-discovery.md) |
| Auto-rescan on network change and sleep/wake | ✅ | [device-discovery.md](./device-discovery.md) |
| Device health checks via ECP | ✅ | [device-discovery.md](./device-discovery.md) |
| Sidebar tree view with device info | ✅ | [device-discovery.md](./device-discovery.md) |
| Favorite/saved devices (persisted) and manual entry by IP | ✅ | [device-discovery.md](./device-discovery.md) |
| Secure password storage (OS keychain via SecretStorage) | ✅ | [device-discovery.md](./device-discovery.md) |
| Active device for debug/deploy + per-device `.kopytkorc` environment | ✅ | [device-discovery.md](./device-discovery.md) |
| Package upload from sidebar (`Ctrl+Shift+F5`) and start-debug per device | ✅ | [device-discovery.md](./device-discovery.md) |
| Context-menu actions (copy IP, open web portal, set password) | ✅ | [device-discovery.md](./device-discovery.md) |
| Registry viewer (read device registry via ECP) | ✅ | [device-discovery.md](./device-discovery.md) |

## Debugging

| Feature | Status | Doc |
|---|---|---|
| Build & deploy via kopytko-packager with `remotedebug=1` manifest injection | ✅ | [roku-debug.md](./roku-debug.md) |
| Socket debug protocol (port 8081, protocol 3.3.0) | ✅ | [roku-debug.md](./roku-debug.md) |
| Breakpoints — dynamic, conditional, hit-count, verified, exception (caught/uncaught) | ✅ | [roku-debug.md](./roku-debug.md) |
| Variable inspection — typed, expandable containers, virtual variables | ✅ | [roku-debug.md](./roku-debug.md) |
| Multi-thread inspection (SceneGraph threads) + per-thread call stack | ✅ | [roku-debug.md](./roku-debug.md) |
| Stepping (over/into/out), pause (STOP) | ✅ | [roku-debug.md](./roku-debug.md) |
| Debug console REPL (EXECUTE) and hover-to-evaluate | ✅ | [roku-debug.md](./roku-debug.md) |
| Compile errors as diagnostics; program output via IO channel | ✅ | [roku-debug.md](./roku-debug.md) |

## Performance & Caching

| Feature | Notes |
|---|---|
| Per-document LRU cache | `utils/documentCache.ts` caches lines, CST, type map, imports, and functions per `{uri, version, length}`. Providers read through it. |
| Cross-document file parse cache | `utils/fileParseCache.ts` parses each `.brs`/`.xml` once and shares it; the edited document always parses its live buffer. |
| Workspace function index | `utils/workspaceFunctionIndex.ts` — built at startup, updated incrementally; O(1) function name lookups for diagnostics, Find References, Rename. |
| Workspace call index | `utils/workspaceCallIndex.ts` — built at startup, updated incrementally; provides workspace-wide union of all called function names (used by `identifier/unused-function`). No per-keystroke computation. |
| Component-XML resolution cache | `findComponentXml` memoizes `componentName → XML path` (incl. negatives). |
| Import-path directory cache | Each directory listed once per session via `readCachedDir`. |
| Granular cache invalidation | A watched-file change evicts only the changed files; package re-walk only on `package.json`/`node_modules` changes. |

---

## Planned / Nice-to-have

Ideas grouped by readiness. The parser already ships four analysis modules that are **not yet wired to any editor feature** — `buildCallGraph`, `analyzeContext` (`m`-field tracking), `inferTypesFromAst`, and `getSymbolInfo` — so several high-value items below are mostly UI/plumbing work over an engine that already exists.

### A. Buildable now on existing parser tools

| Feature | What it does | Engine it uses |
|---|---|---|
| **Call Hierarchy** | VS Code "Show Call Hierarchy" — incoming/outgoing calls for any function. | `buildCallGraph` (already records callers, callees, arg counts) |
| **Unreachable-code diagnostic** | Flag statements after `return`/`stop`/`throw`/`goto` in a block. | CST/AST walk |
| **`m`-field diagnostics** | Warn on reads of an `m.field` never assigned (typo catch), and inconsistent `m.field` types. | `analyzeContext` (already tracks field assignments + inferred types) |
| **Inlay hints** | Inline parameter-name hints at call sites and inferred-type hints on `=` assignments. | `inferTypesFromAst` + call graph |
| **Document highlight** | Highlight every occurrence of the symbol under the cursor (scope-aware, skips strings). | `buildScopes` / `resolve` |
| **Folding ranges** | Fold functions, `if`/`for`/`while` blocks, and `@import` blocks from the CST (vs today's indentation heuristic). | CST node ranges |
| **Selection range** | Smart expand/shrink selection along AST boundaries. | CST node ranges |
| **More quick-fixes** | "Create missing function" stub from an undefined-function call; "Add `@import`" for a function found in another module; "Add type annotation" inferring the type. | scope + import resolver + `inferTypesFromAst` |

### B. Higher-value, larger build

| Feature | What it does | Notes |
|---|---|---|
| **Test Explorer integration** | Discover Kopytko `it()`/`test()`/`itEach()` cases in VS Code's Testing panel; run on the active device; show pass/fail inline. | Reuses existing test-scope detection; needs a device test runner bridge. |
| **CodeLens** | Reference counts and a "Run test" lens above test cases; "N callers" above functions. | Reference counts come from the workspace index; call counts from the call graph. |
| **Rename file → update `@import`s** | Auto-rewrite affected `@import`/`@mock` paths when a `.brs`/`.xml` is moved or renamed. | Import resolver already maps both directions. |
| **Type hierarchy** | Navigate SceneGraph `extends` chains (super/sub components). | XML `extends` parsing already exists. |
| **Workspace audit command** | One-shot report of unused exports, unresolved imports, and dead functions across the project. | Call graph + import resolver + workspace index. |

### C. Roku device & debugging roadmap

| Feature | Notes |
|---|---|
| Device info webview panel | Detailed device info in a dedicated panel. |
| Remote control | Send key presses to the active Roku from a panel / command palette. |
| Channel screenshot | Capture via ECP and open in VS Code. |
| Roku log streaming panel | Always-on syslog channel, independent of debug sessions. |
| Debugger enhancements | Source maps, profiling, SceneGraph inspector, logpoints — see [roku-debug.md — Future possibilities](./roku-debug.md#future-possibilities). |

# vscode-kopytko — Feature Overview

Canonical list of extension and package features. Each row links to its topic doc. **A feature is not "done" until it appears here.** Status legend: ✅ Implemented · 🟡 Partial · ⬜ Planned.

> Package layout: the BrightScript engine ships as three npm packages — `kopytko-brightscript-parser` (`packages/brightscript-parser/`), `kopytko-formatter` (`packages/formatter/`), and `kopytko-linter` (`packages/linter/`) — and all Roku device communication (SSDP discovery, ECP, SceneGraph debug console, BrightScript remote debug protocol, diagnostics collectors, Perfetto streaming) lives in a fourth package, `kopytko-roku-device` (`packages/roku-device/`), which is deliberately Kopytko-ecosystem-unaware so Kopytko packages can depend on it. The extension's LSP server is a thin adapter over the language packages, and its device features are thin VS Code glue over `kopytko-roku-device` plus the Kopytko CLI deployer (`src/client/roku/rokuDeployer.ts`).

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
| Folding ranges — CST-driven folds for functions, `if`/`for`/`while`/`try` blocks, and `@import` groups | ✅ | [language-server.md](./language-server.md) |
| Selection range — smart expand/shrink selection along AST boundaries (`Shift+Alt+→` / `Shift+Alt+←`) | ✅ | [language-server.md](./language-server.md) |
| Call hierarchy — incoming and outgoing calls for any function (`Shift+Alt+H` / right-click → "Show Call Hierarchy") | ✅ | [language-server.md](./language-server.md) |

## Diagnostics

Backed by the standalone linter's 31 rules (shared by the editor and CI). Full rule reference: [kopytko-linter README](../packages/linter/README.md).

| Group | Rules | Status | Doc |
|---|---|---|---|
| Imports | unresolved · duplicate · unused · missing-path · path-not-absolute · wrong-comment-style · build-generated · missing-promise-deps | ✅ | [kopytko-imports.md](./kopytko-imports.md) |
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
| ECP `exit-app`, `tv-channels`/`tv-active-channel` (Roku TV), `sgnodes` roots/by-id scope, `graphics-frame-rate`, `r2d2-bitmaps` | ✅ | [packages/roku-device/README.md](../packages/roku-device/README.md#ecp-method-reference) |
| `kopytko-roku` terminal CLI — ECP + web-admin operations from the shell, independent of VS Code | ✅ | [roku-device-cli.md](./roku-device-cli.md) |

## Web-Admin Automation (Installer / Utilities / Packager / Update)

`kopytko-roku-device`'s `InstallerClient` drives the Roku developer web-admin page
(`http://<device-ip>/`, HTTP Digest auth) the same way a developer would in a
browser. Surfaced in the extension through the Device Manager's Device actions
section (inside the Remote Control view). See [roku-webadmin.md](./roku-webadmin.md).

| Feature | Status | Doc |
|---|---|---|
| Delete installed dev channel | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| Install/replace dev channel from a local zip | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| Rekey device from a signed `.pkg` + signing password | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| Validate keyed developer ID against a target key (via ECP device-info) | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| Screenshot capture + download | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| Profiling data download | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| Package (sign) a channel into a `.pkg` | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| OS update check | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| Reboot | ✅ | [roku-webadmin.md](./roku-webadmin.md) |
| VS Code UI surface for the above (Device Manager → Remote Control → Device actions) | ✅ | [device-manager.md](./device-manager.md) |

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

## Runtime Diagnostics & Profiling

A recording tool that captures live runtime telemetry from a running channel into replayable per-session files. Built only on data verified against real devices (SceneGraph debug server on TCP 8080 + ECP rendezvous). See [diagnostics.md](./diagnostics.md).

| Feature | Status | Doc |
|---|---|---|
| Resilient debug-console transport (TCP 8080) — serialized commands, idle framing, auto-reconnect | ✅ | [diagnostics.md](./diagnostics.md) |
| Per-channel CPU + memory collection (`chanperf`) | ✅ | [diagnostics.md](./diagnostics.md) |
| SceneGraph node counts by type incl. custom components (`sgnodes counts`) | ✅ | [diagnostics.md](./diagnostics.md) |
| BrightScript object counts by type/subtype (ECP `/query/app-object-counts`) — stacked chart + table, hidden by default | ✅ | [diagnostics.md](./diagnostics.md) |
| Rendezvous collection via ECP | ✅ | [diagnostics.md](./diagnostics.md) |
| Device memory (`free`) + GPU texture memory (`r2d2_bitmaps`) — opt-in collectors | ✅ | [diagnostics.md](./diagnostics.md) |
| Open event model + NDJSON-per-stream session storage (crash/network-safe) | ✅ | [diagnostics.md](./diagnostics.md) |
| Session manifest + reader (replay, torn-line tolerant) | ✅ | [diagnostics.md](./diagnostics.md) |
| Start/Stop session commands | ✅ | [diagnostics.md](./diagnostics.md) |
| Bottom-panel webview with live D3 charts — memory/CPU/nodes/objects/textures, rendezvous + beacon overlays, app-state shading | ✅ | [diagnostics.md](./diagnostics.md) |
| In-panel node / object / rendezvous / texture lists (click-to-open-file on the node & rendezvous rows) | ✅ | [diagnostics.md](./diagnostics.md) |
| Record any channel sharing the sideloaded dev key, not just "dev" | ✅ | [diagnostics.md](./diagnostics.md) |
| Tools sidebar — quick-nav buttons, top to bottom: Device Manager, Diagnostics, Network Inspector, Deep Linking, Node Tree, Perfetto, Roku Pay Web Services | ✅ | [diagnostics.md](./diagnostics.md) |
| Past-session replay/preview (read-only) | ✅ | [diagnostics.md](./diagnostics.md) |
| Mutual-exclusion lock (Diagnostics ↔ Perfetto panels — only one holds the device at a time) | ✅ | [diagnostics.md](./diagnostics.md) |

## Kopytko Perfetto (App Tracing)

Live Roku app tracing panel that embeds the official `ui.perfetto.dev` viewer directly in VS Code. Requires Roku firmware 15.2+. Deploy, stream, view, and save — without leaving the editor. See [diagnostics.md](./diagnostics.md).

| Feature | Status | Doc |
|---|---|---|
| Deploy app with `run_as_process=1` manifest injection + restore | ✅ | [diagnostics.md](./diagnostics.md) |
| ECP Perfetto enable (`POST /perfetto/enable/dev`) | ✅ | [diagnostics.md](./diagnostics.md) |
| WebSocket trace stream (`ws://device:8060/perfetto-session`) — native Perfetto binary format | ✅ | [diagnostics.md](./diagnostics.md) |
| Live `ui.perfetto.dev` iframe with rolling buffer refresh (3 s default) + scroll to live edge | ✅ | [diagnostics.md](./diagnostics.md) |
| Heap snapshot trigger (`POST /perfetto/heapgraph/trigger/dev`) | ✅ | [diagnostics.md](./diagnostics.md) |
| Per-session binary `.perfetto-trace` storage (append-write, crash-safe) | ✅ | [diagnostics.md](./diagnostics.md) |
| Past-session replay (load `.perfetto-trace` → send to Perfetto iframe) | ✅ | [diagnostics.md](./diagnostics.md) |
| Start / Stop / Restart / New-session session controls | ✅ | [diagnostics.md](./diagnostics.md) |

## Deep Linking

Editor-tab tool for exercising Roku deep links against the active device. See [deep-linking.md](./deep-linking.md).

| Feature | Status | Doc |
|---|---|---|
| Channel picker — all installed channels with icons (ECP `/query/apps` + `/query/icon`) | ✅ | [deep-linking.md](./deep-linking.md) |
| contentId + free-form key-value parameters, `mediaType` value suggestions | ✅ | [deep-linking.md](./deep-linking.md) |
| Send via Launch (`POST /launch/{appId}`) or Input (`POST /input`, roInput to running channel) | ✅ | [deep-linking.md](./deep-linking.md) |
| Named parameter sets — save / use / edit / delete, persisted per workspace | ✅ | [deep-linking.md](./deep-linking.md) |
| Custom labels on saved sets — Filter (multi-select, default all) and Sort-by-label dropdowns | ✅ | [deep-linking.md](./deep-linking.md) |
| Tools-sidebar button + `Kopytko: Open Deep Linking` command | ✅ | [deep-linking.md](./deep-linking.md) |

## Device Manager

Activity-bar container (drag it to the right-hand Secondary Side Bar) joining a
Roku remote control with everything else `kopytko-roku-device` can do. See
[device-manager.md](./device-manager.md).

| Feature | Status | Doc |
|---|---|---|
| Remote Control view — physical-remote button layout (ECP `/keypress`) | ✅ | [device-manager.md](./device-manager.md) |
| Press-and-hold → `keydown`/`keyup` after a configurable threshold (default 1 s) | ✅ | [device-manager.md](./device-manager.md) |
| Text input — ordered, sequential `Lit_` keypresses (UTF-8 safe) | ✅ | [device-manager.md](./device-manager.md) |
| Keyboard remote mode — keybindings drive the device from anywhere; typing with the view focused | ✅ | [device-manager.md](./device-manager.md) |
| Saved Text entries — `text` and `credentials` types, per-field Send buttons | ✅ | [device-manager.md](./device-manager.md) |
| Custom labels on Saved Text (type doubles as an implicit label) and Scripts — Filter (multi-select, default all) and Sort-by-label dropdowns | ✅ | [device-manager.md](./device-manager.md) |
| Credential passwords in SecretStorage (OS keychain), never in Memento or the webview | ✅ | [device-manager.md](./device-manager.md) |
| RASP script editor tab — live validation, snippets, format switcher | ✅ | [device-manager.md](./device-manager.md) |
| Remote-to-script recording — remote presses / sent text append steps to the open editor | ✅ | [device-manager.md](./device-manager.md) |
| Full RASP runner — press/text/pause/launch/loop/anchors/wait_for_player_state/validate_streaming | ✅ | [device-manager.md](./device-manager.md) |
| Script library — save/edit/delete/run/cancel + import/export `.rasp` (Roku Remote Tool compatible) | ✅ | [device-manager.md](./device-manager.md) |
| Device actions section (collapsed by default, icon-only pill buttons matching the remote keypad) — screenshot/update/reboot + web-admin (install/delete/package/rekey) | ✅ | [device-manager.md](./device-manager.md) |
| `kopytko` custom automation script format (second editor mode) | ⬜ | [device-manager.md](./device-manager.md) |

## Roku Pay Web Services

Editor-tab tool for calling Roku Pay's cloud API (`apipub.roku.com`) — no Roku
device involved. See [roku-pay.md](./roku-pay.md).

| Feature | Status | Doc |
|---|---|---|
| All 6 transaction-service endpoints — validate-transaction, validate-refund, cancel-subscription, refund-subscription, update-bill-cycle, issue-service-credit | ✅ | [roku-pay.md](./roku-pay.md) |
| All 4 subscription-recovery TEST transitions — in-grace, on-hold, passively cancel, recover | ✅ | [roku-pay.md](./roku-pay.md) |
| Named credential profiles — partner API key in SecretStorage (OS keychain), partnerReferenceId prefill | ✅ | [roku-pay.md](./roku-pay.md) |
| Endpoint-driven forms — typed fields (string/number/boolean/date), required markers, live masked URL preview | ✅ | [roku-pay.md](./roku-pay.md) |
| Accept header switch — JSON (pretty-printed) or XML (raw) response rendering | ✅ | [roku-pay.md](./roku-pay.md) |
| Full response viewer — status, headers, body, duration, request body | ✅ | [roku-pay.md](./roku-pay.md) |
| Persistent request/response history — last 200, API key always masked (`****`), per-entry delete + clear all | ✅ | [roku-pay.md](./roku-pay.md) |
| Tools-sidebar button + `Kopytko: Open Roku Pay Web Services` command | ✅ | [roku-pay.md](./roku-pay.md) |

## Network Inspector

Charles-style editor-tab tool: an intercepting proxy the device's traffic is
redirected through, showing HTTP requests/responses grouped by origin/path
with metrics. Uses a protocol-bridging model (device speaks HTTP, proxy
bridges to HTTPS, response bodies rewritten `https://`→`http://`) so **no CA
is installed on the device**. Real transparent redirect works on all three
platforms out of the box — macOS/Linux via `iptables`/`pf`, Windows via an
elevated WinDivert companion process using the driver bundled with the
extension, no setup required (see
[network-inspector.md](./network-inspector.md#windows-transparent-redirect-windivert)).

| Feature | Status | Doc |
|---|---|---|
| Pure-Node intercepting proxy (HTTP in, HTTP/HTTPS out) — no external deps, no CA | ✅ | [network-inspector.md](./network-inspector.md) |
| Master enable/disable toggle — starts proxy + OS redirect; reverts on disable/close/crash | ✅ | [network-inspector.md](./network-inspector.md) |
| Transparent gateway redirect — scoped `iptables` chain (Linux) / pf anchor (macOS) / WinDivert companion (Windows) | ✅ | [network-inspector.md](./network-inspector.md) |
| Body rewrite rules — built-in `https://`→`http://` + user find/replace, live-editable | ✅ | [network-inspector.md](./network-inspector.md) |
| Per-host upstream-scheme bridging (https/http/auto) with content-encoding + header handling | ✅ | [network-inspector.md](./network-inspector.md) |
| Request list grouped by origin → path, detail pane (headers/bodies/metrics), device filter | ✅ | [network-inspector.md](./network-inspector.md) |
| Detail pane: collapsible header/body sections, per-body Raw/Formatted/Tree tabs computed on demand, original-vs-rewritten toggle per body | ✅ | [network-inspector.md](./network-inspector.md) |
| Formatted tab: JSON/XML syntax highlighting; Tree tab: only root expanded by default | ✅ | [network-inspector.md](./network-inspector.md) |
| Per-body Find with match count + prev/next, works across Raw/Formatted/Tree | ✅ | [network-inspector.md](./network-inspector.md) |
| Export capture to HAR — real per-phase timings, `-1` for not-applicable phases | ✅ | [network-inspector.md](./network-inspector.md) |
| Timing waterfall — per-request phase breakdown (blocked/DNS/connect/TLS/send/wait/receive) as a stacked bar + table, keep-alive-aware (`socket reused`) | ✅ | [network-inspector.md](./network-inspector.md) |
| Copy URL / Copy as cURL / Copy body — host-side clipboard, truncation warnings on partial bodies | ✅ | [network-inspector.md](./network-inspector.md) |
| Replay a captured request through the proxy (new flow tagged `replay`; confirmation for state-changing methods) | ✅ | [network-inspector.md](./network-inspector.md) |
| Pause recording without tearing down the proxy/redirect (traffic keeps bridging) | ✅ | [network-inspector.md](./network-inspector.md) |
| Timestamp column + status-class and method filter chips combining with the text filter | ✅ | [network-inspector.md](./network-inspector.md) |
| Incremental, frame-batched request list — live flows append targeted DOM rows instead of rebuilding the list; debounced filter; selection survives tab hide/restore | ✅ | [network-inspector.md](./network-inspector.md) |
| Bounded memory — entry cap (`maxEntries`) plus byte budget (`maxBufferBytes`), enforced host- and webview-side | ✅ | [network-inspector.md](./network-inspector.md) |
| Upstream connection pooling (keep-alive) — no per-request TCP/TLS handshake to origins; device side still closes per request; `upstreamKeepAlive` off-switch | ✅ | [network-inspector.md](./network-inspector.md) |
| Tools-sidebar button + `Kopytko: Open Network Inspector` / `Toggle Network Capture` commands | ✅ | [network-inspector.md](./network-inspector.md) |
| Windows transparent redirect via a bundled WinDivert companion — zero setup on x64, packet-level, any port/protocol, hidden elevated process, self-terminates if the extension host goes silent; `kopytko.network.winDivertDir` (machine-scoped) as an escape hatch | ✅ verified against real hardware | [network-inspector.md](./network-inspector.md#windows-transparent-redirect-windivert) |

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
| **Inlay hints** | Inline parameter-name hints at call sites and inferred-type hints on `=` assignments. | `inferTypesFromAst` + call graph |
| **Document highlight** | Highlight every occurrence of the symbol under the cursor (scope-aware, skips strings). | `buildScopes` / `resolve` |
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
| Device info webview panel | Deliberately dropped from the Device actions section — not needed for a remote-control-first workflow. Still reachable via the [`kopytko-roku` CLI](./roku-device-cli.md) or a raw ECP `device-info` request. |
| Remote control | ~~Implemented~~ — Device Manager Remote Control view + keyboard remote mode ([device-manager.md](./device-manager.md)). |
| Web-admin automation commands | ~~Implemented~~ — Device Manager → Device actions section wires `InstallerClient` (install/delete/package/rekey/screenshot/update/reboot) into the UI ([device-manager.md](./device-manager.md)). Profiling-data download remains package-only. |
| Roku log streaming panel | Always-on syslog channel, independent of debug sessions. |
| Debugger enhancements | Source maps, profiling, SceneGraph inspector, logpoints — see [roku-debug.md — Future possibilities](./roku-debug.md#future-possibilities). |

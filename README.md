<p align="center">
  <img src="images/kopytko-logo.png" alt="Kopytko" width="128" />
</p>

<h1 align="center">Kopytko BrightScript</h1>

<p align="center">
  BrightScript &amp; Kopytko language support for Visual Studio Code — syntax highlighting, IntelliSense, diagnostics, formatting, linting, and a built-in Roku debugger.
</p>

---

## Features

### Language support

- **Syntax highlighting** — full TextMate grammar for `.brs` files including `@import`/`@mock` annotations, `as <type>`, and `m` variable scopes
- **IntelliSense** — completions for 63 `ro*` components, 81 interfaces, 662 methods, 59 built-in functions, keywords, and user-defined functions
- **`CreateObject` type inference** — member completions appear automatically after typing `.` on a variable created via `CreateObject`
- **`m.top` member completion** — auto-completes fields from your XML interface, parent components, and the 88-type SceneGraph node catalog
- **Kopytko module support** — module export completions with auto-insert `@import`, `@import`/`@mock` path completions and snippets
- **Hover, go-to-definition, signature help** — for components, methods, built-ins, user functions, and Kopytko module exports
- **Find All References, Rename, Call Hierarchy** — workspace-wide and safe across files
- **Type Hierarchy** — navigate SceneGraph `extends` chains up and down, from a component's `.xml` or its `.brs`
- **Outline & Workspace Symbols** — functions, subs, AA methods, and test cases via the Outline view or `Ctrl+T`
- **Semantic tokens** — parser-driven highlighting that separates params, locals, calls, and `m`-fields
- **32 diagnostic rules** — undefined functions/variables, wrong argument count, unused imports/parameters, `CreateObject` validation, `@import` resolution, test framework checks, and more
- **Inline suppression** — `' kopytko-disable-next-line <rule>` and `' kopytko-disable-line <rule>` (glob patterns and `rem` style supported; use `disable-next-line` on the preceding line for `@import`/`@mock` annotations)
- **Code actions** — quick fixes for import diagnostics and unused parameters
- **Document formatting** — multi-pass engine with 49 configurable options (indentation, spacing, casing, blank lines, keyword style, and more)
- **Configurable identifier casing** — 10 casing dimensions (builtins, keywords, types, methods, user functions) with per-identifier overrides
- **Kopytko Unit Testing Framework** — test file detection, `@mock` support, `expect()` matcher completions, test case symbols in Outline

### Device & debugging

- **Roku device discovery** — SSDP network scanning with auto-rescan, manual entry, password management, and per-device environment selection
- **BrightScript debugger** — deploy, set breakpoints (conditional, hit-count, exception), inspect variables, step through code, REPL, multi-thread support
- **Web-admin automation** — install, delete, rekey, package, screenshot, download profiling data, check for updates, and reboot, straight from the editor
- **Device Manager** — on-screen remote, keyboard mode, saved text entries, RASP automation scripts, and a device abilities hub

### Runtime tools

- **Kopytko Console** — interactive debug terminal for the Roku consoles (ports 8085 and 8080) with command completion, severity colouring, and filtering
- **Runtime diagnostics** — live CPU, memory, SceneGraph node, object, texture, and rendezvous charts recorded to replayable NDJSON sessions
- **Kopytko Perfetto** — app tracing streamed from the device into an embedded Perfetto UI, plus heap snapshots
- **Network Inspector** — intercepting HTTP proxy with no-CA `https`↔`http` bridging, transparent OS-level redirect, rewrite/block/latency/breakpoint rules, and HAR export
- **SceneGraph Tree** — fetch the live node tree as XML or an icicle chart; Edit mode pushes field changes to the running app via RALE TrackerTask
- **Deep Linking** — launch channels with `contentId` / `roInput` parameters and saved parameter sets
- **Roku Pay Web Services** — call Roku Pay cloud endpoints with saved credential profiles and a request history

See [docs/features.md](docs/features.md) for the full feature list with status and links to detailed documentation.

---

## Standalone Tools

The extension is built on four packages, each published to npm and usable on its own in CI pipelines and build tools:

| Package | Description |
|---|---|
| [**kopytko-brightscript-parser**](packages/brightscript-parser/README.md) | Lossless BrightScript lexer, CST, typed AST, scope/type analysis, and the built-in + component + SceneGraph catalogs |
| [**kopytko-formatter**](packages/formatter/README.md) | BrightScript formatter — `kopytko-format --check` / `--write` for CI, plus a library API |
| [**kopytko-linter**](packages/linter/README.md) | BrightScript linter with 32 rules and inline suppression comments — `kopytko-lint --check` for CI, SARIF output for GitHub Code Scanning |
| [**kopytko-roku-device**](packages/roku-device/README.md) | Roku device communication toolkit — SSDP, ECP, debug console/protocol, web-admin automation, diagnostic collectors, Perfetto, and the `kopytko-roku` CLI |

---

## Extension Settings

<!-- settings:start -->
<!-- Generated from package.json contributes.configuration by scripts/generate-map.mjs — do not edit by hand. -->

All settings use the `kopytko.` prefix in `.vscode/settings.json` or VS Code user settings.

The 50 formatting options (`kopytko.format.*`) are documented in the [kopytko-formatter README](packages/formatter/README.md#vs-code-settings-reference), and lint rule severities in the [kopytko-linter README](packages/linter/README.md#configuration). For every setting in one table, see [docs/reference/commands-and-settings.md](docs/reference/commands-and-settings.md).

### Language Server

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.languageServer.enabled` | `boolean` | `true` | Enable the Kopytko language server. |
| `kopytko.languageServer.trace` | `enum` | `"off"` | Trace LSP communication for debugging. |

### Debugging

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.debug.trace` | `enum` | `"off"` | Trace the Roku debug protocol (port 8081) to the Kopytko output channel. Use when a debug session disconnects or the channel freezes on resume. |

### Import Resolution

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.imports.resolveModules` | `boolean` | `true` | Resolve @import annotations from installed Kopytko NPM modules. |
| `kopytko.imports.sourceDir` | `string` | `"app"` | Root source directory for resolving internal @import paths (matches .kopytkorc sourceDir). |
| `kopytko.imports.generatedPaths` | `array` | `[]` | Glob patterns for `@import` paths that are generated during the build process and do not exist as source files on disk (e.g. by a Kopytko plugin or code-generation tool). Unresolved imports matching these patterns are shown as informational hints instead of warnings, so the developer is aware of the situation without it being flagged as an error. **Supported wildcards:** `*` matches any characters except `/`; `**` matches any characters including `/`. **Examples:** - `/components/generated/**` - `**/auto-generated/*.brs` |
| `kopytko.imports.generatedModules` | `array` | `[]` | Declarations for `@import` paths that are generated during the build process and whose function names should be known to the language server. Each entry has a `path` glob pattern and a `functions` list. When a file imports a path matching `path`, the listed functions are added to the known function scope — so they are not flagged as undefined — and the import itself is shown as an informational hint rather than an unresolved warning. Use this when a plugin or code-generation tool creates `.brs` files that are not present as source files on disk but will exist at build time. **Example:** ```json [ { "path": "/components/generated/PluginApi.brs", "functions": ["PluginInit", "PluginGetData"] } ] ``` |
| `kopytko.imports.siblingPatterns` | `array` | `[]` | Groups of file name patterns whose `.brs` files share import scope for the `import/unused` diagnostic check. Files in the same group are always loaded together by the same XML component, so an `@import` in one file is considered used if any file in the group references one of its exported functions. **Pattern syntax:** each pattern may contain a single `*` wildcard; files with the same wildcard value in the same directory are considered siblings. **Example** — Kopytko component/template pairs: ```json [ ["*.component.brs", "*.template.brs"], ["*.view.brs", "*.template.brs"] ] ``` With this config, if `Foo.component.brs` imports `helperFn` and only `Foo.template.brs` calls it, the import is not flagged as unused. |

### Casing

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.casing.builtin` | `enum` | `"preserve"` | Casing applied to BrightScript built-in function names when a completion is inserted. |
| `kopytko.casing.keyword` | `enum` | `"preserve"` | Casing applied to BrightScript keywords when a completion is inserted. Acts as fallback for type, literal, and operator casing when those are not set. |
| `kopytko.casing.type` | `enum` | `"preserve"` | Casing for BrightScript type names (`boolean`, `integer`, `string`, `void`, …). Falls back to `kopytko.casing.keyword` when not set. |
| `kopytko.casing.literal` | `enum` | `"preserve"` | Casing for literal values (`true`, `false`, `invalid`). Falls back to `kopytko.casing.keyword` when not set. |
| `kopytko.casing.logicOperator` | `enum` | `"preserve"` | Casing for logic operators (`and`, `or`, `not`). Falls back to `kopytko.casing.keyword` when not set. |
| `kopytko.casing.mathOperator` | `enum` | `"preserve"` | Casing for math operators (`mod`). Falls back to `kopytko.casing.keyword` when not set. |
| `kopytko.casing.method` | `enum` | `"preserve"` | Casing applied to component method names when a completion is inserted. |
| `kopytko.casing.userFunction` | `enum` | `"preserve"` | Casing applied to user-defined function/sub names in completions and formatting. |
| `kopytko.casing.userMethod` | `enum` | `"preserve"` | Casing applied to user-defined associative array method names in completions. |
| `kopytko.casing.exact` | `object` | `{}` | Per-identifier casing overrides applied after all other casing rules. Keys are identifier names (case-insensitive), values are the exact output string. **Example:** ```json { "invalid": "Invalid", "getglobalaa": "GetGlobalAA" } ``` |

### Device Discovery

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.deviceDiscovery.enabled` | `boolean` | `true` | Enable automatic Roku device discovery via SSDP. |
| `kopytko.deviceDiscovery.scanTimeout` | `number` | `5000` | Timeout in milliseconds for active SSDP device scans. |
| `kopytko.deviceDiscovery.showNotifications` | `boolean` | `true` | Show notification messages when devices come online or go offline. |

### Device Manager

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.deviceManager.holdThresholdMs` | `number` | `1000` | Remote Control: how long (ms) a button must be held before a press becomes a keydown/keyup hold instead of a single keypress. |
| `kopytko.deviceManager.runner.pollIntervalMs` | `number` | `500` | Script runner: how often (ms) to poll the device for wait_for_player_state / validate_streaming / launch completion. |
| `kopytko.deviceManager.runner.waitTimeoutSec` | `number` | `30` | Script runner: how long (seconds) wait_for_player_state and validate_streaming wait for the expected player state before failing the step. |

### Diagnostics (Runtime Telemetry)

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.diagnostics.outputDir` | `string` | `"debug"` | Folder (relative to the workspace root, or absolute) where diagnostics sessions are saved. Each session gets its own timestamped subfolder. |
| `kopytko.diagnostics.maxLivePoints` | `number` | `3600` | Maximum number of samples kept in memory per stream for the live view. Older points are dropped from the live charts but remain on disk. |
| `kopytko.diagnostics.debugConsolePort` | `number` | `8080` | TCP port of the Roku SceneGraph debug server used for chanperf / sgnodes / texture metrics. |
| `kopytko.diagnostics.collectors.memCpu.enabled` | `boolean` | `true` | Collect per-channel CPU and memory usage (chanperf). |
| `kopytko.diagnostics.collectors.memCpu.intervalMs` | `number` | `1000` | Polling interval in milliseconds for per-channel CPU/memory. |
| `kopytko.diagnostics.collectors.nodeCounts.enabled` | `boolean` | `true` | Collect SceneGraph node counts by type (sgnodes counts). |
| `kopytko.diagnostics.collectors.nodeCounts.intervalMs` | `number` | `2000` | Polling interval in milliseconds for node counts. |
| `kopytko.diagnostics.collectors.objectCounts.enabled` | `boolean` | `true` | Collect BrightScript object counts by type via ECP /query/app-object-counts. Only polled while the Objects chart or table is visible in the panel (both hidden by default). |
| `kopytko.diagnostics.collectors.objectCounts.intervalMs` | `number` | `2000` | Polling interval in milliseconds for object counts. |
| `kopytko.diagnostics.collectors.rendezvous.enabled` | `boolean` | `true` | Collect render-thread rendezvous via ECP. |
| `kopytko.diagnostics.collectors.rendezvous.intervalMs` | `number` | `1000` | Polling interval in milliseconds for rendezvous events. |
| `kopytko.diagnostics.collectors.systemMem.enabled` | `boolean` | `false` | Collect device-wide memory (free). Off by default; per-channel memory is usually more useful. |
| `kopytko.diagnostics.collectors.systemMem.intervalMs` | `number` | `5000` | Polling interval in milliseconds for device-wide memory. |
| `kopytko.diagnostics.collectors.textures.enabled` | `boolean` | `true` | Collect GPU texture/bitmap memory (r2d2_bitmaps). Enabled by default; the Textures chart/table only shows when selected in the Charts/Tables dropdowns. |
| `kopytko.diagnostics.collectors.textures.intervalMs` | `number` | `5000` | Polling interval in milliseconds for texture memory. |
| `kopytko.diagnostics.collectors.appState.enabled` | `boolean` | `true` | Track app foreground/background state via ECP /query/app-state, shown as background shading on the charts. Requires "Control by mobile apps" enabled on the device — degrades to no shading (not an error) when unavailable. |
| `kopytko.diagnostics.collectors.appState.intervalMs` | `number` | `2000` | Polling interval in milliseconds for app state. |
| `kopytko.diagnostics.collectors.fwBeacon.enabled` | `boolean` | `true` | Track framework beacon markers (AppLaunch/AppResume/VODStart Initiate/Complete) via ECP /fwbeacons. Enabled by default, including the Beacons checkbox. |
| `kopytko.diagnostics.collectors.fwBeacon.intervalMs` | `number` | `1000` | Polling interval in milliseconds for framework beacon events. |
| `kopytko.diagnostics.defaultVisibleCharts` | `array` | `["memory","cpu","nodes"]` | Charts shown by default when the diagnostics panel opens. The corresponding data is only collected while at least one visible chart or table needs it. |
| `kopytko.diagnostics.defaultVisibleTables` | `array` | `["nodes","rendezvous"]` | Tables shown by default when the diagnostics panel opens. |
| `kopytko.diagnostics.memoryLimits.backgroundMB` | `number` | `100` | Reference line on the Memory chart for Roku's published background-app DRAM guidance. Not device-reported (unlike the foreground limit, which comes from chanperf) — Roku publishes this as a fixed recommendation that may change between OS versions, hence configurable here. |

### Perfetto (App Tracing)

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.perfetto.ecpPort` | `number` | `8060` | ECP port used for Perfetto tracing control and the WebSocket connection. |
| `kopytko.perfetto.refreshIntervalMs` | `number` | `3000` | How often (in milliseconds) the live buffer is pushed to the Perfetto UI iframe. |
| `kopytko.perfetto.startCommand` | `string` | `""` | Build and deploy command for Perfetto sessions. Defaults to `npx kopytko start` when empty. |

### Kopytko Console

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.console.defaultPort` | `enum` | `8085` | Debug console port the Kopytko Console selects when it opens. |
| `kopytko.console.autoConnect` | `boolean` | `false` | Connect to the active device automatically when the Kopytko Console panel opens. |
| `kopytko.console.maxLines` | `number` | `20000` | Maximum number of output lines kept per console port. Older lines are dropped from the buffer. |
| `kopytko.console.reconnect` | `boolean` | `true` | Reconnect automatically (with backoff) when the console connection drops. |
| `kopytko.console.colorize` | `boolean` | `true` | Colour console output by severity — errors, warnings, beacons, rendezvous logs, and debugger frames. |
| `kopytko.console.logToFile` | `boolean` | `false` | Append every console line to a log file as it arrives, in addition to the in-memory buffer. |
| `kopytko.console.outputDir` | `string` | `"debug"` | Folder (relative to the workspace root, or absolute) where console logs and saved output are written. |
| `kopytko.console.historySize` | `number` | `200` | Number of submitted commands remembered per console port for history recall. |

### Network Inspector

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.network.proxyPort` | `number` | `8888` | Local port the Network Inspector capture proxy listens on. Device traffic is redirected here. |
| `kopytko.network.redirectPorts` | `array` | `[80]` | Device-side ports whose traffic is transparently redirected into the capture proxy (HTTP only). |
| `kopytko.network.maxEntries` | `number` | `5000` | Maximum number of captured requests kept in memory before the oldest are dropped. |
| `kopytko.network.maxBufferBytes` | `number` | `52428800` | Approximate memory budget in bytes for the captured-flow buffer (retained bodies + header overhead). Oldest requests are evicted when exceeded. 0 disables the byte cap; kopytko.network.maxEntries still applies. |
| `kopytko.network.upstreamKeepAlive` | `boolean` | `true` | Reuse upstream connections (HTTP keep-alive) between the capture proxy and origin servers, avoiding a fresh TCP/TLS handshake per request. The device-side connection is always closed per request. Disable if an origin misbehaves with connection reuse. |
| `kopytko.network.filterToActiveDevice` | `boolean` | `true` | Only show traffic originating from the active Roku device's IP (hides the dev machine's own traffic). |
| `kopytko.network.maxBodyBytes` | `number` | `262144` | Maximum bytes of each request/response body retained in memory for inline display and HAR export. The full body is always forwarded to the device, and is persisted uncapped to the capture session folder (see kopytko.network.outputDir) for the “Open full body in editor” action. |
| `kopytko.network.outputDir` | `string` | `"debug"` | Folder (relative to the workspace root, or absolute) where Network Inspector capture sessions are saved — flow metadata plus full request/response bodies. Each capture session gets its own timestamped subfolder. |
| `kopytko.network.defaultUpstreamScheme` | `enum` | `"https"` | Scheme the proxy uses to reach an origin when the device called it over HTTP. `https` bridges the plaintext device call to a secure upstream connection. |
| `kopytko.network.winDivertDir` | `string` | `""` | Windows only, and usually unnecessary — this extension bundles a working WinDivert driver for 64-bit Windows. Only set this to override it with a different WinDivert build/version, or on a non-x64 architecture the bundled driver doesn't cover. A local driver path is inherently per-machine, so this can only be set in User Settings, never in a workspace/team settings.json. |
| `kopytko.network.rewriteRules` | `array` | `[]` | Body rewrite rules applied to text request/response bodies. Each item: { enabled, direction: 'response'\|'request', hostPattern?, pathPattern?, contentTypePattern?, find, replace, isRegex? }. When empty, the built-in `https://` → `http://` and `wss://` → `ws://` response rules are used. |
| `kopytko.network.rewriteExcludeRules` | `array` | `[]` | Opt specific host+path combinations out of ALL body rewriting (every enabled rewrite rule, both directions) — for a response that must reach the device byte-for-byte even though a broad rule like the built-in https→http one would otherwise match it. Each item: { enabled?, hostPattern?, pathPattern? }. |
| `kopytko.network.upstreamSchemes` | `array` | `[]` | Per-host upstream scheme overrides. Each item: { hostPattern, scheme: 'https'\|'http'\|'auto' }. |
| `kopytko.network.mapLocalRules` | `array` | `[]` | Serve a local file or inline body instead of contacting the upstream when host/path match. Each item: { enabled?, hostPattern, pathPattern?, filePath?, body?, contentType?, status? }. filePath wins over body; a rule with neither is ignored. |
| `kopytko.network.latencyRules` | `array` | `[]` | Delay matched responses by delayMs before sending them to the device — simulate slow backends. Each item: { enabled?, hostPattern, pathPattern?, delayMs }. |
| `kopytko.network.headerRules` | `array` | `[]` | Add/set/remove request or response headers for matched hosts. Each item: { enabled?, direction: 'request'\|'response', hostPattern?, op: 'set'\|'add'\|'remove', name, value? }. Proxy-managed headers (content-length, transfer-encoding, connection, host) cannot be changed. |
| `kopytko.network.blockRules` | `array` | `[]` | Abort matched requests before they reach the upstream — the device sees a connection reset, for testing the channel's network-error handling. Each item: { enabled?, hostPattern, pathPattern? }. |
| `kopytko.network.breakpointRules` | `array` | `[]` | Pause matched requests and/or responses so you can edit them live before continuing. Each item: { enabled?, hostPattern, pathPattern?, onRequest?, onResponse? }. |
| `kopytko.network.breakpointTimeoutMs` | `number` | `30000` | How long a breakpoint pause waits for you to act before auto-continuing the request/response unmodified, so a forgotten breakpoint can't hang the device. |

### Linting

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.lint.readOnlyPaths` | `array` | `[]` | Glob patterns for files that the linter should skip. When set, overrides `kopytko.readOnlyPaths` for linting. When empty, falls back to `kopytko.readOnlyPaths`. |

### General

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.readOnlyPaths` | `array` | `[]` | Glob patterns for files that the extension should treat as read-only. Acts as a shared fallback — applies to both formatting and linting unless overridden by `kopytko.format.readOnlyPaths` or `kopytko.lint.readOnlyPaths`. **Supported wildcards:** `*` matches any characters except `/`; `**` matches any characters including `/`. **Examples:** ```json [ "**/node_modules/**", "**/generated/**", "**/vendor/*.brs" ] ``` |

<!-- settings:end -->

---

## Roku Device Discovery

The **Roku Devices** panel in the **Kopytko** sidebar automatically discovers Roku devices on your local network using SSDP. Devices are listed with their model, serial number, and firmware version.

- **Auto-scan** — rescans on network changes and wake from sleep
- **Manual entry** — add a device by IP if not discovered automatically
- **Secure passwords** — stored in your OS keychain via VS Code's SecretStorage
- **Active device** — right-click → **Set as Active Device** to set the default deploy target
- **Environment selection** — choose a `.kopytkorc` environment per device
- **Context menu** — copy IP, open web portal, set password, view registry, upload package

---

## Debugging on a Roku Device

### Prerequisites

Enable **developer mode** on the Roku: on the remote press Home × 3, Up, Right, Left, Right, Left, Right. Note the device IP and set a developer password.

### `launch.json` Configuration

Create `.vscode/launch.json` (or use **Run → Add Configuration**):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "kopytko",
      "request": "launch",
      "name": "Run on Roku",
      "rootDir": "${workspaceFolder}"
    }
  ]
}
```

> **Tip:** If you have an active device selected in the Roku Devices panel with a stored password and environment, `host`, `password`, and `env` are all filled in automatically. A minimal config only needs `type`, `request`, `name`, and `rootDir`.

| Property | Required | Default | Description |
|---|---|---|---|
| `host` | No | — | IP address of the Roku device. Auto-filled from the active device if omitted. |
| `password` | No | — | Developer password. Auto-filled from the active device's stored credentials if omitted. |
| `rootDir` | No | `${workspaceFolder}` | Project root where `.kopytkorc` lives. |
| `env` | No | — | Kopytko environment to build (matches `.kopytkorc` `environments` key). Auto-filled from the active device's environment selection if omitted. |
| `stopOnEntry` | No | `false` | Pause execution at the first line of `main` on launch. |
| `startCommand` | No | `npx kopytko start` | Command to build and deploy. Must accept env as a positional argument and `ROKU_IP`, `ROKU_DEV_PASSWORD`, `ENV` as environment variables. |

### What Happens When You Press F5

1. Injects `remotedebug=1` into the manifest (enables socket-based debug protocol)
2. Runs `kopytko start` to build and deploy the app to the Roku
3. Restores the original manifest
4. Connects to the debug protocol on TCP port 8081

### Debugging Capabilities

| Capability | How |
|---|---|
| Inspect variables | Variables panel — **Local** scope with typed, expandable containers |
| View call stack | Call Stack panel — multi-thread support (SceneGraph threads) |
| Set breakpoints | Click the gutter — conditional, hit-count, and exception breakpoints supported |
| Step over / into / out | F10 / F11 / Shift+F11 |
| Continue / Pause | F5 / F6 |
| Evaluate expressions | Hover over a variable, or use the Debug Console (REPL) |
| See `print` output | Debug Console — stdout forwarded in real time |
| See compilation errors | Shown as VS Code diagnostics with file and line info |

See [docs/roku-debug.md](docs/roku-debug.md) for full architecture and troubleshooting.

---

## Further Reading

**Start here:** [Feature overview](docs/features.md) · [Commands & settings reference](docs/reference/commands-and-settings.md)

| Language | Device & debugging | Runtime tools |
|---|---|---|
| [Language server](docs/language-server.md) | [Device discovery](docs/device-discovery.md) | [Runtime diagnostics](docs/diagnostics.md) |
| [Formatting rules](docs/formatting.md) | [Debugging on a Roku](docs/roku-debug.md) | [Kopytko Console](docs/roku-console.md) |
| [Component catalog](docs/brightscript-components.md) | [Web-admin automation](docs/roku-webadmin.md) | [Network Inspector](docs/network-inspector.md) |
| [`@import` annotations](docs/kopytko-imports.md) | [Device Manager](docs/device-manager.md) | [Deep linking](docs/deep-linking.md) |
| [Syntax & snippets](docs/brightscript-support.md) | [`kopytko-roku` CLI](docs/roku-device-cli.md) | [Roku Pay Web Services](docs/roku-pay.md) |

Contributing and release process: [CONTRIBUTING.md](CONTRIBUTING.md) · [docs/publishing.md](docs/publishing.md)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, building, testing, and project layout.

---

## Releasing

Five packages, each released via its own **GitHub Actions** workflow (Actions tab → Run workflow → pick `patch`/`minor`/`major`). Every workflow runs tests, bumps the version, updates the changelog, tags the release, publishes, creates a GitHub Release, and — for the four npm packages — auto-bumps the root `package.json` dependency once npm has propagated the new version.

| Workflow | Publishes | Tag |
|---|---|---|
| **Release kopytko-brightscript-parser** | npm (OIDC provenance) | `kopytko-brightscript-parser-v{x.y.z}` |
| **Release kopytko-formatter** | npm (OIDC provenance) | `kopytko-formatter-v{x.y.z}` |
| **Release kopytko-linter** | npm (OIDC provenance) | `kopytko-linter-v{x.y.z}` |
| **Release kopytko-roku-device** | npm (OIDC provenance) | `kopytko-roku-device-v{x.y.z}` |
| **Release vscode-kopytko** | VS Code Marketplace | `v{x.y.z}` |

### Release order

`kopytko-brightscript-parser` has no dependency on the other packages, but `kopytko-formatter` and `kopytko-linter` both depend on it — `kopytko-roku-device` is fully independent (see [Standalone Tools](#standalone-tools)).

1. **If the parser changed**: release `kopytko-brightscript-parser` first
2. Release `kopytko-formatter` / `kopytko-linter` (if changed) — their dependency on the parser auto-bumps once it's published
3. Release `kopytko-roku-device` (if changed) — independent of the above
4. **Last**: release `vscode-kopytko`, once every package it depends on that changed has been published and its root dependency bump has landed on `main`

Skipping a package release before releasing the extension is the most common way to ship a broken build — the extension's own tests run against whatever is currently on npm, not local source, so a source fix with no matching package release doesn't reach users and can fail the extension's own CI.

### Required secrets

| Secret | Purpose |
|---|---|
| `VSCE_PAT` | Azure DevOps PAT with Marketplace (Manage) scope |

npm uses OIDC provenance — no token needed. See [docs/publishing.md](docs/publishing.md) for full setup, the complete publishing order, and manual (non-Actions) release steps.

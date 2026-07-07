<p align="center">
  <img src="images/kopytko-logo.png" alt="Kopytko" width="128" />
</p>

<h1 align="center">Kopytko BrightScript</h1>

<p align="center">
  BrightScript &amp; Kopytko language support for Visual Studio Code — syntax highlighting, IntelliSense, diagnostics, formatting, linting, and a built-in Roku debugger.
</p>

---

## Features

- **Syntax highlighting** — full TextMate grammar for `.brs` files including `@import`/`@mock` annotations, `as <type>`, and `m` variable scopes
- **IntelliSense** — completions for 62+ `ro*` components, 80 interfaces, ~700 methods, built-in functions, keywords, and user-defined functions
- **`CreateObject` type inference** — member completions appear automatically after typing `.` on a variable created via `CreateObject`
- **`m.top` member completion** — auto-completes fields from your XML interface, parent components, and the SceneGraph node catalog
- **Kopytko module support** — module export completions with auto-insert `@import`, `@import`/`@mock` path completions and snippets
- **Hover documentation** — docs for components, methods, built-in functions, user-defined functions, and Kopytko module exports
- **Go-to-definition** — jump to `@import`/`@mock` files and user-defined function sources
- **Signature help** — parameter hints as you type function calls
- **Find All References** — workspace-wide symbol references
- **Rename symbol** — safe rename across the workspace
- **Outline & Workspace Symbols** — navigate functions, subs, AA methods, and test cases via the Outline view or `Ctrl+T`
- **31 diagnostic rules** — undefined functions/variables, wrong argument count, unused imports/parameters, `CreateObject` validation, `@import` resolution, test framework checks, and more
- **Inline suppression** — `' kopytko-disable-next-line <rule>` and `' kopytko-disable-line <rule>` comments to suppress individual diagnostics per-line (glob patterns and `rem` style supported; use `disable-next-line` on the preceding line for `@import`/`@mock` annotations)
- **Code actions** — quick fixes for import diagnostics and unused parameters
- **Document formatting** — multi-pass engine with 60+ configurable rules (indentation, spacing, casing, blank lines, keyword style, and more)
- **Configurable identifier casing** — 10 casing dimensions (builtins, keywords, types, methods, user functions) with per-identifier overrides
- **Kopytko Unit Testing Framework** — test file detection, `@mock` support, `expect()` matcher completions, test case symbols in Outline
- **Roku device discovery** — SSDP-based network scanning with auto-rescan, manual entry, password management, and per-device environment selection
- **BrightScript debugger** — deploy, set breakpoints (conditional, hit-count, exception), inspect variables, step through code, REPL, multi-thread support

See [docs/features.md](docs/features.md) for the full feature list with status and links to detailed documentation.

---

## Standalone Tools

The formatting engine and linter are also available as standalone npm packages for use in CI pipelines and build tools:

| Package | Description |
|---|---|
| [**kopytko-formatter**](packages/formatter/README.md) | BrightScript formatter — `kopytko-format --check` / `--write` for CI, plus a library API |
| [**kopytko-linter**](packages/linter/README.md) | BrightScript linter with 31 rules and inline suppression comments — `kopytko-lint --check` for CI, SARIF output for GitHub Code Scanning |
| [**kopytko-roku-device**](packages/roku-device/README.md) | Roku device communication toolkit — SSDP, ECP, debug console/protocol, diagnostic collectors, Perfetto |

---

## Extension Settings

All settings use the `kopytko.` prefix in `.vscode/settings.json` or VS Code's user settings.

For formatting settings (`kopytko.format.*`) see the [kopytko-formatter README](packages/formatter/README.md#vs-code-settings-reference). For linting settings (`kopytko.lint.*`) see the [kopytko-linter README](packages/linter/README.md#configuration).

### Language Server

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.languageServer.enabled` | `boolean` | `true` | Enable the Kopytko language server |
| `kopytko.languageServer.trace` | `string` | `"off"` | Trace LSP communication for debugging |

### Import Resolution

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.imports.resolveModules` | `boolean` | `true` | Resolve `@import` annotations from installed Kopytko npm modules |
| `kopytko.imports.sourceDir` | `string` | `"app"` | Root source directory for resolving internal `@import` paths (matches `.kopytkorc` `sourceDir`) |
| `kopytko.imports.generatedPaths` | `array` | `[]` | Glob patterns for build-generated `@import` paths (shown as hints instead of warnings) |
| `kopytko.imports.generatedModules` | `array` | `[]` | Declarations for build-generated imports with known function names |
| `kopytko.imports.siblingPatterns` | `array` | `[]` | Groups of file patterns that share import scope for the `import/unused` check |

### Read-only Paths

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.readOnlyPaths` | `array` | `[]` | Glob patterns for read-only files (shared fallback for formatting and linting) |
| `kopytko.format.readOnlyPaths` | `array` | `[]` | Glob patterns for files the formatter should skip (overrides `readOnlyPaths`) |
| `kopytko.lint.readOnlyPaths` | `array` | `[]` | Glob patterns for files the linter should skip (overrides `readOnlyPaths`) |

### Casing

Casing settings control identifier casing in completions and formatting. Values: `preserve`, `upper-case`, `lower-case`, `capitalize`, `pascal-case`, `camel-case`.

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.casing.builtin` | `string` | `"preserve"` | Casing for built-in function names |
| `kopytko.casing.keyword` | `string` | `"preserve"` | Casing for keywords (fallback for sub-categories below) |
| `kopytko.casing.type` | `string` | — | Casing for type names (`boolean`, `integer`, etc.); falls back to `keyword` |
| `kopytko.casing.literal` | `string` | — | Casing for `true`, `false`, `invalid`; falls back to `keyword` |
| `kopytko.casing.logicOperator` | `string` | — | Casing for `and`, `or`, `not`; falls back to `keyword` |
| `kopytko.casing.mathOperator` | `string` | — | Casing for `mod`; falls back to `keyword` |
| `kopytko.casing.method` | `string` | `"preserve"` | Casing for component method names |
| `kopytko.casing.userFunction` | `string` | `"preserve"` | Casing for user-defined function/sub names |
| `kopytko.casing.userMethod` | `string` | `"preserve"` | Casing for user-defined AA method names |
| `kopytko.casing.exact` | `object` | `{}` | Per-identifier casing overrides (e.g. `{ "getglobalaa": "GetGlobalAA" }`) |

### Device Discovery

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.deviceDiscovery.enabled` | `boolean` | `true` | Enable automatic Roku device discovery via SSDP |
| `kopytko.deviceDiscovery.scanTimeout` | `number` | `5000` | Timeout in milliseconds for active SSDP device scans |
| `kopytko.deviceDiscovery.showNotifications` | `boolean` | `true` | Show notifications when devices come online or go offline |

### Device Manager

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.deviceManager.holdThresholdMs` | `number` | `1000` | Remote Control: hold time before a press becomes a keydown/keyup hold |
| `kopytko.deviceManager.runner.pollIntervalMs` | `number` | `500` | Script runner: device poll interval for launch/player-state/validation steps |
| `kopytko.deviceManager.runner.waitTimeoutSec` | `number` | `30` | Script runner: timeout for `wait_for_player_state` and `validate_streaming` |

See [docs/device-manager.md](docs/device-manager.md) for the full Device Manager feature set.

### Diagnostics (Runtime Telemetry)

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.diagnostics.outputDir` | `string` | `"debug"` | Folder where diagnostics sessions are saved, each in its own timestamped subfolder |
| `kopytko.diagnostics.maxLivePoints` | `number` | `3600` | Max in-memory samples per stream for the live view; older points stay on disk |
| `kopytko.diagnostics.debugConsolePort` | `number` | `8080` | TCP port of the Roku debug server used for chanperf/sgnodes/texture metrics |
| `kopytko.diagnostics.collectors.<name>.enabled` | `boolean` | varies | Enable a specific collector (`memCpu`, `nodeCounts`, `objectCounts`, `rendezvous`, `systemMem`, `textures`, `appState`, `fwBeacon`) |
| `kopytko.diagnostics.collectors.<name>.intervalMs` | `number` | varies | Polling interval for that collector |
| `kopytko.diagnostics.defaultVisibleCharts` | `array` | `["memory","cpu","nodes"]` | Which charts are visible by default |
| `kopytko.diagnostics.defaultVisibleTables` | `array` | `["nodes","rendezvous"]` | Which tables are visible by default |
| `kopytko.diagnostics.memoryLimits.backgroundMB` | `number` | `100` | Reference line on the Memory chart for the published background-app DRAM guidance |

See [docs/diagnostics.md](docs/diagnostics.md) for the full settings reference and architecture.

### Perfetto (App Tracing)

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.perfetto.ecpPort` | `number` | `8060` | ECP port used for Perfetto tracing control and the WebSocket connection |
| `kopytko.perfetto.refreshIntervalMs` | `number` | `3000` | How often the live trace buffer pushed to the webview is coalesced and flushed; the on-disk trace file is written per-chunk regardless |
| `kopytko.perfetto.startCommand` | `string` | `""` | Build and deploy command for Perfetto sessions; defaults to `npx kopytko start` when empty |

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

- [Feature overview](docs/features.md)
- [Roku device management and debugging](docs/roku-debug.md)
- [BrightScript component catalog](docs/brightscript-components.md)
- [Kopytko @import annotations](docs/kopytko-imports.md)
- [Language server architecture](docs/language-server.md)
- [Document formatting rules](docs/formatting.md)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, building, testing, and project layout.

---

## Releasing

Both packages are released via **GitHub Actions** workflows (Actions tab → Run workflow → pick `patch`/`minor`/`major`).

### Release kopytko-formatter (npm)

1. Go to **Actions** → **Release kopytko-formatter** → **Run workflow**
2. Select `patch`, `minor`, or `major`
3. The workflow runs tests, bumps the version, updates the changelog, tags `kopytko-formatter-v{x.y.z}`, publishes to npm (OIDC provenance), and creates a GitHub Release

### Release kopytko-linter (npm)

1. Go to **Actions** → **Release kopytko-linter** → **Run workflow**
2. Select `patch`, `minor`, or `major`
3. The workflow runs tests, bumps the version, updates the changelog, tags `kopytko-linter-v{x.y.z}`, publishes to npm (OIDC provenance), and creates a GitHub Release

### Release vscode-kopytko (VS Code Marketplace)

1. Go to **Actions** → **Release vscode-kopytko** → **Run workflow**
2. Select `patch`, `minor`, or `major`
3. The workflow compiles, tests, bumps the version, updates the changelog, tags `v{x.y.z}`, publishes to the Marketplace, and creates a GitHub Release with the `.vsix` attached

### Release order

When the formatter changes affect the extension:

1. Release `kopytko-formatter` first
2. Update the extension's `kopytko-formatter` dependency version
3. Release `vscode-kopytko`

### Required secrets

| Secret | Purpose |
|---|---|
| `VSCE_PAT` | Azure DevOps PAT with Marketplace (Manage) scope |

npm uses OIDC provenance — no token needed. See [docs/publishing.md](docs/publishing.md) for full setup.

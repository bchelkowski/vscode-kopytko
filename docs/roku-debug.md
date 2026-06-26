# Roku Device Management and Debugging

This document covers the two runtime-facing features of vscode-kopytko:

1. **Roku device discovery** — find Roku devices on the local network and select one as the active target
2. **BrightScript debugger** — deploy your project and debug it live on the device

---

## Prerequisites

- **Roku OS 14.1 or later** — the debugger uses the [socket-based debug protocol](https://developer.roku.com/dev/docs/socket-based-debugger) (protocol 3.3.0).
- **Developer mode** must be enabled on the Roku. On the remote, press: Home × 3, Up, Right, Left, Right, Left, Right.
- Note the **IP address** shown on the Roku developer dashboard (Settings → Network → About, or the developer mode screen).
- Set a **developer password** when prompted the first time.

---

## Roku Device Discovery

> Full documentation: **[device-discovery.md](./device-discovery.md)**

The extension automatically discovers Roku devices on your local network using [SSDP](https://en.wikipedia.org/wiki/Simple_Service_Discovery_Protocol) (active M-SEARCH and passive NOTIFY listening). Discovered devices appear in the **Roku Devices** sidebar panel with model name, serial number, and firmware version.

### Automatic scanning

Devices are discovered automatically when the sidebar panel is visible. The extension also rescans when it detects a network change (e.g. switching Wi-Fi networks) or when the machine wakes from sleep. You can trigger a manual rescan with the **↺ Refresh** button in the panel title bar.

### Adding a device manually

If a device is not discovered automatically (e.g. it is on a different subnet), use the **Add Device** command (`kopytko.addDevice`) from the command palette or the panel title bar. Enter the device IP address and the extension will query it via ECP to fetch its info.

### Password management

Device passwords are stored securely in your operating system's keychain via VS Code's `SecretStorage` API — they never appear in settings files. Right-click a device and choose **Set Password** to store the developer password. Passwords are keyed by device serial number, so they persist across IP changes.

### Setting the active device

Right-click any discovered device and choose **Set as Active Device**, or click the plug icon next to it. The active device is remembered per workspace.

When you launch a debug session, the active device's IP and stored password are automatically used if `host` or `password` are not set in `launch.json`.

---

## Debugging

The extension registers a `kopytko` debug type that handles the full deploy-and-debug cycle:

1. Inject `remotedebug=1` into the project's local manifest override (enables the socket-based debug protocol)
2. Run `kopytko start` (or a custom command) which builds and deploys the app to the Roku device
3. Restore the original manifest override
4. Connect to the socket-based debug protocol on TCP port 8081
5. Surface breakpoints, variables, stack frames, threads, and stepping through VS Code's standard debug UI

The build and deploy steps use the **project's own** `@dazn/kopytko-packager` — the extension invokes it via CLI, it does not bundle it.

### Setting up `launch.json`

Add a configuration via **Run → Add Configuration** or create `.vscode/launch.json` manually:

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

> **Tip:** If you have an active device selected in the Roku Devices panel with a stored password and an environment set, `host`, `password`, and `env` are all filled in automatically. A minimal launch config only needs `type`, `request`, `name`, and `rootDir`.

| Property | Required | Description |
|---|---|---|
| `host` | No | IP address of the Roku device. Auto-filled from the active device in the Roku Devices panel if omitted. |
| `password` | No | Developer password. Auto-filled from the active device's stored credentials if omitted. |
| `rootDir` | No | Project root where `.kopytkorc` lives (default: `${workspaceFolder}`) |
| `env` | No | Kopytko environment to build — matches `.kopytkorc` environments key. Auto-filled from the active device's environment selection if omitted. |
| `stopOnEntry` | No | If `true`, pause at the first line of `main` on launch |
| `startCommand` | No | Command to build and deploy (default: `npx kopytko start`). Must accept env as a positional argument and `ROKU_IP`, `ROKU_DEV_PASSWORD`, `ENV` as environment variables. |

### Starting a debug session

Press **F5** or click **Run → Start Debugging**. The Debug Console shows:

```
Running: npx kopytko start
Building package…
Deploying to 192.168.1.100…
Build and deploy successful.
Connecting debugger (port 8081)…
Debugger connected (protocol 3.3.0).
```

### Breakpoints

Set breakpoints in any `.brs` file by clicking in the gutter. Breakpoints are managed dynamically via the socket-based debug protocol — no source code modification is needed. The device stops execution when a breakpoint is hit.

**Conditional breakpoints** — right-click a breakpoint and add a condition (any BrightScript expression). The breakpoint only fires when the condition evaluates to true.

**Hit-count breakpoints** — add a hit condition to skip the first N hits (e.g. `5` means stop on the 5th hit).

**Breakpoint verification** — the device confirms which breakpoints were set successfully. Unverified breakpoints appear as grey circles in the gutter.

### Exception breakpoints

In the **Breakpoints** panel in the Run sidebar, toggle:

- **Uncaught Exceptions** (on by default) — break on unhandled runtime errors
- **Caught Exceptions** — break on caught runtime errors (try/catch)

### Variable inspection

When execution pauses, the **Variables** panel shows:

- **Local** — variables in the current function scope, with full type information
- Container types (`roAssociativeArray`, `roArray`, `roList`) can be expanded to inspect their contents
- SceneGraph nodes (`roSGNode`) can be expanded to browse their fields (custom and built-in), just like associative arrays
- Virtual variables (`$children`, `$parent`, `$count`) are available for SceneGraph nodes and collections

Hover over a variable in the editor to evaluate it inline.

### Debug console (REPL)

Type any BrightScript expression in the **Debug Console** to evaluate it in the current scope. This uses the protocol's `EXECUTE` command for reliable structured results.

### Multi-thread inspection

The **Call Stack** panel shows all SceneGraph threads (main, render, Task nodes). Click any thread to inspect its stack. Step commands target the selected thread.

### Stepping

| Action | Keyboard | What it does |
|---|---|---|
| Continue | F5 | Resume until next breakpoint |
| Pause | F6 | Halt execution immediately (STOP command) |
| Step Over | F10 | Execute the current line, stay in current function |
| Step Into | F11 | Follow a function call into its body |
| Step Out | Shift+F11 | Finish the current function and return to the caller |

### Compilation errors

Compile errors from the device are shown as VS Code diagnostics (red squiggles in the editor) with file and line information. The error also appears in the Debug Console.

### Program output

`print` statements and other console output are received via a dedicated IO channel (separate from the debug protocol) and shown in the **Debug Console**.

---

## Rendezvous Logging

Roku SceneGraph apps synchronize Task threads with the render thread at **rendezvous points** — every time a background task reads or writes a field on a SceneGraph node. Each rendezvous costs time on the render thread; too many or too slow ones cause frame drops and jank.

The **Rendezvous Log** panel (second view in the Kopytko sidebar) lets you monitor these events live, grouped by source location.

> Rendezvous are also one of the streams captured by the broader **Runtime Diagnostics** recorder (per-channel CPU/memory, node counts, textures, …) — see [diagnostics.md](./diagnostics.md). While a diagnostics session records rendezvous, this legacy Rendezvous Log poller is paused so the two don't both drain the device's shared event queue.

### Enabling rendezvous logging

The panel is independent of the debug session — it works whenever the active device is reachable on the network.

1. Set an active device in the **Roku Devices** panel.
2. In the **Rendezvous Log** panel, check the **Rendezvous Logging** checkbox.
3. The extension sends `POST /query/sgrendezvous/track` to the device via ECP, then polls `GET /query/sgrendezvous` every second.

> **Requirements**: Developer mode must be enabled on the device and "Control by mobile apps" must be set to Enabled in Roku settings.

When tracking is enabled while running an app, rendezvous events start appearing grouped by file and line number.

### Reading the panel

```
Rendezvous Log
  [☑] Rendezvous Logging

  Foo.brs:42 (3)              ← file:line, entry count
    15ms  2:30:05 PM          ← duration, timestamp
    8ms   2:30:12 PM
    22ms  2:30:25 PM

  Bar.brs:88 (1)
    5ms   2:30:08 PM
```

- Click any **group header** or **entry** to open the file at the exact line in the editor.
- Use the **Clear** (trash) button in the panel title bar to reset the log while keeping tracking enabled.

### Disabling rendezvous logging

Uncheck the **Rendezvous Logging** checkbox. The extension sends `POST /query/sgrendezvous/untrack` to stop tracking on the device. The log is cleared.

### Per-device state

The enabled/disabled state is saved per device serial number in workspace state. Switching to a different active device resets the panel to unchecked (the device's current tracking state is not queried — see below). When you switch back to the original device, its stored state is restored and tracking resumes automatically if it was enabled.

> If the device's actual tracking state cannot be verified (just activated, just discovered, extension restarted), the panel defaults to **unchecked** to avoid showing stale data. Check the checkbox to start fresh.

### Architecture

| Component | File | Responsibility |
|---|---|---|
| ECP client methods | `src/client/roku/discovery/ecpClient.ts` | `enableRendezvousTracking`, `disableRendezvousTracking`, `queryRendezvousEvents` |
| Rendezvous manager | `src/client/roku/rendezvous/rendezvousManager.ts` | ECP polling, event grouping, device-change handling, persistence |
| Tree items | `src/client/roku/views/rendezvousTreeItems.ts` | Toggle, group, entry, and empty TreeItem subclasses |
| Tree provider | `src/client/roku/views/rendezvousTreeProvider.ts` | TreeDataProvider rendering the panel |
| Activation | `src/client/activation/rendezvous.ts` | Register view, checkbox handler, navigation command |

---

## Architecture

The debugger uses the [Roku socket-based debug protocol](https://developer.roku.com/dev/docs/socket-based-debugger) — a binary-framed TCP protocol on port 8081 (protocol 3.3.0, Roku OS 14.1+).

```
VS Code (DAP)
  │
  ▼
BrightScriptDebugAdapter (inline DAP)
  │
  ├─ ProtocolClient ── TCP port 8081 (binary commands + responses)
  │                         Roku device
  └─ IOClient ── TCP dynamic port (app stdout, negotiated via IO_PORT_OPENED)
                     Roku device
```

### Connection lifecycle

1. **Deploy** — inject `remotedebug=1` into local manifest override, run `kopytko start` to build and deploy
2. **Handshake** — TCP connect to port 8081, exchange magic bytes, read protocol version
3. **Initial stop** — device pauses before the first BrightScript statement
4. **Set breakpoints** — send `ADD_BREAKPOINTS` for all VS Code breakpoints
5. **Continue** — send `CONTINUE` to start the app (unless `stopOnEntry` is true)
6. **IO channel** — device sends `IO_PORT_OPENED` update with a dynamic port number; a second TCP connection is opened for app output

### Component files

| Component | File | Responsibility |
|---|---|---|
| Protocol client | `src/client/debug/protocol/protocolClient.ts` | TCP connection, binary handshake, packet framing, request/response tracking |
| Protocol commands | `src/client/debug/protocol/commands.ts` | High-level command builders and response parsers |
| Binary IO | `src/client/debug/protocol/binaryIO.ts` | Little-endian binary reader/writer |
| Constants | `src/client/debug/protocol/constants.ts` | Protocol enums, magic values, command codes |
| Types | `src/client/debug/protocol/types.ts` | TypeScript interfaces for protocol data |
| IO client | `src/client/debug/protocol/ioClient.ts` | App stdout channel (dynamic port) |
| Debug adapter | `src/client/debug/brightScriptDebugAdapter.ts` | Inline VS Code DAP implementation |
| Factory | `src/client/debug/debugAdapterFactory.ts` | Creates one adapter instance per debug session |
| Deployer | `src/client/roku/rokuDeployer.ts` | Inject debug manifest, run kopytko start, restore manifest |
| Rendezvous manager | `src/client/roku/rendezvous/rendezvousManager.ts` | ECP-based rendezvous tracking, live polling, per-device state |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Connection timed out" | Ensure the device is on the same network. The debugger retries for 60 seconds. Check firewall rules for TCP port 8081. |
| "Handshake timed out" | The device may not support the socket-based debugger. Ensure Roku OS 14.1+. |
| "Install failed" | Check that the developer password is correct. Try re-enabling developer mode. |
| Breakpoints appear grey (unverified) | The file path may not match the `pkg:/` path on the device. Ensure `rootDir` in `launch.json` matches your project root. |
| No program output | The IO channel connects on a dynamic port. Ensure no firewall blocks outgoing TCP connections. |

---

## Future possibilities

These features could be built on top of the socket-based debug protocol and Roku ECP:

| Feature | Description | Complexity |
|---|---|---|
| **Source map support** | Map transpiled BrighterScript `.bs` → `.brs` for breakpoints and stack traces. Load `.map` files from build output. | Medium |
| **Logpoints** | Evaluate expressions on hit without pausing. Implement via `EXECUTE` on conditional breakpoint. | Medium |
| **Data breakpoints** | Break when a variable changes. Not natively supported — would require polling via `VARIABLES` command. | High |
| **Rendezvous tracking** | ~~Implemented~~ — see [Rendezvous Logging](#rendezvous-logging) section above. | — |
| **Channel performance panel** | CPU, memory, rendering stats from ECP `chanperf` in a VS Code webview. | Medium |
| **Profiling (Perfetto)** | Capture performance traces (Roku OS 15.2+). Save as `.perfetto-trace`. | High |
| **SceneGraph Inspector** | Visualize the SceneGraph node tree from a running channel via ECP `/query/sgnodes`. | High |
| **Remote file system** | Browse and download files from `tmp:/` and `cachefs:/` via ECP. | Low |
| **Log streaming panel** | Always-on output channel streaming device syslog, independent of debug sessions. | Low |
| **Component library debugging** | `lib:/<name>/<path>` breakpoints for multi-component-library projects. | High |
| **Deep link debugging** | Sideload, set breakpoints, then trigger a deep link via ECP `launch`. | Medium |
| **Watch expressions** | Persistent watch panel with auto-refresh on stop (via `EXECUTE` command). | Low |
| **RALE integration** | Inject Roku Advanced Layout Editor's `TrackerTask.xml` at deploy time. | Medium |
| **Remote control webview** | Send key presses via ECP `/keypress/` from a VS Code webview. | Low |
| **Inline variable values** | Show variable values inline in the editor (VS Code `InlineValueProvider` API). | Medium |
| **Debug visualizers** | Custom renderers for Roku types (node trees, AA tables). | Medium |

# Roku Device Management and Debugging

This document covers the two runtime-facing features of vscode-kopytko:

1. **Roku device discovery** — find Roku devices on the local network and select one as the active target
2. **BrightScript debugger** — deploy your project and debug it live on the device

---

## Prerequisites

- **Developer mode** must be enabled on the Roku. On the remote, press: Home × 3, Up, Right, Left, Right, Left, Right.
- Note the **IP address** shown on the Roku developer dashboard (Settings → Network → About, or the developer mode screen).
- Set a **developer password** when prompted the first time.

---

## Roku Device Discovery

The **Roku Devices** panel appears in the Explorer sidebar. It scans your local network using [SSDP](https://en.wikipedia.org/wiki/Simple_Service_Discovery_Protocol) and queries each discovered device for its model name, serial number, and firmware version.

### How to scan

Click the **↺ Refresh** button in the panel title bar. VS Code will show a spinner while scanning (default timeout: 5 seconds).

### Setting the active device

Right-click any discovered device and choose **Set as Active Device**, or click the plug icon next to it. The active device is remembered per workspace.

When you launch a debug session, the active device's IP address is automatically filled into the `host` field of your launch configuration if it is not already set.

---

## Debugging

The extension registers a `kopytko` debug type that handles the full deploy-and-debug cycle:

1. Build the project using `@dazn/kopytko-packager` (reads `.kopytkorc`, runs plugins, generates manifest)
2. Optionally inject `stop` statements at breakpoint lines
3. Deploy the zip to the Roku via kopytko-packager's AppDeployer (digest auth)
4. Connect to the BrightScript Micro Debugger on port 8085
5. Surface breakpoints, variables, stack frames, and stepping through VS Code's standard debug UI

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
      "host": "192.168.1.100",
      "password": "rokudev",
      "rootDir": "${workspaceFolder}",
      "env": "dev"
    }
  ]
}
```

| Property | Required | Description |
|---|---|---|
| `host` | Yes | IP address of the Roku device |
| `password` | Yes | Developer password set during developer mode activation |
| `rootDir` | No | Project root where `.kopytkorc` lives (default: `${workspaceFolder}`) |
| `env` | No | Kopytko environment to build — matches `.kopytkorc` environments key (default: `dev`) |
| `stopOnEntry` | No | If `true`, pause at the first line of `main` on launch |

> **Tip:** If you have an active device selected in the Roku Devices panel, `host` is filled in automatically and can be omitted from `launch.json`.

### Starting a debug session

Press **F5** or click **Run → Start Debugging**. The Debug Console shows:

```
Building with kopytko-packager…
Deploying to 192.168.1.100…
Deploy successful.
Connecting to debugger…
Debugger connected.
```

### Breakpoints

Set breakpoints in any `.brs` file by clicking in the gutter. The extension injects a `stop` statement immediately before each breakpoint line when packaging — no modification to your source files on disk.

> **Note:** Because `stop` statements are inserted before breakpoint lines, line numbers in stack traces may be off by the number of active breakpoints above the current position. This is a known limitation of the `stop`-injection approach.

### Variable inspection

When execution pauses at a breakpoint or runtime error, the **Variables** panel shows two scopes:

- **Local** — variables in the current function scope
- **Global** — `m` and other global references

Hover over a variable in the editor to evaluate it via `print` in the running session.

### Call stack

The **Call Stack** panel shows the full BrightScript stack. Click any frame to switch context.

### Stepping

| Action | Keyboard | What it does |
|---|---|---|
| Continue | F5 | Resume until next breakpoint |
| Step Over | F10 | Execute the current line, stay in current function |
| Step Into | F11 | Follow a function call into its body |
| Step Out | Shift+F11 | Finish the current function and return to the caller |

### Compilation errors

If the uploaded channel fails to compile, the error message appears in the **Debug Console** and the session terminates. Fix the error and press F5 to redeploy.

### Program output

`print` statements and other console output are forwarded to the **Debug Console** while the session is active.

---

## Architecture notes

| Component | File | Responsibility |
|---|---|---|
| SSDP scanner | `src/client/roku/deviceDiscovery.ts` | Per-NIC UDP sockets, triple M-SEARCH for reliability, ECP `/query/device-info` |
| Device tree view | `src/client/roku/deviceProvider.ts` | VS Code TreeDataProvider |
| Deployer | `src/client/roku/rokuDeployer.ts` | Build via kopytko-packager pipeline, breakpoint injection, digest-auth deploy via AppDeployer |
| Telnet connection | `src/client/debug/rokuConnection.ts` | TCP socket on port 8085, command/event parsing |
| Debug adapter | `src/client/debug/brightScriptDebugAdapter.ts` | Inline VS Code DAP implementation |
| Factory | `src/client/debug/debugAdapterFactory.ts` | Creates one adapter instance per debug session |

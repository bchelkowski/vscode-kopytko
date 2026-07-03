# Roku Device Discovery

Automatic discovery and management of Roku devices on the local network. Devices appear in a dedicated sidebar panel with rich context menus for common actions.

---

## Overview

The device discovery system finds Roku devices via [SSDP](https://en.wikipedia.org/wiki/Simple_Service_Discovery_Protocol), queries each device for hardware details via the [ECP](https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md) API, and presents them in a VS Code tree view. It handles network changes, sleep/wake cycles, and device health monitoring automatically.

> The device-communication layer (`SsdpClient`, `EcpClient`, `DeviceManager`) lives in the standalone [`kopytko-roku-device`](../packages/roku-device/README.md) package. The extension supplies the VS Code-specific pieces: persistence (`DeviceStore` over `Memento`, `CredentialStore` over `SecretStorage`), the focus-aware `NetworkMonitor`, and the tree view.

---

## Architecture

```
SsdpClient (raw dgram)
  ├── Active scanning: M-SEARCH on 239.255.255.250:1900
  └── Passive listening: NOTIFY ssdp:alive / ssdp:byebye

EcpClient (http)
  └── GET /query/device-info on port 8060

NetworkMonitor
  ├── Interface polling (15s normal, 1s alert)
  └── Sleep/wake detection (timer gap heuristic)

DeviceManager (orchestrator)
  ├── State machine: unknown → pending → online/offline
  ├── Health checks with 5-min cache
  └── View-gated scanning

DeviceStore (globalState)
  ├── Network-scoped device lists
  ├── Cross-network device cache
  ├── Favorites (always visible)
  └── 30-day expiration

CredentialStore (SecretStorage)
  └── Passwords keyed by device ID (ECP device-id / WiFi MAC)
```

### Component files

| Component | File | Responsibility |
|---|---|---|
| SsdpClient | `src/client/roku/ssdp/ssdpClient.ts` | Raw dgram sockets — sends M-SEARCH multicast and listens for NOTIFY messages |
| EcpClient | `src/client/roku/discovery/ecpClient.ts` | HTTP GET to port 8060, parses `/query/device-info` XML |
| NetworkMonitor | `src/client/roku/discovery/networkMonitor.ts` | Polls `os.networkInterfaces()` at 15s intervals (1s during alert), detects sleep/wake via timer gap heuristic |
| DeviceManager | `src/client/roku/discovery/deviceManager.ts` | Orchestrator — wires SSDP, ECP, and network events; manages device state machine and health checks |
| DeviceStore | `src/client/roku/persistence/deviceStore.ts` | Persists device lists to VS Code `globalState`, scoped by network fingerprint |
| CredentialStore | `src/client/roku/persistence/credentialStore.ts` | Wraps VS Code `SecretStorage` — passwords keyed by device ID (ECP `device-id` / WiFi MAC) |
| DeviceTreeProvider | `src/client/roku/views/deviceTreeProvider.ts` | VS Code `TreeDataProvider` — renders the Roku Devices sidebar panel |
| DeviceTreeItems | `src/client/roku/views/deviceTreeItems.ts` | TreeItem subclasses for devices, info rows, and action buttons |
| RegistryProvider | `src/client/roku/views/registryProvider.ts` | Parses ECP registry XML, provides virtual document content for the registry viewer |

---

## Configuration Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `kopytko.deviceDiscovery.enabled` | boolean | `true` | Enable automatic device discovery |
| `kopytko.deviceDiscovery.scanTimeout` | number | `5000` | SSDP scan timeout in milliseconds |
| `kopytko.deviceDiscovery.showNotifications` | boolean | `true` | Show device online/offline notifications |

---

## Commands

| Command | ID | Description |
|---|---|---|
| Refresh Devices | `kopytko.refreshDevices` | Trigger an active SSDP scan and refresh the device list |
| Set as Active Device | `kopytko.selectDevice` | Set a device as the active target for debug/deploy |
| Unset Active Device | `kopytko.unselectDevice` | Clear the active device selection |
| Set Environment | `kopytko.setDeviceEnvironment` | Choose a Kopytko environment for a device |
| Upload to Device | `kopytko.uploadToDevice` | Build and upload the project to a device |
| Add Device | `kopytko.addDevice` | Add a device manually by IP address |
| Add to Favorites | `kopytko.addFavorite` | Mark a device as a favorite (persists across networks) |
| Remove from Favorites | `kopytko.removeFavorite` | Unmark a device as a favorite |
| Set Password | `kopytko.setDevicePassword` | Store the developer password securely for a device |
| Clear Password | `kopytko.clearDevicePassword` | Remove the stored password for a device |
| Copy IP | `kopytko.copyDeviceIp` | Copy the device IP address to the clipboard |
| Open Web Portal | `kopytko.openDevicePortal` | Open the Roku developer web portal (`http://<ip>`) in a browser |
| Read Registry | `kopytko.readRegistry` | Read and display a channel's device registry — shows a picker with all installed channels |
| Remove Device | `kopytko.removeDevice` | Remove a manually-added or stale device from the list |
| Copy to Clipboard | `kopytko.copyToClipboard` | Copy selected text or device info to the clipboard |

---

## Sidebar Tree View

The **Roku Devices** panel appears in the **Kopytko** sidebar (its own activity bar container). Each device entry shows:

- **Device name** — user-defined name set on the Roku device (e.g. "Living Room TV")
- **IP address** — current network address in parentheses, e.g. `(192.168.1.100)`
- **Status icon** — online (green), offline (grey), pending (spinner)
- **Active indicator** — plug icon for the currently selected device
- **Favorite indicator** — star icon for favorited devices

### Device properties (expanded)

Click any device to expand it and see:

| Property | Description |
|---|---|
| **Model Name** | Hardware model name (e.g. "Roku Ultra") |
| **Developer Mode** | Enabled / Disabled — based on the `developer-enabled` ECP field |
| **ECP Mode** | ECP setting mode (`ecp-setting-mode` field) |
| **Developer Keyed ID** | Developer key ID used for sideloading (`keyed-developer-id`) |
| **Roku OS** | Firmware version and build number, e.g. `12.5.0 (4200.45)` |
| **Resolution** | UI resolution (e.g. `1080p`) |
| **Locale** | Device locale (e.g. `en_US`) |
| **Time Zone** | Time zone name and UTC offset, e.g. `United States/Eastern (Offset: -300)` |

### Environment selection

Each device can have a **Kopytko environment** assigned (from the `environments` section of `.kopytkorc`). The environment is shown as a child item under each device:

- **Environment** — displays the selected environment name (e.g. "staging"), or "(not set)" if none
- Click the environment item or right-click → **Set Environment** to open a picker with all environments defined in `.kopytkorc`
- If no environment is explicitly selected, the first environment from `.kopytkorc` is automatically preselected
- Environment selections are persisted per-device in VS Code's global state

The selected environment is used by:
- **Upload to Device** — builds and deploys with the selected environment
- **Debug sessions** — auto-fills the `env` launch config property (see [roku-debug.md](./roku-debug.md))

### Upload to device

The **Upload to Device** button (☁↑ cloud-upload icon) appears as an inline button on each online device, between the active device toggle and the favorite toggle. Clicking it:

1. Reads the device's IP, stored password, and selected environment
2. Runs `kopytko start` to build and deploy the project to the device
3. Shows progress in a notification and logs output to the **Roku Discovery** output channel

This is a **non-debug deploy** — it does not inject `remotedebug=1` into the manifest, so the app runs normally on the device without debug protocol support.

**Requirements:**
- The device must have a **stored password** (right-click → Set Password)
- A workspace with a `.kopytkorc` file must be open

### Context menu actions

Right-click any device to access:

- **Set as Active Device** / **Unset Active Device** — toggle the active device for debug/deploy
- **Upload to Device** — build and deploy the project to this device
- **Add to Favorites** / **Remove from Favorites** — favorite devices persist across networks
- **Set Password** / **Clear Password** — manage stored developer credentials
- **Copy IP Address** — copy to clipboard
- **Open Web Portal** — open the Roku developer dashboard in a browser
- **Read Registry** — view the device registry for any installed channel (shows a channel picker)
- **Remove Device** — remove from the device list

### Scanning behaviour

Scanning is **view-gated**: SSDP scanning only runs while the Roku Devices panel is visible. When the panel is collapsed or hidden, scanning pauses to conserve resources. Scanning resumes automatically when the panel becomes visible again.

---

## Network Scoping

Discovered devices are **isolated per network**. The extension identifies networks by a fingerprint derived from your active network interfaces. When you switch from your home Wi-Fi to an office network, you see a different set of discovered devices.

- **Scoped devices** — devices discovered on each network are stored separately and only shown when connected to that network.
- **Favorites** — favorited devices are visible on **all** networks, regardless of where they were discovered.
- **Cross-network cache** — previously seen devices are retained for up to 30 days, so switching back to a network restores the device list instantly.

---

## Password Management

Device passwords are stored securely via VS Code's `SecretStorage` API, which delegates to the operating system's native keychain (macOS Keychain, Windows Credential Manager, or Linux libsecret).

### How passwords are stored

- Passwords are keyed by **device ID** (the `device-id` ECP field — the device's WiFi MAC address). This means the password persists even if the device's IP changes via DHCP.
- For devices discovered but not yet queried via ECP, passwords fall back to using the serial number as the key.
- Passwords **never** appear in `settings.json`, `launch.json`, or any file on disk.

### Setting a password

1. Right-click a device in the Roku Devices panel → **Set Password**
2. Enter the developer password (set when enabling developer mode on the Roku)
3. The extension validates the password via ECP digest authentication (username is always `rokudev`)

### Password and debug integration

When you launch a debug session with an active device selected:

- If the active device has a stored password, it is used automatically — no need to set `password` in `launch.json`.
- If `password` is explicitly set in `launch.json`, it takes precedence over the stored password.

### Changing or clearing a password

- **Change**: right-click → **Set Password** and enter the new password. The old one is overwritten.
- **Clear**: right-click → **Clear Password** to remove the stored credential entirely.

---

## Troubleshooting

If devices are not appearing or manual add fails, check the **Roku Discovery** output channel (**View → Output** → select **Roku Discovery** from the dropdown). It logs:

- SSDP scan start/end and discovered devices
- Health check results (online/offline per device)
- Socket errors that may indicate firewall or network issues
- Manual add attempts with detailed error reasons

### Common issues

| Problem | Possible cause | Solution |
|---|---|---|
| No devices discovered | Firewall blocking UDP multicast (port 1900) | Allow UDP traffic on port 1900 for the VS Code process |
| No devices discovered | Device on a different subnet or VLAN | Use **Add Device** with the device's IP address |
| Manual add fails with timeout | Device not powered on or not on the network | Verify the device is reachable (try `curl http://<ip>:8060/query/device-info`) |
| Manual add fails with "connection refused" | ECP not enabled on the device | Enable developer mode on the Roku (Home × 3, Up, Right, Left, Right, Left, Right) |
| Devices show as offline | Network changed since last scan | Click **↺ Refresh** or wait for automatic re-scan |

# Roku Developer Web-Admin Automation

Programmatic access to the Roku developer web-admin page (`http://<device-ip>/`) — the
Installer, Utilities, Packager, and Update tabs a developer normally drives by hand in a
browser to install a dev channel, rekey a device, grab a screenshot, package a signed
`.pkg`, or check for/trigger a system update and reboot.

Implemented in [`kopytko-roku-device`](../packages/roku-device/README.md)'s
`InstallerClient`, and surfaced in the extension through the **Device Manager's Device
view** (install/delete/package/rekey/screenshot/update-check/reboot — see
[device-manager.md](./device-manager.md)). Profiling-data download remains
package-layer-only. Passwords come from the shared device credential store (OS
keychain), prompting once when missing.

---

## Overview

Roku exposes an authenticated HTTP admin page on **port 80** (distinct from the
unauthenticated ECP REST API on port 8060 that the rest of `kopytko-roku-device` talks
to). Authentication is HTTP Digest (RFC 7616), username always `rokudev`, password is
whatever the device's developer mode was set up with.

```ts
import { InstallerClient } from 'kopytko-roku-device';

const installer = new InstallerClient();
const password = 'my-dev-password';

await installer.installChannel('192.168.1.20', password, './build/archive.zip');
await installer.takeScreenshot('192.168.1.20', password, './out/screenshot.jpg');
```

`InstallerClient` accepts an optional `EcpClient` instance in its constructor (used by
`validateKey`, which delegates to `EcpClient.queryDeviceInfo` rather than duplicating
device-info logic):

```ts
const installer = new InstallerClient(myEcpClient); // defaults to `new EcpClient()`
```

Every method takes the device `ip`, the developer `password`, and a `port` (default
`80`, `validateKey`'s `ecpPort` defaults to `8060`).

---

## Actions

| Method | Web-admin tab | What it does |
|---|---|---|
| `deleteChannel(ip, password)` | Installer → Delete | Deletes the currently installed dev channel. |
| `installChannel(ip, password, zipPath)` | Installer → Install | Installs (or replaces) the dev channel from a local zip archive. |
| `rekey(ip, password, pkgPath, signingPassword)` | Utilities → Rekey | Rekeys the device using an already-signed `.pkg` and its signing password. |
| `validateKey(ip, targetKeyId)` | — (ECP `/query/device-info`) | Compares the device's current `keyed-developer-id` against a target key, to decide whether a rekey is needed. |
| `takeScreenshot(ip, password, destPath)` | Utilities → Screenshot | Captures the running dev channel and saves the JPEG to `destPath`. |
| `downloadProfilingData(ip, password, destPath)` | Utilities → Profiling Data | Downloads the BrightScript profiler export and saves it to `destPath`. |
| `packageChannel(ip, password, zipPath, appNameVersion, signingPassword, destPkgPath)` | Packager | Installs the zip, packages it into a signed `.pkg` (`app_name` e.g. `"MyApp/1.0"`), and saves the result to `destPkgPath`. |
| `packageInstalledChannel(ip, password, appNameVersion, signingPassword, destPkgPath)` | Packager | Same as `packageChannel` minus the install step — packages whatever channel is already on the device. `/plugin_package` takes no archive field, so re-uploading isn't required. |
| `checkForUpdate(ip, password)` | Update → Check for Update | Triggers a device OS update check. |
| `reboot(ip, password)` | Update → Reboot | Reboots the device. |

All methods throw on failure (network error, timeout, wrong password, or a device-reported
error) — see [Error handling](#error-handling) below. `reboot` is a partial exception: on
the one real device tested, the reboot POST completed normally with HTTP 200 (the device
rebooted within seconds, fast enough that the HTTP response was still delivered) — but
`reboot` also tolerates a connection-reset-shaped network error as a defensive fallback,
in case older/other firmware drops the connection instead.

### Profiling data prerequisite

The BrightScript profiler only produces data if the channel's `manifest` opts in:

```
bsprof_enable=1
bsprof_data_dest=local
```

See [Roku's BrightScript Profiler docs](https://developer.roku.com/dev/docs/brightscript-profiler#manifest-entries)
for the full set of `bsprof_*` manifest keys (sampling ratio, memory profiling,
line-level detail). Without `bsprof_enable=1`, `downloadProfilingData` throws — the
device reports "No profiling data available" instead of a download link.

---

## Error handling

- Any non-2xx HTTP status throws `"<Action> failed: status <code>"` (with the response
  body appended when non-empty).
- **`/plugin_install` (delete/install) returns HTTP 200 for both success and failure** —
  the real result is reported in a `type: "success" | "error" | "info"` message embedded
  as JSON in the response page. `InstallerClient` parses this and throws with the
  device's own error text (e.g. `"Install Failure: Script directory ... does not exist in
  plugin."`) when a message reports `type: "error"`. This was confirmed live — see
  `findings/roku-device-api.md` for the exact response shapes captured.
- A digest-auth retry that still comes back `401` throws
  `"Authentication failed for rokudev at <ip> — check the developer password"`.
- `rekey` throws with the device's own message when the response doesn't report
  `"Success."`; `packageChannel` throws with the device's `"Failed: ..."` reason when
  packaging fails.

---

## Building the zip/pkg archive

Archive entries **must use forward-slash path separators**. On Windows,
`Compress-Archive` and `[System.IO.Compression.ZipFile]::CreateFromDirectory` both
produce backslash-separated entries — a known PowerShell/.NET quirk — which the device's
unzip step cannot interpret as directories, causing a silent-looking (HTTP 200) install
failure (`Install Failure: Script directory "/source" does not exist in plugin.`). Build
the archive by adding entries with an explicit forward-slash relative path instead of
relying on `CreateFromDirectory` — see `findings/roku-device-api.md` for a working
PowerShell snippet.

---

## What's verified vs. best-effort

Confirmed live against a real device (Roku Ultra, 2026-07-04): `deleteChannel`,
`installChannel` (including the success/failure/"identical version" message shapes),
`takeScreenshot`, `downloadProfilingData` (both the "no data" and "data ready" HTML
shapes), `checkForUpdate`, and `reboot` (the device actually restarted — uptime reset,
dev channel survived, confirmed via ECP after the fact).

`rekey` and `packageChannel`'s **failure paths** are also confirmed live — a garbage
`.pkg` + wrong password for `rekey` returned `<font color="red">Invalid file format.:
iostream error</font>` (correctly caught), and a wrong signing password for
`packageChannel` returned `<font color="red">Failed: Invalid Password.</font>` plus a
`params.messages` entry with `type: "error"` (also correctly caught, by two independent
checks). Only their **success** response shape remains unverified — the literal
`"Success."` text for rekey and the `<a href="pkgs/....pkg">` download link for
packaging — since exercising those requires a real signed key/password that wasn't
available during development. See `findings/roku-device-api.md` for the full breakdown,
including a genuinely non-obvious finding: `/plugin_install` and `/plugin_package` report
results via the `params.messages` JSON mechanism, but `/plugin_inspect` (rekey,
screenshot, profiling) does not — it renders errors directly and only duplicates the
text into the legacy `<font color="red">` div, which the page's own HTML confirms is an
intentionally-preserved backward-compat path.

---

## See also

- [`packages/roku-device/README.md`](../packages/roku-device/README.md) — package-level
  quick examples and device-behavior notes.
- [`findings/roku-device-api.md`](../findings/roku-device-api.md) — the "Port 80 —
  Developer Web Admin" section has the full endpoint map, confirmed response shapes, and
  what's still unverified.
- [`docs/device-discovery.md`](./device-discovery.md) — the existing device-discovery and
  password-storage layer this could eventually plug into for a VS Code command surface.

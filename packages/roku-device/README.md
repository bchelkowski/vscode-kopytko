# kopytko-roku-device

Roku device communication toolkit. Everything needed to discover, control, profile,
and debug a Roku device — in one standalone, VS Code-free npm package. Used by the
[vscode-kopytko](https://github.com/bchelkowski/vscode-kopytko) extension for all of
its device features.

The package is deliberately **Kopytko-ecosystem-unaware** — it speaks only Roku
device protocols (no CLI spawning, no `.kopytkorc` knowledge), so Kopytko packages
themselves can depend on it without circularity.

```bash
npm install kopytko-roku-device
```

Also ships a `kopytko-roku` terminal CLI covering ECP + web-admin operations —
see [CLI](#cli) below.

Requires Node.js >= 24. No runtime dependencies beyond `ws` (Perfetto streaming).

## What's inside

| Subsystem | Port | Exports |
|---|---|---|
| Low-level networking | — | `httpGet`, `httpGetBuffer`, `httpPost`, `httpPostMultipartDigest`, `httpGetBufferDigest`, `buildMultipartBody`, `parseDigestChallenge`, `buildDigestAuthHeader`, `computeNetworkId` — the digest-auth/multipart plumbing shared by `EcpClient` and `InstallerClient`; exported for callers writing their own device requests |
| SSDP discovery | UDP 1900 | `SsdpClient` — M-SEARCH scans + NOTIFY monitoring, per-IP debounce |
| ECP (External Control Protocol) | HTTP 8060, 80 | `EcpClient`, `parseRegistryXml`, `enablePerfettoTracing`, `triggerHeapSnapshot` |
| Device discovery orchestration | — | `DeviceManager` + `DeviceStorage` / `NetworkWatcher` injection interfaces |
| SceneGraph debug console | TCP 8080 | `DebugConsoleClient` — idle-framed request/response, auto-reconnect |
| Interactive debug consoles | TCP 8085, 8080 | `ConsoleStream` — raw bidirectional streaming; `CONSOLE_COMMANDS` / `completeCommand` / `isDestructiveCommand` command catalog |
| Diagnostics parsers + collectors | 8060/8080 | `parseChanperf`, `parseSgNodesCounts`, `parseR2d2Bitmaps`, …, `PollingCollector` and 10 concrete collectors |
| BrightScript remote debug protocol | TCP 8081 | `ProtocolClient`, `IOClient`, `DebugCommands`, `BinaryReader`/`BinaryWriter`, protocol constants/types |
| Perfetto trace streaming | WS 8060 | `PerfettoWebSocketClient` — quiet-window framing over `ws://…/perfetto-session` |
| RALE TrackerTask client | TCP dynamic (49152–65535) | `RaleTrackerClient`, `FrameDecoder`/`encodeRequest` — live SceneGraph node editing through an injected RALE TrackerTask |
| Developer web-admin automation | HTTP 80 | `InstallerClient` — install/delete/rekey/package/screenshot/profiling-data/update/reboot |

## Quick examples

### Discover devices

```ts
import { SsdpClient, EcpClient, DeviceManager, DeviceStorage } from 'kopytko-roku-device';

const manager = new DeviceManager(new SsdpClient(), new EcpClient(), myStorage, myNetworkWatcher);
manager.on('devices-changed', () => console.log(manager.getDevices()));
await manager.initialize();
```

`DeviceStorage` (persistence) and `NetworkWatcher` (network-change/wake signals) are
host-provided interfaces — the VS Code extension backs them with `Memento` global
state and a window-focus-aware poller; a CLI could use a JSON file and a no-op watcher.

### Query a device over ECP

```ts
import { EcpClient } from 'kopytko-roku-device';

const ecp = new EcpClient();
const info = await ecp.queryDeviceInfo('192.168.1.20');
const apps = await ecp.queryApps('192.168.1.20');
const perf = await ecp.queryChanperf('192.168.1.20'); // per-channel CPU/memory XML
```

### Deep-link into a channel

```ts
import { EcpClient } from 'kopytko-roku-device';

const ecp = new EcpClient();

// Relaunch the channel with deep-link params (POST /launch/{appId}?…)
await ecp.launchApp('192.168.1.20', '12', { contentId: 'movie-123', mediaType: 'movie' });

// Send params to the channel already running in the foreground as an
// roInput event, without relaunching (POST /input?…)
await ecp.sendInput('192.168.1.20', { contentId: 'movie-123', mediaType: 'movie' });

// Fetch a channel's icon (GET /query/icon/{appId}) — raw bytes + content type
const { data, contentType } = await ecp.queryAppIcon('192.168.1.20', '12');
```

### Edit SceneGraph nodes on a running app (RALE TrackerTask)

Requires Roku's RALE `TrackerTask` to be injected and started in the (dev)
channel. The client activates it with an ECP input, the task opens a TCP
server on the device at the requested port, and commands flow as
`[start]{json}[end]`-framed JSON with uuid-correlated responses:

```ts
import { EcpClient, RaleTrackerClient } from 'kopytko-roku-device';

const rale = new RaleTrackerClient({ host: '192.168.1.20', ecp: new EcpClient() });
const { raleVersion } = await rale.connect();   // ECP activate → TCP connect → init
await rale.hideSelectorView();                  // don't draw the red selector on the TV

// setField writes to the *selected* node — always selectNode first.
// Paths are {child: index} chains rooted at the scene.
const { node } = await rale.selectNode([{ child: 0 }, { child: 2 }]);
console.log(node.item.subtype);                 // e.g. "Label" — verify before writing
await rale.setField('text', 'Hello from RALE'); // JSON-native values; omit the type arg
await rale.setField('visible', true);

rale.close();                                   // task returns to awaiting activation
```

In-band TrackerTask errors (`Invalid Path`, `Invalid Field Type or Value`, …)
reject the command's promise. The task only serves dev-signed channels, and the
init handshake must complete within ~3 s of activation — `connect()` handles
the sequencing and retries on a fresh port.

Keys and values are `encodeURIComponent`-encoded (helper: `buildEcpQueryString`).
Non-2xx responses throw with the device's status and response body — a `403`
usually means ECP is restricted on-device ("Control by mobile apps"), a `404`
that the channel is not installed. `sendInput` always targets the foreground
channel; there is no app id parameter in the ECP `/input` endpoint.

### Simulate the remote control

```ts
import { EcpClient, EcpKeys, textToLitKeys } from 'kopytko-roku-device';

const ecp = new EcpClient();

// Press-and-release a named key (POST /keypress/{key})
await ecp.keypress('192.168.1.20', EcpKeys.Home);

// Hold a key: keydown … keyup (always pair them — the device keeps the key
// held until the matching keyup arrives)
await ecp.keydown('192.168.1.20', EcpKeys.Right);
await ecp.keyup('192.168.1.20', EcpKeys.Right);

// Type on the on-screen keyboard — one strictly sequential keypress per
// Unicode code point, encoded as Lit_ keys ('€' → 'Lit_%E2%82%AC')
await ecp.sendText('192.168.1.20', 'my search term');

// Lower-level: encode text yourself
textToLitKeys('r€'); // → ['Lit_r', 'Lit_%E2%82%AC']
```

`EcpKeys` lists every named key (`Home`, `Select`, D-pad, media keys, and the
Roku-TV-only volume/power/channel/input keys). `isValidEcpKey()` accepts named
keys and `Lit_`-prefixed literals.

### ECP method reference

Every `EcpClient` method, mapped to its endpoint (default port 8060 unless noted):

| Method | Endpoint | Purpose |
|---|---|---|
| `queryDeviceInfo` | `GET /query/device-info` | Device model/serial/software-version/etc. |
| `checkDeviceAlive` | `GET /query/device-info` | Reachability check (swallows errors) |
| `queryApps` | `GET /query/apps` | Installed channel list |
| `queryActiveApp` | `GET /query/active-app` | Foreground channel |
| `queryMediaPlayer` | `GET /query/media-player` | Playback state/position/duration |
| `queryAppIcon` | `GET /query/icon/{appId}` | Channel icon bytes |
| `queryRegistry` | `GET /query/registry/{channelId}` | Channel registry dump (dev mode); optional `RegistryQueryOptions` (`escaped`, `keys`, `sections`) filter the response |
| `queryChanperf` | `GET /query/chanperf` | Per-channel CPU/memory (raw XML) |
| `querySgNodes` | `GET /query/sgnodes/{all\|roots}` | SceneGraph node tree, all nodes or only un-parented roots (raw XML) |
| `querySgNodesById` | `GET /query/sgnodes/nodes?node-id=` | SceneGraph nodes matching one node id (raw XML) |
| `queryAppUi` | `GET /query/app-ui` | Rendered UI node tree of the foreground app (raw XML; throws `app-ui: No active app` when nothing is running) |
| `queryR2d2Bitmaps` | `GET /query/r2d2-bitmaps` | GPU texture/bitmap memory (raw XML, dev mode) |
| `queryGraphicsFrameRate` | `GET /query/graphics-frame-rate` | Recent rendered FPS, Roku OS 12.0+ (raw XML, dev mode) |
| `queryAppObjectCounts` | `GET /query/app-object-counts/{appId}` | BrightScript object counts/memory (raw XML) |
| `queryAppState` | `GET /query/app-state/{appId}` | `'active'\|'background'\|'inactive'\|'unknown'` |
| `queryTvChannels` | `GET /query/tv-channels` | TV tuner channel list — **Roku TV only** |
| `queryTvActiveChannel` | `GET /query/tv-active-channel` | Current TV channel/signal — **Roku TV only** |
| `queryRendezvousEvents` | `GET /query/sgrendezvous` | Drains queued rendezvous events |
| `enableRendezvousTracking` / `disableRendezvousTracking` | `POST /sgrendezvous/track` / `/untrack` | Toggle rendezvous logging |
| `queryFwBeacons` | `GET /query/fwbeacons` | Drains queued framework-beacon events |
| `enableFwBeaconTracking` / `disableFwBeaconTracking` | `POST /fwbeacons/track/{appId}` / `/untrack/{appId}` | Toggle beacon tracking for a channel |
| `launchApp` | `POST /launch/{appId}` | Launch/relaunch with optional deep-link params |
| `sendInput` | `POST /input` | Deep-link params to the foreground channel (no relaunch) |
| `keypress` / `keydown` / `keyup` | `POST /keypress\|keydown\|keyup/{key}` | Remote-control key simulation |
| `sendText` | `POST /keypress/Lit_…` (sequential) | Types a string via `Lit_` keys |
| `exitApp` | `POST /exit-app/{appId}[/true]` | Suspend/terminate a running channel |
| `validatePassword` | Digest auth on port 80 | Validates the developer password |
| `enablePerfettoTracing` (free fn) | `POST /perfetto/enable/{channelId}` | Starts Perfetto tracing, Roku OS 15.2+ |
| `triggerHeapSnapshot` (free fn) | `POST /perfetto/heapgraph/trigger/{channelId}` | Captures a heap snapshot |

**Deliberately not implemented** — confirmed absent from or removed from the
[official ECP docs](https://developer.roku.com/dev/docs/external-control-api):
`/search/*` (removed Roku OS 12.0+), `/query/screensaver`, `/query/textedit-state`,
`/query/audio-device` (not documented anywhere on the current official page), and
ECP-2 WebSocket session/subscription endpoints. See `findings/roku-device-api.md`
in the extension repo for the full rationale.

```ts
await ecp.exitApp('192.168.1.20', 'dev');            // suspend (or terminate if unsupported)
await ecp.exitApp('192.168.1.20', 'dev', true);       // force-terminate, bypassing Instant Resume

const roots = await ecp.querySgNodes('192.168.1.20', 8060, 'roots'); // un-parented nodes only
const byId = await ecp.querySgNodesById('192.168.1.20', '42');

const textures = await ecp.queryR2d2Bitmaps('192.168.1.20');    // GPU texture memory, raw XML
const fps = await ecp.queryGraphicsFrameRate('192.168.1.20');   // raw XML, Roku OS 12.0+

// Roku TV models only
const channels = await ecp.queryTvChannels('192.168.1.20');
const tuned = await ecp.queryTvActiveChannel('192.168.1.20');
```

### Query playback state

```ts
// Foreground channel (GET /query/active-app)
const active = await ecp.queryActiveApp('192.168.1.20'); // { id, name, … } | undefined

// Media player state (GET /query/media-player): state ('none'|'play'|'pause'|…),
// owning channel, stream format (codecs/DRM), position/duration
const player = await ecp.queryMediaPlayer('192.168.1.20');
if (player.state === 'play') console.log(player.format?.video, player.positionMs);
```

### Drive an interactive debug console

`ConsoleStream` is the terminal-facing counterpart to `DebugConsoleClient`. It frames nothing and strips
nothing — every byte the device sends is forwarded, prompts and unsolicited output included — which is what
a human-facing console needs and a parser does not. Neither port echoes input, so callers own local echo.

```ts
import { ConsoleStream, completeCommand, isDestructiveCommand } from 'kopytko-roku-device';

const stream = new ConsoleStream({ host: '192.168.1.20', port: 8085 });
stream.on('connect', () => stream.write('bt\r\n'));  // caller supplies the terminator
stream.on('data', (chunk: string) => process.stdout.write(chunk));
stream.on('close', () => console.log('disconnected; reconnecting with backoff'));
stream.start();

completeCommand(8080, 'sgnodes ');   // → all | roots | counts
isDestructiveCommand(8080, 'genkey'); // → true — confirm before sending
```

### Poll runtime metrics

```ts
import { DebugConsoleClient, ChanperfCollector } from 'kopytko-roku-device';

const console8080 = new DebugConsoleClient({ host: '192.168.1.20' });
const collector = new ChanperfCollector(console8080, 1000);
collector.on('sample', (s) => console.log(s)); // { type: 'mem-cpu', memKiB, cpuPct, … }
collector.start();
```

Collectors never throw into callers — a failed poll skips that interval and the
collector self-heals when the device answers again. All 10 concrete collectors:

| Collector | Data source | Metric |
|---|---|---|
| `ChanperfCollector` | port 8080 console | Per-channel CPU/memory |
| `EcpChanperfCollector` | ECP `/query/chanperf` | Per-channel CPU/memory (no telnet console needed) |
| `NodeCountsCollector` | port 8080 console | SceneGraph node counts |
| `EcpNodeCountsCollector` | ECP `/query/sgnodes/all` | SceneGraph node counts |
| `EcpObjectCountsCollector` | ECP `/query/app-object-counts` | BrightScript object counts/memory |
| `TextureCollector` | port 8080 console | GPU texture/bitmap memory |
| `SystemMemCollector` | port 8080 console | System-wide free memory |
| `RendezvousCollector` | ECP `/query/sgrendezvous` | Render-thread rendezvous events |
| `FwBeaconCollector` | ECP `/query/fwbeacons` | App/media lifecycle beacon events |
| `AppStateCollector` | ECP `/query/app-state` | Foreground/background/inactive polling |

### Drive the BrightScript debugger

```ts
import { ProtocolClient, DebugCommands } from 'kopytko-roku-device';

const client = new ProtocolClient('192.168.1.20'); // port 8081
await client.connect();
const commands = new DebugCommands(client);
const threads = await commands.threads();
```

### Web-admin automation (port 80)

```ts
import { InstallerClient } from 'kopytko-roku-device';

const installer = new InstallerClient();
const password = 'my-dev-password'; // username is always 'rokudev'

await installer.installChannel('192.168.1.20', password, './build/archive.zip');
await installer.packageChannel(
  '192.168.1.20', password, './build/archive.zip',
  'MyApp/1.0', 'my-signing-password', './out/signed.pkg',
);

// Package whatever is already on the device, without re-uploading a zip
await installer.packageInstalledChannel(
  '192.168.1.20', password, 'MyApp/1.0', 'my-signing-password', './out/signed.pkg',
);

await installer.takeScreenshot('192.168.1.20', password, './out/screenshot.jpg');
await installer.checkForUpdate('192.168.1.20', password);

// Confirm the device is keyed for the target app before packaging
const { matches } = await installer.validateKey('192.168.1.20', 'abcd1234efgh');

// Pull a profiling data dump down to disk
await installer.downloadProfilingData('192.168.1.20', password, './out/profiling-data.zip');
```

Drives the same Installer/Utilities/Packager/Update tabs a developer would use in a
browser at `http://<device-ip>/`. Digest-auth handshake reuses the same
`parseDigestChallenge`/`buildDigestAuthHeader` helpers as `EcpClient.validatePassword`.

## CLI

`kopytko-roku` is a zero-dependency terminal client for everything `EcpClient` and
`InstallerClient` can do — useful for scripting, CI smoke tests, or quick manual
checks without opening the extension.

```bash
npm install -g kopytko-roku-device
kopytko-roku --help

# or without installing globally
npx kopytko-roku-device ecp device-info --host 192.168.1.20
```

```
kopytko-roku discover [--timeout <ms>] [--json]
kopytko-roku ecp <op> --host <ip> [--port <n>] [--json] [op flags...]
kopytko-roku installer <op> --host <ip> --password <pw> [op flags...]
```

Every `ecp` op maps 1:1 to an `EcpClient` method (`device-info`, `apps`,
`active-app`, `media-player`, `icon`, `launch`, `input`, `keypress`/`keydown`/`keyup`,
`text`, `exit-app`, `tv-channels`, `tv-active-channel`, `registry`, `chanperf`,
`sgnodes`, `app-ui`, `app-object-counts`, `app-state`, `rendezvous-track`/`-untrack`/`-query`,
`fwbeacons-track`/`-untrack`/`-query`, `graphics-frame-rate`, `r2d2-bitmaps`,
`perfetto-enable`, `perfetto-trigger-heap-snapshot`); every `installer` op maps to
`InstallerClient` (`screenshot`, `install`, `delete`, `rekey`, `package`,
`package-installed`, `update`, `reboot`). Run `kopytko-roku --help` for the full flag
reference, or see `docs/roku-device-cli.md` in the extension repo.

```bash
kopytko-roku ecp keypress --host 192.168.1.20 --key Home
kopytko-roku ecp launch --host 192.168.1.20 --app dev --param contentId=42
kopytko-roku installer screenshot --host 192.168.1.20 --password secret --out shot.jpg
```

**Config resolution** (highest priority first): CLI flags → `--config <path>`
(a JSON file with `{ "host", "password", "port" }`) → `ROKU_HOST`/`ROKU_PASSWORD`
environment variables. The CLI intentionally does **not** read `.vscode/settings.json`
or any `.kopytkorc` — unlike `kopytko-format`/`kopytko-lint`, this package stays
Kopytko-ecosystem- and editor-unaware even at the CLI layer.

**Output**: ops returning a device's raw XML body (`chanperf`, `sgnodes`, `app-ui`,
`r2d2-bitmaps`, `graphics-frame-rate`, `registry`, `tv-channels`, `tv-active-channel`)
always print that XML as-is — `--json` is a deliberate no-op there, since
JSON-escaping an XML document just produces an unreadable quoted blob. Everything else
pretty-prints as JSON. See `docs/roku-device-cli.md` in the extension repo.

## Device behaviour notes

- `GET /query/sgrendezvous` and `GET /query/fwbeacons` **drain** the device-side
  event queue — never run two pollers against the same endpoint.
- chanperf/sgnodes/the port-8080 console report nothing while the channel is
  backgrounded; this is a Roku OS limitation, not an error.
- Port 8080 responses are idle-framed (`>` appears inside XML, so it cannot be a
  terminator).
- The port-80 web admin's digest-auth POSTs (`InstallerClient`) send **no body on
  the first, expected-401 request** — the multipart payload is only attached on the
  authenticated retry, so a large file is never uploaded twice.
- `/plugin_install` returns **HTTP 200 for both success and failure** — the real
  result is a `type: "success" | "error" | "info"` message embedded as JSON in the
  page's inline script, which `InstallerClient` parses and checks. Zip archives must
  use forward-slash path separators (PowerShell's `Compress-Archive` produces
  backslash-separated entries on Windows, which the device rejects as an
  "Install Failure" despite the 200 status). See
  `findings/roku-device-api.md` for the confirmed details, plus which of the 9
  actions are live-verified vs. best-effort (rekey/package/update/reboot were not
  live-tested — see that file).
- `exitApp`, `queryTvChannels`/`queryTvActiveChannel`, `queryGraphicsFrameRate`,
  `queryR2d2Bitmaps`, and `querySgNodes`'s `roots` scope / `querySgNodesById` are all
  live-verified (Roku Ultra 4850X, 2026-07-06). The `tv-*` endpoints were only
  confirmed as an expected 404 on this non-TV hardware — their success response shape
  on an actual Roku TV remains unverified. `exitApp` (non-forced) suspends via Instant
  Resume rather than killing the app, confirmed via `queryAppState` reporting
  `background` afterward. See `findings/roku-device-api.md` for the exact response
  shapes captured, including the surprising discovery that `sgnodes/all`, `/roots`,
  and `/nodes` each wrap results in a **different** tag name
  (`All_Nodes`/`Root_Nodes`/`Nodes_Nodes`) — a naive shared parser will not work
  across all three.

## License

MIT

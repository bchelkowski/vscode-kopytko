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

Requires Node.js >= 24. No runtime dependencies beyond `ws` (Perfetto streaming).

## What's inside

| Subsystem | Port | Exports |
|---|---|---|
| SSDP discovery | UDP 1900 | `SsdpClient` — M-SEARCH scans + NOTIFY monitoring, per-IP debounce |
| ECP (External Control Protocol) | HTTP 8060, 80 | `EcpClient`, `parseRegistryXml`, `enablePerfettoTracing`, `triggerHeapSnapshot` |
| Device discovery orchestration | — | `DeviceManager` + `DeviceStorage` / `NetworkWatcher` injection interfaces |
| SceneGraph debug console | TCP 8080 | `DebugConsoleClient` — idle-framed request/response, auto-reconnect |
| Diagnostics parsers + collectors | 8060/8080 | `parseChanperf`, `parseSgNodesCounts`, `parseR2d2Bitmaps`, …, `PollingCollector` and 10 concrete collectors |
| BrightScript remote debug protocol | TCP 8081 | `ProtocolClient`, `IOClient`, `DebugCommands`, `BinaryReader`/`BinaryWriter`, protocol constants/types |
| Perfetto trace streaming | WS 8060 | `PerfettoWebSocketClient` — quiet-window framing over `ws://…/perfetto-session` |

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

Keys and values are `encodeURIComponent`-encoded (helper: `buildEcpQueryString`).
Non-2xx responses throw with the device's status and response body — a `403`
usually means ECP is restricted on-device ("Control by mobile apps"), a `404`
that the channel is not installed. `sendInput` always targets the foreground
channel; there is no app id parameter in the ECP `/input` endpoint.

### Poll runtime metrics

```ts
import { DebugConsoleClient, ChanperfCollector } from 'kopytko-roku-device';

const console8080 = new DebugConsoleClient('192.168.1.20');
const collector = new ChanperfCollector(console8080, 1000);
collector.on('sample', (s) => console.log(s)); // { type: 'mem-cpu', memKiB, cpuPct, … }
collector.start();
```

Collectors never throw into callers — a failed poll skips that interval and the
collector self-heals when the device answers again.

### Drive the BrightScript debugger

```ts
import { ProtocolClient, DebugCommands } from 'kopytko-roku-device';

const client = new ProtocolClient('192.168.1.20'); // port 8081
await client.connect();
const commands = new DebugCommands(client);
const threads = await commands.threads();
```

## Device behaviour notes

- `GET /query/sgrendezvous` and `GET /query/fwbeacons` **drain** the device-side
  event queue — never run two pollers against the same endpoint.
- chanperf/sgnodes/the port-8080 console report nothing while the channel is
  backgrounded; this is a Roku OS limitation, not an error.
- Port 8080 responses are idle-framed (`>` appears inside XML, so it cannot be a
  terminator).

## License

MIT

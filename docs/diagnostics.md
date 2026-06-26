# Runtime Diagnostics & Profiling

A recording tool that captures live runtime telemetry from a running Roku channel
into replayable, per-session files. It is designed to diagnose hard-to-reproduce
problems — memory growth, CPU spikes, SceneGraph node leaks, and render-thread
rendezvous stalls.

Everything here is built **only on data that Roku devices actually expose**, all
verified against real hardware. Nothing is synthesized.

> **Status:** Phases 1 and 2 are implemented — collection, storage, replay,
> Start/Stop commands, and the bottom-panel webview with live uPlot charts
> (memory, CPU, node counts, rendezvous markers). Lists with click-to-open-file
> navigation and past-session replay UI land in phases 3 and 4. See the status
> table in [features.md](./features.md).

---

## Data sources (verified on-device)

The device exposes diagnostics over two channels:

### SceneGraph debug server — TCP port 8080

A line-oriented request/response console: write `command\r\n`, read a text/XML
reply terminated by a `>` prompt. (Because XML replies contain `>`, the transport
frames a response by idle-detection, not by the prompt.)

| Command | Yields |
|---|---|
| `chanperf` | Per-channel CPU + memory: `mem=<KiB>{anon,file,shared,swap},%cpu=<n>{user,sys}` |
| `sgnodes counts` | XML: total node count + static bytes + per-type `count`/`num-bytes-static` (type names include custom components, e.g. `EventTileModel`) |
| `sgnodes all`/`roots`/`<id>` | Node tree XML (used by later phases for drill-down) |
| `free` | Device-wide memory (Linux `free`, KiB) |
| `r2d2_bitmaps` | GPU texture/bitmap table + `Available texture memory … used … max …` summary |

### ECP — HTTP port 8060

Rendezvous tracking, reusing the existing `EcpClient`:
`POST /sgrendezvous/track` → `GET /query/sgrendezvous` (drains the device queue,
returns `<item>` events with id/start/end/line/file + drop count) →
`POST /sgrendezvous/untrack`.

> **Shared queue caveat:** `GET /query/sgrendezvous` *drains* a single device
> queue. If two pollers run at once they split events. So while a diagnostics
> session records rendezvous, the legacy **Rendezvous Log** poller is suspended
> and restored when the session stops.

---

## Architecture

All code is client-side (`src/client/diagnostics/`) — it needs raw TCP/HTTP to the
device, like the debug adapter. The modules are intentionally free of any `vscode`
import so they can run (and be tested) headless.

```
transport/debugConsoleClient.ts   Resilient TCP client for port 8080
parsers/                          Pure parsers: chanperf, sgNodesCounts, free, r2d2Bitmaps (+ consoleResponse)
collectors/                       Independent, self-healing pollers (one per metric)
session/eventModel.ts             Open event registry + envelope { t, wall, type, … }
session/diagnosticsSession.ts     Orchestrates collectors → timestamp → storage + live ring buffers
storage/                          Injectable sink, NdjsonWriter, sessionStore (manifest), sessionReader
diagnosticsController.ts          Builds the session for the active device from config; suspends legacy rendezvous
activation/diagnostics.ts         Registers the Start/Stop commands
```

### Transport — `DebugConsoleClient`

Keeps one connection open, serializes commands through a queue, frames each
response by an **idle window** (default 250 ms of no data), strips the device
banner + prompts, and **auto-reconnects with exponential backoff**. `send()`
rejects fast when not connected so polling collectors simply skip a sample and
retry — sessions survive flaky networks without breaking.

### Collectors

Each collector is independent and self-healing: a failing poll or a reconnecting
transport emits nothing that tick and retries on the next interval, never
affecting other collectors or the session.

| Collector | Source | Default | Event type |
|---|---|---|---|
| `ChanperfCollector` | `chanperf` (8080) | on, 1000 ms | `mem-cpu` |
| `NodeCountsCollector` | `sgnodes counts` (8080) | on, 2000 ms | `node-counts` |
| `RendezvousCollector` | ECP (8060) | on, 1000 ms | `rendezvous` |
| `SystemMemCollector` | `free` (8080) | off, 5000 ms | `system-mem` |
| `TextureCollector` | `r2d2_bitmaps` (8080) | off, 5000 ms | `textures` |

### Event model (open registry)

Every datum is an event with a common envelope plus a typed payload:

```jsonc
{ "t": 639, "wall": 1782463022594, "type": "mem-cpu", "memKiB": 52492, "cpuPct": 0, … }
```

`t` is milliseconds since session start; `wall` is the epoch timestamp. Adding a
new metric = add a member to the `DiagnosticEvent` union, an entry in
`STREAM_FILE`, and a collector — no migration; storage and (future) charts stay
generic.

---

## Session files

Sessions are written under `kopytko.diagnostics.outputDir` (default `debug/`,
relative to the workspace root). Each session is its own timestamped subfolder:

```
debug/
└── 2026-06-26_10-37-01__DAZN/
    ├── session.json        Manifest: schema, device, app, collectors, per-stream counts
    ├── mem-cpu.ndjson      One JSON event per line
    ├── node-counts.ndjson
    └── rendezvous.ndjson
```

**Why NDJSON (one JSON object per line):** append-only and crash/network-safe — a
torn final line is simply skipped on read; linear to parse; trivially
streamable/tailable; and new streams add no coupling. Writes are buffered in
memory and flushed on a timer, so disk or network hiccups never block collection
or drop events (a failed flush retains its batch and retries).

`SessionReader` lists sessions (newest first) and reads any stream back for
replay, tolerating blank and torn lines.

---

## Commands

| Command | Title |
|---|---|
| `kopytko.diagnostics.startSession` | Kopytko: Start Diagnostics Session |
| `kopytko.diagnostics.stopSession` | Kopytko: Stop Diagnostics Session |

A session records from the **active Roku device** (set in the Roku Devices panel)
into a new folder, and stops/finalizes on the stop command.

---

## Settings

All under `kopytko.diagnostics.*`:

| Setting | Default | Description |
|---|---|---|
| `outputDir` | `debug` | Folder (relative or absolute) for session subfolders |
| `maxLivePoints` | `3600` | Samples kept in memory per stream for the live view |
| `debugConsolePort` | `8080` | SceneGraph debug server port |
| `collectors.memCpu.enabled` / `.intervalMs` | `true` / `1000` | Per-channel CPU+memory |
| `collectors.nodeCounts.enabled` / `.intervalMs` | `true` / `2000` | Node counts by type |
| `collectors.rendezvous.enabled` / `.intervalMs` | `true` / `1000` | Rendezvous via ECP |
| `collectors.systemMem.enabled` / `.intervalMs` | `false` / `5000` | Device-wide memory |
| `collectors.textures.enabled` / `.intervalMs` | `false` / `5000` | GPU texture memory |

---

## Webview panel (Phase 2)

The panel appears in the VS Code bottom bar under **Kopytko Diagnostics**.

### Layout

A toolbar row (device indicator, Start/Stop button, elapsed timer) above three
side-by-side uPlot charts:

| Chart | Series | Source |
|---|---|---|
| **Memory** | Total MB (line), Anon (line), File (line) | `chanperf` |
| **CPU** | Total %, User, Sys | `chanperf` |
| **SceneGraph Nodes** | Total node count (line) + rendezvous markers (vertical lines) | `sgnodes counts` + ECP rendezvous |

All charts resize with the panel. Colors adapt to the VS Code theme via CSS
variables.

### Webview bundle

Built by `npm run bundle:webview` → `out/diagnostics-webview/main.js` (153 KB,
includes uPlot) and `out/diagnostics-webview/main.css` (3.6 KB). The bundle is
excluded from tsc (browser globals) and compiled by esbuild only.

Source: `src/client/diagnostics/webview/` — `protocol.ts` (message types),
`main.ts` (DOM + chart logic), `styles.css`.

### Message protocol

Extension → webview:
- `init` — sent on panel open; seeds charts from ring-buffer data
- `batch` — throttled at 250 ms; live data while recording  
- `state` — recording state changed (device, start/stop)

Webview → extension:
- `start` / `stop` — delegates to controller

## Testing

- **Parsers** are tested against captured real-device fixtures in
  `test/diagnostics/fixtures/`.
- **Transport** is tested with an injected mock socket (connect/framing/timeout/
  reconnect) under fake timers.
- **Collectors, session, storage, and controller** use stubbed transports/ECP and
  an in-memory sink, so tests never touch real disk or the network.

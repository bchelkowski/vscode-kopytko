# Runtime Diagnostics & Profiling

A recording tool that captures live runtime telemetry from a running Roku channel
into replayable, per-session files. It is designed to diagnose hard-to-reproduce
problems — memory growth, CPU spikes, SceneGraph node leaks, and render-thread
rendezvous stalls.

Everything here is built **only on data that Roku devices actually expose**, all
verified against real hardware. Nothing is synthesized.

> **Status:** All four phases are implemented. See the status table in
> [features.md](./features.md).

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
> queue. If two pollers run at once they split events. `RendezvousManager`
> (an internal coordination class, no visible UI of its own — the sidebar
> tree view that used to expose it directly was removed in favor of this
> panel) is suspended before a diagnostics session starts and restored when
> it stops, so nothing else can drain the queue concurrently.

Framework beacon markers also go through ECP, scoped to the recorded app id:
`POST /fwbeacons/track/<appId>` → `GET /query/fwbeacons` (drains the device
queue the same way as rendezvous, returning named beacon elements — e.g.
`<app-launch-complete><timestamp>…</timestamp></app-launch-complete>` — each
with its own absolute epoch-ms timestamp, plus a drop count). This replaced an
earlier approach that tailed the port-8085 BrightScript log for `[beacon.signal]`
lines: that port only accepts one consumer at a time, so beacons silently
stopped appearing whenever a debug session or another tool already held it. See
`findings/roku-device-api.md` for the verified response shape.

BrightScript object counts also come from ECP, scoped to the recorded app id:
`GET /query/app-object-counts/<appId>` returns per-object-type live instance
counts and memory (`<type>`, `<count>`, `<num-bytes-physical>`,
`<num-bytes-logical>`), plus totals. `roSGNode` is broken down further — one
`<object>` entry per SceneGraph component `<subtype>`. Like `chanperf`/`sgnodes`,
the device answers `<status>FAILED</status>` while the channel is backgrounded.

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
| `EcpObjectCountsCollector` | ECP (8060) | on, 2000 ms | `object-counts` |
| `RendezvousCollector` | ECP (8060) | on, 1000 ms | `rendezvous` |
| `SystemMemCollector` | `free` (8080) | off, 5000 ms | `system-mem` |
| `TextureCollector` | `r2d2_bitmaps` (8080) | off, 5000 ms | `textures` |
| `FwBeaconCollector` | ECP (8060) | on, 1000 ms | `fw-beacon` |

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

## Tools sidebar

A small panel in the Kopytko activity-bar sidebar (labeled "Tools", alongside
Roku Devices) with three buttons for quick navigation:

| Button | Opens |
|---|---|
| **Diagnostics** | Reveals this panel (`kopytko.diagnostics.focus`) |
| **Perfetto** | Opens the Perfetto tracing tab (`kopytko.perfetto.open`) |
| **Node Tree** | Opens the SceneGraph Node Tree Explorer (`kopytko.nodes.open`) |

It's a plain navigation aid — no data flows through it, it just executes the
corresponding reveal command. Styled to match this panel's toolbar (same
color/spacing/radius conventions) for visual consistency across the
extension's runtime-inspection tools.

Source: `src/client/nav/` (`views/navViewProvider.ts`, `webview/main.ts`,
`webview/styles.css`), registered via `src/client/activation/nav.ts`.

---

## Recording a different channel

By default, sessions record the sideloaded **dev** channel. The toolbar's
channel dropdown lets you record any *other* installed channel that shares
the same developer key — useful for profiling a "prod tester"/QA build
installed alongside the dev channel, without re-sideloading.

The list is built by cross-referencing ECP `GET /query/registry/dev`'s
`<plugins>` field (every channel id signed with the same developer key as the
sideloaded channel) against `GET /query/apps` for display names. Channels
signed with a different key (any regular store app, or another developer's
sideload) never appear — the device itself rejects the registry lookup for
them with "Specified dev ID does not match the device key". If no dev
channel is sideloaded at all, the dropdown falls back to just "dev".

**Selecting a channel only changes what the *next* session targets and how
its manifest labels it — it does not switch the device to that channel.**
`chanperf`/`sgnodes`/the raw debug console (Memory/CPU/Nodes/Textures) always
report whatever channel is *currently the foreground UI* on the device,
regardless of which one is selected here; only app-state and framework-beacon
tracking target the selected channel specifically (via its app id — ECP
`/query/app-state/<appId>` and `/fwbeacons/track/<appId>` both require one).
So to get real Memory/CPU/Node data for a non-dev channel, you still need to
actually navigate the device to that channel; beacons and app-state, being
per-app ECP calls, work correctly for a backgrounded non-foreground channel too.

Changing the selection while a session is recording **stops that session
immediately** — a running session always reflects the channel it was
started for, never a silently-swapped target. Either way (recording or not),
changing the channel **resets the panel to a clean live view** — charts,
tables, and the app-state badge are all cleared, the same as opening the
panel fresh — since data from the previous channel would otherwise linger on
screen looking like it belongs to the new one. "dev" is always the default on
panel open. Starting a new recording after a channel change always creates a
brand-new session folder for the new channel; it never appends to or reuses
the previous channel's session files.

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
| `collectors.objectCounts.enabled` / `.intervalMs` | `true` / `2000` | BrightScript object counts by type via ECP `/query/app-object-counts`, scoped to the recorded app id. Only polled while the Objects chart or table is visible — both are hidden by default |
| `collectors.rendezvous.enabled` / `.intervalMs` | `true` / `1000` | Rendezvous via ECP |
| `collectors.systemMem.enabled` / `.intervalMs` | `false` / `5000` | Device-wide memory |
| `collectors.textures.enabled` / `.intervalMs` | `true` / `5000` | GPU texture memory. Only polled while the Textures chart or table is visible |
| `collectors.appState.enabled` / `.intervalMs` | `true` / `2000` | App foreground/background state via ECP, shown as background shading on every chart. Requires "Control by mobile apps" enabled on-device — degrades to no shading (not an error) when unavailable |
| `collectors.fwBeacon.enabled` / `.intervalMs` | `true` / `1000` | Framework beacon markers (AppLaunch/AppResume/VODStart Initiate/Complete) via ECP `/fwbeacons`, scoped to the recorded app id. Enabled by default, including the Beacons overlay checkbox |
| `defaultVisibleCharts` | `["memory","cpu","nodes"]` | Charts shown by default when the panel opens |
| `defaultVisibleTables` | `["nodes","rendezvous"]` | Tables shown by default when the panel opens |
| `memoryLimits.backgroundMB` | `100` | Reference line on the Memory chart for Roku's published background-app DRAM guidance. Not device-reported (the foreground limit is, from `chanperf`) |

A collector enabled in settings is still only **polled** while at least one
visible chart, table, or overlay needs its data — toggling charts/tables/overlays
in the panel's "Charts"/"Tables" dropdowns and the Rendezvous/Beacons checkboxes
starts and stops individual collectors on the running session in real time, so
nothing not currently displayed is fetched from the device.

---

## Session replay (Phase 4)

A `<select>` dropdown in the toolbar lists every recorded session (newest first),
alongside a **● Live** option for the live view.

### Session selector

Each option is labelled `<appTitle>  <date>  (<duration>)`, e.g.
`DAZN  2026-06-26 10:37  (5m 12s)`. The extension reads all `session.json`
manifests under the output directory and sends them to the webview each time the
panel opens or a session stops.

### Entering replay mode

Selecting a past session sends `load-session { dir }` to the extension host, which:
1. Uses `SessionReader` to read `mem-cpu.ndjson`, `node-counts.ndjson`, and
   `rendezvous.ndjson` from the session directory.
2. Caps at `kopytko.diagnostics.maxLivePoints` (default 3600) points per stream.
3. Includes node-type breakdown only for the first and last node-counts snapshots
   to keep the message small for long sessions.
4. Sends a `replay` message back with the loaded data.

The webview then:
- Clears the live data, ingests the historical data, and redraws all charts and lists.
- Updates the toolbar: the status dot turns blue, the Start/Stop button is disabled,
  and the device label shows the session summary (app, date, duration).

### Returning to live view

Selecting **● Live** from the dropdown sends `load-live`; the extension responds with
a fresh `init` message containing the live ring-buffer data (if a session is running)
or an empty state. The toolbar and button are restored.

## Lists & navigation (Phase 3+)

Below the charts the panel shows up to four side-by-side data tables, each
independently scrollable and independently shown/hidden via the toolbar's
"Tables" dropdown. Each table's header badge shows a running total (event
count + total time for Rendezvous; bitmap count + total size for Textures;
object/type counts for Nodes and Objects).

### Node types table

Populated from every `sgnodes counts` snapshot. Columns:

| Type | Count | Δ | kB |
|---|---|---|---|
| Custom component name (e.g. `EventTileModel`) | Live count | Change since session start (red = up, green = down) | Static bytes / 1024 |

Sorted by count descending (top offenders first). Click any row → VS Code
opens the matching `<Type>.xml` file using `resolveNodeComponentFile`:
1. `workspace.findFiles('**/<Type>.xml')` — includes node_modules Kopytko packages.
2. Multiple matches → prefer the project source tree over node_modules (custom
   components defined in the project take priority).
3. No match → info toast (built-in Roku types like `Label`, `Rectangle` have no
   source file).

### Objects table (hidden by default)

Populated from every `app-object-counts` snapshot. Rows are keyed by object
**type, or subtype when available** — every `roSGNode` SceneGraph component
gets its own `roSGNode:<Subtype>` row (e.g. `roSGNode:Font`), all other
BrightScript types (e.g. `roString`, `roAssociativeArray`) one row each. Columns:

| Object | Count | Δ | kB |
|---|---|---|---|
| `type` or `roSGNode:<subtype>` | Live instance count | Change since previous snapshot (red = up, green = down) | Physical bytes / 1024 |

Sorted by count descending, capped at 50 rows. This is the best view for
spotting object leaks (e.g. runaway `roString`/`roArray` growth) that node
counts alone don't show.

### Rendezvous table

Aggregates all `rendezvous` events for the session, grouped by `file:line`.
Columns: **Location** (filename:line), **Count**, **Avg ms** (average stall duration).
Sorted by count descending. Click any row → VS Code opens the source file at the
rendezvous line using `resolveRendezvousFile`:
1. Workspace-wide search by full relative path (null excludes → node_modules included).
2. Multiple matches → prefer node_modules (kopytko npm packages are the typical source).
3. Filename-only fallback.

### Textures table

Lists individual loaded bitmaps from the latest `textures` snapshot. Columns:
**Name** (basename, full path on hover), **Dimensions** (width×height), **kB**.
Sorted by size descending, capped at 50 rows.

### Shared file-resolution util

`src/client/roku/util/resolveSourceFile.ts` exports both `resolveRendezvousFile`
and `resolveNodeComponentFile`, used by this panel's Rendezvous/Nodes tables to
open source files on click.

## Webview panel (Phase 2+)

The panel appears in the VS Code bottom bar under **Kopytko Diagnostics**. The
webview is hand-rolled D3.js/SVG, not a charting library.

### Layout

A toolbar row (device indicator, a live app-state badge, Start/Stop, elapsed
timer, Charts/Tables visibility dropdowns, Rendezvous/Beacons overlay
checkboxes) above up to five charts, each independently shown/hidden via the
"Charts" dropdown:

| Chart | Series | Source |
|---|---|---|
| **Memory** | Total MB (area), Anon, File, Shared, Swap, plus a device-reported foreground-limit line ("FG Limit") and Roku's published background-DRAM-guidance line ("BG Limit", default 100 MB, `kopytko.diagnostics.memoryLimits.backgroundMB`) | `chanperf` |
| **CPU** | Total %, User, Sys | `chanperf` |
| **SceneGraph Nodes** | Stacked area by node type (top 8 + "Other"), with a legend | `sgnodes counts` |
| **Objects** (hidden by default) | Stacked area of BrightScript object counts by type (top 8 + "Other"), with a legend — `roSGNode` subtypes are summed into a single `roSGNode` series here; the Objects table shows the per-subtype breakdown | ECP `/query/app-object-counts` |
| **Textures** | Used MB (area) + a max-texture-memory reference line | `r2d2_bitmaps` |

Every chart can optionally overlay rendezvous markers (vertical lines) and
framework beacon markers (dashed vertical lines), toggled independently via
the toolbar checkboxes, and shades its background for time ranges the app was
backgrounded/inactive (from the `app-state` collector, on by default). The
toolbar's app-state badge (`● active` / `● background` / `● inactive` /
`● unknown`) shows the *current* live state directly — useful when the app has
been in one state for the whole session, since the chart shading alone only
reads as a signal when there's a visible transition. Requires "Control by
mobile apps" enabled on the device; shows `● unknown` otherwise (not an
error).

**The diagnostics *session* itself never stops or pauses when the app is
backgrounded** — recording, the NDJSON writer, and the rendezvous/app-state/
beacon collectors all keep running the entire time a session is active,
regardless of the app's foreground/background state. What *does* go quiet
during background is CPU/Memory/Node/Texture data specifically, because the
Roku device itself refuses to serve it: `GET /query/chanperf` and
`GET /query/sgnodes/all` both return `<status>FAILED</status><error>Channel
not running: active UI</error>` while the channel isn't the foreground UI, and
the raw SceneGraph debug console (port 8080, used for Textures) accepts the
TCP connection but doesn't respond to any command until the app returns to
the foreground. This is a Roku OS/ECP platform limitation (confirmed live
against a dev Ultra, firmware 15.2.4) that no client-side polling change can
work around — the resulting gap in those charts is exactly what the
background/inactive shading is meant to explain, not a bug.

Hovering
any chart shows a tooltip with each series' value plus the nearest
rendezvous/beacon at the cursor (file:line + duration, or beacon name).

The "Helper lines" toolbar checkbox toggles the FG/BG memory-limit and
texture-max reference lines off — when off, those lines stop being included
in the y-axis auto-range too, so the remaining series can use the full chart
height to show lower values more clearly (useful when a limit is far above
normal usage and compresses everything else near the bottom).

Dragging directly on **any** chart — not just the navigator strip — selects a
time range and zooms all charts to it, the same as dragging the navigator. The
dragged rectangle clears itself immediately afterward; the navigator strip is
what continues to show the current zoom range. A plain click (no drag) is a
no-op and doesn't reset an existing zoom — use "Clear Range" or drag an empty
selection on the navigator for that.

A single navigator/range-select strip below the charts overlays the headline
metric of **every** currently visible chart simultaneously (Memory, CPU, Nodes,
Objects, Textures), each normalized to a shared 0–1 scale since their units
differ — not just the first one.

Charts are laid out in equal-width columns matching how many are visible (one
chart = full width, two = 50/50, etc.) and likewise for tables. The charts
area grows with the panel up to a height cap; once that cap is hit, further
panel growth goes to the tables area instead. A drag handle between the two
areas works the same way manually. When no charts are selected the tables
area fills the space, and vice versa.

All charts resize with the panel. Colors adapt to the VS Code theme via CSS
variables.

### Webview bundle

Built by `npm run bundle:webview` → `out/diagnostics-webview/main.js` and
`out/diagnostics-webview/main.css`. The bundle is excluded from tsc (browser
globals) and compiled by esbuild only.

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

---

# Kopytko Perfetto (App Tracing)

A separate bottom panel that provides a **live** Roku app tracing experience by
embedding the official Perfetto UI (`ui.perfetto.dev`) directly in VS Code and
continuously feeding it the device's binary trace stream.

> **Requires Roku firmware 15.2 or later.**  
> On first use Perfetto will show a "Trust this origin?" dialog — click **Always trust**.

## How it works

1. **Deploy** — clicking Start injects `run_as_process=1` into the local manifest
   override (same pattern as the debug session: inject → build → restore), then
   builds and deploys the app via `npx kopytko start`.
2. **Enable tracing** — `POST http://device:8060/perfetto/enable/dev`.
3. **Stream** — opens `ws://device:8060/perfetto-session`.  The device streams raw
   binary Perfetto protobuf packets (`TracePacket` messages).  Each chunk is:
   - written to `debug/<session>__perfetto/trace.perfetto-trace` (append-write)
   - forwarded to the webview as a transferable `ArrayBuffer`
4. **Live view** — the webview accumulates chunks into a growing buffer and posts
   it to the embedded `ui.perfetto.dev` iframe every 3 seconds (configurable).
   The iframe re-renders the full trace each cycle.  After each push the viewport
   scrolls to the live edge so the user sees the most recent second of trace.
5. **Stop** — sends the WebSocket close frame, waits for a 500 ms quiet window,
   flushes the trace file, writes `session.json`, and releases the device lock.

## Mutual exclusion

`DiagnosticsLock` (`src/client/diagnostics/diagnosticsLock.ts`) ensures only one
panel holds the device at a time.  Starting either panel while the other is active
shows a warning and prevents the start.  Both webviews show a banner immediately
when the lock changes.

## Session storage

```
debug/
└── 2026-06-28_14-22-01__MyApp__perfetto/
    ├── session.json           startedWall, endedWall, device, app
    └── trace.perfetto-trace   raw Perfetto binary (append-written as chunks arrive)
```

The `__perfetto` suffix distinguishes Perfetto sessions from Diagnostics sessions
in the shared `debug/` directory (controlled by `kopytko.diagnostics.outputDir`).

## Replay

Selecting a past session from the dropdown reads `trace.perfetto-trace` from disk
and sends the full buffer to the Perfetto iframe.  The iframe renders the complete
saved trace in read-only mode.

## Configuration

| Setting | Default | Effect |
|---|---|---|
| `kopytko.perfetto.ecpPort` | `8060` | ECP port for HTTP control + WebSocket |
| `kopytko.perfetto.refreshIntervalMs` | `3000` | How often the buffer is sent to the Perfetto iframe |
| `kopytko.perfetto.startCommand` | `""` | Build command; falls back to `npx kopytko start` |
| `kopytko.diagnostics.outputDir` | `"debug"` | Shared output dir; Perfetto sessions use `<dir>/*__perfetto/` |

## Heap snapshots

Clicking **Heap** triggers `POST /perfetto/heapgraph/trigger/dev`.  The snapshot
appears as a heap-graph track in the Perfetto timeline automatically.

## Source files

```
src/client/perfetto/
├── transport/perfettoWebSocketClient.ts   WS client (quiet-window stop, buffer accumulation)
├── ecpTracing.ts                          HTTP enable + heapgraph trigger
├── perfettoController.ts                  Deploy → enable → stream lifecycle, lock
├── session/perfettoSessionStore.ts        Manifest + folder listing
├── views/perfettoViewProvider.ts          WebviewViewProvider (kopytko.perfetto)
└── webview/
    ├── protocol.ts                        Message types (no imports — browser bundle)
    ├── main.ts                            iframe host, PING/PONG, rolling buffer
    └── styles.css
```

Tests: `test/perfetto/`

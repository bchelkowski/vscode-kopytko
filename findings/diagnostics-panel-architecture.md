# Diagnostics Panel — Architecture & Implementation Notes

Internal notes for future sessions. See `docs/diagnostics.md` for the public-facing version.

---

## Directory layout

```
src/client/diagnostics/
  transport/
    debugConsoleClient.ts    Resilient TCP to port 8080 (idle-framed, auto-reconnect)
  parsers/
    consoleResponse.ts       Strip banner + prompts from raw responses
    chanperf.ts              parseChanperf() → ChanperfSample
    sgNodesCounts.ts         parseSgNodesCounts() → SgNodesCounts
    free.ts                  parseFree() → FreeSample
    r2d2Bitmaps.ts           parseR2d2Bitmaps() → R2d2Bitmaps
    index.ts                 Re-exports all parsers
  collectors/
    collector.ts             PollingCollector base class (setInterval, self-healing)
    chanperfCollector.ts     1s interval → mem-cpu events
    nodeCountsCollector.ts   2s interval → node-counts events
    rendezvousCollector.ts   1s interval → rendezvous events (via ECP)
    systemMemCollector.ts    5s interval → system-mem events (opt-in)
    textureCollector.ts      5s interval → textures events (opt-in)
    index.ts                 Re-exports
  session/
    eventModel.ts            DiagnosticEvent union type, STREAM_FILE map, ALL_EVENT_TYPES
    diagnosticsSession.ts    Owns collectors + writer + ring buffers; emits 'event'
  storage/
    sink.ts                  DiagnosticsSink interface + nodeSink (real fs) + joinPath
    ndjsonWriter.ts          Buffered append-only NDJSON writer (400ms flush timer)
    sessionStore.ts          buildSessionId(), writeManifest(), readManifest()
    sessionReader.ts         SessionReader: listSessions(), readStream<T>()
  views/
    diagnosticsViewProvider.ts  WebviewViewProvider: bridges controller ↔ webview
  webview/
    protocol.ts              Message types (ExtMsg, WebMsg, SerializedSessionInfo, ...)
    main.ts                  uPlot charts + DOM + message handler (browser context only)
    styles.css               VS Code-themed layout

  diagnosticsController.ts   Builds session from config; suspends legacy rendezvous poller
```

---

## Event model

Every collected datum is a `DiagnosticEvent` with a common envelope:

```typescript
{ t: msSinceStart, wall: epochMs, type: DiagnosticEventType, ...payload }
```

Adding a new metric:
1. Add member to `DiagnosticEvent` union in `eventModel.ts`
2. Add entry to `STREAM_FILE` map
3. Write a parser in `parsers/`
4. Write a collector in `collectors/`
5. Wire it into `DiagnosticsController.startSession()`
6. Add serialized form to `protocol.ts` and update the provider/webview

---

## Transport — DebugConsoleClient

Key design decisions:
- **Single TCP connection** per session, commands serialized via an internal queue
- **Idle-framing** (250ms default): response is complete when socket goes silent. Cannot use `>` prompt as delimiter because XML responses contain `>` everywhere.
- **Auto-reconnect**: exponential backoff (500ms → 10s). Collectors simply skip a sample when the connection is down; the session continues with gaps, no crash.
- **Never throws into callers**: `send()` rejects fast (not connected → reject immediately), so collectors catch the error and skip that interval.

The banner (first line after connect: `X02800C5FKLV (Roku Ultra - 15.2.4.3442)`) is discarded during the drain phase before the first command is sent.

---

## Rendezvous and the "shared queue" problem

The ECP `/query/sgrendezvous` endpoint **drains** the device's event buffer. If two pollers both call it, they split events between them and each misses half.

Solution: `RendezvousManager` (the legacy Rendezvous Log tree) has `suspend()` / `resume()` methods. `DiagnosticsController` calls `suspend()` before starting a session and `resume()` after stopping, so only one poller touches the queue at a time.

`suspend()` also calls `disableRendezvousTracking()` on the device so no events accumulate in the buffer while the legacy poller is paused.

---

## Storage format

Each session is a folder: `<outputDir>/<YYYY-MM-DD_HH-MM-SS__AppLabel>/`

Files:
- `session.json` — manifest (written at start, finalized at stop)
- `mem-cpu.ndjson`, `node-counts.ndjson`, `rendezvous.ndjson`, etc. — one JSON object per line

NDJSON is safe under crashes/network loss: a torn final line is silently skipped by `SessionReader.readStream()`.

`NdjsonWriter` buffers events and flushes every 400ms. On flush failure the batch is retained and retried next cycle — nothing is dropped.

---

## Webview architecture

The webview bundle is built separately by esbuild (`npm run bundle:webview`) because:
1. It targets the browser, not Node.js (DOM globals, no `require`)
2. It bundles uPlot (~40 KB)
3. It imports `./styles.css` which esbuild extracts to `main.css`

**The webview directory is excluded from `tsconfig.json`** (browser globals break the server tsconfig). esbuild is the only compiler for webview files. `npm run compile` includes `bundle:webview` at the end so a single `npm run compile` builds everything needed for F5 development.

### Message protocol

Extension→Webview (`ExtMsg`):
- `init` — sent on panel open; contains current state + ring-buffer history
- `batch` — throttled 250ms; live events while recording
- `state` — recording state changed (device, start/stop)
- `sessions` — list of recorded sessions for the selector dropdown
- `replay` — full data for a past session loaded from disk

Webview→Extension (`WebMsg`):
- `start` / `stop` — delegate to controller
- `open-rendezvous { file, line }` — navigate editor to source location
- `load-session { dir }` — load a past session as replay
- `load-live` — return to live view
- `new-session` — stop current session + start fresh (or just clear if stopped)

### uPlot patterns

**Cursor sync**: all 3 main charts share `cursor.sync.key = 'kopytko-diag'`. No `uPlot.sync()` call needed — providing the same string key in options automatically registers the chart with a shared pub/sub hub.

**Navigator chart**: 4th chart spanning full width (`grid-column: 1 / -1`). Uses `select: { show: true }` for brush selection. The `hooks.setSelect` callback reads `u.select.left` / `u.select.width`, converts to wall-clock ms via `u.posToVal(pos, 'x')`, and calls `chart.setScale('x', { min, max })` on all 3 main charts.

**Restoring selection after setData**: when `setData(..., true)` is called on the navigator (which resets scales), any active selection rectangle is lost. After calling setData, explicitly restore the selection via `navChart.setSelect({ left, width, top: 0, height }, false)` using the stored `zoomMin`/`zoomMax` values converted back to pixels via `navChart.valToPos(...)`.

**Y axis never clips**: use `range: (_u, min, max) => [Math.max(0, min - 1), max + 1]` — the `+1` padding prevents data points at the exact range boundary from being clipped.

**Fixed Y-axis width**: set `size: 52` on y-axis options to prevent label overflow. Without this, long numbers (e.g. "53920 MB") can overflow the axis area and be cut off.

**Chart initialization timing**: call `initCharts()` inside `requestAnimationFrame()`. At `DOMContentLoaded` time the layout hasn't settled so `getBoundingClientRect()` returns wrong (often 0) dimensions. `requestAnimationFrame` defers until after the first paint.

---

## DiagnosticsViewProvider key behaviours

- `retainContextWhenHidden: true` — the webview's JS state (data arrays, zoom) is preserved across panel hide/show. This means charts don't reset when the user switches away from the bottom panel.
- `sendSessions()` is async (reads disk). Called on: panel open, visibility change, after session stops. Fire-and-forget via `void this.sendSessions()`.
- For replay, node-counts types are only included for the first and last snapshot to keep the postMessage small. Historical point data is `{ wall, totalCount, types: [] }` except at endpoints.
- `resolveOutputRoot()` reads `kopytko.diagnostics.outputDir` from workspace config and `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` for the workspace root.

---

## Testing patterns

### Parser tests
Use real device fixtures in `test/diagnostics/fixtures/`. Captured directly from the device via `exec 3<>/dev/tcp/$IP/8080; printf 'cmd\r\n' >&3; timeout 4 cat <&3 > fixtures/name.txt`. Tests call the parser and assert on the known values.

### Transport tests (DebugConsoleClient)
Inject a `ConsoleSocketFactory` that returns a mock socket (EventEmitter + write/destroy stubs). Use `sinon.useFakeTimers()` to control the idle timer. The mock socket emits `'connect'`, `'data'`, `'close'` events to simulate real TCP behaviour.

### Collector tests
Stub `DebugConsoleClient.send()` to resolve with fake response strings. Use `sinon.useFakeTimers()` to advance the polling interval. Assert on events emitted by the collector.

### Storage tests
Use an in-memory `DiagnosticsSink` (a plain object implementing the interface) so tests never touch real disk. The sink stores content in `Map<string, string>` objects.

### resolveSourceFile tests
The module imports `vscode` at the top (TypeScript's `__importStar` wrapping). This means mutating the mock object AFTER the module is first imported will NOT be seen by the module's `vscode` reference (the wrapper is a snapshot). Fix: clear the module from `require.cache` before each test and `require()` it fresh. This is why the test uses dynamic `require()` with ESLint disable comments.

```typescript
function loadModule() {
  delete require.cache[require.resolve('path/to/resolveSourceFile')];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('path/to/resolveSourceFile') as typeof import('...');
}
```


---

## Kopytko Perfetto panel

A separate panel (`kopytko.perfetto`) that sits alongside the Diagnostics panel in the bottom area.

### Mutual exclusion

`src/client/diagnostics/diagnosticsLock.ts` — a singleton `EventEmitter` (`DiagnosticsLock`). Both controllers call `acquire(owner)` before starting and `release(owner)` on stop. Emits `'change'` so both `ViewProvider`s can push a `{ kind: 'lock' }` message to their webviews without polling. The webview disables the Start button and shows a banner when locked by the other panel.

### Source layout

```
src/client/perfetto/
  transport/perfettoWebSocketClient.ts   ws:// client; quiet-window stop; Buffer accumulation
  ecpTracing.ts                          HTTP enablePerfettoTracing / triggerHeapSnapshot
  perfettoController.ts                  Lifecycle: deploy → enable → stream → save → stop
  session/perfettoSessionStore.ts        Session manifest, folder naming (*__perfetto)
  views/perfettoViewProvider.ts          WebviewViewProvider; forwards chunks; lock subscription
  webview/
    protocol.ts                          Message types (no imports; browser bundle)
    main.ts                              PING/PONG, iframe, rolling buffer, scroll-to-edge
    styles.css
```

### Session storage

Sessions land in `<outputDir>/<timestamp>__<app>__perfetto/` alongside Diagnostics sessions.
- `session.json` — `PerfettoManifest` (startedWall, endedWall, device, app)
- `trace.perfetto-trace` — raw binary Perfetto protobuf, append-written as chunks arrive

### Perfetto iframe integration (PING/PONG required)

Before sending any trace: poll `iframe.contentWindow.postMessage('PING', origin)` at 250ms intervals. The iframe replies `'PONG'` once its message listener is active. Distinguish iframe messages from extension messages by checking `event.source === iframe.contentWindow`.

After sending a new buffer: wait ~800ms then post `{ perfetto: { timeStart, timeEnd } }` (seconds, not nanoseconds) to scroll the viewport to the live edge.

`keepApiOpen: true` keeps Perfetto's message listener active across multiple `postMessage` calls (needed for live refresh). `localOnly: true` hides share/download UI.

### rokuDeployer extension

`deployForPerfetto()` in `src/client/roku/rokuDeployer.ts` — same inject/restore pattern as `deploy()` but uses `{ run_as_process: 1 }` instead of debug entries. Uses `PERFETTO_MANIFEST_FILENAME = 'kopytko-perfetto-local.js'` so it does not collide with an active debug session's file.

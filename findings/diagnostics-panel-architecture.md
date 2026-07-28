# Diagnostics Panel & Webview Architecture — Reference

> Full history and the bug-by-bug reasoning:
> [archive/diagnostics-panel-journal.md](archive/diagnostics-panel-journal.md).
>
> Despite the name this is the **repo-wide webview reference** — the toolbar, uPlot, xterm,
> and sidebar-vs-panel rules below apply to every webview tool, not just Diagnostics.
> User-facing docs: `docs/diagnostics.md`.

---

## ⛔ Never do this

- **Never call `FitAddon.fit()` without checking the container has a real size.** At first paint the
  panel measured 12×4 px, `proposeDimensions()` returned `{cols:2, rows:1}`, and the grid **never
  grew back** — the ResizeObserver notification was already consumed at that degenerate size.
  Symptom: buffer full, terminal renders one row. Guard with `MIN_CONTAINER_PX` + an rAF retry
  (`scheduleFit()`). Panel collapse re-triggers this, so it is not only a startup concern.
- **Never put `user-select: none` on a webview `body`.** It propagates into input fields and breaks
  selecting/copying. Scope it to buttons/labels/toolbar and set `input, textarea { user-select: text }`.
- **Never `stopPropagation()` keydown inside webview inputs** — it hides them from VS Code's webview
  keyboard handling (clipboard shortcuts, workbench re-dispatch). Use target checks in the
  document-level handler instead.
- **Never write raw device output to a terminal.** A channel's `print` is untrusted; an escape
  sequence repaints the screen or corrupts the input row. Run it through `stripControl()`.
- **Never let two pollers touch `/query/sgrendezvous`** — it drains the device buffer. See below.

---

## Bottom-panel toolbar convention

Match the **sibling** panel, not any panel: the eye compares the tab immediately beside yours.
Console was first styled from `rokuPay`/`deepLinking` — both *editor tabs* — and read as visibly
foreign next to Diagnostics. Canonical metrics live in
`src/client/diagnostics/webview/styles.css`; copy verbatim:

| Element | Metrics |
|---|---|
| `#toolbar` | `padding: 5px 10px`, `gap: 6px`, `min-height: 34px`, 1px `--vscode-panel-border` bottom |
| `select` | `--vscode-dropdown-*`, `padding: 2px 4px`, `font-size: 11px`, radius 2px, `max-width: 240px` → **23px** |
| `button` | **primary by default**, `border: none`, `padding: 3px 10px`, `font-size: 11px`, radius 2px → **21px**; `.secondary` / `.stop` variants |
| status dot | `8px`, `--vscode-editorHint-foreground`, `transition: background 0.3s` |
| badge/pill | `font-size: 10px`, weight 600, `padding: 1px 7px`, radius 8px, **no border**, `rgba(…,0.18)` tint → **15.5px** |

Two traps: **a 1px border makes a pill 2px taller** than the house badge (the off state is a neutral
tint, not an outline), and **buttons are primary by default** — styling `.control` as
secondary-with-border inverts the convention and changes button height.

To verify rather than eyeball: render the reference panel's real markup against its real emitted
stylesheet in an iframe, put the new toolbar underneath, diff `getComputedStyle` +
`getBoundingClientRect` per element. That is how a 17.5-vs-15.5px pill discrepancy was caught.

---

## Panel vs sidebar webviews

- **`WebviewPanel` supports `retainContextWhenHidden: true`** — Diagnostics uses it, so chart data
  and zoom survive hide/show.
- **Sidebar `WebviewView`s do NOT** (VS Code decides). Collapsing destroys JS state. So: every view
  re-posts `{kind:'ready'}` on load, the provider re-pushes **all** state on `ready` *and*
  `onDidChangeVisibility`, and anything long-running lives host-side.
- **One bundle can serve several views** — Device Manager's four sidebar views all load
  `out/device-manager-webview/main.js`; the provider stamps `<body data-view="…">` and `main.ts`
  dispatches on it. One provider class instantiated 4× with a `kind` param. Saves three esbuild
  entries and three compile-chain slots.
- **VS Code re-dispatches webview keyboard events to the workbench**, so extension keybindings fire
  even while the webview has focus. The remote view's keydown listener therefore captures **only
  printable characters** and leaves arrows/Enter/Escape to package.json keybindings — handling both
  would double-send every navigation key.
- **Webview bundles are excluded from `tsconfig.json`** (browser globals break the server tsconfig);
  esbuild is their only compiler. `npm run compile` chains every `bundle:*-webview` so one command
  builds everything F5 needs.

---

## uPlot patterns

- **Cursor sync**: give every chart the same `cursor.sync.key`. No `uPlot.sync()` call needed — the
  matching string auto-registers with a shared pub/sub hub.
- **Navigator brush**: `select: { show: true }`; `hooks.setSelect` reads `u.select.left`/`.width`,
  converts via `u.posToVal(pos, 'x')`, and calls `setScale('x', {min,max})` on the main charts.
- **`setData(..., true)` resets scales and destroys the selection rectangle.** Restore it explicitly
  with `navChart.setSelect({left,width,top:0,height}, false)`, converting stored `zoomMin`/`zoomMax`
  back to pixels via `valToPos`.
- **Y axis must not clip**: `range: (_u,min,max) => [Math.max(0,min-1), max+1]` — without the padding,
  points exactly on the boundary are cut.
- **Fixed y-axis width** `size: 52`, or long labels overflow and get cut.
- **Initialise charts inside `requestAnimationFrame`.** At `DOMContentLoaded` the layout has not
  settled and `getBoundingClientRect()` returns 0.

---

## xterm.js (Kopytko Console)

- **Default DOM renderer only.** The WebGL addon is unreliable in webviews and the DOM renderer
  handles these line rates fine. `@xterm/xterm` + `@xterm/addon-fit`.
- **xterm belongs in `devDependencies`** — esbuild inlines it into the bundle, so shipping it in the
  VSIX's `node_modules` is pure weight. (`d3` sits in `dependencies` for the diagnostics webview;
  that is the pattern *not* to copy.)
- **Theme from `--vscode-terminal-ansi*` into an `ITheme`**, re-read via a `MutationObserver` on
  `document.body` — a webview gets no theme-change event. Using the 16 ANSI slots for severity
  colours makes themes drive the hues for free.
- **CSP needs nothing extra**; xterm's inline styles fall under the existing
  `style-src ${csp} 'unsafe-inline'`, and its CSS import concatenates into the same `main.css`.
- **No readline, and neither Roku console echoes input** — the input row is ours. Erase the row
  (`\r\x1b[2K`), write output, repaint prompt+buffer, move the caret back (`\x1b[<n>D`). Funnel
  everything through one `withInputRow()` helper so output can never land inside the typed line.
- **Completion trap**: re-firing the buffer-changed hook from `applyCompletion()` re-opened the popup
  on the just-accepted text, so Enter accepted forever and never submitted. Accepting must not fire
  `change`, and `accept()` returns **false** when the highlighted value equals the typed token.

---

## Headless webview verification

Bundle + a stub `acquireVsCodeApi()` + a static server renders a whole panel in a browser — worth
doing. Catches: the browser pane does not composite, so `requestAnimationFrame` never fires and
xterm's DOM renderer never paints — shim `window.requestAnimationFrame = cb => setTimeout(cb, 16)`
before loading the bundle. Synthetic keys need `keyCode`/`which` defined; dispatch printable
characters as `keypress` only or they double-insert.

---

## Data pipeline

Collectors, parsers, and transports live in `packages/roku-device/`; the extension side is VS Code
glue only. The package barrel exports everything including the `Ecp*Collector`s.

**Event envelope**: `{ t: msSinceStart, wall: epochMs, type: DiagnosticEventType, ...payload }`.

**Adding a metric**: union member in `eventModel.ts` → `STREAM_FILE` entry → parser → collector →
wire into `DiagnosticsController.startSession()` → serialized form in `protocol.ts` → provider/webview.

**`DebugConsoleClient`**: one TCP connection per session, commands serialized through an internal
queue, **idle-framed at 250 ms** (`>` appears inside XML so it cannot delimit), auto-reconnect with
500 ms → 10 s backoff. **Never throws into callers** — `send()` rejects immediately when
disconnected so collectors just skip that interval and the session continues with gaps.

**Rendezvous shared-queue problem**: ECP `/query/sgrendezvous` drains the device buffer, so two
pollers each miss half the events. `RendezvousManager.suspend()`/`resume()` bracket a session;
`suspend()` also disables device-side tracking so nothing accumulates while paused.

**Storage**: one folder per session, `session.json` manifest plus one `*.ndjson` per stream.
NDJSON survives crashes — a torn final line is silently skipped by `readStream()`. `NdjsonWriter`
flushes every 400 ms and **retains the batch on failure** for the next cycle, so nothing is dropped.

**Replay size**: node-counts `types` are included only for the first and last snapshot; intermediate
points carry `{ wall, totalCount, types: [] }` to keep the `postMessage` small.

---

## Perfetto panel

Separate panel, mutually exclusive with Diagnostics via `diagnosticsLock.ts` — a singleton
EventEmitter both controllers `acquire`/`release`, emitting `'change'` so each provider pushes a
`{kind:'lock'}` message instead of polling.

`deployForPerfetto()` uses the same inject/restore pattern as `deploy()` but with
`{run_as_process: 1}`, and a distinct `kopytko-perfetto-local.js` manifest filename so it cannot
collide with an active debug session's file. Trace lands as raw binary protobuf, append-written as
chunks arrive. Iframe integration details are in [roku-device-api.md](roku-device-api.md#perfetto-port-8060-firmware-152).

---

## Testing patterns

| Layer | Approach |
|---|---|
| Parsers | Real device fixtures in `test/diagnostics/fixtures/`, captured via `exec 3<>/dev/tcp/$IP/8080` |
| Transport | Inject a `ConsoleSocketFactory` returning a mock socket (EventEmitter + write/destroy stubs); `sinon.useFakeTimers()` drives the idle timer |
| Collectors | Stub `DebugConsoleClient.send()`, advance fake timers, assert emitted events |
| Storage | In-memory `DiagnosticsSink` — tests never touch disk |

**`resolveSourceFile` module-snapshot trap**: the module imports `vscode` at top level, and
TypeScript's `__importStar` wrapper snapshots it — mutating the mock *after* first import is invisible
to the module. Clear `require.cache` and `require()` fresh in each test.

**JS default-param trap**: `makeController(activeDevice = DEVICE)` called with explicit `undefined`
still gets the default. "No device" fixtures must pass `null`.

---

## Key files

| Area | File |
|---|---|
| Session lifecycle | `src/client/diagnostics/session/diagnosticsSession.ts` |
| Controller | `src/client/diagnostics/diagnosticsController.ts` |
| Panel/lock | `src/client/diagnostics/views/diagnosticsViewProvider.ts`, `diagnosticsLock.ts` |
| Storage | `src/client/diagnostics/storage/` |
| Webview + canonical styles | `src/client/diagnostics/webview/main.ts`, `styles.css` |
| Console terminal | `src/client/console/webview/`, `src/client/console/lineClassifier.ts` |
| Collectors / parsers | `packages/roku-device/src/diagnostics/` |
| Transport | `packages/roku-device/src/console/debugConsoleClient.ts` |

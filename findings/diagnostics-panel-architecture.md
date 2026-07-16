# Diagnostics Panel — Architecture & Implementation Notes

Internal notes for future sessions. See `docs/diagnostics.md` for the public-facing version.

**Correction (2026-06-30): the webview is hand-rolled D3.js/SVG, not uPlot.** Earlier
versions of this file said uPlot — that was never accurate for the current
implementation. `webview/main.ts` builds raw `<svg>` elements via `d3-selection`,
`d3-scale`, `d3-shape`, `d3-axis`, `d3-brush` and updates path `d` attributes
in place on each redraw (no virtual DOM, no uPlot dependency). All "uPlot"
references below should be read as "D3".

## Panel overhaul (2026-06-30)

Added in one pass: hover tooltips (series values + nearest rendezvous/beacon),
rendezvous + framework-beacon overlays selectable on every chart (not just
Nodes), a stacked Nodes-by-type chart (top-8 types + "Other", `d3.stack`-style
cumulative areas via `ChartConfig.stacked`), a new Textures chart (used MB +
max reference line) and Textures table (per-bitmap name/dimensions/size),
app-state (foreground/background) tracking with chart-background shading,
chart/table visibility dropdowns wired to **dynamic per-collector start/stop**
on the extension host, a resizable charts/tables split, and empty-state
collapse. Key design points:

- **Settings are a ceiling, webview visibility is the floor.** `DiagnosticsController.startSession()`
  still builds collectors from `kopytko.diagnostics.collectors.*.enabled` exactly as before — a
  collector that's off in settings is never built at all. `DiagnosticsSession.setCollectorActive(type, bool)`
  can only start/stop a collector that *was* built; calling it for a type with no
  collector is a no-op. `DiagnosticsViewProvider` tracks the webview's current
  chart/table/overlay selection and calls `controller.setCollectorActive(...)`
  per `DiagnosticEventType` whenever that selection changes (and once right
  after a session starts) — so e.g. `mem-cpu` only polls while Memory or CPU
  is visible, `rendezvous` only polls while the rendezvous overlay or table is
  on, etc. The webview is the source of truth for visibility — it posts a
  `'visibility'` WebMsg eagerly on load and on every toggle, rather than the
  extension's config-derived default winning.
- **App-state tracking uses ECP `GET /query/app-state/<appId>`** (`<channel-state>`:
  `active`/`background`/`inactive`), added as `EcpClient.queryAppState()` — requires
  "Control by mobile apps" enabled on-device; returns `'unknown'` on any failure
  rather than throwing, matching the existing collector "never throw" contract.
- **Correction: ECP `/query/chanperf` DOES report a per-app memory limit** —
  `<memory><limit>859832320</limit></memory>` (bytes), confirmed live against the
  dev device. The original finding above ("no limit exposed via any endpoint")
  was wrong — it just wasn't checked against the live ECP response, only the
  Roku docs prose. `parseEcpChanperf()` now extracts `limitKiB` (raw debug-console
  `chanperf` has no equivalent field, so it stays `undefined` there — only the ECP
  path populates it). The Memory chart draws it as a reference line via the same
  `drawLimitLine()` helper used for the Textures chart's max line.
- **Framework beacons (`fw-beacon` event type) come from port 8085** (the
  BrightScript log stream — see `findings/roku-device-api.md` "Port 8085"),
  NOT port 8080. It's a read-only streaming log, not a request/response
  console, so `FwBeaconCollector` does *not* extend `PollingCollector` — it
  implements `Collector` directly and wraps a new `BeaconLogClient` (modeled
  on `DebugConsoleClient`'s reconnect/backoff but emitting one `'line'` event
  per complete line instead of framing request/response pairs). Beacon lines
  look like `06-26 07:24:26.305 app  [beacon.signal] |AppLaunchInitiate ---------> TimeBase(0 ms)`;
  parsed by `parsers/fwBeacon.ts`. This was unscoped going in (no "beacon"
  terminology existed anywhere in the codebase) — the data source was found by
  re-reading `findings/roku-device-api.md`'s existing port-8085 notes from an
  earlier session, not by a fresh device spike.
- **Per-bitmap texture data was always parsed but never persisted.** `parseR2d2Bitmaps()`
  already returned a full `bitmaps: TextureBitmap[]` array; `TextureCollector`
  discarded it before emitting `TexturesEvent`. Fixed by adding `bitmaps` to
  the event type and forwarding it through — `STREAM_FILE` already covered
  `textures.ndjson`, so no new file, just a richer payload.
- **Stacked node-type chart needs per-timestamp type history, not just the
  latest snapshot.** The existing `SerializedNodePoint.types` field already
  carries the full per-type breakdown on every *live* batch (only replay caps
  it to first/last snapshot for message size) — `ingestNodes()` now retains a
  `nodeTypeHistory: { wall, types: Map }[]` array and `typesAt(ms)` binary-searches
  it for the nearest preceding snapshot (step/carry-forward, not interpolated).
  Top-8-by-latest-count + "Other" bucket; chart uses 9 fixed "slots" whose
  label/color get reassigned on each ranking change rather than recreating SVG
  elements (`createChart()`'s series array shape must stay fixed once built).
- **`ChartConfig.extras` callback signature grew** from `(g, xSc, h)` to
  `(g, xSc, h, ySc, w)` — needed `ySc` for the texture max-line reference and
  `w` for its full-width span. All four main charts now share one `chartExtras()`
  composer (suspend shading → beacon markers → rendezvous markers, in that
  paint order) instead of each chart owning bespoke overlay logic.

## Follow-up fixes (2026-06-30, same day)

A first pass left several pieces non-functional or behaving differently than
intended. Root causes and fixes:

- **Beacons/textures showed nothing**: `collectors.textures.enabled` and
  `collectors.fwBeacon.enabled` defaulted to `false`, so those collectors were
  never *built* by `DiagnosticsController.startSession()` — the webview's
  visibility checkboxes/dropdown could only start/stop a collector that
  already exists (`setCollectorActive` narrows, never widens; see above), so
  toggling them was a silent no-op. Fixed by defaulting both (and `appState`)
  to `true` — the always-on/off split should be expressed through what's
  *visible* in the panel, not through whether the collector was ever
  instantiated. `DiagnosticsController` now also always constructs the
  `DebugConsoleClient` (previously conditional on `systemMem`/`textures` being
  enabled) since textures is default-on now.
- **`FwBeaconCollector` had no test/injection seam** — unlike every other
  transport (`DebugConsoleClient` takes a `ConsoleSocketFactory`), it
  hardcoded a real `net.Socket` via `BeaconLogClient`. Once `fwBeacon` defaulted
  to enabled, `DiagnosticsController`'s tests (which start a full session)
  began opening real TCP connections to a fake test IP and hung. Fixed by
  giving `BeaconLogClient`/`FwBeaconCollector` the same `socketFactory`
  injection pattern, reusing the controller's existing `ConsoleSocketFactory`
  (structurally compatible — `ConsoleSocket` is a superset of `LogSocket`,
  adding only `write`).
- **Navigator headline series was changed (wrongly) to "first visible chart
  only".** The actual requirement is *all* visible charts' headline metrics on
  the navigator simultaneously, not just one. Replaced the single-series
  navigator with up to `MAX_NAV_SERIES = 4` pre-allocated `<path>` elements,
  one per visible chart, each independently normalized to a shared `[0,1]`
  y-domain (`v / max(values)`) since Memory/CPU/Nodes/Textures use unrelated
  units and can't share a literal y-scale.
- **Chart/table sizing wasn't responding to count or panel height correctly.**
  `#charts` previously had `flex: 1 1 0` with no cap (charts ate the entire
  panel growth) and `#lists` was a fixed `flex: 0 0 110px` (tables never grew
  with the panel at all — the resize-handle JS set inline `style.flex` but the
  *default* untouched state never reflected the intended 75/25 split or any
  cap). Fixed: `#charts` is now `flex: 3 1 0; max-height: var(--max-charts-height, 480px)`
  and `#lists` is `flex: 1 1 0; min-height: 80px` — charts grow with the panel
  up to the cap, after which CSS flex-grow naturally routes the remainder to
  `#lists`. Also, `grid-template-columns` on both `#charts` and `#lists` was
  hardcoded to 3/2 columns regardless of how many panes were actually visible;
  `applyChartVisibility()`/`applyTableVisibility()` now set
  `grid-template-columns: repeat(N, 1fr)` where N is the live visible count,
  so 1 visible = full width, 2 = 50/50, etc.
- **Memory chart now plots all 4 chanperf memory components + a limit line**:
  `MemCpuEvent`/`SerializedMemCpuPoint` gained `sharedKiB`/`swapKiB` (parsed by
  `chanperf.ts`/`ecpChanperf.ts` since the original implementation but never
  wired past the event — confirmed missing in the very first pass too) and
  `limitKiB?` (new — see the ECP `<limit>` correction above). All three
  `diagnosticsViewProvider.ts` serialization sites (`onEvent`, `buildHistory`,
  `loadSessionReplay`) needed the same fields added — there's no single choke
  point for this, each site independently destructures the event.
- **Added a "Max lines" toolbar checkbox** (`showHelperLines`, default on) that
  hides the memory-limit/texture-max reference lines AND excludes them from
  `ChartConfig.extraYMax` so the y-axis auto-range doesn't stretch to
  accommodate a now-invisible line — otherwise unchecking the line would still
  leave all the real series compressed near the bottom of the chart, defeating
  the point.

## Navigator/brush performance fix (2026-07-01)

User-reported: range selection ("brush") felt slow/janky, especially while a
session was actively recording. Root cause was in `createNavigator()`'s
`redraw()`:

1. **The brush behavior was fully recreated and re-attached to the DOM on
   every single redraw** (`brushBeh = brushX...; brushG.call(brushBeh)`).
   `redraw()` runs on every live batch (every ~250ms while recording via
   `scheduleRedraw()`), every resize, every chart/table visibility toggle —
   so the brush's overlay/selection/handle elements and all pointer/touch/mouse
   listeners were torn down and rebuilt constantly, not just when the user
   actually dragged.
2. **Worse, when a range was selected, every redraw also called
   `brushG.call(brushBeh.move, [pixelLeft, pixelRight])`** to keep the
   selection rect positioned correctly as new data extended the time domain.
   d3-brush's `.move()` unconditionally dispatches `start`/`brush`/`end`
   events — and the `'end'` handler called `redrawCharts()`. So every redraw
   with an active selection triggered another full redraw, which itself called
   `.move()` again, which fired `'end'` again — a self-reinforcing cascade
   stacked on top of the full brush rebuild from point 1, every single batch.

Fix: the brush behavior (`brushBeh`) is now created exactly once, outside
`redraw()`. Its DOM is only (re)attached via `brushG.call(brushBeh)` when the
chart's pixel size actually changed (tracked via `attachedW`/`attachedH`,
effectively gating it to real resizes). Repositioning the selection rect to
track live data still happens via `.move()`, but is now guarded by a
`suppressBrushEvent` flag that the `'end'` handler checks and clears — so the
cosmetic resync no longer re-triggers a redraw. The `'end'` handler reads the
brush's pixel→time mapping from a `currentXSc` variable updated each redraw,
rather than being recreated as a fresh closure each time. One thing the old
full-rebuild approach got "for free": a fresh `brushG.call(brushBeh)`
attachment has no prior selection, which incidentally cleared the visual rect
whenever `xVisible` was reset (e.g. the "Clear Range" button, which sets
`xVisible = null` directly without going through the brush). The optimized
version needs to do this explicitly — `redraw()` now calls
`brushG.call(brushBeh.move, null)` (also suppressed) when `xVisible` is `null`
but the rect is still visually showing a selection.

## Per-chart range selection + app-state XML bug fix (2026-07-01)

Two follow-ups requested together:

**Range selection only worked on the navigator strip.** Added a brush directly
to each main chart (Memory/CPU/Nodes/Textures) in `createChart()`, reusing the
same perf lesson from the navigator fix above: the brush behavior
(`chartBrushBeh`) is created once, and its DOM/listeners are only
(re)attached when the chart's pixel size changes (`chartBrushAttachedW/H`
gate), not on every redraw. Unlike the navigator, a per-chart brush doesn't
need to persist a visible selection rectangle across redraws — dragging on a
chart is purely an input gesture: on `'end'`, it sets `xVisible` from
`currentChartXSc.invert(sel)` (a scale ref updated every redraw, same pattern
as the navigator's `currentXSc`) and immediately self-clears via
`.move(null)` under a `suppressChartBrushEvent` guard (to avoid the same
redraw-cascade bug fixed in the navigator). The navigator strip remains the
persistent visual indicator of the current zoom. A plain click (zero-width
drag, `event.selection === null` on `'end'`) is a no-op rather than resetting
`xVisible` — only the "Clear Range" button or an empty drag on the navigator
itself clears the zoom.

The brush overlay (`pointer-events: all`) sits on top of the chart but only
intercepts `mousedown`-initiated drags; passive hover `mousemove` still
bubbles up to the existing tooltip listener on `svgEl` since d3-brush doesn't
bind anything that would stop that propagation outside of an active gesture —
confirmed the existing crosshair/tooltip-on-hover behavior is unaffected.

**App-state shading silently never appeared because the ECP response shape
was wrong.** `EcpClient.queryAppState()` was implemented against an *assumed*
shape (`<channel><channel-state>active</channel-state></channel>`) sourced
from a `WebFetch` summary of Roku's docs prose, never checked against a real
device. The **actual** live response from `GET /query/app-state/<appId>`
(verified via `curl` against the dev Ultra, firmware 15.2.4) is:
```xml
<app-state>
  <app-id>dev</app-id><app-title>Acme</app-title><app-version>3.30.5</app-version>
  <app-dev-id>...</app-dev-id>
  <state>background</state>
  <status>OK</status>
</app-state>
```
and on failure (e.g. querying an app ID other than the dev channel):
```xml
<app-state><app-id>12</app-id><status>FAILED</status><error>Channel access not authorized: 12</error></app-state>
```
The regex was matching a tag (`<channel-state>`) that never appears in the
real response, so `queryAppState()` always fell through to `'unknown'` and no
shading ever rendered, regardless of the collector/webview wiring being
otherwise correct. Fixed by matching `<state>` and additionally requiring
`<status>OK</status>` before trusting it. **Lesson: a docs-derived endpoint
shape is a hypothesis, not a fact — verify against the live device (`curl`)
before shipping the parser, the same standard already applied to chanperf/
sgnodes/r2d2_bitmaps elsewhere in this file.**

## App-state shading UX gap + WSL network isolation gotcha (2026-07-01, same day)

After the `<state>` tag fix above, the user still reported not seeing chart
shading. Two separate things were going on:

1. **WSL cannot reach the Roku device's network at all** (`ENETUNREACH`) even
   though this session's Bash tool (native/git-bash on Windows) reaches it
   fine via `curl`. Confirmed by running the exact `EcpClient.queryAppState()`
   call via `npx tsx` under `wsl.exe bash` — it failed with `ENETUNREACH`,
   while `curl` from the plain Bash tool to the same IP:port succeeded
   immediately. **When verifying ECP/device-reachable code from this
   environment, use the plain Bash tool (or a temporary throwaway `curl`), not
   `wsl.exe bash -lic "... npx tsx ..."`** — WSL's virtual network adapter is
   not bridged to whatever interface has a route to the Roku device's subnet
   (commonly a USB-tethered/ICS-shared adapter that's Windows-host-only). This
   is a tooling gotcha, not a code bug — the actual VS Code Extension Host
   (when running natively on Windows) has the same network access as the
   Windows-side curl, so the collector code itself was not actually broken by
   this.
2. **The real UX gap**: the device's `dev` channel was sitting continuously in
   `background` state for the entire observed session (never transitioned to
   `active`). `computeShadeRanges()`'s logic is correct — it does shade from
   the first "background" sample onward — but when the state never changes,
   the ENTIRE chart is uniformly tinted from the same low alpha (0.14), which
   is visually indistinguishable from "no shading is happening" at a glance;
   the shading only reads as a signal when there's a *transition* to contrast
   against. Fixed two ways:
   - Bumped `C.suspendBg`/`C.suspendInactive` alpha from 0.14 → 0.22 for
     better baseline visibility.
   - Added a persistent toolbar badge (`#app-state-badge`, `updateAppStateBadge()`
     in `webview/main.ts`) showing the live state directly (`● active` /
     `● background` / `● inactive` / `● unknown`), independent of whether a
     transition is visible on the charts — this is the primary fix, since it
     gives an unambiguous signal regardless of shading subtlety or session length.
   - Added an output-channel log line in `DiagnosticsController.startSession()`
     when app-state tracking arms (or is skipped because `resolveApp()`
     couldn't find the sideloaded `dev` channel id), so a user can check
     "Kopytko Diagnostics" output without needing a repro from us.

**Also don't forget**: after any change to `src/client/diagnostics/webview/`,
the compiled `out/diagnostics-webview/main.js` is what the Extension Host
actually loads — a code fix alone does nothing until `npm run compile` runs
AND the Extension Development Host window is reloaded (F5 restart, or
"Developer: Reload Window" if running from a real install). This is an easy
thing to forget to mention when a user says a just-fixed feature "still
doesn't work."

## Confirmed: backgrounding a channel breaks chanperf/sgnodes/debug-console at the device level (2026-07-01)

User reported "you stopped recording when app is in background mode" and
wanted recording to continue regardless. Investigated by live-testing every
data source against the dev Ultra while its sideloaded `dev` channel was
actually in `background` state (confirmed via `/query/app-state/dev`):

| Endpoint | Behavior while backgrounded |
|---|---|
| `GET /query/chanperf` (ECP, mem-cpu) | `<status>FAILED</status><error>Channel not running: active UI</error>` |
| `GET /query/sgnodes/all` (ECP, node-counts) | Same `FAILED`/`Channel not running: active UI` |
| Raw debug console `chanperf`/`r2d2_bitmaps` (port 8080, textures/systemMem) | TCP connect succeeds, but the server sends **zero bytes** back for any command — the request just times out (confirmed via a raw `/dev/tcp` socket test, ruling out a `DebugConsoleClient` framing bug) |
| `POST /sgrendezvous/track` + `GET /query/sgrendezvous` (rendezvous) | Works fine regardless of foreground/background |
| `GET /query/app-state/<id>` (app-state) | Works fine regardless (that's the whole point of the endpoint) |

**Conclusion: this is a Roku OS/ECP platform limitation, not a bug in our
polling code.** Roku suspends a backgrounded channel's SceneGraph render
thread, and chanperf/sgnodes/the raw debug console are read from that thread
— when it isn't the foreground UI, the device has literally nothing current
to report for those specific metrics, and ECP says so explicitly rather than
returning stale data. **No code in this diagnostics stack ever stops or
pauses the session itself when the app backgrounds** — verified by grepping
for any 'background'-conditional stop/pause logic in `diagnosticsController.ts`,
`diagnosticsSession.ts`, and `diagnosticsViewProvider.ts`; there is none. Every
collector (`PollingCollector` subclasses) keeps ticking on its interval
regardless of success/failure, self-healing back to normal once the app
returns to foreground. Rendezvous, app-state, and beacon collection are
completely unaffected by backgrounding, so they keep providing continuous
data even through the gap. The user-visible "recording stopped" impression
was specifically the CPU/Memory/Node/Texture chart lines going flat/gapped
during background — which is exactly what the app-state shading (see above)
is meant to visually explain, not a defect to fix. Documented this clearly in
`docs/diagnostics.md` so it isn't re-investigated as a bug later.

**Tooling gotcha hit while investigating**: `wsl.exe bash -lic "npx tsx ..."`
cannot reach the Roku device's subnet at all (`ENETUNREACH`) even though the
plain Bash tool (native/git-bash on Windows) reaches it fine — confirmed by
running the identical `EcpClient.queryAppState()` call both ways. When
verifying device-reachable code from this environment, use the plain Bash
tool (or throwaway `curl`/`/dev/tcp` probes), not WSL-wrapped Node.

## Foreground/background memory limit lines (2026-07-01)

Added a second reference line to the Memory chart alongside the existing
device-reported foreground limit (`mcLimitMB`, from chanperf's `<limit>`,
labeled "FG Limit"): a "BG Limit" line for Roku's published background-app
DRAM guidance (100 MB, per Roku's Resource Monitor docs — "apps should
consume a maximum of 100 MB of DRAM while running in the background"). Unlike
the foreground limit, **this value is not device-reported** (confirmed
earlier — no ECP/debug-console endpoint exposes it), so it's a new
`kopytko.diagnostics.memoryLimits.backgroundMB` setting (default `100`)
threaded through `WebviewState.backgroundMemLimitMB` rather than parsed from
any device response. Made it a setting rather than a hardcoded constant since
Roku's own docs say this guidance "may be decreased in the near future."

Also renamed the "Max lines" toolbar checkbox to "Helper lines" (now toggles
both memory reference lines plus the texture max line) and gave the memory
chart's two lines explicit distinct labels ("FG Limit"/"BG Limit") instead of
a single generic "Limit" — `drawLimitLine()`'s `label` param was already
overridable per-call, just previously only used with its `'max'` default.

## Recording channels other than "dev" (2026-07-01)

User wanted to profile other installed channels sharing the same developer
key as the sideloaded dev channel (e.g. a "prod tester"/QA build), without
knowing offhand how to enumerate which channels that includes. Found and
verified the mechanism live against the dev Ultra:

**`GET /query/registry/<anyChannelId>` returns a `<plugins>` field listing
every channel id on the device signed with the same developer key** —
identical regardless of *which* of those ids you query it with. Confirmed:
`/query/registry/dev`, `/query/registry/268970` ("Acme - PROD TESTER"), and
`/query/registry/158987` ("Acme Live Sports Streaming") all returned the same
`<plugins>158987,268970,dev</plugins>`. Querying any channel signed with a
*different* key (a regular store app, or e.g. "Binge Tester" id `852522`
which — despite the similar-sounding name — turned out NOT to share the dev
key) instead returns `<status>FAILED</status><error>Specified dev ID does
not match the device key</error>`. This is a real, useful discovery
mechanism, not a guess — **don't assume by app name which channels share a
dev key; only the registry's `<plugins>` list is authoritative** (the Binge
Tester case above is a concrete example of a same-publisher-sounding name
that isn't actually the same signing key).

`parseRegistryXml()` (already existed in `src/client/roku/views/registryProvider.ts`,
used by the Registry tree view) already parses the `<plugins>` field as a raw
comma-separated string — reused directly, no new parser needed.

**Implementation**: `DiagnosticsController` gained:
- `selectedAppId` (private field, default `'dev'`, getter `selectedApp`)
- `setSelectedApp(appId)` — sets the field; if it actually changed *and* a
  session is currently recording, stops that session (never lets a running
  session silently start reflecting a different channel than it began with)
- `listAvailableApps()` — cross-references `queryRegistry(ip, 'dev', port)`'s
  plugins list against `queryApps()` for display names, `dev` always sorted
  first; falls back to `[{id:'dev', ...}]` alone if the registry call fails
  (e.g. no sideloaded channel) or `[]` with no active device
- `resolveApp()` now matches `apps.find(a => a.id === this.selectedAppId)`
  instead of hardcoding `a.id === 'dev'` — this one change is what makes
  `startSession()`, the session manifest, and the `AppStateCollector`'s appId
  all automatically follow whatever channel is currently selected

**Important limitation, called out in `docs/diagnostics.md`**: selecting a
channel here only changes what `resolveApp()`/app-state target — it does
**not** switch the device to that channel. `chanperf`/`sgnodes`/the raw debug
console have no channel-id parameter at all (confirmed much earlier in this
file) and always report whichever channel is the device's *current
foreground UI*, regardless of selection. Only `app-state` (which does take an
explicit app id) actually tracks the selected channel specifically. So
picking a non-dev channel here is meaningful for labeling/app-state, but the
user still has to manually navigate the device to that channel to see real
Memory/CPU/Node data for it.

New protocol messages: `ExtMsg.apps` (sent on panel open/visibility-change,
alongside the existing `sendSessions()` pattern) and `WebMsg.select-app`. New
`WebviewState.selectedAppId` field threads the current selection back so the
webview's dropdown reflects reality after e.g. an app-forced stop.

**Follow-up (same day): channel change now forces a full view reset.**
Initially `'select-app'`'s handler only called `syncSession()` + `sendState()`
after `setSelectedApp()` resolved — this synced the recording flag/device
label but left stale chart/table data and the app-state badge showing the
*previous* channel's last-known values on screen, since nothing told the
webview to actually clear anything (`syncSession()`'s internal `sendState()`
only sends a `'state'` message, not a data reset — the webview only clears
its D3 series arrays and badge inside its `case 'init':` handler, via
`clearData()`). Fixed by having the `'select-app'` handler `post()` a full
`{kind:'init', history: emptyHistory()}` message (same shape used by
`clear-view` and the "New Session while not recording" branch of
`handleNewSession()`) after `setSelectedApp()` resolves — this reuses the
webview's existing `case 'init':` reset path (`clearData()` + `panelMode =
'live'` + re-`applyState()`) rather than inventing a new one, and runs
unconditionally (whether or not a session was actually stopped), since the
requirement is "clear like a diagnostic start" any time the channel changes,
not just when a stop occurred. No change was needed to guarantee a fresh
session file on the next Start — `buildSessionId()` already stamps a new
folder every `startSession()` call, and `stopSession()` clears `this.session`
before returning, so there was never a code path that could reuse or append
to a previous channel's NDJSON files.

## Rendezvous Log sidebar removal + Kopytko Tools nav sidebar (2026-07-01)

**Removed the legacy "Rendezvous Log" sidebar tree view** (redundant now that
the Diagnostics panel's Rendezvous table/chart-overlay/beacon-style markers
cover everything it did). Deleted:
- `src/client/activation/rendezvous.ts`
- `src/client/roku/views/rendezvousTreeProvider.ts`
- `src/client/roku/views/rendezvousTreeItems.ts`
- The `kopytko.rendezvous` view entry, its 3 commands
  (`kopytko.clearRendezvousLog`, `kopytko.navigateToRendezvous`,
  `kopytko.toggleRendezvousSort`), and their menu/commandPalette entries in
  `package.json`

**`RendezvousManager` (`src/client/roku/rendezvous/rendezvousManager.ts`) was
deliberately kept** — `DiagnosticsController.startSession()`/`stopSession()`
call its `suspend()`/`resume()` to avoid two pollers draining the same ECP
event queue (see "Rendezvous and the shared queue problem" above). Its
`setEnabled(true)` is now unreachable (no UI calls it anymore), so
`suspend()`/`resume()` are permanently harmless no-ops going forward — the
double-drain problem this class exists to prevent literally cannot recur
without a second consumer being added, but removing the class outright would
be a needless API break for a small amount of dead-but-harmless surface.
`resolveRendezvousFile()`/`resolveNodeComponentFile()` in
`src/client/roku/util/resolveSourceFile.ts` were also kept — the Diagnostics
panel's tables (`diagnosticsViewProvider.ts`) already depend on them
independently of the tree view, always did.

**Added a "Kopytko Tools" sidebar webview** (`kopytko.nav` view id, in the
`kopytko-sidebar` container, positioned above Roku Devices) with three
buttons that reveal the Diagnostics panel, the Perfetto tab, and the Node
Tree tab:
- `src/client/nav/views/navViewProvider.ts` — `WebviewViewProvider`, no data
  flow, just relays `{kind:'open', target}` to the corresponding
  `vscode.commands.executeCommand(...)` (`kopytko.diagnostics.focus`,
  `kopytko.perfetto.open`, `kopytko.nodes.open`)
- `src/client/nav/webview/main.ts` + `styles.css` — three inline-SVG-icon
  buttons, styled with the exact same `var(--vscode-button-*)` /
  `border-radius: 2px` / `font-size: 11-12px` conventions as the Diagnostics
  webview's toolbar, for visual consistency across the extension's
  inspection tools (per explicit user request)
- New esbuild bundle target `bundle:nav-webview` → `out/nav-webview/`, wired
  into `compile`/`bundle` npm scripts alongside the other 3 webview bundles;
  `src/client/nav/webview/**/*` added to `tsconfig.json`'s exclude list (same
  as the other three webview dirs — browser globals break the server tsconfig)
- `kopytko.diagnostics.focus` is VS Code's auto-generated per-view focus
  command (every `contributes.views` entry — tree or webview — gets one for
  free), not something this extension registers itself; confirmed this
  pattern already existing for `kopytko.diagnostics` before relying on it.

## Perfetto/Node Tree webviews had unstyled/default rendering (2026-07-01)

Both `src/client/perfetto/webview/styles.css` and `src/client/nodes/webview/styles.css`
already existed, fully written (the Perfetto one's header comment literally
says "styles matching the Diagnostics panel for consistency"), and both
`*ViewPanel.ts`/`*Panel.ts` classes correctly `<link>` a `main.css` file. But
**neither `main.ts` entry point imported its own `styles.css`** — unlike the
Diagnostics webview, whose `main.ts` starts with `import './styles.css';`.
esbuild only extracts a CSS bundle from what's actually imported by the JS
entry point; with no import, `out/perfetto-webview/main.css` and
`out/node-tree-webview/main.css` were never generated at all (confirmed:
`wc -c` on those paths → "No such file"), so the `<link href="...main.css">`
in each panel's HTML pointed at a 404 and the webviews rendered with zero
custom styling — plain unstyled HTML. Fixed by adding the missing
`import './styles.css';` to both `main.ts` files. **Any new webview added to
this extension needs that import line, or its styles.css is silently dead
weight** — nothing else fails loudly when it's missing (esbuild doesn't warn
about an unused sibling file, and a 404 `<link>` fails silently in the
webview).

While fixing this, also gave the Node Tree Explorer a status dot + combined
`channel @ ip` device label (it already computed that exact string via
`channelLabel.textContent = ${msg.channelTitle} @ ${msg.device}` — just had no
dot element to sit next to it) matching the Diagnostics/Perfetto toolbar
layout, since Node Tree previously had no live/error indicator at all. Unlike
Diagnostics' red=recording/blue=replay scheme (which describes a recording
session), Node Tree has no session concept — just "did the last fetch
succeed" — so it uses a distinct green=loaded / red=error / pulsing-gray=loading
convention instead of reusing the recording-specific classes verbatim.

## Legend cleanup, beacon-timestamp bug, and Node Tree canvas blur (2026-07-01)

**Removed Rendezvous/Beacon/reference-line entries from all chart legends**
(`legend-mem`, `legend-cpu`, `legend-nodes`, `legend-textures` in `webview/main.ts`)
per explicit user request — they added clutter without adding information
(the overlays/lines are still drawn on the charts and toggleable via the
toolbar checkboxes, just no longer duplicated as legend rows).

**Found and fixed a real bug: framework beacon markers were timestamped at
receipt time, not their actual device-log time.** `FwBeaconCollector` stamped
every sample with `wall: Date.now()` — the moment the collector *processed*
the log line — rather than the time the device actually wrote it. The raw
log line already carries its own timestamp prefix
(`06-26 07:24:26.305 app  [beacon.signal] |...`, format `MM-DD HH:MM:SS.mmm`),
which `parseFwBeaconLine()` previously discarded entirely (its regex only
matched the `[beacon.signal] |Name --> TimeBase(N ms)` portion). Symptom: the
user correctly diagnosed this from just the UI behavior — right when the
Beacons checkbox / `fw-beacon` collector was turned on, any log lines that
had been buffered on the device (or in the TCP receive buffer) before the
connection/collector-start arrived in a burst and all got stamped with
"now," making historical beacons appear to happen at the moment you enabled
tracking instead of their real (earlier) times. Fixed by parsing the log
line's own date-time prefix into a `deviceWall` field (`parsers/fwBeacon.ts`)
and having the collector use that instead of `Date.now()`. The device log has
no year, so the year of a reference `now` (defaults to `Date.now()`,
overridable for tests) is assumed — the only remaining inaccuracy is a
session that happens to straddle a New Year's Eve UTC midnight, not worth
guarding against.

**Node Tree Explorer's canvas rendering was blurry on HiDPI displays / non-100%
zoom** because it had no `devicePixelRatio` handling at all — `resize()` set
the canvas's backing-store resolution (`ic.width`/`ic.height`) directly to
its CSS-pixel display size, so on any display where 1 CSS px maps to more
than 1 physical device pixel, the browser upscales the already-rendered
bitmap to fill the extra physical pixels, blurring both the flame-chart
fills and the text labels. Fixed with the standard canvas-HiDPI pattern:
track `logicalW`/`logicalH` (CSS px — what the D3 partition layout, hit-testing,
and all drawing coordinates use, unchanged) separately from the backing
store, which is now sized to `logical * devicePixelRatio`, with
`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` applied once per resize so all
existing CSS-pixel-coordinate draw calls automatically render at full
physical resolution without needing to touch any of the actual drawing code
(`draw()`/`computeRects()` still just read `logicalW`/`logicalH` where they
used to read `ic.width`/`ic.height`). Mouse hit-testing needed no change —
`event.offsetX`/`offsetY` are already DPR-independent CSS-pixel values.

## Port 8085 (framework beacons) only accepts one consumer at a time (2026-07-01)

User reported rendezvous and beacons "not working," suspecting the Rendezvous
Log sidebar removal broke something diagnostics still depends on. Verified
both independently against the real device:

- **Rendezvous is not broken.** `POST /sgrendezvous/track` → `GET /query/sgrendezvous`
  → `POST /sgrendezvous/untrack` all still succeed exactly as before — the
  diagnostics `RendezvousCollector` never depended on the removed tree view
  or `RendezvousManager` at all, it calls these ECP methods directly. An
  empty Rendezvous table/no overlay markers most likely just means the app
  isn't currently producing render-thread stalls (`<count>0</count>` was the
  live response when tested), not a code regression. `chartExtras()`/
  `drawEventMarkers()`/`showRendezvousOverlay` were all confirmed intact
  after the legend-cleanup edit (that edit only touched `buildLegend(...)`
  calls, not the overlay-drawing functions).
- **Beacons were genuinely broken, for an unrelated reason**: connecting to
  port 8085 directly (`exec 3<>/dev/tcp/<ip>/8085`) returned
  `"Console connection is already in use.\r\n"` instead of the expected
  banner + log stream. **This device port only accepts one consumer
  connection at a time** — same category of problem as the ECP rendezvous
  "shared queue" issue documented above, but for the raw log stream instead.
  Whatever already holds that slot (most likely an active debug session's IO
  channel, which also needs a device console/log connection — see
  `src/client/debug/sessionController.ts`'s `connectIOPort()`, though its
  port comes from a dynamic `IOPortOpened` protocol update rather than a
  hardcoded 8085, so this needs confirming whether it's literally the same
  underlying resource or a separate one) blocks `FwBeaconCollector`'s
  `BeaconLogClient` from ever receiving a real line.
  - **The bug this exposed**: `BeaconLogClient` didn't handle this rejection
    at all — the TCP `connect` succeeds (the device accepts the socket, then
    sends this one line instead of real data), so the client considered
    itself successfully connected forever, silently receiving zero real
    beacon lines with no retry and no visible error anywhere.
  - **Fix**: `BeaconLogClient.onData()` now detects the literal string
    `"Console connection is already in use"`, emits a new `'rejected'` event
    with the line, and destroys the socket to trigger the existing
    disconnect/backoff/retry path (so it keeps trying in case the port frees
    up later, instead of sitting on a dead-but-"connected" socket forever).
    `FwBeaconCollector` re-emits `'rejected'`, and
    `DiagnosticsController.startSession()` logs it to the "Kopytko
    Diagnostics" output channel (same pattern as the existing
    `consoleClient.on('disconnected', ...)` logging) so this is now at least
    diagnosable instead of silently doing nothing.
  - **Not fixed (would need real architecture work)**: this doesn't make
    beacon collection actually **work** while a debug session holds the
    port — it just surfaces the conflict. A real fix would mean sharing the
    device's single console/log connection between the debug session's
    IOClient and the diagnostics FwBeaconCollector (e.g. a shared manager
    that both register with, forwarding lines to whichever consumers want
    them — the same architecture pattern already used for the ECP
    rendezvous queue via `RendezvousManager.suspend()/resume()`), which is
    out of scope for this pass.

## Two more real bugs found after re-testing live (2026-07-01, same day)

User reported "still don't see rendezvous/beacons" after the fixes above.
Re-investigated from scratch rather than trusting the earlier analysis, and
found two more genuine, confirmed bugs:

**1. `RendezvousManager` auto-restores its OWN independent polling from stale
persisted state — with no UI left to turn it back off.** `_initForCurrentDevice()`
(constructor) and `_handleDevicesChanged()` both read
`workspaceState.get('kopytko.rendezvousEnabled')` and call `this.setEnabled(true)`
automatically if a *previous* session (from before the Rendezvous Log sidebar
was removed) had left that persisted flag `true` for the active device. Since
the checkbox/commands that used to let a user turn this back off are gone,
any user who ever had it checked now gets a permanent background poller that
auto-resumes on every extension activation and after every diagnostics
session ends (via `resume()`, since `_enabled` is still `true`), competing
with the diagnostics `RendezvousCollector` for the same drain-on-read ECP
queue between sessions. **Fixed by removing the auto-`setEnabled(true)` calls
entirely** — `_initForCurrentDevice()` and `_handleDevicesChanged()` now only
track `_lastKnownSerial`/reset local state, never resurrecting tracking from
persisted history. `suspend()`/`resume()` (still needed by the diagnostics
controller) are untouched. Updated
`test/roku/rendezvous/rendezvousManager.test.ts`'s "auto-enables on the new
device..." test to assert the opposite (`does NOT auto-enable`), and added an
equivalent construction-time test.

**2. The beacon regex only matched `TimeBase(N ms)`, silently dropping every
`*Complete` beacon.** Re-tested port 8085 live (it had freed up — confirms
the single-consumer theory from the earlier entry was real, and it's whatever
holds that slot, not a code bug, that determines whether beacons are
reachable at all) and captured real traffic:
```
07-01 11:27:13.476 sdkl [beacon.signal] |AppLaunchChainComplete ----> Duration(333 ms)
07-01 11:27:14.035 sdkl [beacon.signal] |VODStartInitiate ----------> TimeBase(376 ms)
07-01 11:27:14.035 sdkl [beacon.signal] |VODStartComplete ----------> Duration(201 ms)
```
**`*Initiate` beacons report `TimeBase(N ms)`; `*Complete` beacons report
`Duration(N ms)`** — two different labels for what's structurally the same
"labeled millisecond count." The regex added earlier today only matched
`TimeBase\(`, so every single `*Complete` beacon (roughly half of all beacon
traffic) was silently discarded (regex just returns `null`, no error). Fixed
by matching `(?:TimeBase|Duration)\((\d+)\s*ms\)` — both captured into the
same `timeBaseMs` field (kept that name to avoid a multi-file rename for a
field that's really just "the reported ms value, whichever label it came
with"). **Lesson: the very first beacon investigation only had one line of a
findings-doc example to go on and never actually saw live `*Complete` traffic
— assumed a shape from a single example instead of confirming it against a
real, varied sample.** This directly contradicts the earlier framing that the
timestamp-prefix fix alone made beacon parsing complete; it did not.

## "New Session" / channel change left old chart data on screen during the async round trip (2026-07-01)

`handleNewSession()` and the `'select-app'` handler both did their reset
(`post({kind:'init', history: emptyHistory()})`) **after** `await`ing the
stop/start (or `setSelectedApp`) work — which involves real network calls to
the device (ECP queries, `enableRendezvousTracking`, etc.) and can take a
noticeable moment. During that window the webview kept rendering the
*previous* session's charts/tables untouched, since nothing told it to clear
until the round trip finished. Fixed by moving the reset `post()` call to
*before* the async work in both handlers, so the panel blanks instantly on
click and the real data streams back in once the new session actually starts
— matching how a user reads "New Session" (immediate, not eventually-consistent).

For `'select-app'` specifically: `DiagnosticsController.setSelectedApp()`
sets `selectedAppId` synchronously before its own internal `await
stopSession()` (by design, from when the multi-channel feature was added —
see the entry above), so calling it *before* building the reset message's
`state` means the immediate reset already reflects the new channel selection
rather than briefly flashing the old one.

**Follow-up (same day): the reset message alone didn't actually clear the
charts.** After the fix above, `clearData()` ran immediately and correctly
emptied all the underlying series arrays — but the D3 lines/areas stayed
visibly rendered on screen anyway. Root cause: `createChart()`'s `redraw()`
computes `hasData = domain && ts.length >= 2` and, when there's no data,
`return`s **before** touching `pathSels`/`areaSels`/`extrasSel`/the axis
groups — it only ever *updates* those elements' `d`/content when there IS
data to plot; it never had a path that explicitly blanks them. So after
`clearData()` (which makes `ts.length === 0`), every subsequent `redraw()`
call hit that early return and left the *previous* session's `<path d="...">`
values completely untouched, with only the "waiting for data" hint text
overlaid on top of the still-rendered old plot. `createNavigator()`'s
equivalent redraw already handled this correctly (`linePaths.forEach(p =>
p.style('display','none'))` before its own early return) — `createChart()`
just never got the matching treatment. Fixed by explicitly clearing
`pathSels`/`areaSels` (`attr('d', '')`), `extrasSel`, and both axis groups
(`selectAll('*').remove()`), plus hiding the cursor crosshair, in that early-return
branch.

## Objects chart + table via ECP app-object-counts (2026-07-02)

Added an "Objects" stacked chart (BrightScript object counts by `<type>`, top-8
+ "Other", cloned from the Nodes-by-type pattern) and an "Objects" table (rows
by type, or `roSGNode:<subtype>` per SceneGraph component), both **hidden by
default** — new event type `object-counts`, `EcpObjectCountsCollector`
(per-app, `EcpClient.queryAppObjectCounts()`), `parsers/ecpAppObjectCounts.ts`.
See `findings/roku-device-api.md` for the endpoint shape. Non-obvious notes:

- **"Off by default" = not in the default-visible chart/table lists, NOT
  `collectors.objectCounts.enabled: false`.** The enabled setting defaults
  `true` so the collector is *built*; `neededTypesFor()` in
  `diagnosticsViewProvider.ts` simply never activates it until the user checks
  the Objects chart/table. This is the same lesson as the 2026-06-30
  beacons/textures bug (a settings-disabled collector makes the webview toggle
  a silent no-op). The webview's *initial* `visibleCharts`/`visibleTables`
  sets in `webview/main.ts` are what actually control the default — the
  `defaultVisibleCharts/Tables` settings only seed the provider's pre-webview
  state; the webview posts its own hardcoded defaults on load and wins.
- **Chart aggregates roSGNode subtypes into one `roSGNode` series; the table
  preserves them as separate rows** (`ingestObjects()` builds the aggregated
  `Map` for `objTypeHistory` while `lastObjectTypes` keeps the raw entries).
  With per-subtype series the top-8 slots would be dominated by SG components
  that the Nodes chart already shows.
- **`MAX_NAV_SERIES` bumped 4 → 5** — the navigator pre-allocates fixed
  `<path>` slots; without the bump a 5th visible chart's headline series is
  silently dropped from the navigator (no error).
- ECP parsers/collectors are deliberately NOT exported via `parsers/index.ts` /
  `collectors/index.ts` — `ecpSgNodes`/`ecpChanperf` and the `Ecp*Collector`s
  are all imported by direct path (only the console-based ones are in the
  index files). Followed the same convention.
- `diagnosticsController.test.ts`'s ecp mock needs a `queryAppObjectCounts`
  stub (rejecting is fine) — without it the collector's tick throws a
  TypeError that PollingCollector swallows, so tests still pass but silently
  exercise nothing.
- The GitHub Pages site had **no Kopytko Diagnostics section at all** on
  `extension.astro` (only Perfetto) — the panel was only mentioned in
  `index.astro`'s feature-card grid. Added a full section (before Perfetto)
  as part of this task; future diagnostics features should update it.
- Live verification gap: the device was unreachable during implementation, so
  the parser is validated against the user-captured curl response only; the
  backgrounded `FAILED` shape is extrapolated from chanperf/sgnodes (see the
  roku-device-api.md entry).

---

## "Missing" app-state badge was a stale-webview glitch, not a code bug (2026-07-03)

User reported the `#app-state-badge` toolbar badge (added 2026-07-01, see above)
was gone. Traced the full path — DOM template in `buildDom()`, CSS classes in
`styles.css`, `ingestAppState()` → `updateAppStateBadge()` wiring, `AppStateCollector`
construction/enable-by-default in `diagnosticsController.ts` and `package.json`'s
config schema, and confirmed `out/diagnostics-webview/main.js` was compiled and
current — everything was intact, no commit ever removed it. Root cause turned out
to be environmental: **VS Code's window came back from a macOS sleep in a bad
state and the webview (which uses `retainContextWhenHidden: true`, see below)
was stuck** — restarting VS Code fixed it immediately, no code change needed.
**Lesson: if a diagnostics-panel feature that provably exists in source/build
appears "gone," ask whether the VS Code window survived a sleep/wake cycle
before assuming a regression** — `retainContextWhenHidden` keeps the webview's
JS execution alive across hide/show, which also means it can carry forward into
a bad state after the host process suspends/resumes, unlike a normal page reload.

## Device Manager webviews (2026-07-06) — patterns that differ from the panels above

The Device Manager (`src/client/deviceManager/`) introduced two webview patterns
not used by the Diagnostics/Perfetto/Deep Linking tools; recorded here because
this file is the de-facto webview-architecture reference:

- **One bundle, four sidebar views.** All four `kopytko.deviceManager.*` webview
  views load the same `out/device-manager-webview/main.js`; the provider stamps
  `<body data-view="remote|entries|scripts|abilities">` and `main.ts` dispatches
  on it. One `DeviceManagerViewProvider` class is instantiated 4× with a `kind`
  param. Saves three esbuild entries + three `compile`/`bundle` chain slots.
- **Sidebar `WebviewView`s do NOT support `retainContextWhenHidden`** (that's a
  `WebviewPanel` option; for views VS Code decides). Collapsing a Device Manager
  view destroys its JS state — so every view re-posts `{kind:'ready'}` on load,
  the provider re-pushes ALL state on `ready` AND `onDidChangeVisibility(visible)`,
  and anything long-running lives host-side (`ScriptRunnerService` owns runs;
  a held remote key gets a safety `keyup` from `onDidDispose`).
- **VS Code re-dispatches webview keyboard events to the workbench**, so
  extension keybindings (`when: kopytko.deviceManager.remoteMode`) fire even
  while the webview has focus. Consequence: the remote view's keydown listener
  must capture ONLY printable characters (→ `Lit_` keypresses) and leave
  arrows/Enter/Escape to the package.json keybindings — handling both in the
  webview would double-send every navigation key.
- **`type`-command override rejected for remote mode**: `registerCommand('type')`
  is exclusive per window (VSCodeVim and rokucommunity's extension already
  register it — a second registration throws) and only fires with a text editor
  focused. setContext + keybindings + webview char capture covers the same need
  without the conflict.
- **JS default-param gotcha in tests**: `makeController(activeDevice = DEVICE)`
  called with an explicit `undefined` still gets the DEFAULT — "no device" test
  fixtures must pass `null`, not `undefined`.
- **Never put `user-select: none` on a webview's `body`** — it propagates into
  the input fields and breaks selecting/copying their text (user-reported on
  the Saved Text entry form, 2026-07-06). Scope it to `button`/labels/toolbar
  elements and explicitly set `input, textarea { user-select: text }`. Note
  the Deep Linking webview never needed `user-select` at all. Related: don't
  `stopPropagation()` keydown events inside webview inputs either — it hides
  them from VS Code's webview keyboard handling (clipboard shortcuts /
  workbench re-dispatch); prefer target checks in the document-level handler.

## Directory layout

**Since 2026-07-03 the transport/parsers/collectors layers live in `packages/roku-device/`
(npm: `kopytko-roku-device`), consumed by the extension as a `file:` dependency** — see
`findings/dev-environment.md` for the build-order rule (edit package → build package → then
root compile/F5). The old convention of keeping ECP parsers/collectors out of the index files
was dropped at extraction: the package's `index.ts` barrel exports everything, including the
`Ecp*Collector`s and ECP parsers.

```
packages/roku-device/src/
  console/
    debugConsoleClient.ts    Resilient TCP to port 8080 (idle-framed, auto-reconnect)
  diagnostics/
    eventModel.ts            DiagnosticEvent/DiagnosticSample union types (device-data shapes)
    parsers/
      consoleResponse.ts     Strip banner + prompts from raw responses
      chanperf.ts            parseChanperf() → ChanperfSample
      sgNodesCounts.ts       parseSgNodesCounts() → SgNodesCounts
      free.ts                parseFree() → FreeSample
      r2d2Bitmaps.ts         parseR2d2Bitmaps() → R2d2Bitmaps
      ecpChanperf.ts / ecpSgNodes.ts / ecpAppObjectCounts.ts   ECP-response parsers
      index.ts               Re-exports all parsers (ECP ones included)
    collectors/
      collector.ts           PollingCollector base class (setInterval, self-healing)
      chanperfCollector.ts   1s interval → mem-cpu events
      nodeCountsCollector.ts 2s interval → node-counts events
      ecpChanperfCollector.ts / ecpNodeCountsCollector.ts / ecpObjectCountsCollector.ts   ECP variants
      rendezvousCollector.ts 1s interval → rendezvous events (via ECP)
      fwBeaconCollector.ts   1s interval → fw-beacon events (via ECP)
      appStateCollector.ts   2s interval → app-state events (via ECP)
      systemMemCollector.ts  5s interval → system-mem events (opt-in)
      textureCollector.ts    5s interval → textures events (opt-in)
      index.ts               Re-exports all collectors

src/client/diagnostics/          (extension side — VS Code glue only)
  session/
    eventModel.ts            Re-exports the package's event types + local STREAM_FILE map, ALL_EVENT_TYPES
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

Solution: `RendezvousManager` (internal coordination class only — its sidebar tree view was removed 2026-07-01, see below) has `suspend()` / `resume()` methods. `DiagnosticsController` calls `suspend()` before starting a session and `resume()` after stopping, so only one poller touches the queue at a time.

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

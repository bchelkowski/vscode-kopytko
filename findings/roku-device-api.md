# Roku Device API — Verified Findings

All findings below were verified live against a **Roku Ultra (model 4850X, firmware 15.2.4.3442, serial X02800C5FKLV)** running a sideloaded DAZN dev app.

> **Code location (since 2026-07-03):** all implementations of these protocols live in
> `packages/roku-device/` (npm: `kopytko-roku-device`) — `EcpClient` in `src/ecp/ecpClient.ts`,
> the port-8080 console in `src/console/debugConsoleClient.ts`, parsers under
> `src/diagnostics/parsers/`, the port-8081 protocol under `src/debug-protocol/`, Perfetto under
> `src/ecp/tracing.ts` + `src/perfetto/webSocketClient.ts`. Old `src/client/…` paths mentioned in
> this file predate the extraction. **Deliberate boundary:** the package is Kopytko-ecosystem-unaware
> (so Kopytko packages can depend on it) — the Kopytko CLI deployer and `.kopytkorc` reader stayed in
> the extension at `src/client/roku/rokuDeployer.ts` / `src/client/roku/kopytkorc.ts`.

---

## Network topology note

**WSL2 cannot reach Windows hotspot devices** (192.168.137.x range). All raw TCP/HTTP probing of the device must be done from native Git Bash or PowerShell, not from WSL2. This affects:
- Testing device connectivity during development
- Running headless verification scripts that talk to the device

The extension itself runs in the VS Code Extension Host on Windows and CAN reach the device fine.

---

## Port 8060 — ECP (External Control Protocol)

Standard Roku HTTP API. All commands are `GET` or `POST`, no auth required for most endpoints.

### Useful ECP endpoints

| Endpoint | Method | Response |
|---|---|---|
| `/query/device-info` | GET | XML: model, firmware, serial, developer-enabled, etc. |
| `/query/active-app` | GET | XML: id, type, version, name of running app |
| `/query/apps` | GET | XML list of installed apps; sideloaded app has `id="dev"` |
| `/query/registry/<channelId>` | GET | XML: app registry; use `channelId=dev` for sideloaded |
| `/query/sgrendezvous` | GET | **Drains** the rendezvous event queue (see below) |
| `/sgrendezvous/track` | POST | Enable rendezvous tracking; returns `<tracking-enabled>true</tracking-enabled>` |
| `/sgrendezvous/untrack` | POST | Disable rendezvous tracking |
| `/launch/<appId>?k=v&…` | POST | Launch/relaunch a channel with deep-link params (`contentId`, `mediaType`, …). 200/204 on success; 404 = not installed; 403 = ECP restricted ("Control by mobile apps" set to Limited). Implemented as `EcpClient.launchApp()`. |
| `/input?k=v&…` | POST | Deliver deep-link params to the **foreground** channel as an `roInput` event — no relaunch, and no app-id parameter exists. Same 403 semantics. Implemented as `EcpClient.sendInput()`. |
| `/query/icon/<appId>` | GET | Channel icon as raw image bytes (`Content-Type: image/png` or jpeg). Implemented as `EcpClient.queryAppIcon()` via `httpGetBuffer` — the string-accumulating `httpGet` corrupts binary bodies, so a `Buffer`-based variant was added to `net/httpClient.ts` (2026-07-03, Deep Linking panel). |

**Live-verified against the Roku Ultra 4850X on 192.168.137.46 (2026-07-04):**
- `POST /launch/dev?contentId=…&mediaType=episode` → `200`, DAZN transitioned to `<state>active</state>` per `/query/app-state/dev` within ~3s.
- `POST /input?contentId=…&mediaType=series` while `dev` was already foreground → `200`.
- `POST /launch/999999999` (unregistered app id) → `404` with an **empty body** — confirms `launchApp`'s error-message formatting must not append a dangling separator when the body is blank (already covered by a unit test, now also confirmed live).
- `GET /query/icon/12` (Netflix) → `200`, `Content-Type: image/jpeg`, real JPEG magic bytes (`ffd8ffe0…`) — confirms icons are not uniformly PNG and `queryAppIcon()`'s header-derived `contentType` (rather than a hardcoded assumption) is required.

### Rendezvous via ECP

**Critical:** `GET /query/sgrendezvous` **drains** the device-side event buffer. Two pollers calling it simultaneously will split the events between them and each will miss half. Always ensure only one poller is active at a time.

Response format when tracking is active and events are queued:
```xml
<sgrendezvous>
  <data>
    <tracking-enabled>true</tracking-enabled>
    <plugin-id>dev</plugin-id>
    <plugin-title>DAZN</plugin-title>
    <drop-count>0</drop-count>
    <count>3</count>
    <item><id>1</id><start-tm>100</start-tm><end-tm>118</end-tm><line-number>42</line-number><file>pkg:/components/Foo.brs</file></item>
    <item>...</item>
  </data>
  <timestamp>1782459942521</timestamp>
  <status>OK</status>
</sgrendezvous>
```

Response when no events:
```xml
<sgrendezvous>
  <data><tracking-enabled>true</tracking-enabled><plugin-id>dev</plugin-id>...<drop-count>0</drop-count><count>0</count></data>
  <timestamp>...</timestamp><status>OK</status>
</sgrendezvous>
```

`drop-count` > 0 means the device buffer overflowed; events were lost. This happens if polling is too slow relative to event rate.

---

### Framework beacons via ECP

**`/fwbeacons` is a first-class ECP endpoint, scoped to a specific app id** (unlike
`/sgrendezvous`, which is channel-agnostic). Confirmed live via curl against a real
device (`POST /fwbeacons/track/dev` then repeated `GET /query/fwbeacons`):

```
curl -d '' "http://192.168.2.2:8060/fwbeacons/track/dev"
```
```xml
<fwbeacons><tracking-enabled>true</tracking-enabled><status>OK</status></fwbeacons>
```

`GET /query/fwbeacons` — same drain semantics as `/query/sgrendezvous`: each call
only returns events since the previous call, and `count` resets to 0 with nothing
new. Every child tag other than the fixed metadata fields
(`tracking-enabled`/`plugin-id`/`plugin-title`/`drop-count`/`interval-drop-count`/
`count`/`timestamp`/`status`) is a named beacon event wrapping its own absolute
epoch-ms `<timestamp>` — no year-guessing needed, unlike the port-8085 log format:

```xml
<fwbeacons>
	<tracking-enabled>true</tracking-enabled>
	<plugin-id>dev</plugin-id>
	<plugin-title>DAZN</plugin-title>
	<drop-count>0</drop-count>
	<interval-drop-count>0</interval-drop-count>
	<count>11</count>
	<app-suspend-initiate><timestamp>1782980508764</timestamp></app-suspend-initiate>
	<app-suspend-complete><timestamp>1782980508849</timestamp></app-suspend-complete>
	<app-launch-chain-initiate><timestamp>1782980513047</timestamp></app-launch-chain-initiate>
	<app-splash-initiate><timestamp>1782980513056</timestamp></app-splash-initiate>
	<app-splash-complete><timestamp>1782980513191</timestamp></app-splash-complete>
	<app-compile-initiate><timestamp>1782980513373</timestamp></app-compile-initiate>
	<app-compile-complete><timestamp>1782980513801</timestamp></app-compile-complete>
	<app-launch-chain-complete><timestamp>1782980513820</timestamp></app-launch-chain-complete>
	<app-launch-complete><timestamp>1782980514114</timestamp></app-launch-complete>
	<vod-start-initiate><timestamp>1782980514080</timestamp></vod-start-initiate>
	<vod-start-complete><timestamp>1782980514288</timestamp></vod-start-complete>
	<timestamp>1782980516220</timestamp>
	<status>OK</status>
</fwbeacons>
```

Note the tag names are hyphenated/lowercase here (`app-launch-complete`), unlike
the port-8085 log format's PascalCase (`AppLaunchComplete`) — they're two
independent device-side representations of the same underlying beacon signal.

**`untrack` is unverified.** Only `track` and `query` were curled live; `POST
/fwbeacons/untrack/<appId>` is inferred by symmetry with `/sgrendezvous/untrack`
and hasn't been independently confirmed. Harmless either way — `FwBeaconCollector`
swallows the result on `stop()`, same as `RendezvousCollector`.

---

### BrightScript object counts via ECP

**`GET /query/app-object-counts/<appId>`** — per-app (like `/query/app-state`,
unlike `/query/chanperf`), no tracking enable/disable needed, plain
request/response (no drain semantics). Returns live BrightScript object
instance counts and memory per type. Response captured live from the dev
device (`curl http://192.168.2.2:8060/query/app-object-counts/dev`):

```xml
<app-object-counts>
<timestamp>1782995684112</timestamp>
<channel-id>dev</channel-id>
<channel-title>DAZN</channel-title>
<channel-version>3.30.5</channel-version>
<objects>
  <objects-count>12589</objects-count>
  <objects-num-bytes-physical>1498532</objects-num-bytes-physical>
  <objects-num-bytes-logical>1413406</objects-num-bytes-logical>
  <objects>
    <object><type>roArray</type><count>1210</count>
      <num-bytes-physical>118644</num-bytes-physical><num-bytes-logical>84208</num-bytes-logical></object>
    <object><type>roSGNode</type><subtype>Font</subtype><count>157</count>
      <num-bytes-physical>6940</num-bytes-physical><num-bytes-logical>6940</num-bytes-logical></object>
    <!-- … one <object> per type, ~85 entries on the DAZN dev app … -->
  </objects>
</objects>
<status>OK</status>
</app-object-counts>
```

Key facts:
- Note the **doubly-nested `<objects>`**: the outer block holds the totals, an
  inner `<objects>` holds the `<object>` list. Regex per `<object>` block
  parses it fine regardless (`parsers/ecpAppObjectCounts.ts`).
- **`<subtype>` appears only on `roSGNode` entries** — one `<object>` block per
  SceneGraph component type (built-in and custom alike, e.g. `Font`,
  `MainScene`, `EventBus`). All other BrightScript types (`roString`,
  `roAssociativeArray`, …) get exactly one block, no subtype.
- Bulk of a real app's objects: `roString` (6746), `roAssociativeArray` (3470),
  `roArray` (1210) — the per-type counts are the leak-hunting signal node
  counts can't provide.
- **Backgrounded-channel behavior is assumed, not yet verified**: expected to
  return `<status>FAILED</status><error>Channel not running: active UI</error>`
  like chanperf/sgnodes, but the device was unreachable when this was
  implemented (2026-07-02) — the `FAILED` shape used in tests is extrapolated
  from the chanperf/sgnodes responses documented above. Verify when the device
  is back.

---

### Remote-control key simulation via ECP (2026-07-06 — NOT yet verified live)

`POST /keypress/{key}`, `POST /keydown/{key}`, `POST /keyup/{key}` — implemented as
`EcpClient.keypress/keydown/keyup` plus `sendText` (sequential `Lit_` keypresses) and
the `EcpKeys`/`textToLitKeys` helpers in `packages/roku-device/src/ecp/keys.ts`.

- Named keys: `Home, Rev, Fwd, Play, Select, Left, Right, Down, Up, Back, InstantReplay,
  Info, Backspace, Search, Enter, FindRemote` + Roku-TV-only `Volume*/Power*/Channel*/Input*`.
- Literal characters: `Lit_` + URL-encoded UTF-8 of ONE code point (`Lit_r`, `Lit_%E2%82%AC`).
  The client must NOT re-encode the key path segment — `textToLitKeys` output is pre-encoded.
- `keydown` holds the key until a matching `keyup` — always pair them (the extension's
  remote view sends a safety `keyup` on webview dispose).
- Docs say all three require "Control by mobile apps" enabled (expect 403 in Limited mode,
  same as `/launch`).

**Verification gap:** the dev device was off-network when this was implemented (full
192.168.0.x sweep found no ECP responder; old IPs 192.168.137.46 / 192.168.2.2 dead).
Everything above is docs-derived. When the device is back, verify live: status codes for
keypress/keydown/keyup, Lit_ typing with the on-screen keyboard open, volume/power
behavior on the non-TV Ultra.

### `GET /query/active-app` and `GET /query/media-player` (2026-07-06 — media-player NOT yet verified live)

- `/query/active-app` → `EcpClient.queryActiveApp()`. `<active-app><app id="dev" type="appl"
  version="…">DAZN</app></active-app>`; the home screen may report `<app>Roku</app>` with no
  attributes (older firmware) — `id` is optional in `ActiveAppInfo`. An earlier live probe
  (2026-07-04, reboot testing) saw `id="562859" ui-location="home"` for the home screen, so
  the attribute set varies by state/firmware — parser only relies on `id/type/version`.
- `/query/media-player` → `EcpClient.queryMediaPlayer()` + `parseMediaPlayerXml()`. Expected
  (docs-derived) shape: `<player error="false" state="play">` wrapping `<plugin bandwidth id
  name/>`, `<format audio captions container drm video/>`, `<position>N ms</position>`,
  `<duration>N ms</duration>`, `<is_live>bool</is_live>`. Parser is deliberately lenient
  (every field optional, `state` defaults `'none'`). **Must be verified against the live
  device during playback before trusting `validate_streaming` assertions in the RASP runner**
  — same lesson as the 2026-07-01 `queryAppState` `<channel-state>` bug: a docs-derived shape
  is a hypothesis, not a fact.

## Port 8080 — SceneGraph Debug Server

**Text-based request/response console.** Send `command\r\n`, read until the device stops sending (idle for ~250ms) — the response ends with a `>` prompt but since `>` appears inside XML responses it cannot be used as a terminator. Use idle-time detection instead.

**Availability:** port 8080 is active whenever a sideloaded developer channel is running. It does NOT require `remotedebug=1` — that flag enables the binary remote debugger on port 8081, which is a different service. Port 8080 (SceneGraph debug console) is a plain text console available to any dev channel without special manifest flags.

**Observed intermittency on Roku Ultra 4850X firmware 15.2.4:** `Test-NetConnection` showed port 8080 OPEN when the dev channel was first queried, then CLOSED minutes later while ECP still reported the same channel as active. The cause is unclear — possibly the channel exited/crashed between the two probes, or the debug console has a connection timeout. The `DebugConsoleClient` auto-reconnects with exponential backoff, so transient closure is handled, but persistent closure means no chanperf/sgnodes data.

The very first response after connecting includes a device banner:
```
X02800C5FKLV (Roku Ultra - 15.2.4.3442)
>
```

This banner appears exactly once. Subsequent responses start directly with the output (preceded by `>`).

### Full command list (from `help`)

```
chanperf [-r <repeat-seconds>]  Show channel CPU and memory usage
sgnodes all | roots | counts | <node-id>  List SceneGraph nodes
sgperf clear | start | report | stop  SceneGraph node operation perf metrics
r2d2_bitmaps                    Enumerate R2D2 bitmaps (GPU textures)
free                            Linux free(1) output (device-wide memory)
loaded_textures [overlay]       Show loaded textures (only when SG screen is displayed)
fps_display [1|0]               Onscreen graphics stats overlay
logrendezvous [on|off]          Turn rendezvous logging on/off via telnet
bsprof-pause / bsprof-resume / bsprof-status  BrightScript profiling
brightscript_warnings <n>       Max BS warnings displayed
press {key}                     Simulate keypress
plugins                         List installed plugins
showkey                         Show current developer key
genkey                          Generate new developer key
target list | <n> | <name>     List/select command execution target
exit / quit / q                 Exit debug terminal
```

### `chanperf` — Per-channel CPU + memory

**This is the primary metric for diagnosing memory growth and CPU spikes.**

```
channel: mem=53920KiB{anon=31968,file=21756,shared=196,swap=0},%cpu=0{user=0,sys=0}
```

All memory values in KiB. `-r N` sends a new line every N seconds (useful for manual monitoring, not needed for polling).

Fields:
- `mem` = total resident memory of the channel process
- `anon` = anonymous/heap memory (allocations, SceneGraph nodes)
- `file` = file-backed memory (code, mmapped assets)
- `shared` = shared memory
- `swap` = swapped-out memory (bad — means device is under pressure)
- `%cpu` = total CPU % used by channel process (user + sys)

### `sgnodes counts` — Node type breakdown

```xml
<sg-nodes>
  <nodes-count>311</nodes-count>
  <nodes-num-bytes-static>179272</nodes-num-bytes-static>
  <nodes>
    <node>
      <type>EventTileModel</type>
      <count>54</count>
      <num-bytes-static>15120</num-bytes-static>
    </node>
    <node>
      <type>BrowsePageNavigationModel</type>
      <count>35</count>
      <num-bytes-static>9800</num-bytes-static>
    </node>
    <!-- ...45 entries total for DAZN dev app... -->
  </nodes>
</sg-nodes>
```

`type` = SceneGraph component name — **includes custom project components** (e.g. `EventTileModel`, `BrowsePageNavigationModel`, `VodEventModel`). This is how you detect node leaks: track count per type over time.

`num-bytes-static` = static allocation bytes for all instances of this type.

### `sgnodes all` / `sgnodes roots` — Full node tree

Returns XML with one element per live node. Very verbose; roots-only (`roots`) is more useful:

```xml
<Root_Nodes node-count="64">
  <MainScene children="0" extends="Scene" focused="true" bounds="{0,0,1920,1080}" _sn="2" osref="4" bscref="2" />
  <NewRelicService extends="Node" _sn="1" osref="2" bscref="18" />
  <DaznAccountEntitlementSetModel extends="Node" name="tier_gold_de" _sn="6" osref="2" bscref="0" />
  <BrowsePageNavigationModel extends="Node" _sn="7" osref="2" bscref="0" />
  <!-- ... -->
</Root_Nodes>
```

Attributes:
- `_sn` = SceneGraph node ID (unique per session)
- `osref` = OS-level reference count
- `bscref` = BrightScript reference count (0 = orphaned, may be a leak)
- `extends` = parent component type in the hierarchy
- `bounds` = visible bounds `{x,y,w,h}` (only on rendered nodes)

### `r2d2_bitmaps` — GPU texture memory

```
RoGraphics instance 0x36f44179
address    width height bpp     size   buf sz  tex  fbo name
0x9668bf69   948    879   4  3440640        0  878    0 /tmp/plugin/JBAAAAfRkde0/pkg:/images/Factory.webp
0x96fafb71  1920   1080   4  8294400  [123184]        ← render target, no name
...
Available texture memory 214125568 used 25874432 max 240000000
```

`size` = bytes allocated for this bitmap. The summary line gives total GPU texture budget usage. `fbo` > 0 means it's a render target (framebuffer object).

### `free` — Device-wide memory

Standard Linux `free` output, values in KiB:
```
              total        used        free      shared  buff/cache   available
Mem:        1504692      424676      689772       12216      390244     1031464
Swap:        370028        7424      362604
```

This is device-wide, not per-channel. Use `chanperf` for channel-specific memory.

### `sgperf` — Node operation profiling

`sgperf start` → ... user navigates app ... → `sgperf report` → `sgperf stop`

Reports per-node-type operation counts (create, field set, observe, etc.). Returns empty when the app is idle. Useful for pinpointing which components generate the most SG operations during user interaction.

### `loaded_textures` — Detailed texture info

Only works when a SceneGraph screen is actively displayed (returns an error otherwise). Shows all currently-loaded textures with dimensions and memory. Less useful than `r2d2_bitmaps` for automated collection.

---

## Port 8085 — BrightScript Log Stream

**Read-only streaming log.** Connect, receive continuous output of `print` statements from the running channel plus system events:

```
[translate] Missing translation for 'railMenu_movies' key
06-26 07:24:26.305 app  [beacon.signal] |AppLaunchInitiate ---------> TimeBase(0 ms)
06-26 07:24:26.429 sdkl [beacon.signal] |AppResumeInitiate ---------> TimeBase(0 ms)
BRIGHTSCRIPT: WARNING: roSGNode.signalBeacon: initiate before signaling AppResumeComplete: pkg:/components/Foo.brs(40)
```

Beacon events (`AppLaunchInitiate`, `AppLaunchComplete`, `AppResumeInitiate`, `AppResumeComplete`, `VODStartInitiate`, `VODStartComplete`, etc.) are particularly useful for measuring performance.

**Cannot send commands to port 8085** — it is output-only. SceneGraph debug commands go to port 8080.

**The extension no longer reads beacons from here.** `FwBeaconCollector` originally
tailed this stream for `[beacon.signal]` lines, but port 8085 accepts only one
consumer at a time — if a debug session's IO channel (or any other tool) already
held it, beacon markers silently stopped appearing with no error surfaced to the
user. Beacons are now collected via ECP (`/fwbeacons/track` + `/query/fwbeacons`,
see below), which has no such exclusivity limit. This section is kept only
because the log format itself is still real/observable on-device.

---

## Port 8089

Open (TCP SYN accepted) but does not respond to any text commands. Purpose unknown; ignore it.

---

## Response parsing notes

All 8080 responses start with the device banner (first connection only), then `>` followed by output. Strip:
1. The banner line: `/^[^\n]*\(Roku[^\n]*\)\r?\n/`
2. The leading `>` glued to output: `/^[ \t]*>+/`
3. The trailing `>` prompt: `/\n[ \t]*>+[ \t]*$/`

XML responses use `>` characters inside tags — never use `>` as a response terminator. Use idle-time detection (250ms default) instead.

Some commands return `Usage: ...` hints if the subcommand is missing or wrong. Check for this before trying to parse the response.

---

## Port 8060 — Perfetto App Tracing (firmware 15.2+)

Roku's ECP port also exposes a native Perfetto tracing interface. The device outputs **standard binary Perfetto protobuf** — no custom format, no conversion needed.

### Control endpoints (HTTP)

| Method | Path | Effect |
|---|---|---|
| `POST` | `/perfetto/enable/{channelId}` | Enable tracing for `channelId` (use `dev` for sideloaded channel). Returns XML. Works even when no channel is running. |
| `POST` | `/perfetto/heapgraph/trigger/{channelId}` | Capture a heap snapshot. Also returns 200 OK even without a running channel. |

**Real device response — `POST /perfetto/enable/dev` (firmware 15.2.4, Roku Ultra 4850X):**
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<perfetto-enable>
  <enabled-channels><channel>dev</channel></enabled-channels>
  <application-already-started>false</application-already-started>
  <timestamp>1782714472826</timestamp>
  <timestamp-end>1782714472827</timestamp-end>
  <status>OK</status>
</perfetto-enable>
```
`application-already-started` = `true` if the channel was already running when you enabled tracing.

**Real device response — `POST /perfetto/heapgraph/trigger/dev`:**
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<perfetto-heapgraph-trigger>
  <timestamp>1782714578745</timestamp>
  <timestamp-end>1782714579359</timestamp-end>
  <status>OK</status>
</perfetto-heapgraph-trigger>
```

### Data stream (WebSocket)

`ws://device:8060/perfetto-session`

- Streams raw binary `TracePacket` proto messages continuously from the moment the connection opens.
- Unmasked binary frames from the server. Standard WebSocket (e.g. the `ws` npm package).
- The device streams until the WS connection is closed. After sending a close frame, allow a 500 ms quiet window before hard-terminating (the device may flush final packets).
- Hard timeout: 3 s max wait before `socket.terminate()`.
- **WS stays open with no data when no channel is running.** The connection does not drop — it just waits. Data starts flowing when a channel with `run_as_process=1` starts.
- **Correct start order:** enable Perfetto → open WS → deploy channel. Opening the WS before deploy ensures trace packets from channel boot are captured.

### Manifest requirement

The channel must be sideloaded with `run_as_process=1` in the local manifest override. This is the same pattern as `remotedebug=1` for debug sessions — inject before deploy, restore after. See `src/client/roku/rokuDeployer.ts` (`deployForPerfetto`).

### Origin trust

The WebSocket streams Perfetto protobuf to a VS Code webview. When posting the buffer to the `ui.perfetto.dev` iframe via `postMessage`, Perfetto shows a "Trust this origin?" dialog on first use because VS Code webviews have a `vscode-webview://` origin (not in Perfetto's trusted list). Click **Always trust** — the trust is stored in the `ui.perfetto.dev` domain's localStorage and persists across sessions.

### Perfetto embedding API highlights

- `iframe.contentWindow.postMessage('PING', 'https://ui.perfetto.dev')` → iframe replies `'PONG'` once ready. Must complete before sending trace data.
- `{ perfetto: { buffer: ArrayBuffer, title: string, keepApiOpen: true, localOnly: true } }` — loads a trace. `keepApiOpen: true` keeps the listener alive for repeated loads (live refresh). `localOnly: true` disables share/download UI.
- `{ perfetto: { timeStart: number, timeEnd: number } }` — scrolls to a time range in seconds (not nanoseconds — URL params use nanoseconds, postMessage uses seconds).
- URL params: `?mode=embedded&hideSidebar=true` — hides sidebar and file-drop zone for a cleaner panel embed.

---

## Port 80 — Developer Web Admin (Installer / Utilities / Packager / Update tabs)

Implemented as `InstallerClient` in `packages/roku-device/src/installer/installerClient.ts`, using new
`httpPostMultipartDigest`/`httpGetBufferDigest`/`buildMultipartBody` primitives added to
`net/httpClient.ts`. **This is port 80, not 8060** — an earlier research pass incorrectly assumed
8060 for this surface; corrected 2026-07-04 by fetching the actual rendered admin pages
(`js/common.js`'s `getAction()` builds each tab's nav link with no port, i.e. same-origin/port-80).

Auth is HTTP Digest (RFC 7616), username always `rokudev`, reusing the existing
`parseDigestChallenge`/`buildDigestAuthHeader` helpers (see `EcpClient.validatePassword` for the
original port-80 digest-auth discovery).

### Endpoint map (confirmed live, Roku Ultra 4850X, firmware 15.2.4.3442, 2026-07-04)

| Action | Method | Path | Key multipart fields | Confirmed success/failure signal |
|---|---|---|---|---|
| Delete dev channel | POST | `/plugin_install` | `mysubmit=Delete` | HTTP 200; `params.messages` contains `{"text":"Delete Succeeded.","type":"success"}` + `{"text":"Uninstall Success.","type":"success"}` (see below) |
| Install/replace dev channel | POST | `/plugin_install` | `mysubmit=Install`, `archive=<zip bytes>` | HTTP 200 in **all** cases — success/failure is only distinguishable via `params.messages` (see below). `mysubmit=Install` works identically for a fresh install AND replacing an already-installed channel — there is no separate `Replace` value on this firmware (contradicting the older `bchelkowski/roku-dev` reference, which is presumably an older firmware). |
| Rekey | POST | `/plugin_inspect` | `mysubmit=Rekey`, `passwd=<signing password>`, `archive=<signed .pkg bytes>` | **Failure path confirmed live**, success path not (would require a real signed `.pkg` for this device's developer key — too risky to improvise). A garbage file + wrong password returned `<font color="red">Invalid file format.: iostream error</font>` — matches `REKEY_MESSAGE_PATTERN` and correctly fails the `=== 'Success.'` check, so `InstallerClient.rekey` throws as expected. The `bchelkowski/roku-dev`-derived pattern is confirmed correct for the failure branch; the literal `"Success."` text on a real successful rekey is unverified. |
| Screenshot (trigger) | POST | `/plugin_inspect` | `mysubmit=Screenshot` | **Confirmed live end-to-end.** Trigger response body contains `<img src="pkgs/dev.jpg?time=1783170127">` (relative URI, double-quoted). `GET /pkgs/dev.jpg?time=...` (same digest auth) returned a real JPEG (200, 15027 bytes). |
| Profiling data | POST | `/plugin_inspect` | `mysubmit=dloadProf` | **Confirmed live end-to-end** (previously fully unverified). See dedicated subsection below. |
| Package (sign) | POST | `/plugin_package` | `mysubmit=Package`, `app_name=<Name/Version>`, `passwd=<signing password>`, `pkg_time=<ms timestamp>` | **Failure path confirmed live**, success path not (requires a real signing password). A wrong signing password returned HTTP 200 with `<font color="red">Failed: Invalid Password.</font>` **and** `params.messages: [{"text":"Failed: Invalid Password.","type":"error"}]` — both `PACKAGE_FAILURE_PATTERN` and `ensureOk`'s messages-array check independently catch this (the messages check runs first, so it's what actually throws). The `<a href="pkgs/....pkg">` success-link pattern is unverified but consistent with the confirmed screenshot/profiling `pkgs/...` link shape. |
| Check for update | POST | `/plugin_swup` | `mysubmit=CheckUpdate` | **Confirmed live.** HTTP 200, `params.messages` is `null`. The response HTML is a **static template** — both the "Software update" and "Failed to check for software update" headline branches are always present in the returned script, gated client-side by a `swup_failed = false === true` literal that is always `false`; the actual update-availability result isn't observable from this HTTP response at all (surfaces only via the device's own System Update UI). `InstallerClient.checkForUpdate` correctly treats HTTP 200 as success — there's nothing else to parse. |
| Reboot | POST | `/plugin_swup` | `mysubmit=Reboot` | **Confirmed live — the device actually reboots.** The POST completes normally with HTTP 200 (`params.messages: null`, same static template as CheckUpdate) — it does **not** drop the connection. Uptime (`GET /query/device-info` → `<uptime>`) read 203s and climbing ~30s later, confirming a real reboot completed within seconds of the trigger; the dev channel (`id="dev"`) survived and `/query/active-app` returned to the home screen (`id="562859"`, `ui-location="home"`) afterward. The reboot was fast enough that 10s-interval HTTP polling never observed a connection failure — `InstallerClient.reboot`'s connection-reset-tolerant catch is a defensive fallback for slower/older firmware, not something this device's reboot actually exercises. |
| Device info / keyed dev ID | GET | `http://<ip>:8060/query/device-info` (no auth) | — | XML `<keyed-developer-id>` — confirmed live (`594b61af2a05f79e1d0f317f230970ea18693957`), already parsed by `EcpClient.queryDeviceInfo`. `InstallerClient.validateKey` is a thin comparison wrapper around this. |

### The real success/failure signal is a JSON `messages` array, not the HTTP status

**Critical, confirmed-live finding:** `/plugin_install` returns **HTTP 200 for both success and failure**. The
actual result is reported in a `params.messages` array JSON-embedded in the page's inline script:

```html
<script>
  var params = JSON.parse('{"messages":[{"text":"...","text_type":"text","type":"success"|"error"|"info"},...],"metadata":{...},"packages":[...]}');
  ...
</script>
```

Real examples captured live:
- Successful delete: `{"text":"Delete Succeeded.","type":"success"}`, `{"text":"Uninstall Success.","type":"success"}`
- Successful fresh install: `{"text":"Application Received: 278627 bytes stored.","type":"success"}`, `{"text":"Install Success.","type":"success"}`
- Re-uploading byte-identical content: `{"text":"Application Received: Identical to previous version -- not replacing.","type":"info"}` — **not an error**, must not be treated as a failure.
- Failed install (bad zip — entries used `\` path separators instead of `/`, produced by PowerShell's `Compress-Archive`/`ZipFile.CreateFromDirectory` on Windows, which is a known non-conformant-zip footgun): `{"text":"Application Received: 278627 bytes stored.","type":"success"}`, `{"text":"Install Failure: Script directory \"/source\" does not exist in plugin.","type":"error"}` — **HTTP status was still 200.**

`InstallerClient` extracts this via `extractWebAdminMessages()` (regex over `JSON.parse('...')`, then
`JSON.parse` the captured JSON text directly — it's valid JSON once un-wrapped from the surrounding
single-quoted JS string) and throws if any message has `type: "error"`, as a check layered on top of
(not instead of) each action's own status/pattern check.

**Confirmed live which endpoints use the `params.messages` JSON mechanism vs. the legacy pattern:**
`/plugin_install` and `/plugin_package` embed `params.messages` (both confirmed — see the endpoint
table above). `/plugin_inspect` (rekey, screenshot, profiling) does **not** — a rekey failure test
(garbage `.pkg` + wrong password) returned a response with zero `JSON.parse(...)` occurrences at all;
instead the error is rendered directly via `Shell.create('Roku.Message').trigger('Set message type',
'error').trigger('Set message content', '...').trigger('Render', node)`, with the same message text
also duplicated into the legacy hidden `<font color="red">...</font>` div (which the page's HTML
explicitly comments as `<!-- Keep it, so old scripts can continue to work -->` — confirming the
legacy pattern is an intentionally-preserved backward-compat path, not a stale artifact). This means
`ensureOk()`'s messages-array check is a genuine no-op (gracefully returns `undefined`) for
`/plugin_inspect` responses — `rekey`/`takeScreenshot`/`downloadProfilingData` rely entirely on their
own pattern matching, which is why confirming those patterns against `/plugin_inspect` specifically
(done above for rekey's failure path, and for screenshot/profiling end-to-end) mattered.

**Zip-building gotcha (verified live):** zip archives must use forward-slash path separators
internally. PowerShell's `Compress-Archive` and `[System.IO.Compression.ZipFile]::CreateFromDirectory`
both produce **backslash**-separated entry names on Windows (a known .NET/PowerShell bug), which the
device's unzip step cannot interpret as directories, causing a silent-looking (HTTP 200) install
failure ("Script directory \"/source\" does not exist"). Building the zip by iterating files and
calling `ZipArchiveMode.Create` + `CreateEntryFromFile(..., relativePath.Replace('\\', '/'), ...)`
directly produces a correct archive. This is a zip-*building* concern for whoever packages the
`archive.zip`/`.pkg` before calling `installChannel`/`rekey` — `InstallerClient` itself just uploads
whatever bytes it's given.

### Profiling data (`mysubmit=dloadProf`) — confirmed live

Not implemented by either reference repo (`bchelkowski/roku-dev`, `getndazn/kopytko-packager`).
Confirmed live in two states:

1. **No profiling data available** (default — the running channel's manifest doesn't opt in):
   trigger response body contains `<font color="red">No profiling data available</font>`, HTTP 200,
   `Content-Type: text/html`.
2. **Profiling data ready** (channel manifest has `bsprof_enable=1` + `bsprof_data_dest=local` — see
   https://developer.roku.com/dev/docs/brightscript-profiler#manifest-entries): trigger response
   contains `<font color="red">Profiling data ready</font>` plus `'<a href="pkgs/channel.bsprof">Download Profile...'`.
   `GET /pkgs/channel.bsprof` (same digest auth) returned HTTP 200 — though `Content-Length: 0` in
   this test, since the profiled channel hadn't actually executed enough BrightScript to generate
   profiler samples (installing it alone isn't enough; the app needs to run for a while, or be
   exited, for the profiler to flush non-empty data). The download filename is a fixed
   `channel.bsprof`, not per-timestamp like the screenshot's `dev.jpg?time=...`.

`InstallerClient.downloadProfilingData()`'s "trigger, then scrape a `pkgs/...` link out of the HTML
response, then GET it" implementation is confirmed correct end-to-end; only the *non-empty content*
of a real profiling run was not exercised (would require driving the sample app through real playback
to accumulate samples, out of scope for this pass).

### Test fixture note

`C:\Projects\rokudev\samples\<category>\<AppName>\` sample BrightScript apps are convenient
`installChannel`/`packageChannel` test fixtures. To test profiling, copy the sample app to a scratch
location first and edit the *copy's* `manifest` (add `bsprof_enable=1`) — do not edit the shared
sample in place, since these are checked-in reference apps other tasks may reuse untouched.

---

## ECP coverage audit against the official docs (2026-07-06)

Compared the full `EcpClient` surface against
https://developer.roku.com/dev/docs/external-control-api. Six methods added to close real gaps;
three endpoints from older third-party writeups were deliberately **not** implemented because they
do not appear anywhere on the current official page — don't re-add them from stale training-data
memory without a fresh check of that page.

### New methods — live-verified 2026-07-06 (Roku Ultra 4850X, 192.168.137.46, firmware 15.2.4.3442)

All six were confirmed against the real device the same day they were added (curl from native
Git Bash — WSL2 still cannot reach this hotspot range, see the network topology note above).

| Method | Endpoint | Verification status |
|---|---|---|
| `exitApp(ip, appId, force?)` | `POST /exit-app/<appId>[/true]` | **Live-verified.** `POST /exit-app/dev` (no force) with DAZN foregrounded → `200`, `<exit-app><status>OK</status></exit-app>`. Device switched to the home screen (`/query/active-app` then reported `Roku Dynamic Menu`), and `/query/app-state/dev` afterward reported `<state>background</state>` — confirms this is an Instant Resume suspend, not a kill, matching the docs. Force (`/true`) variant not exercised (no reason to test destructively once the non-force path was confirmed). |
| `queryTvChannels` | `GET /query/tv-channels` | **Live-verified as expected-404.** Returns HTTP 404 on this Roku Ultra (not a TV model) — confirms `EcpClient`'s throw-on-non-200 behavior fires correctly on real (not just mocked) TV-only-endpoint rejection. The success response shape remains unverified since a Roku TV isn't available to test against. |
| `queryTvActiveChannel` | `GET /query/tv-active-channel` | Same as above — live-verified 404 on non-TV hardware; success shape still unverified, needs a Roku TV. |
| `queryGraphicsFrameRate` | `GET /query/graphics-frame-rate` | **Live-verified**, HTTP 200: `<graphics-frame-rate><fps>59.473724</fps><timestamp>…</timestamp><status>OK</status></graphics-frame-rate>`. Simple enough that a parser could be added later if a consumer needs it (not added — no current caller). |
| `queryR2d2Bitmaps` (ECP) | `GET /query/r2d2-bitmaps` | **Live-verified**, HTTP 200: `<r2d2-bitmaps><timestamp>…</timestamp><channel-id>dev</channel-id><graphics-instances /><status>OK</status></r2d2-bitmaps>` (empty `<graphics-instances />` since DAZN wasn't rendering custom bitmaps at query time). Confirms this is **distinct from** `TextureCollector`'s `r2d2_bitmaps` **telnet console command** (port 8080) — same conceptual data, completely different response format (this is XML with a `<graphics-instances>` wrapper; the console command is plain text parsed by `parseR2d2Bitmaps`). Do not reuse that parser against this endpoint's output. |
| `querySgNodes(ip, port, scope)` scope param + `querySgNodesById` | `GET /query/sgnodes/{all\|roots}` and `GET /query/sgnodes/nodes?node-id=` | **Live-verified.** `roots` scope, HTTP 200: wraps nodes in `<Root_Nodes node-count="30">…</Root_Nodes>` — note the tag name differs from the `all` scope's `<All_Nodes>`, so `parseEcpSgNodes` (which specifically looks for `<All_Nodes>`) **cannot** be reused as-is for `roots`; a caller wanting typed roots data needs its own parser keyed on `<Root_Nodes>`. `querySgNodesById('192.168.1.20', '2')` → HTTP 200, wraps the match in `<Nodes_Nodes node-id="2" node-count="1">…</Nodes_Nodes>` — yet another distinct wrapper tag. Also confirms `test/diagnostics/fixtures/sgnodes-roots.raw.xml` is an **unrelated, still-unused** fixture — it's a port-8080 telnet `sgnodes roots` console dump (plain text, different shape entirely from this ECP endpoint's `<Root_Nodes>` XML). Wiring that fixture up is a separate, still-open gap in the 8080 console path, not something this ECP work touched. |

### Deliberately not implemented — confirmed absent from the current official docs

Checked the full page structure (all H2/H3 headings) on 2026-07-06; none of these appear anywhere:

- **`/search/browse`, `/search/query`** — Roku's own docs state `/search` was **removed as of Roku OS 12.0**. Don't re-add.
- **`/query/screensaver`, `/query/textedit-state`, `/query/audio-device`** — these show up in older third-party/community ECP writeups but are **not present anywhere** on the current official developer.roku.com ECP page (checked both the endpoint tables and every section heading). Do not implement these from memory/training data alone — if a future task wants them, re-fetch the official page first to confirm they've been (re-)documented, or get a live device response sample.
- **ECP-2 WebSocket session/subscription endpoints** (`ecp-session-id` header, subscribe-style session negotiation) — not documented on the official page at all.
- No callbacks: the iframe fires no "loaded" or "ready" events back. The time-range scroll command retries internally (~20×/200 ms) until the trace is ready.

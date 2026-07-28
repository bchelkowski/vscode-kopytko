# Roku Device API — Verified Findings

All findings below were verified live against a **Roku Ultra (model 4850X, firmware 15.2.4.3442, serial X02800C5FKLV)** running a sideloaded Acme dev app.

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
- `POST /launch/dev?contentId=…&mediaType=episode` → `200`, Acme transitioned to `<state>active</state>` per `/query/app-state/dev` within ~3s.
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
    <plugin-title>Acme</plugin-title>
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
	<plugin-title>Acme</plugin-title>
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
<channel-title>Acme</channel-title>
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
    <!-- … one <object> per type, ~85 entries on the Acme dev app … -->
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
  version="…">Acme</app></active-app>`; the home screen may report `<app>Roku</app>` with no
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

### `GET /query/app-ui` — rendered UI node tree (2026-07-16, live-verified)

Implemented as `EcpClient.queryAppUi()` + CLI op `app-ui`. Returns the **rendered UI tree of the
foreground app** — the same hierarchy `sgnodes all` shows, but only what the screen is actually
displaying, wrapped differently and with different attributes:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<app-ui>
	<status>OK</status>
	<topscreen>
		<plugin id="dev" name="Acme" />
		<screen type="SGScreen" focused="true">
			<MainScene children="0" extends="Scene" focused="true" focusable="true" rcid="0" bounds="{0, 0, 1280, 720}">
				<AppView children="6" extends="AcmeGroup" name="app" ... index="0">
				...
```

Key differences from `/query/sgnodes/all` (both verified against the same live app state):
- Wrapper is `<app-ui><status/><topscreen><plugin/><screen>` — **no** `<channel-title>`, no
  `node-count` attribute, no `<timestamp>`. Channel name is the `<plugin name="...">` attribute.
- Nodes carry `index` (child position) and rendered attrs like `text`, `bounds`, `translation` —
  but **no `_sn`/`osref`/`bscref`** reference-count attributes.
- **Failure is in-band with HTTP 200**: with no dev app running the body is
  `<app-ui><status>FAILED</status><error>No active app</error></app-ui>` — `queryAppUi()` detects
  `<status>FAILED</status>` and throws with the `<error>` text (`app-ui: No active app`).
- `query/api-ui` (a plausible misremembering of the path) is a plain **404** — as are
  `query/ui`, `query/apiui`, `query/api_ui`, `query/screen`, `query/focus` (all probed live).

Also verified the same day: `?count_only=true&sizes=true` on `/query/sgnodes/all` is **ignored**
by firmware 15.2.4 — the response is byte-for-byte identical with or without the params, so they
were deliberately not added to `querySgNodes`. Both sgnodes scopes wrap the tree in an outer
`<sgnodes>` element carrying `<timestamp>/<channel-id>/<channel-title>/<channel-version>` before
the `<All_Nodes>`/`<Root_Nodes>` container.

---

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

**Parallel connections to 8080 work (2026-07-27).** Repeated independent TCP connections each received
their own `X02800C5FKLV (Roku Ultra - 15.2.4.3442)` banner and `>` prompt and answered commands normally,
including while other sessions were open. The Kopytko Console therefore does **not** take `diagnosticsLock`
— a recording and a console session can coexist. (Not stress-tested beyond a handful of concurrent
sessions; if interference ever shows up, the fix is to extend `DiagnosticsLockOwner` with `'console'` in
`src/client/diagnostics/diagnosticsLock.ts`.)

### Full command list — captured live from `help` (firmware 15.2.4.3442, 2026-07-27)

```
? [str]                 Display the help.
brightscript_warnings <num-warnings> Set the maximum number of brightscript warnings displayed
bsprof-pause            Pause BS profiling
bsprof-resume           Resume BS profiling
bsprof-status           Get BS profiling status
chanperf [-r <repeat-seconds>] Show channel CPU and memory usage
clear_launch_caches     Clear all caches that can affect channel launch time
exit                    Exits the debug terminal.
fps_display             display onscreen graphics statistics [1|0].
free                    Return the output of the free(1) command
genkey                  Generate a new developer key.
help [str]              Display the help.
loaded_textures [overlay] Show loaded textures (default main RenderContext)
logrendezvous [on|off]  Turn Rendezvous Logging on or off
plugins                 Show list of all installed plugins.
press {hudrlsp<fb>yikoteacn} Simulate a keypress. (no param lists keys)
quit                    Exits the debug terminal.
q                       Exits the debug terminal.
r2d2_bitmaps            Enumerate R2D2 bitmaps
remove_plugin           Remove a plugin from the account and device.
sgnodes                 List SceneGraph nodes.
sgperf                  SceneGraph node operation performance metrics.
showkey                 Show the current developer key.
target list | <n> | <name> | -p <pid>) List or select command execution target
type                    Send a literal text sequence.
```

Deltas against the older capture recorded further below, and against Roku's published docs:
- **New here, absent from the older `help`:** `?` (alias of `help`), `clear_launch_caches`, `type`.
- **`sgversion` is documented by Roku but is NOT in this firmware's `help`.** Kept in the command catalog
  anyway — a missing help entry is not proof the command is gone — but treat it as unconfirmed.
- `chanperf` answers immediately with a single line and a `>` prompt:
  `channel: mem=61608KiB{anon=40436,file=20972,shared=200,swap=0},%cpu=0{user=0,sys=0}`

### Older capture of the same list

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
    <!-- ...45 entries total for Acme dev app... -->
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
  <AcmeAccountEntitlementSetModel extends="Node" name="tier_gold_de" _sn="6" osref="2" bscref="0" />
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

## Port 8085 — BrightScript Runtime Console

> **Correction (2026-07-27).** This section previously asserted "Cannot send commands to port 8085 — it is
> output-only." That is **wrong as a general statement**. Roku's own debugging docs
> (https://developer.roku.com/dev/docs/debugging) document port 8085 as *"the BrightScript runtime
> environment"* with ~22 interactive commands (`bt`, `bsc`, `bscs`, `brkd`, `classes`, `cont`/`c`, `down`/`d`,
> `gc`, `help`, `last`/`l`, `list`, `next`/`n`, `over`, `out`, `print`/`p`/`?`, `step`/`s`/`t`,
> `threads`/`ths`, `thread`/`th`, `up`/`u`, `var`, `exit`). The original observation was almost certainly
> made while the channel was *running* — 8085 only presents a `BrightScript Debugger>` prompt once execution
> stops on a crash or a break, and typing into it at any other time does nothing visible.
>
> **Verified live 2026-07-27** (Roku Ultra 4850X, firmware 15.2.4.3442, 192.168.137.46, dev channel running,
> probed from native PowerShell — WSL2 still cannot reach this hotspot range):
>
> - **8085 accepts a TCP connection and streams, but ignores input while the channel runs normally.**
>   Sending `help\r\n` and `bt\r\n` produced **zero bytes** of response over a 2.5 s window each. So the
>   original "output-only" note was right about the *common* case and wrong as a general rule — the command
>   set exists, but only behind a `BrightScript Debugger>` prompt.
> - **Still unverified:** the stopped/crashed state itself. Reproducing it needs a channel that throws, which
>   was out of scope for this pass. Before trusting the 8085 input path, force a runtime error and confirm
>   the prompt appears and `bt` returns a backtrace. Also still open: whether a `remotedebug=1` debug session
>   takes the port away.
>
> **8085 replays a backlog on connect.** Every fresh connection re-sends the channel's log from launch
> (~84 lines on the test app) before any live output. Two consecutive connects returned byte-identical
> content. Consumers must expect a burst at connect time, and "no new lines for N seconds" does not mean
> the connection is dead.

**Streaming log, plus an interactive prompt when stopped.** Connect and receive continuous output of `print`
statements from the running channel plus system events:

```
[translate] Missing translation for 'railMenu_movies' key
06-26 07:24:26.305 app  [beacon.signal] |AppLaunchInitiate ---------> TimeBase(0 ms)
06-26 07:24:26.429 sdkl [beacon.signal] |AppResumeInitiate ---------> TimeBase(0 ms)
BRIGHTSCRIPT: WARNING: roSGNode.signalBeacon: initiate before signaling AppResumeComplete: pkg:/components/Foo.brs(40)
```

Beacon events (`AppLaunchInitiate`, `AppLaunchComplete`, `AppResumeInitiate`, `AppResumeComplete`, `VODStartInitiate`, `VODStartComplete`, etc.) are particularly useful for measuring performance.

### Real line shapes on 8085 (captured 2026-07-27)

Worth knowing when writing any classifier over this stream. Only *some* lines carry the
`MM-DD HH:MM:SS.mmm <thread>` prefix — beacon lines do, ordinary `print` output does not:

```
07-27 15:01:19.438 sdkl [beacon.signal] |AppLaunchChainComplete ----> Duration(-131286 ms)
07-27 15:01:19.948 sdkl [beacon.signal] |VODStartComplete ----------> Duration(237 ms)
-------------------- new Roku Analytics node created --------------------
 [Info.OneTrust] |OT SDK version = 202606.1.0
 [Success.NetworkRequestHandler] |banner Api Success
 [Warning.MultiProfile] |Multi Profile Consent is disabled.
 [Failed.NetworkRequestHandler] |OT Post API Failure = saveandlogconsent
[translate] Missing translation for 'railMenu_movies' key
buildUrl: 'params' param is ignored because it can't be converted to string
```

Key points:
- **Bracketed level tags (`[Info.X]`, `[Warning.X]`, `[Failed.X]`, `[Success.X]`) are an app-logger
  convention, not a Roku one**, but they are common enough that `lineClassifier.ts` matches
  `[Error|Failed|Failure|Fatal…]` → error and `[Warning|Warn…]` → warning. Note the **leading space**
  before the bracket on these lines.
- A beacon `Duration(-131286 ms)` can legitimately be **negative** — do not assume monotonic timing.
- Multi-line dumps appear inline: `header parameters = <Component: roAssociativeArray> =` followed by a
  brace block. The `<Component: …>` line trips a naive "starts with `<`" XML check.

### `logrendezvous` produces no console output (2026-07-27, verified)

`logrendezvous on` on port 8080 returns `logrendezvous: rendezvous logging is on`, but **no rendezvous
lines then appear on 8085 or 8080** — checked over a 16 s window on 8085 and 9 s on 8080 while driving the
UI with ECP keypresses. Rendezvous data reaches the extension only through ECP `/query/sgrendezvous`
(see above), which is what `RendezvousCollector` already uses.

Consequence: **do not build console features around rendezvous log lines.** A rendezvous severity class and
filter chip were built into the Kopytko Console and then removed once this was measured.

**SceneGraph debug commands go to port 8080, not 8085** — the two consoles have disjoint command sets
(`chanperf`/`sgnodes`/… on 8080, `bt`/`var`/`print`/… on 8085). See the correction at the top of this
section regarding 8085's interactivity.

**Port 8085 accepts a single consumer at a time.** This is why `FwBeaconCollector` was moved off it (see
below) and why the Kopytko Console surfaces a "held by another consumer" hint after two consecutive failed
connects instead of retrying forever.

### Retired ports (do not implement)

Roku's debugging docs state that **ports 8089–8093 are no longer used as of Roku OS 7.5+**. Port 8087 is
documented as the screensaver thread's console (same command surface as 8085) and is deliberately out of
scope for the Kopytko Console. Port 8089 was separately observed open-but-inert on firmware 15.2.4 (see
below) — consistent with it being retired.

**The extension no longer reads beacons from here.** `FwBeaconCollector` originally
tailed this stream for `[beacon.signal]` lines, but port 8085 accepts only one
consumer at a time — if a debug session's IO channel (or any other tool) already
held it, beacon markers silently stopped appearing with no error surfaced to the
user. Beacons are now collected via ECP (`/fwbeacons/track` + `/query/fwbeacons`,
see below), which has no such exclusivity limit. This section is kept only
because the log format itself is still real/observable on-device.

---

## Port 8081 — Socket-based debug protocol (binary)

Enabled by `remotedebug=1` in the manifest. `remotedebug_connect_early=1` additionally makes the
device stop before the first BrightScript statement. Implementation lives in
`packages/roku-device/src/debug-protocol/`.

The handshake layout below is **verified** against a 3.5.0 device (2026-07-28). The out-of-state
command behaviour is still inferred from the reported `read ECONNRESET` on resume (2026-07-27) —
confirm it with `kopytko.debug.trace: "verbose"` and record the actual bytes here.

### The device resets the connection on out-of-state commands

`read ECONNRESET` on 8081 is a TCP RST **from the device**, not something the extension does. The
Roku debug daemon accepts most commands only while the target is stopped; sending one while the
channel is running is answered with a reset on at least some firmware rather than the documented
`NOT_STOPPED` (error code 4).

This is far worse than it sounds: when the socket dies while the channel is *stopped at a
breakpoint*, nothing is left alive to send `CONTINUE`, so the app freezes on the TV permanently.
"Debugger disconnected" and "app hangs" are one bug, not two.

Commands that require the stopped state: `CONTINUE`, `STEP`, `THREADS`, `STACKTRACE`, `VARIABLES`,
`EXECUTE` (see `DebugCommands.STOPPED_ONLY_COMMANDS`). Breakpoint add/remove is treated the same way
and deferred to the next stop. `STOP` and `EXIT_CHANNEL` are always legal.

The trap is that VS Code issues `stackTrace` on its own schedule when refreshing the call-stack
view, so a guard on *one* handler is not enough — every handler that touches the device needs the
same check. `_onStackTrace` was the one that lacked it.

### `remotedebug_connect_early` glues the initial stop to the handshake

The device is already stopped when the TCP connection opens, so its first `ALL_THREADS_STOPPED`
normally arrives in the **same TCP segment as the handshake response**. `ProtocolClient` drains
those leftover bytes synchronously *before* `connect()` resolves, which means any state a caller
wants to arm for that update must be set **before** awaiting `connect()`. Setting it after the
await looks correct and is silently too late — `settleResolve` only schedules a microtask.

### Framing

Protocol 3.0.0+ prefixes every packet (responses *and* updates) with `uint32 packet_length`, which
**includes its own 4 bytes**. `request_id == 0` discriminates a device update from a response.
Minimum valid packet is 12 bytes (`packet_length` + `request_id` + `error_code`); an update is 16
(plus `update_type`).

A desync is unrecoverable by scanning — there is no sync marker in a purely length-prefixed
protocol, and dropping a byte at a time just re-reads garbage as a huge length and stalls forever.
The only useful responses are (a) discard the buffer and realign on the next read, and (b) keep the
socket open regardless, because a live socket still carries `CONTINUE` even when replies are
unparseable.

### Handshake `remaining_packet_length` COUNTS ITSELF (verified, 2026-07-28)

Observed protocol version on the dev device is **3.5.0**, not 3.3.0.

```
offset  size  field
     0     8  magic  (b'bsdebug\0' as LE uint64)
     8     4  major                      = 3
    12     4  minor                      = 5
    16     4  patch                      = 0
    20     4  remaining_packet_length    = 12   ← counts itself
    24     8  platform_revision_timestamp
   ---- 32 bytes total ----
```

So the handshake ends at `20 + remaining_packet_length`, **not** `20 + 4 + remaining_packet_length`.
Getting that wrong over-consumes by exactly 4 bytes, and because `remotedebug_connect_early` glues
updates to the handshake, those 4 bytes are the `packet_length` of the next packet. The framer then
reads that packet's `request_id` — which is **0** for updates — as a packet length, and the session
dies at connect with `Invalid packet length: 0`. Symptom: the app never launches at all.

Two device logs pinned this down without any capture, purely from the discarded-byte counts:
`discarded 16 bytes` = a 20-byte `IO_PORT_OPENED` minus the 4 eaten; `discarded 43 bytes` = that
plus a 27-byte `ALL_THREADS_STOPPED` carrying a 5-char stop-reason detail.

The initial burst on connect is `IO_PORT_OPENED` **then** `ALL_THREADS_STOPPED`, both glued to the
handshake in the same TCP segment.

Watch the test fixtures here: `buildHandshakeResponse()` encoded `remaining_packet_length` as **8**
for a long time, and 8 is the single value at which the wrong formula lands on the right offset —
so the fixture actively concealed the bug. It now encodes 12, and
`packages/roku-device/test/debug-protocol/protocolClient.test.ts` asserts
`20 + remaining_packet_length === handshake.length` plus a glued-updates case that reproduces the
exact 43-byte failure.

### Payload field widths

`stop_reason` in `ALL_THREADS_STOPPED` / `THREAD_ATTACHED` is a **uint8**, not a uint32
(`int32 thread_index`, `uint8 stop_reason`, `utf8z detail`). The package test fixture encoded it as
uint32 for a long time; because the fixture was only ever read back by the fixture, nothing caught
it. Fixed 2026-07-27.

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
| `exitApp(ip, appId, force?)` | `POST /exit-app/<appId>[/true]` | **Live-verified.** `POST /exit-app/dev` (no force) with Acme foregrounded → `200`, `<exit-app><status>OK</status></exit-app>`. Device switched to the home screen (`/query/active-app` then reported `Roku Dynamic Menu`), and `/query/app-state/dev` afterward reported `<state>background</state>` — confirms this is an Instant Resume suspend, not a kill, matching the docs. Force (`/true`) variant not exercised (no reason to test destructively once the non-force path was confirmed). |
| `queryTvChannels` | `GET /query/tv-channels` | **Live-verified as expected-404.** Returns HTTP 404 on this Roku Ultra (not a TV model) — confirms `EcpClient`'s throw-on-non-200 behavior fires correctly on real (not just mocked) TV-only-endpoint rejection. The success response shape remains unverified since a Roku TV isn't available to test against. |
| `queryTvActiveChannel` | `GET /query/tv-active-channel` | Same as above — live-verified 404 on non-TV hardware; success shape still unverified, needs a Roku TV. |
| `queryGraphicsFrameRate` | `GET /query/graphics-frame-rate` | **Live-verified**, HTTP 200: `<graphics-frame-rate><fps>59.473724</fps><timestamp>…</timestamp><status>OK</status></graphics-frame-rate>`. Simple enough that a parser could be added later if a consumer needs it (not added — no current caller). |
| `queryR2d2Bitmaps` (ECP) | `GET /query/r2d2-bitmaps` | **Live-verified**, HTTP 200: `<r2d2-bitmaps><timestamp>…</timestamp><channel-id>dev</channel-id><graphics-instances /><status>OK</status></r2d2-bitmaps>` (empty `<graphics-instances />` since Acme wasn't rendering custom bitmaps at query time). Confirms this is **distinct from** `TextureCollector`'s `r2d2_bitmaps` **telnet console command** (port 8080) — same conceptual data, completely different response format (this is XML with a `<graphics-instances>` wrapper; the console command is plain text parsed by `parseR2d2Bitmaps`). Do not reuse that parser against this endpoint's output. |
| `querySgNodes(ip, port, scope)` scope param + `querySgNodesById` | `GET /query/sgnodes/{all\|roots}` and `GET /query/sgnodes/nodes?node-id=` | **Live-verified.** `roots` scope, HTTP 200: wraps nodes in `<Root_Nodes node-count="30">…</Root_Nodes>` — note the tag name differs from the `all` scope's `<All_Nodes>`, so `parseEcpSgNodes` (which specifically looks for `<All_Nodes>`) **cannot** be reused as-is for `roots`; a caller wanting typed roots data needs its own parser keyed on `<Root_Nodes>`. `querySgNodesById('192.168.1.20', '2')` → HTTP 200, wraps the match in `<Nodes_Nodes node-id="2" node-count="1">…</Nodes_Nodes>` — yet another distinct wrapper tag. Also confirms `test/diagnostics/fixtures/sgnodes-roots.raw.xml` is an **unrelated, still-unused** fixture — it's a port-8080 telnet `sgnodes roots` console dump (plain text, different shape entirely from this ECP endpoint's `<Root_Nodes>` XML). Wiring that fixture up is a separate, still-open gap in the 8080 console path, not something this ECP work touched. |

### Deliberately not implemented — confirmed absent from the current official docs

Checked the full page structure (all H2/H3 headings) on 2026-07-06; none of these appear anywhere:

- **`/search/browse`, `/search/query`** — Roku's own docs state `/search` was **removed as of Roku OS 12.0**. Don't re-add.
- **`/query/screensaver`, `/query/textedit-state`, `/query/audio-device`** — these show up in older third-party/community ECP writeups but are **not present anywhere** on the current official developer.roku.com ECP page (checked both the endpoint tables and every section heading). Do not implement these from memory/training data alone — if a future task wants them, re-fetch the official page first to confirm they've been (re-)documented, or get a live device response sample.
- **ECP-2 WebSocket session/subscription endpoints** (`ecp-session-id` header, subscribe-style session negotiation) — not documented on the official page at all.
- No callbacks: the iframe fires no "loaded" or "ready" events back. The time-range scroll command retries internally (~20×/200 ms) until the trace is ready.

---

## RALE TrackerTask wire protocol (2026-07-17, verified against TrackerTask v3.2.0 source)

The RALE TrackerTask ships as readable BrightScript inside the app package
(a `TrackerTask.xml` component), so the whole protocol is inspectable — everything
below was read directly from a real v3.2.0 copy, not inferred. Client
implementation: `packages/roku-device/src/rale/` (`RaleTrackerClient` + the
`frame.ts` codec). The community gist `jeanbenitez/e3775db60ed65867be76cbe5cff8ef2b`
matches what we verified.

### Activation — the task listens, but only after an ECP poke

The task's `tracker()` loop blocks on `wait(0, inputPort)` for an `roInputEvent`.
Send ECP `POST /input?rale=true&port=<N>` (any non-Invalid `rale` value works;
`port` picked from the task's configured 49152–65535 range). The task then:

- **Refuses non-dev channels** unless the input also carries `nonDev=true`
  (`appInfo.IsDev()` check) — sideloaded dev builds are fine.
- Opens an `roStreamSocket`, `listen(4)` **on the device** at `<N>`, and waits
  **3000 ms** for the first socket event; no event → socket closed, back to
  waiting for ECP input. So activation → TCP connect → `init` must be one fast
  sequence. After any disconnect the task loops back to waiting for ECP input —
  re-activation always works, no reboot needed.

### Framing

- **Client → device**: `[start]{"uuid":"…","command":"…","args":{…}}[end]` — plain
  JSON inside the markers. The device splits its buffer on `[start]` and strips
  `[end]`, then `ParseJson`s each piece; a piece that fails to parse is silently
  dropped (**no error response**). The receive loop reads ≤16 KB per 10 ms burst —
  keep requests small, and **always include `args`** (handlers dereference it
  unguarded; a missing `args` would crash the task thread).
- **Device → client**: `[start][uuid:<len>]<uuid><json>[end]`, where `<len>` is the
  uuid's character count. Large responses arrive in multiple TCP packets — buffer
  until `[end]`. Errors are in-band: `{"error":{"message":"…"}}`.

### Session/command semantics (the non-obvious parts)

- First command must be `init`. Response: `{raleVersion, sessionid}`. Side effects:
  appends a SelectorView + Guides node to the scene (so later `/query/app-ui`
  fetches show extra RALE nodes at the scene-children tail) and re-arms selector
  drawing. Send `{logVerbosity: -1}` in init args — the handler does
  `if args.logVerbosity >= 0` and BrightScript's Invalid-vs-integer comparison is
  a runtime hazard; -1 skips it safely.
- **`setField` has no path argument** — it writes to `m.currentNode`, whatever the
  last `selectNode {path}` selected. The apply sequence is always
  `selectNode` → `setField`. Conveniently `selectNode` returns
  `{path, node: {item: {subtype, id, childrenCount, …}}}` — use it to verify the
  target before writing.
- `selectNode` also draws a red selector rectangle on the TV unless
  `hideSelectorView` was called after init (the `m.showSelectorView` gate).
- Paths are arrays of `{child: index}` (or `{field: "name"}` for descending into
  AA/array fields), rooted at `m.top.GetScene()`. The ECP app-ui XML nests
  `<topscreen><screen><SceneSubtype>…` — so an app-ui child-index chain maps to a
  RALE path by dropping the leading segment (the scene element itself).
  `appUiPathToRalePath()` in `src/client/nodes/nodeTreePanel.ts` does exactly
  that; the selectNode subtype check catches any drift.
- `setField` args: `{field, value}` with optional `type`. **Omit `type`** when the
  field already exists: with a type the task does `removeField` + `addField` when
  the declared type differs from `getFieldType()` (churn, and removeField fails on
  built-in interface fields anyway); without it, it's a plain
  `setFields({field: value})` and SceneGraph coerces the JSON-native value.
  Recognized `type` aliases (`RALE_parseType`): int/num/number→integer,
  roFloat→float, text/str→string, boolean→bool, roSGNode→node ("node" **creates a
  new node** of subtype `value`!), array/arr, object/associativearray→assocarray.
- Command map (v3.2.0): init, show/hideSelectorView, selectNode, updateNode,
  getNodeData, getItemList, getNodeTree, getNodeById, getNodeByName, addChild,
  removeChild, moveChild, setField, removeField, setFocus, selectFocusedNode,
  setBoundingRect, registry ops, ruler ops, setLogVerbosity/Format, log.
- **Response key casing is inconsistent — dot-notation keys arrive lowercase.**
  BrightScript stores AA keys assigned via dot notation in lowercase, and the
  TrackerTask mixes literal AAs (`{item: …}` → `"item"`) with dot assignments
  (`item.childList = …` → serialized as `"childlist"`; `result.childlist`,
  `"fieldlist"`, `"layout"` likewise lowercase). So `getItemList` responds with
  `"childlist"`, NOT `"childList"`. This bit us for real: the resolver read
  `.childList`, got undefined, and every apply failed with "Could not locate
  <AppView>". `RaleTrackerClient.getItemList` normalizes (accepts both
  casings, since key style could drift across TrackerTask versions).
  PowerShell-based protocol probing does NOT catch this class of bug —
  PS property access is case-insensitive.

### Two on-device gotchas (2026-07-17, found in live testing)

- **Reconnect = reuse the original port; activation only works once per app
  launch on newer tasks.** Verified live against TrackerTask **v3.4.0** (note:
  the version on the device can differ from the copy in the repo — v3.4.0 was
  running while the local TrackerTask.xml said 3.2.0): once a client has
  connected, the serve loop **never exits** — not on graceful FIN, not on RST.
  The listener stays alive on the original port serving new connections
  (re-`init` on it works, same sessionid), while the task never returns to
  `wait(0, inputPort)`, so re-activation on a *new* port is silently ignored.
  Client strategy (implemented in `RaleTrackerClient`): try a **direct TCP
  connect + init to the last session's port first** (`reusePort` option; the
  panel persists it in `globalState` per device ip), fall back to the ECP
  activation flow. On older v3.2.0-style tasks the loop DOES exit on a socket
  *error* (`if closed or not connection.eOK()` — `closed` is a dead local, and
  a graceful FIN doesn't trip `eOK()`), so `teardown()` closes with
  `net.Socket.resetAndDestroy()` (RST): the stale port then refuses, and the
  activation fallback works. If neither path connects (e.g. a 3.2.0 task
  wedged by a pre-fix graceful close), the only recovery is relaunching the
  channel.
- **First activation per app launch is flaky in apps with their own `roInput`**
  (observed on the Acme dev build, 2026-07-17): the TrackerTask node exists
  (visible in `sgnodes all`) but `POST /input?rale=…` sometimes never reaches
  it — activation failed across several consecutive ECP relaunches (including
  40 rapid attempts through a full boot), yet succeeded right after the user's
  own app restart earlier the same day. Roku delivers ECP input events to only
  one `roInput` instance per app (the most recently created), so an app that
  creates its own `roInput` (deep links/transport) can starve the tracker's —
  suspected but not conclusively proven. Practical upshot: if Edit can't
  connect, restart the channel (from the IDE/deploy, not just ECP relaunch)
  and try again immediately; once ONE session connects, the port-reuse
  strategy keeps every later session working for the app's lifetime.
- **ECP app-ui child indices ≠ RALE child indices.** `/query/app-ui` renders
  only *renderable* nodes; the task's `getChildList` uses
  `node.getChildren(-1, 0)` — every child, Tasks/Timers/ContentNodes included.
  Any `{child: index}` path computed from app-ui positions drifts as soon as a
  node has non-renderable children interleaved ("Invalid Path" / subtype
  mismatch on some nodes but not others). The app-ui children are an
  order-preserving **subsequence** of the device children, so resolve each
  level against `getItemList {path}` (child `item.index` is the authoritative
  device index): match by subtype, prefer a unique `item.id` match, fall back
  to the ordinal among same-subtype siblings — implemented in
  `src/client/nodes/ralePathResolver.ts`.
- **app-ui tags are representations, not always real subtypes: plain `Group`
  nodes print as `<RenderableNode>`** (verified live on the Acme home screen —
  `container`/`heroContainer` Groups all appeared as `<RenderableNode
  name="…">` while custom components like `Hero`/`RouterOutlet` and other
  built-ins like `LayoutGroup`/`Poster`/`Label` print their real subtype).
  Consequences for resolution: match by **node id first** across all children
  (ids are the reliable anchor; the Acme chain to any node is fully named in
  practice), and gate subtype checks through `subtypeCompatible()` which maps
  app-ui `RenderableNode` ↔ device `Group`. The final `selectNode`
  verification must use the same relaxed check or every Group-ancestor edit
  fails with a false "target mismatch".
- **Vector fields: app-ui prints `{333, 222}`, markup uses `[333,222]`, and
  SceneGraph silently IGNORES the curly form set as a string** (verified live
  on a Poster's `translation`: curly string → no effect; bracket string →
  applied; JSON number array → applied). So `setField` values for vector-ish
  fields must be sent as real JSON number arrays — `coerceFieldValue` in
  `xmlDiff.ts` parses both `{x, y}` and `[x,y]` text into arrays. A silently
  ignored set still returns a normal field-list response — there is no error
  signal from the device for a bad value type.
- **A LayoutGroup owns its children's `translation`** — a manual set succeeds
  but the layout pass overwrites it (verified: same array set persisted on a
  plain-Group child, snapped back on a LayoutGroup child). The panel emits an
  apply *warning* for translation edits whose direct parent step is a
  LayoutGroup.
- `getFieldList` responses (in selectNode/getNodeData/setField results) are an
  **object keyed by field id** — `{ translation: { item: {…} }, … }` — not an
  array; and object-valued fields serialize as `value: "{object}"` (useless
  for verification — read app-ui attributes instead).

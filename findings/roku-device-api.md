# Roku Device API — Verified Findings

All findings below were verified live against a **Roku Ultra (model 4850X, firmware 15.2.4.3442, serial X02800C5FKLV)** running a sideloaded DAZN dev app.

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
- No callbacks: the iframe fires no "loaded" or "ready" events back. The time-range scroll command retries internally (~20×/200 ms) until the trace is ready.

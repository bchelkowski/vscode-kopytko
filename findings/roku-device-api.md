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

## Port 8080 — SceneGraph Debug Server

**Text-based request/response console.** Send `command\r\n`, read until the device stops sending (idle for ~250ms) — the response ends with a `>` prompt but since `>` appears inside XML responses it cannot be used as a terminator. Use idle-time detection instead.

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

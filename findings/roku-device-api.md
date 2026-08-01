# Roku Device API — Reference

> Full history, raw captures, and the reasoning behind each finding:
> [archive/roku-device-api-journal.md](archive/roku-device-api-journal.md).
> Read it only when you need a full response body or *why* something was ruled out.

Unless noted otherwise, everything here was **verified live** against a
**Roku Ultra 4850X, firmware 15.2.4.3442** running a sideloaded dev app.
Claims that were *not* verified are marked ⚠️ — do not promote them to fact without a capture.

All protocol implementations live in `packages/roku-device/src/`. The Kopytko CLI deployer and
`.kopytkorc` reader stay in the extension (`src/client/roku/`) so the package stays
Kopytko-unaware.

---

## ⛔ Never do this

- **Never change device-protocol code without a capture proving the bug.** Every regression here
  came from "hardening" a working wire path by reasoning alone. Fix what a capture shows, nothing more.
- **Never use `>` as a port-8080 response terminator.** `>` occurs inside XML bodies. Use idle-time
  detection (250 ms).
- **Never run two pollers against a draining ECP endpoint** (`/query/sgrendezvous`, `/query/fwbeacons`).
  Each call empties the device buffer, so two consumers silently split the events and both miss half.
- **Never re-add `/search/*`, `/query/screensaver`, `/query/textedit-state`, `/query/audio-device`
  from memory.** `/search` was removed in Roku OS 12.0; the others appear only in stale third-party
  writeups, not the official ECP page. Re-fetch the docs before implementing.
- **Never build console features on rendezvous log lines.** `logrendezvous on` reports success but
  emits nothing on 8085 or 8080 (measured over 16 s / 9 s while driving the UI). Rendezvous data
  arrives *only* via ECP. A severity class and filter chip were built on this assumption and removed.
- **Never re-encode a `Lit_` key path segment** — `textToLitKeys` output is already URL-encoded.

---

## Environment

**WSL2 cannot reach Windows-hotspot devices (192.168.137.x).** Probe from native Git Bash or
PowerShell. The extension itself runs on the Windows side and reaches the device fine.

**`$?` is unreliable after `wsl.exe bash -lic '…'`** — it reports 0 even when the inner command
exits non-zero. Test exit codes with `&&`/`||` chaining instead.

---

## Port map

| Port | Service | Notes |
|---|---|---|
| 80 | Developer web admin | Digest auth, user `rokudev`. **Not 8060** — an early pass got this wrong. |
| 1900 | SSDP discovery | UDP |
| 8060 | ECP + Perfetto | HTTP; no auth on most endpoints |
| 8080 | SceneGraph debug console | Text; available to any dev channel, no manifest flag |
| 8081 | BrightScript debug protocol | Binary; needs `remotedebug=1` |
| 8085 | BrightScript runtime console | Streaming log; **single consumer** |
| 8087 | Screensaver console | Same surface as 8085; deliberately out of scope |
| 8089–8093 | Retired (Roku OS 7.5+) | 8089 observed open-but-inert. Do not implement. |

---

## Port 8060 — ECP

| Endpoint | Method | Notes |
|---|---|---|
| `/query/device-info` | GET | Model, firmware, serial, `<keyed-developer-id>`, `<uptime>` |
| `/query/active-app` | GET | Attribute set varies by state/firmware — rely only on `id`/`type`/`version` |
| `/query/apps` | GET | Sideloaded app is `id="dev"` |
| `/query/app-state/<appId>` | GET | `active` / `background` |
| `/query/registry/<channelId>` | GET | Use `dev` for sideloaded. ⚠️ `?u=1`/`?k=`/`?s=` filter params (`RegistryQueryOptions`) are docs-derived, never confirmed live |
| `/query/sgrendezvous` | GET | **Drains** the queue |
| `/sgrendezvous/track` \| `/untrack` | POST | Channel-agnostic |
| `/query/fwbeacons` | GET | **Drains**. Beacon tags are hyphenated-lowercase here |
| `/fwbeacons/track/<appId>` | POST | App-scoped, unlike sgrendezvous. ⚠️ `untrack` inferred by symmetry, unverified |
| `/query/app-object-counts/<appId>` | GET | Per-type BrightScript object counts + bytes |
| `/query/app-ui` | GET | Rendered node tree of the foreground app |
| `/query/sgnodes/{all\|roots}` | GET | Different wrapper tags — see below |
| `/launch/<appId>?k=v` | POST | 200/204 ok, 404 not installed, 403 ECP restricted |
| `/input?k=v` | POST | Delivers to the **foreground** app as `roInput`; no app-id parameter |
| `/exit-app/<appId>[/true]` | POST | Instant-Resume suspend, not a kill — app goes to `background` |
| `/query/icon/<appId>` | GET | Raw image bytes; **not uniformly PNG** (Netflix returns JPEG) |
| `/keypress\|/keydown\|/keyup/<key>` | POST | ⚠️ docs-derived, never confirmed live |
| `/query/graphics-frame-rate` | GET | `<fps>` |
| `/query/r2d2-bitmaps` | GET | XML — **completely different format** from the 8080 `r2d2_bitmaps` text command |
| `/query/tv-channels`, `/query/tv-active-channel` | GET | 404 on non-TV hardware; ⚠️ success shape unverified |
| `/query/media-player` | GET | ⚠️ docs-derived shape only — verify before trusting `validate_streaming` |
| `/query/chanperf` | GET | Per-channel mem/CPU, XML — see below. **Different units from the 8080 `chanperf` text command.** |

**Binary bodies need `httpGetBuffer`**, not `httpGet` — the string-accumulating version corrupts them.

**Drain semantics** (`/query/sgrendezvous`, `/query/fwbeacons`): each call returns only events since
the last call and resets `count` to 0. `drop-count > 0` means the device buffer overflowed — poll faster.

**sgnodes wrapper tags differ per scope** — `all` → `<All_Nodes>`, `roots` → `<Root_Nodes>`,
by-id → `<Nodes_Nodes>`. `parseEcpSgNodes` keys on `<All_Nodes>` and **cannot** be reused for the others.
`?count_only=true&sizes=true` is silently **ignored** on firmware 15.2.4 (byte-identical response).

**`/query/app-ui` vs `sgnodes all`** — same hierarchy, different shape. app-ui has `index` and rendered
attrs (`text`, `bounds`), but **no `_sn`/`osref`/`bscref`**. Failure is in-band with HTTP 200:
`<status>FAILED</status><error>No active app</error>`.

**Node tree attributes** (`sgnodes`): `_sn` node id, `osref` OS refcount, `bscref` BrightScript
refcount (**0 = orphaned, possible leak**), `extends` parent type, `bounds` only on rendered nodes.

**`<subtype>` appears only on `roSGNode` entries** in app-object-counts. Everything else
(`roString`, `roAssociativeArray`, …) gets one block. Those two plus `roArray` dominate a real app —
the per-type counts are the leak signal node counts cannot give you.

---

## Port 8080 — SceneGraph debug console

Text request/response. Send `command\r\n`, read until idle ~250 ms.

- **Banner appears once per connection**: `X02800C5FKLV (Roku Ultra - 15.2.4.3442)` then `>`.
- **Parallel connections work** — each gets its own banner and answers normally. This is why the
  Kopytko Console does *not* take `diagnosticsLock`; a recording and a console session coexist.
- **Intermittent closure observed**: port open, then closed minutes later while ECP still reports the
  channel active. `DebugConsoleClient` auto-reconnects with backoff.
- Strip in this order: banner `/^[^\n]*\(Roku[^\n]*\)\r?\n/`, leading `/^[ \t]*>+/`, trailing
  `/\n[ \t]*>+[ \t]*$/`.
- Some commands answer `Usage: …` — check before parsing.

**Commands** (from live `help`): `chanperf`, `sgnodes all|roots|counts|<id>`,
`sgperf clear|start|report|stop`, `r2d2_bitmaps`, `free`, `loaded_textures`, `fps_display`,
`logrendezvous`, `bsprof-pause|resume|status`, `brightscript_warnings`, `press`, `type`, `plugins`,
`showkey`, `genkey`, `clear_launch_caches`, `target`, `help`/`?`, `exit`/`quit`/`q`.
⚠️ **`sgversion` is documented by Roku but absent from this firmware's `help`** — kept in the catalog
(a missing help entry is not proof of removal) but treat as unconfirmed.

**`chanperf`** — the primary memory/CPU signal. One line, KiB:
```
channel: mem=53920KiB{anon=31968,file=21756,shared=196,swap=0},%cpu=0{user=0,sys=0}
```
`anon` = heap (allocations, SG nodes) · `file` = code/mmapped assets · `swap` > 0 means device pressure.

**ECP `/query/chanperf` (port 8060) is a separate, richer encoding of the same signal** — XML,
**bytes** not KiB, float CPU percentages, and (firmware **15.2+**) a `<proc-stat>` element:
```xml
<chanperf>
  <plugin>
    <cpu-percent><user>0.0</user><sys>0.0</sys></cpu-percent>
    <memory>
      <used>42905600</used><anon>21086208</anon><file>21618688</file>
      <shared>200704</shared><swap>0</swap><limit>859832320</limit>
    </memory>
  </plugin>
  <proc-stat>… raw /proc/[pid]/stat-style text …</proc-stat>
  <status>OK</status>
</chanperf>
```
`<limit>` (foreground memory ceiling) and `<proc-stat>` have **no equivalent on the 8080 text
command** — both parse to `undefined`/absent there. `parseEcpChanperf` (`packages/roku-device/src/
diagnostics/parsers/ecpChanperf.ts`) treats `<proc-stat>` as opaque text (Roku's own docs describe it
only as "raw Linux CPU and processing status information for integration into custom monitoring
tools") — passed through the whole diagnostics pipeline (`ChanperfSample` → `MemCpuEvent` →
`SerializedMemCpuPoint`) unparsed and surfaced in the diagnostics webview as a hover tooltip on the
CPU chart (`host-cpu`), not a chart series, since it's not a plottable number.

**`sgnodes counts`** — `<type>` includes **custom project components**, which is how node leaks are
found: track count per type over time.

**`free`** is device-wide, not per-channel. Use `chanperf` for the channel.

**`r2d2_bitmaps`** — per-bitmap `size` bytes plus a total-budget summary line; `fbo > 0` = render target.

**Backgrounding a channel breaks `chanperf`/`sgnodes` at the device level** — they return
`<status>FAILED</status><error>Channel not running: active UI</error>`. Not a bug in the extension.

---

## Port 8085 — BrightScript runtime console

Streaming log of `print` output and system events. **Also interactive, but only when execution is
stopped** — a `BrightScript Debugger>` prompt appears on crash or break, exposing ~22 commands
(`bt`, `var`, `print`, `step`, `threads`, …). While the channel runs normally it **ignores input
entirely** (`help\r\n` and `bt\r\n` each produced zero bytes over 2.5 s).
⚠️ The stopped state itself was never reproduced — force a runtime error and confirm `bt` returns a
backtrace before trusting the input path. Also open: whether a `remotedebug=1` session takes the port.

- **Replays a backlog on connect** — every fresh connection re-sends the log from channel launch
  (~84 lines) before live output. "No new lines for N seconds" does not mean the connection is dead.
- **Single consumer at a time.** This is why `FwBeaconCollector` moved to ECP: if a debug session held
  the port, beacons silently stopped with no error. The console shows a "held by another consumer"
  hint after two failed connects rather than retrying forever.
- **Only some lines carry the `MM-DD HH:MM:SS.mmm <thread>` prefix** — beacon lines do, plain `print`
  output does not.
- Bracketed level tags (`[Info.X]`, `[Warning.X]`, `[Failed.X]`) are an **app-logger convention, not
  Roku's**, but common enough that `lineClassifier.ts` matches them. Note the **leading space**.
- A beacon `Duration(-131286 ms)` can legitimately be **negative** — do not assume monotonic timing.
- Multi-line dumps appear inline; `<Component: roAssociativeArray>` trips a naive "starts with `<`"
  XML check.
- SceneGraph commands (`chanperf`, `sgnodes`) are **8080 only** — the two consoles have disjoint
  command sets.

---

## Port 8081 — BrightScript debug protocol (binary)

Needs `remotedebug=1`. `remotedebug_connect_early=1` also stops before the first statement.
Observed protocol version **3.5.0**.

### Handshake `remaining_packet_length` counts itself

```
offset  size  field
     0     8  magic  (b'bsdebug\0' as LE uint64)
     8     4  major / 12: minor / 16: patch      = 3 / 5 / 0
    20     4  remaining_packet_length            = 12   ← counts itself
    24     8  platform_revision_timestamp
   ---- 32 bytes total ----
```

The handshake ends at `20 + remaining_packet_length` — **not** `20 + 4 + remaining_packet_length`.
Getting it wrong over-consumes exactly 4 bytes, which (because `connect_early` glues updates to the
handshake) are the next packet's `packet_length`. The framer then reads that packet's `request_id` —
**0** for updates — as a length and dies with `Invalid packet length: 0`. **Symptom: the app never
launches at all.**

⚠️ **Fixture hazard**: `buildHandshakeResponse()` encoded `remaining_packet_length` as **8** for a long
time, and 8 is the one value where the wrong formula lands on the right offset — the fixture actively
concealed the bug. It now encodes 12 and the test asserts
`20 + remaining_packet_length === handshake.length`.

### Framing

Protocol 3.0.0+ prefixes every packet with `uint32 packet_length` **including its own 4 bytes**.
`request_id == 0` marks a device update. Minimum packet 12 bytes; update 16.

A desync is **unrecoverable by scanning** — a purely length-prefixed protocol has no sync marker, and
dropping a byte at a time re-reads garbage as a huge length and stalls forever. Only useful responses:
discard the buffer and realign on the next read, and **keep the socket open regardless** — a live
socket still carries `CONTINUE` even when replies are unparseable.

`stop_reason` in `ALL_THREADS_STOPPED` / `THREAD_ATTACHED` is a **uint8**, not uint32.

### Out-of-state commands reset the connection

`read ECONNRESET` on 8081 is a TCP RST **from the device**. Most commands are accepted only while the
target is stopped; sending one while the channel runs gets a reset rather than the documented
`NOT_STOPPED`.

This is worse than it sounds: if the socket dies while stopped at a breakpoint, nothing is left to send
`CONTINUE`, so **the app freezes on the TV permanently**. "Debugger disconnected" and "app hangs" are
one bug, not two.

Stopped-only: `CONTINUE`, `STEP`, `THREADS`, `STACKTRACE`, `VARIABLES`, `EXECUTE`
(`DebugCommands.STOPPED_ONLY_COMMANDS`). Breakpoint add/remove is deferred to the next stop.
`STOP` and `EXIT_CHANNEL` are always legal. **VS Code issues `stackTrace` on its own schedule**, so
guarding one handler is not enough — every handler touching the device needs the check.

`connect_early` glues the initial `ALL_THREADS_STOPPED` into the **same TCP segment as the handshake**.
`ProtocolClient` drains those bytes synchronously before `connect()` resolves, so any state a caller
arms for that update must be set **before** awaiting `connect()`. Setting it after looks correct and is
silently too late. Initial burst order: `IO_PORT_OPENED` then `ALL_THREADS_STOPPED`.

---

## Port 80 — Developer web admin

Digest auth (RFC 7616), username always `rokudev`. Implemented as `InstallerClient`.

| Action | Path | Fields |
|---|---|---|
| Install/replace | `/plugin_install` | `mysubmit=Install`, `archive=<zip>` — **no separate `Replace` value** on this firmware |
| Delete | `/plugin_install` | `mysubmit=Delete` |
| Rekey | `/plugin_inspect` | `mysubmit=Rekey`, `passwd`, `archive=<.pkg>` — ⚠️ success path unverified |
| Screenshot | `/plugin_inspect` | `mysubmit=Screenshot` → scrape `pkgs/dev.jpg?time=…`, GET it |
| Profiling | `/plugin_inspect` | `mysubmit=dloadProf` → scrape `pkgs/channel.bsprof` (fixed name) |
| Package | `/plugin_package` | `mysubmit=Package`, `app_name`, `passwd`, `pkg_time` — ⚠️ success path unverified. **No archive field** — packages whatever channel is already installed, so `InstallerClient.packageInstalledChannel` skips the install step entirely (unlike `packageChannel`, which installs first) |
| Check update / Reboot | `/plugin_swup` | `mysubmit=CheckUpdate` \| `Reboot` |

### The success signal is a JSON `messages` array, not the HTTP status

`/plugin_install` returns **HTTP 200 for both success and failure**. The real result is in a
`params.messages` array embedded in an inline `<script>`:

- Success: `{"text":"Install Success.","type":"success"}`
- Identical re-upload: `{"text":"… Identical to previous version -- not replacing.","type":"info"}` —
  **not an error**, must not be treated as failure.
- Failure: `{"text":"Install Failure: Script directory \"/source\" does not exist…","type":"error"}` —
  still HTTP 200.

**Only `/plugin_install` and `/plugin_package` use `params.messages`.** `/plugin_inspect` does not —
it renders errors via `Shell.create('Roku.Message')` plus a legacy `<font color="red">` div the page
explicitly preserves for old scripts. So rekey/screenshot/profiling rely entirely on pattern matching.

`CheckUpdate` returns a **static template** — both the success and failure headlines are always present,
gated client-side by a literal `false`. Update availability is not observable from the response at all.

`Reboot` completes with a normal HTTP 200 and does **not** drop the connection; the device reboots fast
enough that 10 s polling never sees a failure. The connection-reset catch is defensive, not exercised.

### Zip-building gotcha

Zip entries must use **forward slashes**. PowerShell's `Compress-Archive` and
`ZipFile.CreateFromDirectory` produce **backslash**-separated names on Windows, which the device cannot
read as directories — producing the HTTP-200 "Script directory /source does not exist" failure above.
Build with `CreateEntryFromFile(..., relativePath.Replace('\\','/'), ...)`.

---

## Perfetto (port 8060, firmware 15.2+)

Device emits **standard binary Perfetto protobuf** — no conversion needed.

- `POST /perfetto/enable/{channelId}` and `POST /perfetto/heapgraph/trigger/{channelId}`. Both return
  200 even with no channel running.
- Data: `ws://device:8060/perfetto-session`, unmasked binary frames, streams until closed. Allow a
  500 ms quiet window after the close frame; hard-terminate at 3 s.
- **WS stays open with no data when no channel runs** — it waits rather than dropping.
- **Start order matters: enable → open WS → deploy.** Opening the WS before deploy captures boot packets.
- Channel must be sideloaded with `run_as_process=1` (same inject/restore pattern as `remotedebug=1`).
- Embedding: `postMessage('PING')` → `'PONG'` **must complete before sending trace data**. Load with
  `{perfetto:{buffer, title, keepApiOpen:true, localOnly:true}}`. Time-range scroll uses **seconds**
  (URL params use nanoseconds). No load/ready callback — the scroll command retries ~20×/200 ms.
- VS Code webviews have a `vscode-webview://` origin, so Perfetto shows "Trust this origin?" once.

---

## RALE TrackerTask

Verified against TrackerTask v3.2.0 source (readable BrightScript in the app package) and live against
v3.4.0. **The device's version can differ from the repo's copy.** Client: `packages/roku-device/src/rale/`.

**Activation**: `POST /input?rale=true&port=<N>` (port from 49152–65535). The task then listens on the
device at `<N>` for **3000 ms** — activation → TCP connect → `init` must be one fast sequence. Refuses
non-dev channels unless `nonDev=true`.

**Framing**: client → device `[start]{json}[end]`; device → client
`[start][uuid:<len>]<uuid><json>[end]`. A piece that fails to parse is **silently dropped — no error
response**. Always include `args` (handlers dereference it unguarded). Buffer until `[end]`.

**Gotchas that cost real debugging time:**

- **Dot-notation response keys arrive lowercase.** BrightScript lowercases AA keys assigned via dot
  notation, so `getItemList` responds with `"childlist"`, **not** `"childList"`. The resolver read
  `.childList`, got undefined, and every apply failed with "Could not locate <AppView>".
  **PowerShell probing cannot catch this class of bug — PS property access is case-insensitive.**
- **`setField` has no path argument** — it writes to whatever `selectNode` last selected. The sequence
  is always `selectNode` → `setField`.
- **Omit `type` in `setField`** when the field exists: with a type the task does `removeField` +
  `addField` on mismatch (churn, and removeField fails on built-in fields). Note `type: "node"`
  **creates a new node** of subtype `value`.
- **Reconnect = reuse the original port.** On v3.4.0 the serve loop never exits, so the listener stays
  on the original port but the task never returns to waiting for ECP input — re-activation on a *new*
  port is silently ignored. Try direct connect + init to the last port first, then fall back to ECP
  activation. `teardown()` closes with RST so older v3.2.0 tasks release the port.
- **First activation per app launch is flaky in apps with their own `roInput`** — Roku delivers ECP
  input to only one `roInput` per app (the most recent), so the app can starve the tracker's. If Edit
  cannot connect, restart the channel from the IDE and retry; once one session connects, port reuse
  keeps later sessions working for the app's lifetime.
- **ECP app-ui child indices ≠ RALE child indices.** app-ui renders only *renderable* nodes;
  `getChildList` returns every child including Tasks/Timers/ContentNodes. app-ui children are an
  order-preserving **subsequence** — resolve each level against `getItemList` (`item.index` is
  authoritative). See `src/client/nodes/ralePathResolver.ts`.
- **app-ui tags are representations, not subtypes: plain `Group` nodes print as `<RenderableNode>`.**
  Match by node id first; gate subtype checks through `subtypeCompatible()`.
- **Vector fields**: app-ui prints `{333, 222}`, markup uses `[333,222]`, and SceneGraph **silently
  ignores the curly form** set as a string. Send real JSON number arrays. A silently ignored set still
  returns a normal field-list response — **there is no error signal**.
- **A LayoutGroup owns its children's `translation`** — a manual set succeeds, then the layout pass
  overwrites it.
- `getFieldList` is an **object keyed by field id**, not an array; object-valued fields serialize as
  `value: "{object}"` (useless — read app-ui attributes instead).

---

## Key files

| Area | File |
|---|---|
| ECP client | `packages/roku-device/src/ecp/ecpClient.ts` |
| ECP keys | `packages/roku-device/src/ecp/keys.ts` |
| Web admin | `packages/roku-device/src/installer/installerClient.ts` |
| 8080 console | `packages/roku-device/src/console/debugConsoleClient.ts` |
| 8085 stream | `packages/roku-device/src/console/consoleStream.ts` |
| Debug protocol | `packages/roku-device/src/debug-protocol/` |
| Response parsers | `packages/roku-device/src/diagnostics/parsers/` |
| RALE | `packages/roku-device/src/rale/` |
| Perfetto | `packages/roku-device/src/perfetto/webSocketClient.ts`, `src/ecp/tracing.ts` |
| HTTP + digest | `packages/roku-device/src/net/httpClient.ts` |

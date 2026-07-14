# Network Inspector

A Charles-Proxy-style tool for watching a running Roku channel's HTTP traffic
inside VS Code. It runs a local intercepting proxy, transparently redirects the
device's traffic through it, and shows every request/response grouped by
origin/path with per-request metrics — plus a live-editable rewrite engine.

All three platforms redirect a device's traffic transparently at the packet
level, with no hostname foreknowledge needed: **macOS/Linux** via
`iptables`/`pf`, **Windows** via an elevated [WinDivert](https://reqrypt.org/windivert.html)
companion process, bundled with the extension — no setup required on 64-bit
Windows (see [Windows: transparent redirect (WinDivert)](#windows-transparent-redirect-windivert)).

Open it from the **Kopytko Tools** sidebar → **Network Inspector**, or run
`Kopytko: Open Network Inspector`.

---

## The no-CA bridging model

HTTPS interception normally requires the proxy's CA certificate to be trusted on
the device — which Roku devices don't make practical. This tool avoids the CA
entirely by keeping the **device on plaintext HTTP** and letting the **proxy
bridge to HTTPS**:

1. Your dev channel is written/configured to call `http://` for its services.
2. Backends often hand back service URLs (config dictionaries, etc.) as
   `https://`. The proxy **rewrites `https://` → `http://` in response bodies**,
   so every follow-up call the app makes also stays plaintext HTTP — and stays
   visible to the proxy.
3. When forwarding **upstream**, the proxy **upgrades the scheme** (default:
   HTTPS): the app calls `http://api.example.com/…`, the proxy actually fetches
   `https://api.example.com/…` over TLS using the OS trust store, preserving the
   original method/headers/body, then rewrites the response body back to `http://`.

The device never performs TLS, so nothing needs to trust a custom CA. HTTPS
backends are seen fully decrypted because TLS terminates **at the proxy**.

> **Prerequisite:** the channel must actually issue `http://` requests (directly,
> or because a rewritten backend response pointed it at `http://`). Traffic the
> app makes over real HTTPS with hard-coded `https://` URLs and no rewrite is not
> captured.

---

## How the pieces fit

| Piece | File |
|---|---|
| Capture proxy (HTTP in, HTTP/HTTPS out) | `src/client/network/capture/captureProxy.ts` |
| Rewrite engine (body/header rewrite, decode) | `src/client/network/capture/rewrite/engine.ts` |
| Rule model (body rules, upstream schemes) | `src/client/network/capture/rewrite/rules.ts` |
| Hosts-file DNS bypass for the proxy's own upstream requests | `src/client/network/dnsBypass.ts` |
| OS redirect apply/revert | `src/client/network/redirect/redirectController.ts` |
| Elevated runner (writes + runs command batches, macOS/Linux) | `src/client/network/redirect/elevate.ts` |
| Windows WinDivert companion script generator | `src/client/network/redirect/windows/companionScript.ts` |
| Windows WinDivert companion supervisor (spawn, pipe IPC, heartbeat) | `src/client/network/redirect/windows/companionSupervisor.ts` |
| Windows gateway-IP detection (used by the companion) | `src/client/network/discovery/gatewayIp.ts` |
| Orchestrator (buffer, filter, HAR, lifecycle) | `src/client/network/networkController.ts` |
| Editor-tab panel | `src/client/network/views/networkEditorPanel.ts` |
| Webview UI | `src/client/network/webview/` |

---

## The master toggle & traffic redirect

The panel's on/off toggle is the single control. **It is OFF by default and
nothing runs automatically.**

While capture is on, a **Pause** button suspends *recording* without touching
the proxy or the OS redirect — traffic keeps flowing through the bridge (the
app keeps working), it just isn't added to the list until you resume.
User-initiated replays are still recorded while paused. Pause resets when
capture is disabled.

- **Enable** starts the proxy, then runs the OS redirect for your platform
  (one admin/credential prompt), then shows "Capturing". If the redirect fails
  hard, the proxy is rolled back so you're never left half-applied.
- **Disable** stops the proxy and fully reverts the network changes.

The dev machine must be the device's gateway (macOS Internet Sharing, a Linux
gateway, or Windows ICS). Redirect mechanisms, each **exactly scoped** so
teardown never touches your own firewall config:

| Gateway OS | Mechanism | Revert |
|---|---|---|
| **Linux** | dedicated `KOPYTKO_NET` nat chain, `REDIRECT` device :80 → proxy | flush + delete the chain |
| **macOS** | dedicated pf anchor `kopytko-net`, `rdr` device :80 → `127.0.0.1:proxy` | flush that anchor only |
| **Windows** | elevated WinDivert companion process, packet-level redirect into loopback | closing the companion's WinDivert handles (any process exit) |

One elevated prompt (macOS admin dialog / Linux `pkexec` / Windows UAC)
applies the whole redirect when you flip the toggle on. Teardown is
idempotent and also runs when the panel closes or the extension deactivates,
so quitting VS Code restores networking even if you never toggled off.

---

## Windows: transparent redirect (WinDivert)

`netsh interface portproxy` (Windows' only built-in redirect primitive) only
catches traffic already addressed *to* this machine, on one port at a time —
it can't intercept traffic merely *transiting* this machine as the device's
ICS gateway, and it has no concept of protocol, so it can never redirect a
device's `https://` calls the way `iptables`/`pf` do on port 80.

To get the same real, blanket, any-port transparent redirect Windows has on
macOS/Linux, this tool drives [WinDivert](https://reqrypt.org/windivert.html)
(LGPLv3/GPLv2) — a packet-driver library.

**Setup: none, on 64-bit Windows.** The extension bundles the official x64
WinDivert redistributable (`resources/win/x64/` — see its `README.md` for
provenance/license) and uses it automatically. There's nothing to download
and no setting to configure for the common case.

`kopytko.network.winDivertDir` exists only as an escape hatch — point it at
a folder containing `WinDivert.dll`/`WinDivert64.sys` to override the
bundled driver with a different build/version, or to supply one on a
non-x64 architecture the bundled driver doesn't cover (e.g. ARM64). It's
scoped `machine` — it can only be set in your own User Settings, never in a
workspace/team `settings.json`, since a local driver path is inherently
per-machine and shouldn't be something a shared workspace config could push
onto every teammate.

Flipping the panel's toggle on Windows:

1. Generates a companion script (`redirect/windows/companionScript.ts`) — a
   PowerShell script with the WinDivert P/Invoke bindings embedded via
   `Add-Type` (no separate compiled binary, no .NET SDK install needed) — and
   launches it **elevated with its window hidden** (the normal Windows UAC
   prompt still appears and is never bypassed or auto-approved — only the
   console window after that is hidden, since this process runs for the
   whole capture session rather than being a one-shot script to read output
   from). Every action it takes is still logged to `companion.log` under the
   extension's global storage folder for auditability.
2. The companion opens two WinDivert handles — one captures the device's
   outbound traffic (`NETWORK_FORWARD` layer, filtered to exactly the active
   device's IP and the configured ports), the other bridges rewritten packets
   to and from the capture proxy on loopback — and starts redirecting.
3. The extension host connects to the companion over a named pipe (token-
   authenticated, ACL-scoped to your own Windows account) to confirm it
   started, and sends a heartbeat every few seconds for as long as capture
   stays on.

Because the redirect bridges packets through loopback (both source and
destination get rewritten to `127.0.0.1` for Windows to accept the injected
packet at all), the capture proxy can't see the device's real source IP on
Windows the way it can on macOS/Linux — `kopytko.network.filterToActiveDevice`
is automatically skipped for Windows traffic rather than dropping everything.

**Safety properties** (this is the reason the whole design exists — real
Windows networking must never be left broken):

- The redirect only exists while the companion's WinDivert handles are open.
  Any process exit — clean stop, a crash, or killing it from Task Manager —
  immediately and fully restores normal Windows networking. There is no
  persistent state to leave behind.
- The companion also **self-terminates if it stops hearing from the extension
  host** (a repeating heartbeat over the pipe) — so a crashed or force-quit
  VS Code can never leave an orphaned elevated redirect process running.
- If this machine isn't x64, the bundled driver is missing/unreadable, a
  `winDivertDir` override is misconfigured, or this machine's IP on the
  device's subnet can't be determined, the panel shows `unsupported` with
  the specific reason — the proxy still runs, nothing is routed into it.
- If the companion never signals readiness in time (blocked driver load,
  antivirus/EDR quarantine, a dismissed UAC prompt), that's reported as a
  distinct, actionable error rather than a silent hang, with the real reason
  logged to `companion.log`.

**Status:** verified end-to-end against real hardware — live device traffic
captured and displayed correctly, including HTTPS-bridged calls. The
mandatory `TerminateProcess`-mid-capture recovery test (killing the companion
from Task Manager during an active capture and confirming Windows recovers
instantly) has not yet been explicitly re-run against this build; see
`findings/network-inspector.md` for the full verification history.

---

## Rewrite rules

Editable live from the panel's **Rules** button (applied without restart) and
seedable from settings.

- **Body rewrite rules** — ordered find/replace over text bodies
  (`application/json`, `*/xml`, `text/*`, JavaScript, form-encoded). Fields:
  `enabled`, `direction` (`response`/`request`), optional `hostPattern`
  (substring or `*` glob) + `contentTypePattern`, `find`, `replace`, `isRegex`.
  The built-in `https://`→`http://` response rule is enabled by default.
- **Upstream scheme** — a global default (`https`) plus per-host overrides
  (`https`/`http`/`auto`, where `auto` tries HTTPS then falls back to HTTP).
- **Map local** (`mapLocalRules`) — when a rule's `hostPattern` + `pathPattern`
  match, the proxy serves a local `filePath` (or inline `body`) with a chosen
  `contentType`/`status` and never contacts the upstream. The flow is tagged
  `local`.
- **Latency** (`latencyRules`) — delay matched responses by `delayMs` before
  they reach the device, to simulate a slow backend. The injected delay is
  recorded separately from the measured network phases.
- **Header rules** (`headerRules`) — `set`/`add`/`remove` a named request- or
  response-direction header for matched hosts. The proxy-owned headers
  (`content-length`, `transfer-encoding`, `connection`, `host`) are protected
  and can't be changed. Affected flows are tagged `hdr`.
- **Block** (`blockRules`) — when a rule's `hostPattern` + `pathPattern` match,
  the proxy aborts the connection before reaching the upstream, so the device
  sees a network reset (`ECONNRESET`) — for testing the channel's error/
  timeout handling. Blocked flows are tagged `block`.

Because the proxy edits bodies, it also handles the mechanics that keeps the
bridge intact: it decodes gzip/deflate/br before rewriting, recomputes
`Content-Length`, rewrites `Location`/`Content-Location` on redirects, strips
`Secure`/downgrades `SameSite=None` on `Set-Cookie` (a device on HTTP would
otherwise drop them), and drops `Strict-Transport-Security`.

## Streaming responses

Rewriting a body requires the whole body, so most responses are buffered
before forwarding. But an **open-ended** response — Server-Sent Events
(`text/event-stream`), or a chunked response with no `Content-Length` — never
finishes, and buffering one would hang the device forever. Those are instead
**passed through chunk-by-chunk** as they arrive (tagged `stream`), with a
capped copy teed for display. To keep the https→http bridge intact, a
no-`Content-Length` response is only streamed when no body-rewrite rule would
have touched it (and never when it's compressed, since the device needs the
decoded bytes); SSE always streams. A streamed flow appears in the list when
its stream ends, and its captured body is best-effort/partial.

---

## Viewing traffic

Requests are grouped by **origin** (`host`, with a `:port` suffix only for
non-default ports — 80, and 443 when HTTPS-bridged, are omitted), each row
showing method, status, path, duration, size, plus tags for HTTPS-bridged
(`TLS`) and body-rewritten (`rw`). A text filter narrows by
host/path/method/status. **Export HAR** writes the current buffer to a
`.har` file.

Each row starts with a `HH:MM:SS.mmm` timestamp. Below the toolbar, **filter
chips** narrow the list by status class (`2xx 3xx 4xx 5xx ERR` — `ERR` is
requests that never got a response) and by method (`GET POST PUT DELETE
other`); chips combine with the text filter, and an empty chip group means
no restriction.

The list stays responsive under heavy traffic: live requests are batched per
animation frame and appended as individual rows rather than re-rendering the
whole list, and the buffer is bounded twice over — by entry count
(`maxEntries`) and by an approximate byte budget (`maxBufferBytes`), evicting
oldest entries first. Selection and already-loaded bodies survive hiding and
restoring the panel tab.

### Compare two flows

The Overview action bar has **Mark for diff** — mark one request, then open
another and click **Diff against marked** to see a line-level comparison of
the two: summary (method/URL/status/size), request and response headers, and
request and response bodies. Each section is labeled *changed* or *identical*
and shows a unified add/remove diff (A is the marked flow, B the current one).
Binary bodies aren't line-diffable and are noted as such. Selecting any row or
clicking **Close diff** returns to the normal detail view.

### Copy & replay

The detail pane's Overview offers **Copy URL** (the effective upstream URL —
`https://…` for bridged calls), **Copy as cURL** (method, headers minus the
proxy-managed ones, and the request body; truncated bodies get an explicit
warning comment instead of silently pretending to be complete), and
**Replay** — re-sends the request through the running proxy against the real
backend and records the result as a new flow tagged `replay`. Replaying
anything other than GET/HEAD/OPTIONS asks for confirmation first, since it
repeats a state-changing request. Each body section also has a **Copy**
button for the raw body text.

A toolbar **Search** button opens an overlay that scans *every* buffered
request (URL, headers, and text bodies — binary bodies are skipped) and lists
matches with a snippet; clicking a result jumps to that flow, expanding its
origin and scrolling it into view. This is distinct from the toolbar filter,
which only narrows the visible list by host/path/method/status.

Selecting a request opens a detail pane: an always-visible overview, a
**Timing** section, an optional **Query parameters** section (parsed query
string), then the request headers, an optional **Cookies** section (parsed
request `Cookie` and response `Set-Cookie`), and the request/response bodies —
each independently collapsible.

Response bodies for `image/*` are retained and shown with **Preview** (inline
image) and **Hex** tabs instead of Raw/Formatted/Tree; other binary content
types are not retained. Text bodies keep the Raw/Formatted/Tree tabs.

The Timing section breaks the request into phases measured at the proxy —
blocked (receiving the device's request body), DNS, connect, TLS, send, wait
(TTFB), receive — as a color-coded stacked bar plus a per-phase table.
Phases that didn't happen are absent rather than zero: a request served over
a pooled upstream connection shows no DNS/connect/TLS and is labeled
"socket reused". HAR exports carry the same real phase timings (absent
phases as `-1` per the HAR spec) instead of the previous whole-duration
placeholder. Headers open by default;
bodies start collapsed, and a body's content is only fetched from the
webview's own cache and formatted once you actually open its section —
opening one large JSON body never pays for parsing/formatting the others.

Each body section has its own **Raw / Formatted / Tree** tabs, computed on
demand per tab (switching tabs doesn't recompute the ones you're not
looking at):
- **Raw** — the body exactly as captured.
- **Formatted** — pretty-printed and syntax-highlighted (keys, strings,
  numbers, booleans/null) if it parses as JSON; best-effort indented and
  highlighted (tag names, attribute values) if it looks like XML; otherwise
  the raw text with a note.
- **Tree** — a collapsible JSON tree (needs valid JSON; falls back to raw
  text with a note otherwise). Only the root starts expanded — every nested
  object/array starts folded, so a large payload opens as a manageable
  outline rather than a wall of pre-expanded nodes.

Every body section also has a **Find** box (with a match counter and
prev/next buttons, Enter/Shift+Enter to step through matches) that
searches whichever tab is currently showing — Raw, Formatted, or Tree
alike — and keeps working as you switch tabs.

When a rewrite rule changed a body (either direction — request or
response), that section also gets a **Show rewritten** checkbox, unchecked
by default: unchecked shows the original body exactly as sent by the
device or received from the backend; checked shows what the rule actually
produced. Sections with nothing rewritten don't show the checkbox at all —
there's nothing to compare.

---

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `kopytko.network.proxyPort` | `8888` | Local port the capture proxy listens on |
| `kopytko.network.redirectPorts` | `[80]` | Device-side ports redirected into the proxy |
| `kopytko.network.maxEntries` | `5000` | Ring-buffer cap before oldest requests drop |
| `kopytko.network.maxBufferBytes` | `52428800` | Approximate memory budget for retained flows (bodies + overhead); oldest evicted when exceeded, `0` disables |
| `kopytko.network.upstreamKeepAlive` | `true` | Pool proxy→origin connections instead of a fresh TCP/TLS handshake per request (device side always closes per request) |
| `kopytko.network.filterToActiveDevice` | `true` | Show only the active device's traffic (macOS/Linux only — always skipped on Windows) |
| `kopytko.network.maxBodyBytes` | `262144` | Body bytes retained for display/HAR (full body still forwarded) |
| `kopytko.network.defaultUpstreamScheme` | `"https"` | Scheme used to reach origins the app called over HTTP |
| `kopytko.network.rewriteRules` | `[]` | Seed body-rewrite rules (empty = built-in https→http) |
| `kopytko.network.upstreamSchemes` | `[]` | Per-host upstream scheme overrides |
| `kopytko.network.mapLocalRules` | `[]` | Serve a local file/inline body instead of the upstream on host/path match |
| `kopytko.network.latencyRules` | `[]` | Delay matched responses by `delayMs` |
| `kopytko.network.headerRules` | `[]` | Add/set/remove request or response headers for matched hosts |
| `kopytko.network.blockRules` | `[]` | Abort matched requests (connection reset) to test the channel's error handling |
| `kopytko.network.winDivertDir` | `""` | Windows only, usually unnecessary (a working WinDivert is bundled). Override folder with `WinDivert.dll`/`WinDivert64.sys` — machine-scoped, can't be set via workspace settings |

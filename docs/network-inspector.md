# Network Inspector

A Charles-Proxy-style tool for watching a running Roku channel's HTTP traffic
inside VS Code. It runs a local intercepting proxy, transparently redirects the
device's traffic through it, and shows every request/response grouped by
origin/path with per-request metrics — plus a live-editable rewrite engine.

All three platforms redirect a device's traffic transparently at the packet
level, with no hostname foreknowledge needed: **macOS/Linux** via
`iptables`/`pf`, **Windows** via an elevated [WinDivert](https://reqrypt.org/windivert.html)
companion process (requires `kopytko.network.winDivertDir` to be configured —
see [Windows: transparent redirect (WinDivert)](#windows-transparent-redirect-windivert)).

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
(LGPLv3/GPLv2, Microsoft-signed) — a packet-driver library, not something this
extension builds or ships a kernel driver of itself.

**Setup:** download the WinDivert SDK/redistributable from
[reqrypt.org/windivert.html](https://reqrypt.org/windivert.html), unpack it
somewhere permanent, and set `kopytko.network.winDivertDir` to the folder
containing `WinDivert.dll` and `WinDivert64.sys` (the `x64` folder of the
download). Without this set, the toggle still starts the proxy but reports
`unsupported` — nothing is routed into it.

Once configured, flipping the panel's toggle on Windows:

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
- If `winDivertDir` isn't configured, or this machine's IP on the device's
  subnet can't be determined, the panel shows `unsupported` — the proxy still
  runs, nothing is routed into it.
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

Because the proxy edits bodies, it also handles the mechanics that keeps the
bridge intact: it decodes gzip/deflate/br before rewriting, recomputes
`Content-Length`, rewrites `Location`/`Content-Location` on redirects, strips
`Secure`/downgrades `SameSite=None` on `Set-Cookie` (a device on HTTP would
otherwise drop them), and drops `Strict-Transport-Security`.

---

## Viewing traffic

Requests are grouped by **origin** (`host:port`), each row showing method,
status, path, duration, size, plus tags for HTTPS-bridged (`TLS`) and
body-rewritten (`rw`). Selecting a request opens a detail pane with an overview,
request/response headers, and (lazily loaded) bodies — including the original
pre-rewrite response body when a rule fired. A text filter narrows by
host/path/method/status. **Export HAR** writes the current buffer to a `.har`
file.

---

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `kopytko.network.proxyPort` | `8888` | Local port the capture proxy listens on |
| `kopytko.network.redirectPorts` | `[80]` | Device-side ports redirected into the proxy |
| `kopytko.network.maxEntries` | `5000` | Ring-buffer cap before oldest requests drop |
| `kopytko.network.filterToActiveDevice` | `true` | Show only the active device's traffic (macOS/Linux only — always skipped on Windows) |
| `kopytko.network.maxBodyBytes` | `262144` | Body bytes retained for display/HAR (full body still forwarded) |
| `kopytko.network.defaultUpstreamScheme` | `"https"` | Scheme used to reach origins the app called over HTTP |
| `kopytko.network.rewriteRules` | `[]` | Seed body-rewrite rules (empty = built-in https→http) |
| `kopytko.network.upstreamSchemes` | `[]` | Per-host upstream scheme overrides |
| `kopytko.network.winDivertDir` | `""` | Windows only. Folder with `WinDivert.dll`/`WinDivert64.sys` — required to enable traffic capture on Windows |

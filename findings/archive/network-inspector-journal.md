# Network Inspector — Architecture & Implementation Notes

Internal notes for future sessions. Public-facing version: `docs/network-inspector.md`.

## Origin (2026-07-10)

Built the first pass: a Charles-style HTTP capture tool (`src/client/network/`),
an editor-tab `WebviewPanel` mirroring the Perfetto tool. Phase 1 = engine + UI +
macOS/Linux redirect. Windows went through several driver-free approaches
(`netsh portproxy` + hosts-file entries) that were ultimately abandoned as
fundamentally protocol-blind — see "Windows, revisited: real transparent
redirect via WinDivert" below for the packet-level mechanism that replaced them.

## Key design decisions (and why)

- **Not mitmproxy, not any binary — pure Node.** Scope landed on **HTTP-only
  on the device side**, which removes the entire reason mitmproxy exists (TLS
  interception / CA generation). A plaintext-HTTP intercepting proxy just reads
  the `Host` header to find the upstream — no `SO_ORIGINAL_DST`/pf lookups
  needed. Engine is ~1 file of Node `http`/`https`, shipping as an ordinary
  esbuild bundle — keeps the repo's no-Python/native/binary record intact.
- **The no-CA trick is the whole point.** Device speaks HTTP; the proxy
  **bridges to HTTPS upstream** and **rewrites `https://`→`http://` in
  response bodies** so the app stays on HTTP for every follow-up call it
  learns from a backend dictionary. TLS terminates at the proxy (normal OS
  trust), so HTTPS backends are seen decrypted without any cert on the Roku.
- **Transparent redirect is still required** even with the rewrite model — the
  app calls real hostnames on :80, so the device's :80 packets must be pulled
  to the proxy at the gateway. The rewrite model changes what the proxy does
  with the request, not how the request reaches it.

## Correctness gotchas the bridging model forces (all covered by tests)

- **`transfer-encoding` + `content-length` collision.** Copying the client's
  `Transfer-Encoding: chunked` header to the upstream request *and* setting a
  `Content-Length` produced an invalid message and the POST body silently
  vanished. Fix: strip `transfer-encoding`/`content-length`/`host`/
  `accept-encoding`/`proxy-connection` from forwarded request headers and set
  `content-length` ourselves (`buildUpstreamHeaders` in `captureProxy.ts`).
- **Ask upstream for `identity`** (`accept-encoding: identity`) to usually
  avoid decompression — but the engine still decodes gzip/deflate/br as a
  fallback since some servers ignore it, and always re-emits identity to the
  device with a recomputed `Content-Length`.
- **`Set-Cookie` `Secure` must be stripped** (and `SameSite=None`→`Lax`) or a
  device on plaintext HTTP drops auth cookies. `Location`/`Content-Location`
  https→http and `Strict-Transport-Security` dropped for the same reason —
  all fixed policy in `rewriteResponseHeaders`, not user rules.
- **TLS SNI to an IP literal** triggers a Node DEP0123 warning and is
  RFC-invalid — `captureProxy.ts` skips `servername` for IPv4/IPv6 literals.

## Redirect: exactly-scoped, crash-safe revert

`RedirectController` takes an injected `ElevatedRunner` (unit tests never
touch the host) and a platform. Pure `buildSetupCommands`/`buildTeardownCommands`
are exported and unit-tested per OS:
- **Linux**: a dedicated `KOPYTKO_NET` nat chain (create/flush idempotently,
  jump from PREROUTING once); revert flushes + deletes only that chain.
- **macOS**: a dedicated pf anchor `kopytko-net` loaded on top of
  `/etc/pf.conf`; revert flushes only that anchor.
- **Windows**: an injected `WindowsRedirectDriver` (the WinDivert companion,
  `redirect/windows/`) if `kopytko.network.winDivertDir` is configured;
  otherwise `enable()` throws `RedirectUnsupportedError` and the controller
  keeps the proxy running with `redirectStatus: 'unsupported'`. See "Windows,
  revisited" below for the full design — two earlier driver-free approaches
  (`netsh portproxy` + hosts-file entries) were built, live-tested, and
  abandoned as fundamentally protocol-blind before WinDivert replaced them.

Teardown is idempotent (second `disable()` is a no-op) and runs on panel
dispose + extension deactivate. `elevate.ts` writes the batch to an auditable
`.sh` under global storage and runs it via `osascript … with administrator
privileges` (macOS) or `pkexec` (Linux).

## Wiring notes (mirrors the Perfetto editor-tab tool)

- `NetworkController` is deliberately `vscode`-free — config, save dialogs,
  and messages are injected from `activation/network.ts`. Unit-testable with
  plain fakes, no `vscode-mock` needed.
- Webview `protocol.ts` re-exports rule types from `capture/rewrite/rules.ts`
  via `import type` (erased by esbuild — no Node code leaks into the browser
  bundle).
- Bodies are captured capped (`maxBodyBytes`, default 256 KB) for
  display/HAR; the full body is always forwarded to the device. Detail bodies
  load lazily via `select-flow` → `flow-detail` to keep live `flow` messages light.

## Live verification (2026-07-10, device connected)

Verified against a real Roku on Windows ICS: topology matched `findGatewayIp`
exactly (gateway/device on the same /24 — confirmed via `ipconfig`/`arp`,
device reachable via native Windows `curl` since WSL can't reach that
subnet). The http→HTTPS bridge + body rewrite was confirmed against a real
public HTTPS server (via `tsx` under WSL): HTTP 200, `upstreamScheme:
'https'`, `rewrittenBody: true`, the response body's `https://` links
rewritten to `http://` with no `https://` left and a correct identity
`Content-Length` — closing the HTTPS-upstream gap the loopback unit tests
couldn't cover.

## macOS "redirect error" — pf ordering bug + no diagnostics (2026-07-10)

Two distinct problems behind an opaque "redirect error" badge:
1. **The pf setup was genuinely broken.** `buildMacSetup` appended
   `rdr-anchor "kopytko-net"` to the end of `/etc/pf.conf` before `pfctl -f -`;
   pf requires anchors in section order (translation/rdr before filtering),
   and the default macOS pf.conf ends with filter/load-anchor lines, so
   `pfctl` rejected the whole file. Also hardcoded `on bridge100`, which isn't
   necessarily the Internet Sharing bridge. Fixed: insert the rdr-anchor
   among the existing rdr-anchors via `awk`, and drop `on <iface>` entirely
   (an rdr rule with no interface matches on all interfaces).
2. **The failure was invisible.** No `set -e` in the elevate script meant a
   failing `pfctl -f -` could be masked by a later `|| true` line. Fixed:
   `elevate.ts` fails fast and takes a `log` callback; `activation/network.ts`
   threads it into an output channel; `NetworkController` surfaces the real
   error via `WebviewState.message`; the webview renders a `#notice` banner
   with the full error text instead of just a badge.

**Reminder that bit this session**: after client/webview changes, both
`npm run compile` *and* a reload of the Extension Dev Host are required —
the bundled `out/*.js` files are what run, not the source.

## macOS "Expected string but found end of script" — quoting, not pf (2026-07-12)

A follow-up AppleScript syntax error, before pf ever ran. Root cause:
`buildElevatedInvocation` (`elevate.ts`) hand-built a single shell string run
via `exec()` (`/bin/sh -c`). `scriptPath` was embedded unquoted from the
outer shell's point of view (POSIX shell has no single-quote escaping inside
single quotes) — and VS Code's `globalStorageUri` on macOS lives under
`~/Library/Application Support/…`, so the space in "Application Support"
word-split the shell command mid-path, truncating the AppleScript into an
unterminated string.

**This bug was untestable in its old form** — `buildElevatedInvocation`
returned a plain string with no unit test ever asserting behavior on a path
containing a space, despite the doc comment saying "exported for unit
testing." That's why it shipped broken.

**Fix: stop building shell strings; use `execFile` with an argv array.**
`execFile` never invokes a shell — each argv element (including `scriptPath`)
is passed byte-for-byte, so spaces/quotes anywhere in the path or label can't
corrupt the invocation. macOS still needs the path quoted for the *inner*
shell `do shell script` spawns — AppleScript's own `quoted form of "<path>"`
handles that at runtime. Linux (`execFile('pkexec', ['/bin/sh', scriptPath])`)
had the same latent bug, just not yet hit.

**Lesson**: any function producing a shell command/argv for a real OS path
must be tested against a path containing a space — this repo's own VS Code
storage path has one, so "no spaces in test fixtures" is not a safe
assumption here.

## Origin of the dnsBypass module (2026-07-12)

`captureProxy.ts`'s own upstream request (`forward()`, bridging a device's
`http://` call to the real `https://` backend) failed with a connection
refused during early live debugging. Root cause at the time: a
since-removed Windows capture mechanism wrote `hostname -> gatewayIp`
entries into the OS hosts file (global to the whole machine) — the proxy's
own outbound resolution for that same hostname consulted the same hosts
file (`dns.lookup`'s default behavior) and looped straight back to itself.

**Fix, still active today**: `src/client/network/dnsBypass.ts` resolves the
proxy's upstream host via `dns.resolve4`/`resolve6` (an actual DNS protocol
query) instead of `dns.lookup`/`getaddrinfo` — `dns.resolve*` never consults
the local hosts file. `CaptureProxy` takes an injectable `hostsResolver`
option and resolves the upstream host via the bypass before building the
outbound request.

The specific self-inflicted scenario that motivated this no longer exists
(nothing in this extension writes to the OS hosts file anymore), but the
bypass earns its keep independently: it protects the proxy's own upstream
resolution from any local hosts-file entry on the dev machine (VPN
split-tunnel overrides, unrelated local dev entries) redirecting it away
from the real backend it's supposed to bridge to.

## CaptureProxy always forces Connection: close (2026-07-12)

A large response (100+ KB JSON) never appeared in the panel and the device
was left hanging, while a small `304 Not Modified` worked fine. Root-caused
via `Get-NetTCPConnection`: `CaptureProxy` finished writing the response and
closed its own leg cleanly, but the device-facing leg — relayed through a
since-removed Windows mechanism doing raw byte-level TCP forwarding, not
HTTP-aware proxying — was stuck half-closed. `CaptureProxy` left `Connection`
unset, so Node defaulted to keep-alive; through a fragile raw-TCP relay,
that's exactly the ambiguity that gets stuck for larger payloads.

**Fix, still active today**: `CaptureProxy` explicitly sets
`Connection: close` on every response — success, 400, and 502 paths —
forcing a fresh TCP connection per request rather than trusting reuse to
survive any relay hop.

**Lesson**: when bridging through anything that isn't a real HTTP-aware
proxy, don't trust connection-reuse semantics to survive the hop.

## Proxy-side request visibility: two silent-failure gaps closed (2026-07-12)

A specific HTTPS-only app endpoint (its hardcoded bootstrap call) never once
appeared in the panel despite every other fix landing, with the device
failing on a client-side "no host part in the URL" error. Investigating it
surfaced two real, separate observability bugs in `CaptureProxy` unrelated
to that specific mystery (whose actual root cause — the old hosts-file
mechanism being protocol-blind — is covered under "Windows, revisited" below):

1. **Unparseable requests vanished with no flow at all.**
   `handleRequest`'s `parseTarget()` catch block wrote a bare `400` and
   returned with no `FlowRecord` emitted — so "the request failed to parse"
   and "the request never reached the proxy" were indistinguishable in the
   panel. Fix: `recordUnparseableRequest()` still returns `400` but also
   emits a `FlowRecord` with an `error` describing why parsing failed.
   Testing this needed a raw socket sending an HTTP/1.0 request (HTTP/1.1
   without a `Host` header never reaches `handleRequest` at all — Node's own
   parser rejects it first, which is exactly gap #2).
2. **Node's own HTTP parser can reject a request before any of the
   extension's code runs.** A malformed request line, oversized headers, or
   a protocol violation makes Node emit `'clientError'` and, with nothing
   listening, silently write its own generic 400 and destroy the socket —
   invisible to this extension entirely. Fix: `CaptureProxy.start()`
   registers a `clientError` handler that still responds `400` but also
   emits a `FlowRecord` (no method/headers/URL available, so `host` is a
   placeholder and `error` carries Node's exception message).

Together these close the entire remaining gap between "nothing shows because
the request never reached this machine" and "something reached the proxy's
TCP port but never became a recorded flow."

## Windows, revisited: real transparent redirect via WinDivert (2026-07-13)

The earlier Windows arc concluded the platform was permanently macOS/Linux-only
*without a kernel driver* — port 53 is exclusively owned by ICS, so no
wildcard-DNS approach can work, and the hosts-file fallback is fundamentally
protocol-blind (redirects a hostname, never a hostname+port). That second
limitation broke an app's own hardcoded HTTPS bootstrap call in a live
session, prompting a revisit of the kernel-driver option.

**Decision: integrate [WinDivert](https://reqrypt.org/windivert.html)**
(LGPLv3/GPLv2, Microsoft-signed, existing/mature — not a driver built from
scratch). User's explicit framing: *"I want a real fix, in proper way that
will work, just want you to develop in a way it won't break my windows"* —
safety was the primary constraint throughout, not an afterthought.

### Phase 2a — spike, validated live against a real device

A throwaway PowerShell+embedded-C# script was iterated live against a real
Roku on Windows ICS until real HTTP traffic flowed end-to-end (17 genuine
requests in one run, including the app's own bootstrap call). Confirmed
empirically — none of this was knowable from `windivert.h` alone:

1. **Two WinDivert handles are required, not one.** A single
   `NETWORK_FORWARD` handle can capture the device's outbound traffic but
   cannot deliver a rewritten packet to the local stack — a second `NETWORK`
   handle is needed for the injection-toward-loopback leg (confirmed against
   the WinDivert maintainer's own issue-tracker answer for this scenario).
2. **Loopback traffic reports `Outbound=True` in both logical directions** at
   the `WINDIVERT_ADDRESS` NETWORK layer — never `false`, since loopback
   never traverses a real NIC. The initial assumption (`Outbound=false` for
   the "toward local stack" leg) was backwards, producing "`WinDivertSend`
   reports success but the packet vanishes with zero API-level error" —
   diagnosed only by sniffing a known-good real loopback connection's flags.
3. **A broadly-matching injection-only handle silently steals packets other
   handles need**, even with `SEND_ONLY` set. Fix: filter `"false"` (matches
   nothing, ever) — `WinDivertSend` doesn't require the outgoing packet to
   match the sending handle's own filter, so a match-nothing filter is safe
   and correct for a pure-injection handle.
4. **The same physical ICS-gateway path needs two different interface
   indices depending on direction** — the device's own outbound traffic
   (`NETWORK_FORWARD`) reports the real internet-facing adapter's index; the
   return leg needs the ICS-shared *virtual* adapter's index instead. Using
   the wrong one produces the same "success reported, packet silently
   dropped" symptom as (2) — resolved only by sniffing the destination side.
5. **`WinDivertHelperCalcChecksums` must be called on every touched packet
   before every send, unconditionally** — a wrong checksum isn't rejected
   with an error, the packet is just silently dropped downstream.

Also confirmed live: HVCI (Memory Integrity) does not block WinDivert, and
killing the elevated test process left zero lingering effect on the device's
normal traffic — consistent with the "redirect only exists while handles
stay open" safety model the whole design leans on.

### Phase 2b — production companion

Turned the spike into real, tested, in-repo code: `redirect/windows/companionScript.ts`
(PowerShell+C# string generator, unit-tested) and `companionSupervisor.ts`
(Node-side spawn/readiness/pipe-IPC, `WindowsRedirectDriver` implementation,
unit-tested with injected fakes — never touches a real host). Wired into
`RedirectController` as an optional constructor dependency (`windowsDriver?`)
rather than a special-cased branch, so win32 stays a drop-in for the existing
macOS/Linux contract. Both "not configured" and "can't resolve a gateway IP"
throw `RedirectUnsupportedError` specifically so `NetworkController` degrades
to the graceful `unsupported` state instead of a hard failure.

Beyond the spike, production-necessary additions:

- **Named-pipe IPC across the UAC elevation boundary, two independent
  defenses.** A pipe created by an elevated process defaults to a High
  mandatory integrity label — a non-elevated same-user client is silently
  denied by Windows' mandatory integrity control, not by any DACL. Fixed by
  appending a Low mandatory label (`S:(ML;;;;;LW)`) to the security
  descriptor. Layered on top: a random per-session token required as the
  pipe's first line — the ACL scopes *who* can connect, the token scopes
  *that this session's* extension host is on the other end.
- **Heartbeat watchdog, not just process-lifetime safety.** Process death
  alone doesn't cover a companion that stays alive as an orphaned elevated
  process after VS Code crashes or is force-quit. The companion
  self-terminates after 15s without hearing from the extension host over the
  pipe; the supervisor pings every ~5s while enabled.
- **Idle NAT-table sweep** — a 10s-interval sweep drops entries idle more
  than 120s, so a long capture session's memory stays bounded by concurrent
  connections, not total connections ever seen.
- **Readiness handshake via a status file, separate from the pipe** — the
  companion can fail before it ever opens the pipe server (blocked driver
  load, HVCI block), leaving nothing to connect to. The companion writes
  `{state, detail}` to a status file the supervisor polls (15s timeout); a
  `failed` state surfaces the companion's own error text, and a timeout
  stuck on `starting` is reported distinctly as "companion never signaled
  ready" — turning the plan's flagged AV-quarantine/HVCI-block risk into an
  actionable message instead of a silent hang.
- **Bounded pipe-response waits** — every pipe command has a 3s timeout so a
  wedged companion can't hang `disable()` forever; the heartbeat watchdog is
  the real backstop that guarantees the redirect itself comes down either way.
- **Ports and interface indices resolved dynamically, not hardcoded** — the
  spike's final version had the ICS interface index baked in as a literal,
  correct only on that one test machine. The production script resolves
  both indices via `Get-NetIPAddress` at companion startup, and builds the
  port filter from the user's configured `redirectPorts` array.

### What was NOT verified before shipping (flagged, not overlooked)

Reasoned, unit-tested, but not yet hardware-verified at write time: the
generated `companionScript.ts` output end-to-end (only the hand-edited spike
was ever run live), the named-pipe UAC-boundary fix, the heartbeat
self-termination path, multi-port filters, and — called out as
non-negotiable before shipping in the original plan — **the mandatory
`TerminateProcess`-mid-capture kill test**. This section stayed accurate:
every one of the next four live-hardware runs below hit a real, distinct bug
that none of the unit tests or reasoning caught.

## Live-hardware bugs found on first real runs (2026-07-13)

Four consecutive real F5 runs against a real device, four distinct real
bugs — each unreachable by unit tests or reasoning alone, each only found by
running the actual generated companion on real hardware.

**1. Silent `Add-Type` failure — nothing logged, not even a `starting`
status.** `Write-CompanionStatus 'starting'` sits *after* `Add-Type`; if
`Add-Type` itself throws (a PowerShell-level terminating error), nothing the
C# side would have logged ever runs, and the process just flashes and closes.
Root cause: `Add-Type -ReferencedAssemblies 'System.Core'`, added
defensively for `NamedPipeServerStream`/`PipeSecurity`, but specifying
`-ReferencedAssemblies` at all **replaces** Add-Type's default reference set
rather than extending it — the spike never specified it and compiled fine on
defaults. **Fix, two parts**: removed the explicit reference list, and
wrapped the `Add-Type` + `Companion.Run()` call in a PowerShell-level
`try/catch` that writes any failure to both the log and status file — so
this entire class of failure is no longer silent, whatever causes it next.

**2. Compile error once the log was actually visible: `Companion.Main`
"cannot be an entry point because it has an incorrect signature."** The C#
compiler always scans for a method literally named `Main` as a candidate
assembly entry point and errors (CS0028, treated as an error by Add-Type's
compiler) if its signature doesn't match. The spike named this method `Run`;
renaming it to `Main` during the production rewrite — a purely cosmetic
change — was the actual regression. **Fix**: renamed back to `Run`.

**3. `ERROR_PRIVILEGE_NOT_HELD` setting the pipe's SACL, even though fully
elevated.** WinDivert opened fine and the redirect went active — the crash
moved one layer deeper, into `PipeSecurity.SetSecurityDescriptorSddlForm`
(the mandatory-label fix from Phase 2b above). Assigning a SACL needs
`SeSecurityPrivilege` **enabled**, not merely present — a full Administrator
token has it, but disabled by default, same as several other powerful
privileges. Never hit during the Phase 2a spike, which ran single-process
with no pipe at all. **Fix**: added `TokenPrivileges.EnableSeSecurityPrivilege()`
(`OpenProcessToken` + `LookupPrivilegeValue` + `AdjustTokenPrivileges`),
called once before the SDDL assignment. (Side note, unresolved: this
attempt's reported error was the generic "never signaled ready" timeout, not
the specific detail actually sitting in the status file — the 250ms poll
should have caught it well within the 15s window. Flagged rather than
ignored; worth a closer look at the readiness-polling path if it recurs.)

**4. Two final issues once traffic actually flowed.** App worked through the
redirect, but (a) the panel showed **zero traffic**, and (b) an elevated
PowerShell window stayed open for the whole session.
- **(a)** Recurrence of a `clientIp`-trust mistake this feature has hit
  before, from a new angle: `filterToActiveDevice` was scoped to
  `redirectStatus === 'on'`, assuming that state only ever meant "a real
  IP-preserving NAT redirect (macOS/Linux)." WinDivert also reports `'on'`,
  but its loopback injection rewrites both source *and* destination to
  `127.0.0.1` (required for Windows to accept the packet at all), so
  `clientIp` is always `127.0.0.1` there too. **Lesson**: `redirectStatus
  === 'on'` was never actually "clientIp is trustworthy," just "the redirect
  mechanism reported success" — a coupling that held only because there was
  a single IP-preserving mechanism behind it until now. **Fix**: the filter
  now also requires `targetPlatform !== 'win32'`.
- **(b)** UX mismatch, not a functional bug: the companion launched with
  `-WindowStyle Normal`, matching this codebase's "never run elevated
  changes silently" convention for **one-shot** scripts a user explicitly
  reviews. That doesn't fit a **persistent background process running for an
  entire capture session** — macOS/Linux's toggle has no equivalent
  lingering terminal. **Fix**: `-WindowStyle Hidden`; the UAC prompt remains
  the real confirmation gate, everything still logged to `companion.log`.

## Bundling WinDivert instead of requiring a manual download (2026-07-13)

User feedback after WinDivert was confirmed working live: requiring every
Windows user to download the WinDivert SDK themselves and point a setting
at it is real friction for what should be a one-click "just works" feature
— this was always flagged as deferred "Phase 2d — distribution" in the
original plan, never implemented until now. Also raised: VS Code settings
default to `window` scope, which is settable at the *workspace* level — a
path to a local driver checked into a shared `.vscode/settings.json` would
apply to (and get fought over by) every teammate, which is exactly wrong
for something inherently per-machine.

**Fix — bundle the driver, make the setting an escape hatch, scope it
correctly:**

1. Copied the official WinDivert 2.2.2 x64 redistributable
   (`WinDivert.dll` + `WinDivert64.sys`, ~140 KB total) into
   `resources/win/x64/`, plus its LGPLv3/GPLv2 license text and a `README.md`
   documenting provenance — unmodified binaries from the official release,
   which is exactly the redistribution WinDivert's own licensing exists to
   allow. No `.vscodeignore` change needed; the packaging script already
   default-includes anything not explicitly excluded, and neither `resources/`
   nor `.dll`/`.sys` extensions were previously ignored.
2. New `redirect/windows/resolveWinDivertDir.ts` — pure, unit-tested:
   prefers an explicit `kopytko.network.winDivertDir` override if set (and
   validates the files actually exist there); otherwise checks
   `process.arch === 'x64'` and falls back to the bundled directory. Each
   failure mode gets its own specific, actionable reason string (wrong
   override path / wrong architecture / bundled files missing) rather than
   one generic "not configured" message — this now flows straight through
   to the panel's existing `unsupported`-state notice with no webview
   changes needed, since that already renders `NetworkController`'s
   `message` field verbatim.
3. `kopytko.network.winDivertDir` gained `"scope": "machine"` in
   `package.json` — VS Code's setting scopes are `application` / `machine`
   / `machine-overridable` / `window` (default) / `resource` /
   `language-overridable`; `machine` is settable only in User Settings, never
   in workspace/folder settings, so it simply cannot appear in a committed
   `.vscode/settings.json` and can't be pushed onto a team. This is the
   correct fix for "don't want this visible/overridable by everyone," not
   just a description-text warning — VS Code enforces it structurally.

**Net effect**: zero setup on 64-bit Windows (the overwhelming majority of
installs) — the toggle just works, same one-flip experience as macOS/Linux.
The setting still exists for the real edge cases (a different WinDivert
build/version, non-x64 architectures the bundled driver doesn't cover) but
is no longer part of the default path at all.

**Deliberately not done**: auto-downloading WinDivert from within the
extension at runtime (e.g. on first Windows use) instead of bundling it at
build/package time. Bundling was chosen over on-demand download because (a)
the binaries are tiny (~140 KB) so bundling costs nothing meaningful in VSIX
size, (b) it avoids the extension ever fetching and running a kernel-driver
binary from the network at runtime, which is a meaningfully different trust
posture than shipping the exact bytes reviewed and committed at build time,
and (c) it works fully offline. If ARM64 support is ever needed, the same
pattern (bundle a second `resources/win/arm64/` and branch on
`process.arch` in `resolveWinDivertDir`) extends cleanly — no design change,
just another prebuilt binary to add once one exists.

## Detail pane redesign: collapsible sections, lazy body tabs, original-vs-rewritten (2026-07-13)

User ask: collapsible request/response headers+bodies, bodies not
computed/formatted until visible, per-body Raw/Formatted/Tree tabs, and a
checkbox to see original vs. rewritten body data (default: original).

**Real gap found first**: the data model only ever tracked the pre-rewrite
*response* body (`originalResponseBody`). Request-body rewrites
(`direction: 'request'` rules) discarded the original entirely —
`captureProxy.ts`'s `handleRequest` ran `applyBodyRewrites` on the full
request body, but only the rewritten result (`reqBodyToSend`) ever made it
into the `FlowRecord`; the original was a local variable that fell out of
scope. Fixed by threading it through `RequestMeta` (`originalRequestBody`,
`requestRewritten`) into `handleUpstreamResponse`, mirroring the existing
response-side pattern exactly. Also fixed `rewrittenBody` (used for the
list-row `rw` tag) to be `true` when *either* direction rewrote — it
previously only reflected the response side, silently misreporting rows
where only the request body changed.

**Lazy computation via native `<details>`, not hand-rolled state.** Body
sections render their `<details>` shell (summary + tab buttons + empty
`.body-content`) eagerly — cheap, just presence/size checks — but the
actual body text is only read from `state` and formatted the first time the
section's native `toggle` event fires with `.open === true`. A
`data-rendered` flag on `.body-content` makes this genuinely one-shot: an
already-rendered section that's collapsed and reopened doesn't reformat.
Switching tabs or the rewritten checkbox re-renders on demand too — only
ever the one (tab × original/rewritten) combination currently selected, via
a shared `renderBodyTab()` that reads the active tab and checkbox state
directly off the DOM rather than a parallel JS state object. Headers stay
open by default (cheap, no formatting) so triage information is still
visible at a glance; bodies start collapsed since they're the expensive
part.

**Checkbox semantics, confirmed against the user's exact wording**:
unchecked (default) = original, pre-rewrite body; checked = what the rule
actually produced. The checkbox is omitted entirely for a body direction
that wasn't rewritten — nothing to compare, and showing a disabled/no-op
checkbox would be confusing.

**JSON tree view uses nested `<details>` too** — zero hand-rolled
expand/collapse JS for arbitrary depth, the browser handles it natively.
Defaults every node open (matches typical JSON-viewer UX; still fully
collapsible node-by-node). Non-JSON content falls back to raw text with an
explanatory note for both Formatted and Tree tabs rather than hiding the
tab or showing an error — keeps the three-tab layout predictable regardless
of content type. XML gets a best-effort regex-based reindent for
Formatted (not a real parser — deliberately just a readability aid).

**Verified live in a real browser**, not just unit tests — this is pure
webview DOM/event logic with no `vscode` API surface, so it runs unmodified
outside the extension host. Built a throwaway static-file harness
(loopback-only Node server, explicit file allowlist — the sandbox's
auto-classifier blocks ad-hoc HTTP servers without both of those) loading
the real bundled `out/network-webview/main.js`, fed it fake `init`/
`flow-detail` messages via `window.postMessage`, and drove it with the
Browser tool: confirmed body sections start collapsed with literally no
content in the DOM until opened, confirmed the default-unchecked state
shows original data and checking the box swaps to the rewritten text,
confirmed nested JSON tree rendering (object/array counts, correct types),
and confirmed Formatted pretty-prints correctly. `file://` URLs are blocked
by the browser tool's sandbox — needed the local static server instead.

## Detail pane follow-up: fold-by-default tree, syntax highlighting, find (2026-07-13)

Three refinements to the detail pane redesign above, same session.

**Tree tab now only expands the root by default.** `jsonNodeHtml` gained a
`depth` parameter (default 0, incremented on every recursive call); only
`depth === 0` gets the `open` attribute on its `<details class="jt-node">`.
Every nested node still renders as a real, individually-collapsible
`<details>` — this only changes the *default* state, not the mechanism.

**Formatted tab is now syntax-highlighted**, reusing the exact `.jt-key`/
`.jt-string`/`.jt-number`/`.jt-bool`/`.jt-null` classes the Tree view
already defined — one shared color vocabulary across both tabs rather than
a second palette. Implemented as a regex tokenizer
(`highlightJson`/`highlightXml`) that walks the already-pretty-printed text
once, escaping and wrapping each token as it goes — deliberately *not*
"escape first, then regex the escaped string," since escaping turns `"`
into `&quot;` and breaks a regex written against raw JSON syntax. The XML
highlighter is the same shape (tag names, attribute values, comments) and
inherits the existing "best-effort reindent, not a real parser" caveat.

**Find is per-body-section, not per-tab, and survives tab switches.**
Deliberately implemented as a `TreeWalker(NodeFilter.SHOW_TEXT)` over the
*rendered* `.body-content` DOM rather than a search over the raw source
string — this is what makes one find box work identically across Raw
(plain text), Formatted (text inside syntax-highlighting `<span>`s), and
Tree (text inside nested `<details>`) with zero tab-specific logic: matches
are found and wrapped in `<mark>` at the text-node level, so they naturally
end up inside whatever element the browser already rendered around that
text, spans and all. Trade-off accepted deliberately: a match can't span
across two adjacent text nodes (e.g. a search term split by syntax-highlight
tag boundaries) — vanishingly rare for realistic search terms like a token
name or header value, and correctness-over-completeness felt right for a
find feature.

Query + current-match-index state lives in a module-level
`WeakMap<HTMLDetailsElement, {matches, index}>` rather than being bolted
onto the shared `state` object — it's transient, DOM-derived UI state with
a natural lifetime tied to the DOM node itself (WeakMap entries are GC'd
once the `<details>` is replaced by the next flow selection's re-render, no
manual cleanup needed). The query string itself is additionally mirrored
onto `details.dataset.findQuery` so `renderBodyTab()` — called on every tab
switch and rewritten-toggle change, which fully replaces `.body-content`
and would otherwise silently drop all highlights — can reapply it after
re-rendering without needing a reference to the WeakMap entry.

**Verified live** in the same browser harness used for the detail-pane
redesign above (the browser tool's safety classifier had a temporary
outage mid-session — waited it out rather than skipping the check).
Confirmed via the rendered DOM directly (`getComputedStyle` on the
highlighted spans, not just visual inspection): `jt-key`/`jt-string`/
`jt-number` spans resolve to three distinct colors matching the VS Code
dark-theme fallbacks. Confirmed the Tree tab's root shows its immediate
children while a nested object (`"nested": {4}`) stays collapsed — its own
keys don't appear until expanded. Confirmed find end-to-end: a 3-match
query showed `1/3`, cycling Next twice landed on `3/3`, and switching tabs
mid-search kept the query in the input, re-highlighted all 3 matches
against the newly-rendered content, and reset to the first match (`1/3`) —
matching the documented "re-apply, don't try to preserve exact position
across a full content swap" behavior.

## Perf & memory pass: incremental rendering, byte cap, upstream keep-alive (2026-07-13)

Phase A of a four-phase upgrade (plan: perf → timing waterfall → workflow
tools → advanced extras). Key decisions and gotchas:

- **Incremental list rendering replaces per-flow full rebuilds.** The webview
  previously ran `renderTree()` (full `innerHTML` of every group/row) on
  *every* `flow` message — O(all rows) per arriving flow. Now live
  `flow`/`trim` messages queue in module-level `pendingFlows`/`pendingTrimIds`
  and flush as targeted `insertAdjacentHTML` appends / `row.remove()` calls,
  coalesced per `requestAnimationFrame` **with a 100ms `setTimeout`
  fallback** — rAF alone stalls while the panel tab is backgrounded (VS Code
  throttles hidden webviews), and the queues must not grow unboundedly
  there. Whichever timer fires first wins; a `flushScheduled` flag makes the
  loser a no-op. Full `renderTree()` remains for init/clear/filter/collapse,
  and **clears both pending queues** (it supersedes any queued incremental
  work — forgetting this double-renders rows). Selection change is now two
  `classList` swaps, not a rebuild.
- **New origins append at the end of the list** — deliberately the same
  position a full rebuild gives them, because `renderTree` groups flows in
  `Map`-insertion (= arrival) order. If either side ever sorts groups, the
  other must match.
- **`CSS.escape()` for attribute-value selectors** (`[data-origin="…"]`,
  `[data-id="…"]`) — origin keys contain dots/colons which are valid in
  attribute values but not in bare selectors.
- **Webview mirrors the host's ring buffer** (`maxEntries` arrives in
  `init`). Before this, `state.flows` grew unboundedly during a long visible
  session: the host trimmed at `maxEntries` but never told the webview
  (reconciliation only happened via `init` on tab re-show). Host trims now
  arrive as a `trim` message with the evicted ids; DOM removal is idempotent
  so the client ring beating the host's trim message is harmless.
- **Byte budget on top of the entry cap** (`maxBufferBytes`, default 50 MB,
  `flowCost()` = capped body buffer lengths + 2 KB flat overhead). Count
  alone never bounded memory: worst case is ~4×`maxBodyBytes` per flow
  (request + response + both rewrite originals) ≈ 1 MB each at defaults.
  `clear()` must reset the running total or later flows get evicted against
  phantom cost.
- **Upstream keep-alive is safe now; device-side `Connection: close` stays.**
  The original reason for forcing close everywhere (netsh portproxy's raw-TCP
  relay mangling keep-alive close sequences) is gone, but the device leg
  still crosses non-HTTP-aware hops (WinDivert loopback injection, NAT), so
  it keeps closing per request. The proxy→origin leg is plain Node HTTP(S)
  and now pools via shared `http.Agent`/`https.Agent` (`keepAlive:
  true`, destroyed in `stop()` — forgetting `agent.destroy()` leaves mocha
  hanging on open sockets). Accepted nuance: `pinnedLookup` (the hosts-file
  DNS bypass) only runs on *new* connections, so a pooled socket keeps its
  original resolved IP — fine, the pin exists to defeat local hosts-file
  redirects and any real address serves the bridge. `upstreamKeepAlive:
  false` is the escape hatch for origins that misbehave with reuse.
- **`init` no longer wipes the user's place.** Selection and already-fetched
  `FlowDetail`s are carried across the rebuild when their ids still exist in
  the new history (bodies are immutable per flow, so the cache stays valid).
  This fixes selection loss on tab hide→restore, which resyncs via a full
  `init` because `_post` drops messages while the panel is hidden.
- **Bug fixed in passing**: the rules editor UI dropped `contentTypePattern`
  on every Apply — the field existed in the model and config schema but
  `renderRules`/`collectRulesFromDom` never round-tripped it.
- **Origin grouping treats `:443` + HTTPS bridge as a default port** (shows
  bare `host`, like `:80`) — the row's TLS tag already conveys the bridge.

**Verified in the browser harness** (same static-server approach as the
detail-pane work above): DOM-identity markers proved appends/trims don't
rebuild (`dataset` expandos survive across 20-flow bursts and trims), group
counts track, `:443`/`:8080` grouping correct, client ring keeps exactly the
last N under a burst, selection + cached detail survive a simulated
hide→restore `init` with no re-fetch posted, `contentTypePattern` renders and
round-trips through Apply, and the filter debounce leaves the DOM untouched
until ~150ms after typing stops.

## Timing waterfall (2026-07-14)

Phase B of the upgrade plan. Per-phase timings measured at the proxy with
`performance.now()` marks (wall `Date.now()` kept only for `startedWall`):

- **Marks come from socket events on the upstream request**: `lookup` /
  `connect` / `secureConnect` hooked in the `'socket'` callback — but only
  when `socket.connecting` is true. A socket handed out of the keep-alive
  pool is already connected; the phases *didn't happen* for that request, so
  they're **absent, not 0** (`socketReused: true` instead). Absence vs zero
  is a deliberate distinction: absent = didn't happen, 0 = under half a ms.
  HAR encodes absent phases as `-1` (the spec's "not applicable" value).
- **Marks are created fresh per attempt in `forward()`** — the `auto`
  scheme's HTTPS→HTTP retry re-enters `forward()`, and inheriting the failed
  attempt's marks would produce nonsense deltas.
- `blockedMs` = receiving the device's request body (measured around
  `collectBody` in `handleRequest`); `sendMs` = writing the request upstream
  (`'finish'` minus secure/connect/start); `waitMs` = TTFB from the response
  callback; `receiveMs` = response `'end'` minus first byte. `durationMs`
  stays the wall-clock total and can exceed the phase sum (the bar renders
  phases proportional to their own sum, not to durationMs).
- **Error flows carry no `timings`** — partial marks from a failed attempt
  aren't meaningful, and the webview/HAR both handle absence (webview skips
  the section, HAR falls back to the legacy `{send:0, wait:durationMs,
  receive:0}` shape).
- `dnsMs` is also absent for IP-literal hosts (Node never emits `'lookup'`
  when connecting to an address), independent of socket reuse.
- Webview: `timingSection()` renders an always-open `<details>` between
  Overview and Request headers — stacked bar (segments only for phases > 0,
  so a 0ms send doesn't paint a sliver) + a table of every present phase +
  a reused-socket hint. Colors from `--vscode-charts-*` variables with
  dark-theme fallbacks, shared between bar segments and table dots.

Verified in the browser harness: segment widths match the expected
proportions exactly (e.g. tls 12/48 → 25%), zero-duration phases appear in
the table but not the bar, and a reused-socket flow renders only
wait/receive plus the hint.

## Workflow tools: copy/cURL, replay, pause, chips (2026-07-14)

Phase C of the upgrade plan. Non-obvious decisions:

- **`DeviceSink` refactor made replay nearly free.** `forward()` /
  `handleUpstreamResponse` / `finishError` now take a minimal
  `{ headersSent, writeHead, end }` sink instead of `http.ServerResponse` —
  the real `ServerResponse` satisfies it *structurally* (no wrapper needed;
  TS void-return assignability lets `writeHead(): this` match
  `writeHead(): void`), and `replay()` passes a no-op sink since no device
  connection is waiting. `forward()` also stopped touching `req` entirely
  (method/headers come from `RequestMeta`), which is what makes it callable
  without a live request.
- **Replay sends the *retained* request body** (`rec.requestBody`, capped at
  `maxBodyBytes`) — the panel warns before replaying when
  `requestBodyTruncated`. Also confirms non-GET/HEAD/OPTIONS replays via a
  modal (`showWarningMessage` in the panel, controller stays vscode-free).
- **Replayed flows bypass both the pause gate and the clientIp device
  filter** — they're user-initiated and their clientIp is a loopback
  placeholder. Skipping either exemption makes replay appear to do nothing
  (filtered out) exactly when `filterToActiveDevice` is on.
- **Pause ≠ disable**: `setPaused` only gates `onFlow` recording; proxy +
  redirect stay up so the app keeps working through the bridge. Reset on
  `disable()` so the next session records from the start.
- **Clipboard goes through the host** (`vscode.env.clipboard` via a
  `copy-flow` message), not `navigator.clipboard` — webview clipboard
  permission is flaky, host-side always works. cURL builder skips
  proxy-managed headers (`host`/`content-length`/`connection`/
  `proxy-connection`/`accept-encoding`) and single-quote-escapes with
  `'\''`; binary request bodies become a `<binary body omitted>`
  placeholder rather than corrupt shell text.
- **Test-fake gotcha that exposed real hygiene**: `make()`'s FakeProxy is
  reused across enable/disable cycles, which surfaced that the controller
  never removed its `flow` listener from the old proxy on `disable()` —
  harmless live (a real CaptureProxy is created per enable and stopped), but
  a double-enable against the same instance recorded every flow twice. Fixed
  by `removeAllListeners('flow'|'error')` in `disable()`; the controller
  owns the proxy outright so blanket removal is safe.
- **ERR chip doubles as the error-only filter** (`!!f.error`); chips are
  OR within a group, AND across groups and with the text filter. Empty chip
  group = no restriction, deliberately, so the default state filters nothing.

Verified in the browser harness: timestamp column, replay tag, chip
combinations, all four copy/replay postMessages, pause button
visibility/relabel and the paused dot state.

## Advanced extras: map-local, latency, header rules, binary preview, search (2026-07-14)

Phase D of the upgrade plan. Notes:

- **RuleSet grew three optional arrays** (`mapLocal`, `latency`,
  `headerRules`) — optional specifically so every pre-existing persisted
  config, webview `state.rules` literal, and `set-rules` payload stays valid.
  `ruleSetFromConfig` gained three optional trailing params; all existing
  3-arg call sites compile unchanged. Coercers drop malformed entries
  (map-local with neither file nor body; latency with `delayMs <= 0`; header
  rule with no name).
- **Header rules run at two points, ordering matters.** Request-direction
  rules apply after `buildUpstreamHeaders`; response-direction rules apply
  after `rewriteResponseHeaders` but **before** the proxy sets
  content-length/connection — so the bridge's own normalizations always win.
  `applyHeaderRules` refuses the reserved set
  (`content-length`/`transfer-encoding`/`connection`/`host`) outright; a rule
  targeting one is silently a no-op rather than corrupting the bridge.
- **Map-local short-circuits in `handleRequest`** after body collection,
  before `forward()` — new `serveMapLocal` writes the file/inline body with
  its own headers and emits a flow tagged `servedBy: 'map-local'`. `fileReader`
  is injectable (default `fs.readFileSync`; this is the first `fs` use in
  `captureProxy.ts`). A read failure routes to `finishError` → visible 502
  flow, never a silent drop.
- **Latency is injected on the device-facing write, not the flow's phase
  timings.** `findLatencyMs` → `await sleep(ms)` (injectable, default
  `setTimeout`) right before `sink.writeHead`; recorded as
  `latencyInjectedMs` so it reads as deliberate, separate from measured
  `waitMs`. This is why the `end` handler became async (`finishUpstream`).
- **Binary retention is image-only.** `captureProxy` retains a response body
  when `isTextContentType || isImageContentType`; other binary types stay
  dropped (unchanged). `toFlowDetail` base64-encodes non-text retained bodies
  and sets `responseBodyEncoding`. Webview swaps the Raw/Formatted/Tree tabs
  for Preview/Hex when `responseBodyEncoding === 'base64'`: `<img src="data:
  …;base64,…">` (CSP already allows `img-src data:`) or a 16-byte-row hex
  dump via `atob`, capped at 64 KB decoded. HAR writes `{text: base64,
  encoding: 'base64'}` (spec-compliant).
- **Search is host-side and on-demand** (`NetworkController.search`) — no
  index, scans newest-first over URL, headers, and *text* bodies (binary
  skipped), caps at 200 hits with a ±40-char snippet. The webview search
  overlay is separate from the list filter: filter narrows the visible list,
  search finds across the whole buffer and jumps (expanding the origin +
  `scrollIntoView`). Distinct from the per-body find (that's within one open
  body section).
- **Query/cookies detail sections are pure webview** — parsed from
  `f.query` and the `cookie`/`set-cookie` headers already on the
  SerializedFlow, no protocol change, rendered only when non-empty.

Verified in the browser harness: 1×1 PNG renders as an inline image and its
hex dump shows the PNG magic bytes; overview shows served-locally +
latency-injected notes; query/cookies sections parse and count correctly;
`local`/`hdr` row tags appear; the search overlay posts a `search` message,
renders hits, and a hit click selects + scrolls to the flow; and all three
new rule types add, fill, and round-trip through Apply into the `set-rules`
payload.

## Streaming pass-through + block rules (2026-07-14)

Two follow-ups after the four-phase upgrade.

**Streaming — the buffering model's one real correctness gap.** Every
response was `Buffer.concat`'d on `end` before forwarding, so an open-ended
response (SSE, or chunked with no `Content-Length`) never fired `end` and hung
the device forever. Fix: `shouldStream()` decides per-response, and
`streamUpstream()` forwards chunks as they arrive (teeing a capped copy),
emitting the flow on `end`/`close`. The decision is deliberately conservative
so it can't break the https→http bridge:
- **Always stream SSE** (`text/event-stream`) — buffering it is a guaranteed
  hang; accept that streamed bodies are not rewritten.
- **Stream a no-`Content-Length` response only when `hasMatchingBodyRules` is
  false** — i.e. nothing would have rewritten it. Because the built-in
  https→http rule matches *every* text response, in practice this means only
  binary/non-text no-length responses stream; text stays buffered and
  rewritten. Exactly the safe split.
- **Never stream a compressed response** — we strip `Content-Encoding` in
  `rewriteResponseHeaders`, so the device must get decoded bytes, which needs
  buffering. `content-encoding` present and not `identity` → buffer.
- Streamed responses omit `Content-Length` (unknown up front) and rely on
  `Connection: close` framing, which the bridge already forces.
- **Trade-off accepted**: a never-ending SSE stream's flow row appears only
  when the stream finally closes (the emit-once flow model has no live-update
  path). The point was to stop the *device* hanging, which streaming does; a
  live-updating row would need a flow-update protocol — deferred. Also:
  backpressure is not handled (`sink.write` return ignored) — fine on LAN with
  a capped tee, but a huge stream could grow Node's socket buffer.
- `DeviceSink` gained `write()` (and `end()`'s body is now optional) so the
  same abstraction serves buffered, streamed, and replay (no-op) paths.

**Block rules** are the small one: `findBlock` in `handleRequest` (before body
collection) → `recordBlocked` calls `res.destroy()` to reset the device
connection (`ECONNRESET`) and emits a `blocked`-tagged flow. Map-local already
covered "return a fake status/body"; block covers "no response at all", which
is what you need to test client timeout/retry paths. Block is checked only on
the device path, not replay (replay bypasses `handleRequest`), which is
correct — a user-initiated replay shouldn't be blocked.

Both verified: proxy tests prove SSE/binary-no-length stream through (device
receives the data, flow tagged `streamed`), a rewrite-target chunked JSON does
NOT stream (stays buffered + rewritten), and a block rule resets the client
connection with zero upstream hits. Webview harness confirmed the `stream`/
`block` row tags, overview notes, and the block rules editor round-trip.

## Compare two flows (2026-07-14)

Line-level diff between any two captured flows. The diff algorithm lives in a
pure `src/client/network/textDiff.ts` (not under `webview/`, so it has no CSS
import and unit-tests directly via tsx; the webview bundles it through
esbuild). `diffLines` trims the common prefix/suffix cheaply, then runs an
O(n·m) LCS only over the changed middle, with a 4M-cell guard that degrades to
"all deleted then all added" rather than hang on a pathological middle.

Webview: `state.diffBaseId` (the marked "A" flow) + `state.diffView`
(`{aId,bId}`). `renderDetail` short-circuits to `renderDiff` when `diffView`
is set. Diff sections: summary, request/response headers (rendered as sorted
`k: v` lines), request/response bodies. Bodies load lazily, so `renderDiff`
requests any missing `flow-detail` and the `flow-detail` handler re-renders
the diff once both arrive (checks `diffView.aId/bId`, not just `selectedId`).
Binary (base64) response bodies aren't line-diffable — noted, not diffed.
Selecting any row clears `diffView` (exits the diff). Verified in the harness:
mark→run shows A/B tags, per-section changed/identical, correct add/del lines,
and close returns to the normal detail pane.

## Breakpoints / intercept-and-edit (2026-07-14)

Pause a matched request/response mid-flight, edit it, continue or abort. The
one genuinely new architectural piece: the proxy has to *await* a decision
that comes from the webview, across the vscode-free boundary.

- **`CaptureProxy` gets an injected `onIntercept(payload) => Promise<result>`.**
  Absent = breakpoints no-op. Request intercept sits in `handleRequest`'s
  (now async) body-collect callback, before `forward`; response intercept in
  `finishUpstream`, before content-length/latency/writeHead. `findBreakpoint`
  gates both. Edits apply selectively: method/headers/(text)body on request;
  status/headers/(text)body on response. Abort → reset the device connection
  (`res.destroy()` for request via the existing block path; a new
  `DeviceSink.destroy()` for response) and emit a `blocked`-tagged flow.
- **Only text bodies are editable** (`bodyEditable`); binary bodies pause but
  are forwarded byte-for-byte (the payload sends `body: ''`, result body
  ignored). Response intercept is skipped for **streams** (can't hold a
  flowing response) and **replays** (`!meta.replayed`).
- **Controller bridges via a pending-promise map** keyed by intercept id.
  `handleIntercept` emits `'intercept'` and returns a promise; a
  `breakpointTimeoutMs` timer (default 30s, floor 1s) auto-resolves
  `{action:'continue'}` so a forgotten breakpoint can never hang the device —
  this is the critical safety property, since a paused breakpoint holds the
  device's TCP connection open. `resolveIntercept` (from the webview) and
  `drainIntercepts` (on `disable`) both clear the timer and resolve. Pending
  payloads are stored and exposed via `getPendingIntercepts()` so the webview
  rebuilds its queue on an `init` resync (panel hide/restore) — otherwise a
  pause that fired while hidden would be invisible until it timed out.
- **Webview**: `state.intercepts` queue; a `⏸ N paused` toolbar button and an
  edit panel showing the first pending item (method/status input, headers
  textarea parsed back with `parseHeadersText`, body textarea). Continue posts
  `resolve-intercept` with the edits and optimistically drops the item (the
  `intercept-resolved` echo is idempotent). Multiple pauses queue and surface
  one at a time.
- **Timing caveat** (documented, not fixed): a paused breakpoint inflates the
  flow's `durationMs`/receive by the real wall-clock hold time — it *is* real
  elapsed time, so that's arguably correct, just worth knowing.

Verified: proxy tests confirm request-phase edits reach the upstream
(method/header/body), response-phase edits reach the device (status/body),
abort resets with zero upstream contact, and no-match doesn't call the hook;
controller tests confirm the event/resolve bridge, `getPendingIntercepts`,
sinon-fake-timer auto-continue, and disable-drains-continue. Harness confirmed
the toolbar indicator, request vs response panels, Continue-with-edits payload,
Abort, and the breakpoint rules editor round-trip.

## Detail-pane UX pass + full-body disk persistence (2026-07-14)

Five user asks in one pass: persistent section state + scroll restore,
right-click copy key/value everywhere, never show cut bodies (open the full
one in an editor instead), keep JSON-tree key casing, and make per-body Find
reveal matches inside folded tree nodes. Non-obvious findings:

- **The uppercased tree keys were pure CSS cascade.** `.dsec summary` (a
  descendant selector) carried `text-transform: uppercase` for section
  headers — and the JSON tree's `<details class="jt-node"><summary>` elements
  are descendants of the body section's `.dsec`, so every *collapsible*
  object/array key rendered uppercase while leaf keys (plain `.jt-row` divs)
  kept their casing. Nothing in TS ever touched casing. Fix: scope all the
  section-summary rules to `.dsec > summary`. Lesson for any webview with
  nested `<details>`: style outer summaries with direct-child selectors only.
- **`toggle` does not bubble** — persistent section open-state uses ONE
  capturing listener on `#detail` (`addEventListener('toggle', h, true)`)
  instead of per-`<details>` listeners; it both writes `state.sectionOpen`
  and lazily renders body sections. Corollary: a `<details open>` restored
  via `innerHTML` fires no toggle in that flow, so `renderDetail()` must call
  `ensureBodyContent()` explicitly for `.body-section[open]`.
- **Find-in-tree already *found* collapsed matches** (children of a closed
  `<details>` are in the DOM, TreeWalker sees them) — they were counted but
  invisible and `scrollIntoView` no-oped. `revealMatch()` walks
  `parentElement.closest('details')` chains up to `.body-content` setting
  `open = true`, only for the *current* match (expanding all matches on every
  keystroke would unfold huge payloads).
- **Full bodies now go to disk, not memory** (user's explicit call when
  offered a bigger in-memory cap: "save responses/session in files like
  diagnostics/perfetto"). `CaptureProxy` emits `'flow'` with a second
  `FlowBodies` argument carrying the pre-cap buffers (they were already in
  memory transiently for rewriting — this adds no buffering); the record's
  own buffers stay capped. `NetworkSessionStore`
  (`storage/networkSessionStore.ts`, injectable Buffer-capable sink — the
  diagnostics `DiagnosticsSink` is string-only, hence a separate interface,
  though `buildSessionId()` is reused) writes
  `<outputDir>/<ts>__network/{session.json, flows.ndjson, bodies/<id>.req|.res|.req.orig|.res.orig}`.
  The controller persists ONLY flows that pass the pause/device-filter gates,
  fire-and-forget, and a failing store must never break capture (tested).
  `getFullBody()` prefers disk (complete) over the capped memory buffer;
  replay of a truncated request now sends the full on-disk body.
- **Truncated bodies render a warning + "Open full body in editor" link, not
  the stump.** The editor path formats host-side via the new pure
  `bodyFormat.ts` (shared with the webview's Formatted tab like `textDiff.ts`)
  and opens an untitled doc with a proper language id. While unit-testing
  `tryFormatXml` its one-line-element staircase surfaced (`<b>1</b>` used to
  increment indent, staircasing flat element lists — the common API shape);
  fixed in the shared module, accepting slightly worse indent for
  mixed-inline-markup XML.
- **Tree-node copy resolves values from data, not DOM text**: `jsonNodeHtml`
  stamps every node with `data-path` (JSON-encoded segment array), and the
  context menu resolves it against a `WeakMap<sectionEl, parsedJson>` cache
  filled on each Tree render — so "Copy value" on an object/array yields its
  real pretty-printed subtree, and string leaves copy unquoted.
- **Test gotcha (repo repeat offender)**: a test helper `make(root = '/out')`
  called with an explicit `undefined` still gets the default — the "no
  output root" case must be signalled with `null`. Same JS default-param trap
  already documented in the diagnostics findings for `makeController`.
- Verified in the browser harness (DOM-level, not just pixels): default
  section state, persistence + scroll restore across flow switches, computed
  `text-transform: none` on `.jt-node > summary` vs `uppercase` on section
  summaries, context-menu copy payloads (kv row, tree subtree, unquoted
  leaf), truncation warning without a rendered stump, `open-body` messages
  from both the warning link and the toolbar button, and find expanding the
  collapsed ancestor chain (`1/1`, visible mark).

## wss→ws built-in rewrite + rewrite excludes (2026-07-14, same day)

Follow-up user asks: rewrite `wss://` to `ws://` like the existing
`https://`→`http://` bridging rule, and a way to exclude specific
hostnames+paths from rewriting entirely.

- **`wss://` is the same category as `https://`, not a new proxy capability.**
  Confirmed first: `CaptureProxy` never handles a live WebSocket `Upgrade` at
  all (grepped for it — nothing). So this is purely a second built-in
  `BodyRewriteRule` (`WSS_TO_WS_RULE`, response direction, plain string
  find/replace) — a backend hands back a `wss://` endpoint URL in a JSON/XML
  config body, the rule downgrades it to `ws://` text so the device's *next*
  connection attempt is plain, same mechanism as the https rule. No new
  proxy logic, no actual frame-level WebSocket proxying added.
- **`defaultRuleSet()` and `ruleSetFromConfig`'s empty-array fallback both
  now seed two body rules, not one.** Checked every test asserting on
  `defaultRuleSet().bodyRules` first — none asserted an exact length, only
  behavior (`hasMatchingBodyRules`, response-rewrite tests) — so this was a
  safe default change; a persisted/customized `rewriteRules` setting is
  untouched either way (the fallback only fires when the array is empty).
- **Rewrite excludes are a new rule category, not a per-rule flag.**
  `enabled` already existed per body rule — the actual ask was an opt-out
  scoped by host+path that applies across *every* rule including the
  built-ins (e.g. don't touch `signed.test/webhook`'s response even though
  the broad https rule matches every host). Modeled as `RewriteExcludeRule
  { id, enabled, hostPattern?, pathPattern? }`, checked first (before any
  individual body rule) in both `applyBodyRewrites` and
  `hasMatchingBodyRules` via `findRewriteExclude()`. Naming: RuleSet field
  `rewriteExcludes` (short, matches the `block`/`latency`/`mapLocal`
  brevity), config key `kopytko.network.rewriteExcludeRules` (`*Rules`
  suffix, matches `blockRules`/`latencyRules`/etc.) — the existing field
  names in this file were already inconsistent on that suffix, picked the
  more common convention going forward.
- **A rewrite-exclude needs at least a host or a path pattern.** Unlike
  block/breakpoint rules (which require a host), an exclude with neither set
  would silently exclude literally everything — `coerceRewriteExcludeRule`
  rejects that combination specifically, while still allowing a
  path-only exclude (host omitted = every host) since that's a legitimate,
  intentional shape (e.g. "never touch `/webhook` regardless of which
  backend serves it").
- **`BodyRewriteRule` gained `pathPattern`** (it only had `hostPattern` +
  `contentTypePattern` before) — needed so a rule, not just an exclude, can
  be host+path scoped. This required threading `path` through
  `applyBodyRewrites`'/`hasMatchingBodyRules`'s context objects, which
  `captureProxy.ts` already has on hand at every call site (`target.path`)
  — no new data plumbing, just wider function signatures. `shouldStream()`
  needed the same `path` param added since it delegates to
  `hasMatchingBodyRules` to decide stream-vs-buffer; this is a beneficial
  side effect noted but not separately implemented: a host+path now excluded
  from rewriting can also be safely streamed instead of buffered, since
  `hasMatchingBodyRules` naturally returns `false` for it once excluded.
- Verified via the real proxy in `captureProxy.test.ts` (not just the pure
  rule-matching unit tests): a JSON response containing both `https://` and
  `wss://` URLs at an excluded host+path passes through completely
  untouched, while the identical body at a different path on the same host
  still gets both rewritten — confirms the exclude is genuinely host+path
  scoped, not host-only. Also confirmed in the browser harness that the
  Rules panel's body-rule rows now have a path field and a new "Rewrite
  excludes" section that round-trips through Apply into the `set-rules`
  payload.

## Long-polling requests spuriously recorded as ETIMEDOUT (2026-07-16)

A user with a long-polling endpoint (server holds the connection up to 30s,
then returns; client immediately re-polls) saw some polls recorded in the
panel as `ETIMEDOUT` even though the endpoint works correctly end-to-end —
Charles proxying the same traffic showed no such errors. Confirmed from the
user: the literal error text is `ETIMEDOUT`, firing consistently around
**11-13s** (nowhere near the actual 30s poll duration), over the HTTPS bridge,
fresh device-facing connection per poll.

**Ruled out first**: grepped the whole proxy→origin path for any configured
timeout — none exists. `breakpointTimeoutMs` (30s) only governs
intercept/breakpoint auto-continue. The webview purely mirrors
`FlowRecord.error` (`webview/main.ts:189,344-345`) with zero time-based
inference — so a literal `ETIMEDOUT` string is unambiguously a **real**
Node/libuv error on the upstream socket, not a UI artifact.

**Root cause**: `forward()`'s proxy→origin request goes through a pooled,
keep-alive `httpsAgent`/`httpAgent` (deliberate perf optimization — see "Perf
& memory pass" above). The code already tracks whether a request landed on a
reused pooled socket (`marks.reused`, set in the `'socket'` handler). A
long-poll's defining trait — holding a connection essentially idle for up to
30s waiting on the server — is exactly the window in which an intermediate
network hop (VPN, corporate NAT/firewall) can silently drop a pooled
connection without Node ever finding out. The *next* poll reuses that
now-dead socket; writing to it eventually fails once the OS gives up,
landing in the observed ~11-13s window. `forward()`'s error handler had retry
logic only for the unrelated `auto` HTTPS→HTTP fallback case — a
stale-reused-socket error went straight to `finishError()` and got recorded
as a flow error, even though a plain retry on a fresh connection almost
certainly succeeds (exactly why the app's own poll-retry loop already papers
over it and "resolves in the end" from the user's point of view).

This is precisely the failure mode `kopytko.network.upstreamKeepAlive` was
already documented as an escape hatch for ("origins that misbehave with
reuse" — see "Perf & memory pass" above) — but flipping it off disables
pooling for every request, not just the rare dead-socket case.

**Fix**: `forward()`'s `upstreamReq.on('error', ...)` handler now also
retries once, on a fresh connection, specifically when `marks.reused` was
true for the failed attempt (`retriedStale` flag, mirroring the existing
`retriedAuto` pattern one branch above). A **fresh** (non-reused) connection
that errors still surfaces immediately — only a reused socket's failure gets
the benefit of the doubt, so a genuinely broken origin is never masked.

**Test-writing gotcha hit along the way**: the regression test needs a real
socket that answers once, then goes dark on reuse — a plain `http.Server`
can't do this (respond, then simulate "went dark" on the exact same
already-answered connection) without racing Node's own close detection, so
the test uses a raw `net.createServer` with hand-written HTTP/1.1 response
bytes instead. That test then hung on cleanup: the *retry's* fresh connection
stays open (proxy-side keep-alive), and `net.Server.close()` waits for every
open socket to close on its own rather than forcing them — so the test must
track connected sockets and `.destroy()` them explicitly before `close()`,
or the callback never fires and the test times out with no useful error
message pointing at the real cause.

**Follow-up (same day): the stale-pool diagnosis is likely wrong or
incomplete.** New evidence from the user's macOS machine (marketplace build):
identical `read ETIMEDOUT` at ~11-13s, and — critically — **it persists with
`upstreamKeepAlive: false`** (config is read at `enable()` time, so the test
is valid if capture was toggled off/on after the change). That means fresh,
non-pooled, non-SO_KEEPALIVE connections also die ~11-13s into the long-poll
wait, which no stale-reuse or keepalive-probe theory explains — an idle
established connection with nothing being transmitted cannot spontaneously
`ETIMEDOUT`; something must be retransmitting unacknowledged data. Same
signature on two OSes also rules out OS-specific TCP keepalive parameters
(Windows probes at 1s×10 ≈ 11s, macOS at 75s×8 ≈ 600s — they couldn't both
land on 11-13s). Revised suspicion: the path between proxy and origin kills
>10s-quiet flows, with DNS pinning (`dnsBypass.ts`'s `resolve4`, which skips
the OS resolver — VPN/split-DNS networks can return a different IP than
curl/Charles get) as the prime extension-specific difference. The retry fix
above is kept (it's correct for genuine stale-pool errors and never masks
fresh-connection failures) but probably does not fix the user's symptom —
the retried attempt would hold >10s again and die the same way.
A throwaway standalone diagnostic script (plain-node, zero-dep; run on the
affected machine, not kept in the repo) isolated the variables: OS-DNS vs
pinned-resolve4 × TCP keepalive on/off against the real endpoint. First
real-endpoint run on the Mac ruled DNS out (OS resolver and `resolve4`
return the same IPs) but was otherwise inconclusive — the shell-quoted body
arrived mangled, the server rejected it instantly with 400, and the >10s
hold never engaged (lesson: read the request body byte-for-byte from a
file; a large JSON body with a token does not survive shell quoting, and an
instant 4xx means the long-poll never engaged, so the run proves nothing).

**RESOLVED (same day, conclusive): the killer is SO_KEEPALIVE probing with
Node's 1s default delay, on a network path that swallows keepalive probes.**
The diagnostic run against the real endpoint (valid file-read body,
long-poll actually engaging, reproduced twice) split perfectly: scenarios
with `setKeepAlive(true, 1000)` died with `read ETIMEDOUT` at ~11.5s;
scenarios without it held the full ~30s and returned 200 — on both OS-DNS
and pinned-IP connections (DNS fully exonerated). Mechanism: the agents were
built with `keepAliveMsecs: 1000` (Node's default), so the OS starts
keepalive probing 1s into any quiet period. A long-poll sits quiet for up to
30s; on this corporate path the probes go unanswered (middlebox swallows
them — while actual data still flows fine, since scenario A/C's 30s response
arrives intact), and ~10s of unacknowledged probes makes the OS kill the
healthy in-flight connection. Short requests never idle >1s → never probe →
never die. Charles doesn't enable aggressive keepalive probing → unaffected.

This also explains why it originally *looked* like a stale-pooled-socket
problem (the first Windows-side diagnosis above): Node applies
`keepAliveMsecs` in `keepSocketAlive()` — i.e. when a socket enters the
**reuse pool** — while brand-new sockets keep the OS-default probe delay
(hours). So only *reused* sockets carried the 1s probe delay, and only they
died mid-poll: perfectly correlated with reuse, but causally unrelated to
staleness. It also retro-explains the earlier "still fails with
`upstreamKeepAlive: false`" data point as an invalid test (the setting is
read at `enable()` time; it almost certainly wasn't re-applied), since
without the pooled-socket `setKeepAlive` there is nothing left to kill the
connection — as scenario A (fresh socket, no keepalive) proved by holding
30s just fine.

**Fix**: `keepAliveMsecs: 60_000` on both agents — pooling stays, probing
stays for genuinely idle pooled sockets, but probes can never start inside a
realistic long-poll hold. The reused-socket single-retry (above) stays as
defense in depth: with the 1s probe delay gone it should rarely fire, and
when it does it's a genuine dead pooled socket that a fresh retry fixes.

**Lesson**: Node's `http.Agent` default `keepAliveMsecs: 1000` is far more
aggressive than the OS keepalive default (typically 2 hours) and is applied
to every pooled socket. On networks that don't answer keepalive probes, that
default converts any >1s-quiet in-flight request (long-polls especially)
into a spurious `read ETIMEDOUT` roughly 10-12s after the quiet starts.

**Follow-up: `keepAliveMsecs: 60_000` was NOT sufficient on macOS
(v1.10.4 still showed the ERR flows there).** A kernel-level check on Linux
(`ss -tno` reading the live keepalive timer during a held reused-socket
request) proved the agent config does what it claims on Linux — timer armed
at 59s counting down vs ~1s probe cadence with the old default — so the
setting itself applies; whatever macOS/Electron does differently was not
worth chasing further. Hardened instead to the configuration the live A/B
diagnostic actually proved good on the affected Mac network:
`socket.setKeepAlive(false)` in `forward()`'s `'socket'` handler, i.e.
SO_KEEPALIVE fully off for every in-flight upstream request, fresh or
reused (the surviving diagnostic scenarios had keepalive entirely off, not
merely delayed). Sequencing note: the agent re-arms keepalive when a socket
is *freed* (`keepSocketAlive`), so pool-idle sockets still get 60s-delay
probing — harmless and even useful (reaps dead pooled sockets), and every
new request disables it again before its quiet window starts. Dead pooled
sockets that slip through are caught by the reused-socket single-retry.

**Observability gap found while getting that body: error flows dropped the
request body entirely.** `finishError` built its `FlowRecord` with
`requestBytes: 0`, no `requestBody`, and no `FlowBodies` emit — so an ERR
flow showed request headers only, and replay/copy-as-cURL/on-disk `.req`
persistence were all empty for exactly the requests one most needs to
reproduce. The body was already in scope (`meta.originalRequestBody`, set
unconditionally after `collectBody`). Fixed: error flows now carry the
capped original request body + `requestBytes`, and emit the full body via
`flowBodies` for disk persistence. (If a request-rewrite rule fired, the
*sent* body isn't in `finishError`'s scope — the original is recorded, which
is the more useful one for debugging anyway.)

## In-flight (pending) flows: `'flow'` became an upsert-by-id, end to end (2026-07-16)

Requests now appear in the panel the moment they arrive (muted italic row,
`…` status, live elapsed ticker) and update in place on completion — closing
the long-standing "a streamed/long-poll flow appears only when it finally
closes" trade-off documented under "Streaming pass-through" above. The design
is deliberately *not* a new message kind; invariants that must hold:

- **The flow id is pre-allocated in `handleRequest`/`replay` and threaded
  through `RequestMeta.id`.** Every terminal emitter that carries a `meta`
  (`finishUpstream`, `streamUpstream`'s `finalize`, `serveMapLocal`,
  `recordBlocked`, the response-breakpoint abort record, `finishError`) uses
  `meta.id` — **never call `nextFlowId()` in a terminal path**. The only
  remaining `nextFlowId()` call sites are `handleRequest`, `replay`, and the
  two meta-less paths (`recordUnparseableRequest`, `recordClientError`),
  which are also the only exchanges with *no* pending phase. Blocked-by-rule
  requests also skip the pending emit (the block check runs first) so a
  blocked flow never flashes. `forward()`'s `retriedAuto`/`retriedStale`
  re-entries reuse the same `meta`, so a retry can never mint a second id or
  a second pending row.
- **`'flow'` is an upsert by id at every layer.** Proxy emits pending →
  terminal with the same id; `NetworkController.onFlow` merges a known id in
  place (`Object.assign` on the shared record — keeps `flows[]` position with
  no splice) and **bypasses the pause/device-IP gates for known ids** — the
  gates were decided at admission, and dropping a completion would strand a
  pending row forever (this exact case: pending admitted → user pauses →
  completion arrives). Byte accounting is delta-based (subtract old
  `flowCost`, add new); `delete existing.pending` is required because
  `Object.assign` can't remove keys. Webview `ingestFlow` mirrors the same
  upsert; `flushTree` handles the row-already-in-DOM cases (update in place,
  or *remove* when the completion no longer passes the active status chip),
  and `updateFlowRow` re-homes the row when `originKey` changed (an `auto`
  scheme resolves its real upstream only at completion).
- **Ordering races self-heal via the append fallback**: a pending flow
  evicted by the ring/byte caps, or wiped by `clear()`, makes the completion
  an unknown id again → it simply appends. Accepted quirk (documented in
  docs/network-inspector.md): Clear during an in-flight request re-lists
  that request when it completes.
- **Persistence stays completion-only** — the NDJSON store is append-only
  with one immutable line per flow, so `persistFlow` is skipped for
  `pending` records at both onFlow call sites. HAR export filters pending
  out; `controller.replay()` throws on a pending id (no captured body yet).
- **The webview's "bodies are immutable per flow" detail-cache assumption
  no longer holds for pending-era fetches.** A detail cached while the flow
  was pending is invalidated on the completing upsert AND on `init` resync
  (tracked via a `prevPendingIds` set captured before the rebuild — the flow
  may have completed while the panel was hidden). The `init` handler also
  re-requests the selected flow's detail when missing, which additionally
  fixed a small pre-existing gap: a `flow-detail` reply lost to `_post`'s
  hidden-panel drop previously left body sections silently absent until the
  user re-clicked the row.
- **Test-suite ripple**: the `nextFlow` helper in captureProxy.test.ts now
  resolves on the first *non-pending* emit (kept every existing test green
  untouched); tests that count `'flow'` emits to detect retries must count
  terminal emits only. The pending-before-upload test proves the emit fires
  before the request body finishes (chunked POST with the second chunk gated
  on the pending emit's promise).

Verified in the browser harness (static-server approach above) against the
real bundle: pending row renders (`…`/ticker/`—` size), completion flips the
row in place with selection kept and posts a detail re-fetch, status chips
ignore pending rows and re-check on completion (404 under a 2xx chip removes
the row; 200 keeps it), the ticker self-cancels when the last pending flow
resolves, and the hide→restore `init` resync drops the pending-era detail
cache and re-fetches.

## Verification gaps / TODO for a later pass

- **On-device transparent redirect not exercised headlessly on macOS/Linux.**
  The real proxy runs in the VS Code Extension Host (native node — WSL can't
  reach the device). To finish: F5 the extension, flip the toggle, launch a
  dev channel calling `http://`, confirm flows appear grouped by origin.
  (Windows is verified live — see the WinDivert entries above.)
- The `auto` fallback (https attempt fails → http) is tested against a
  plaintext upstream; real-TLS `auto` behavior is covered transitively by
  the live https bridge.
- **Crash-residue is not proactively cleaned up on activation** for Linux —
  if VS Code crashes while capture is on, the `iptables` chain survives
  until the extension runs teardown again, which only happens via an
  explicit disable/dispose/deactivate. A future pass could call
  `redirect.disable()` defensively once at activation, or give Linux the
  same persistent-watchdog treatment macOS got (see "macOS single-elevation
  persistent helper" below). **macOS no longer has this gap** — the
  persistent helper's watchdog self-terminates (reverting the `pf` anchor)
  within ~15s of losing the extension host's heartbeat, the same property
  Windows' WinDivert companion already had.
- **The mandatory `TerminateProcess`-mid-capture kill test for the WinDivert
  companion** (Task Manager "End Task" during an active capture, confirming
  Windows recovers instantly with zero lingering redirect) still has not
  been explicitly re-run against the current production companion build.
- **The bundled-driver path resolution (`resources/win/x64/` via
  `context.extensionUri`) has not been re-verified live** — all the prior
  live hardware runs used the `kopytko.network.winDivertDir` override
  pointed at a Downloads-folder SDK, not the new zero-config bundled path.
  `resolveWinDivertDir.ts` itself is unit-tested, but the real
  `context.extensionUri`-based path (different between F5 Extension Dev Host
  and an installed VSIX) has not been exercised on real hardware yet.

## Button legibility, row context menu, block/unblock (2026-07-16)

Three small usability fixes: `button.secondary`'s text color was nearly
identical to the page's own body text (`--vscode-button-secondaryForeground`
fallback `#ccc` vs. `--vscode-editor-foreground` fallback `#cccccc`) with no
border to compensate, so action buttons read as plain text. Fixed by giving
`button`/`button.secondary` a `1px solid var(--vscode-panel-border, ...)`
border — the same token already used everywhere else in this stylesheet
(chips, `.dsec`, `#ctx-menu`), rather than inventing a new color.

**Generalized the copy-only context menu into a real action menu.** `CtxItem`
was `{label, text}` (always posts `copy-text`); changed to `{label, onClick}`
so `showCtxMenu` can host arbitrary actions. `copyMenuItemsFor`/`treeCopyItems`
now just wrap `vscode.postMessage({kind:'copy-text', ...})` in `onClick` via a
small `copyItem()` helper — no behavior change for the existing detail-pane
copy menu. `flowActionItems(f)` builds the same action list the detail pane's
action bar shows (Copy URL always; Copy as cURL/Replay/Mark-for-diff/Diff-
against-marked only when `!f.pending`, mirroring the exact guard the action
bar already used; Block/Unblock always) and is now the single source of truth
for both surfaces — the row `contextmenu` listener on `#tree` and the detail
pane's buttons stay in sync by construction rather than by convention.
Right-clicking a row also selects it first (extracted the existing
row-selection logic into `selectRow()`, shared with the plain `click`
listener) so the detail pane and any diff-mark state are consistent with
whatever the menu is about to act on.

**Block/Unblock reuses the existing `BlockRule`/`set-rules` model with zero
protocol changes** — `blockFlow()` appends an exact `{hostPattern: f.host,
pathPattern: f.path}` rule; `isFlowBlocked()` is just `findBlock(state.rules,
f.host, f.path)` (imported as a **runtime** function, not just a type, from
`../capture/rewrite/rules` — that module has zero `vscode`/Node imports, the
same property `protocol.ts` already relies on for its type-only re-export, so
esbuild happily bundles the real matching logic into the browser). The one
non-obvious design choice: **Unblock deletes an exact host+path match but
only disables a broader one** (`rule.hostPattern === f.host && rule.pathPattern
=== f.path` → remove; otherwise → `enabled: false`). Without this split,
clicking Unblock on a request that happens to fall under a `*`-glob rule you
built manually in the Rules panel would silently delete that rule and unblock
every other request it also covered — disabling instead keeps it visible and
reversible in the Rules panel.

**Verified in the same throwaway static-file harness pattern used throughout
this file** (loopback Python `http.server` subclass with an explicit
filename allowlist, serving the real bundled `out/network-webview/main.js`,
fed fake `init` messages and a stubbed `acquireVsCodeApi().postMessage` that
echoes a `rules` message back after `set-rules` — mirrors what
`NetworkController.setRules()` does). One harness-only gotcha hit while
testing: `renderRules()` returns early without touching the DOM whenever
`state.rulesOpen` is false, so driving the Rules panel's inputs via raw DOM
script *while it's actually closed* silently edits stale markup left over
from the last time it was open — always check `#rules-panel` `style.display`
before scripting its inputs rather than blindly toggling `#btn-rules`.
Confirmed via the harness: border now present on toolbar/detail buttons
(`getComputedStyle` border != none); right-click on a completed row lists
Copy URL/Copy as cURL/Replay/Mark for diff/Block; right-click on a pending
row lists only Copy URL/Block; Block adds a new enabled rule and flips the
label to Unblock everywhere; Unblock against that same rule removes it
entirely; Unblock against a pre-existing broader `*.example.com` rule
disables it (`enabled: false`) rather than deleting it.

## macOS single-elevation persistent helper (2026-07-22)

Previously, macOS showed a separate `osascript … with administrator
privileges` dialog on both `enable()` and `disable()`, because each called
`ElevatedRunner` independently and each spawn is its own one-shot
authorization with no memory of the earlier one. Added
`redirect/mac/macHelperScript.ts` + `macHelperSupervisor.ts` (a
`SupervisedRedirectDriver`, the same shape `WindowsRedirectDriver` already
had — renamed the interface itself to `SupervisedRedirectDriver` with
`WindowsRedirectDriver` kept as a type alias for zero breakage) so a capture
session needs only one prompt.

- **Why a persistent helper and not `sudo -v` caching.** `pf` state needs no
  live process — `pfctl -a kopytko-net -F all` is a plain one-shot root
  command, runnable at any time by any root process. The alternative
  considered was switching macOS elevation to run batches via `sudo`
  (instead of `do shell script … with administrator privileges`) and
  leaning on `sudo`'s ~5 min timestamp-cache grace period. Rejected: only
  helps within that window (a longer session still double-prompts), needs a
  new GUI askpass helper (a spawned child has no TTY for `sudo` to prompt on
  inline), and whether the cached ticket is even shared between two separate
  `execFile` invocations depends on `sudo`'s `tty_tickets` session-scoping —
  not provable by reading code, would need live verification. The
  persistent-helper approach has no time limit and no such open question.
- **FIFO, not a Unix socket.** `mkfifo` is POSIX and guaranteed present on
  stock macOS; `nc`/`socat` aren't guaranteed, and there's no `/bin/sh`
  primitive to open a Unix socket without shelling out to one of them. The
  FIFO carries exactly one command (`stop`), parsed via a plain `case`
  statement — never `eval` — so even a garbage write to it (600 perms should
  prevent that from another local user anyway) can't produce code execution,
  only a spurious self-teardown at worst.
- **Open-FIFO-blocks-until-writer gotcha.** Opening a FIFO read-only (`<
  fifo`) blocks until a writer opens it — and that block happens *before*
  any `read -t` timeout applies, so a naive read-only watchdog loop would
  never even start iterating (and thus never check the heartbeat) until
  `disable()` sent something. Fixed with the standard portable trick:
  `exec 3<>"$CMD_FIFO"` opens it read-write on an unused fd, making the
  watchdog its own permanent writer too, so the open never blocks and
  `read -t 1 -r cmd <&3` inside the loop is genuinely non-blocking per
  iteration.
- **Heartbeat baseline gotcha.** The watchdog only starts running *after*
  the admin-password dialog is answered, which can take arbitrarily long
  while a user types. If the watchdog trusted the heartbeat-file timestamp
  Node wrote *before* elevation ran, a slow password entry alone (> 15s)
  would make the watchdog think Node had already gone silent and
  self-terminate immediately. Fixed by having the watchdog stamp its own
  fresh timestamp into the heartbeat file the moment it starts (before
  entering the FIFO loop), establishing the baseline only once the watchdog
  itself is actually running.
- **Permission model is simpler than Windows' pipe SACL problem, and in the
  opposite direction.** Windows had to lower the named pipe's mandatory
  integrity label so a non-elevated process could reach an elevated one
  ("lower reads higher" — blocked by default, needed an explicit fix, see
  the "Windows, revisited" entry below). Here it's "higher (root) reads a
  lower-owned object" — always allowed by plain Unix DAC — so the FIFO just
  needs mode `600` owned by the invoking user (created *before* elevation,
  unprivileged) and no ACL workaround is needed at all.
- **No readiness-poll step needed, unlike Windows.** The Windows companion
  needs `waitForStatusFile` because `Start-Process -Verb RunAs` returns as
  soon as UAC is accepted, before the elevated process has actually opened
  its WinDivert handles. macOS's `do shell script … with administrator
  privileges` is already synchronous — `osascript` doesn't return until the
  `/bin/sh` script exits — and the generated script only exits *after*
  `pfctl` setup succeeds and the watchdog is backgrounded, so a resolved
  `execFile` call already means "ready." `waitForStopped` (a short poll on
  `disable()` for the `stopped` status, non-fatal on timeout since the
  watchdog's own heartbeat-timeout is the real backstop) is the only place
  this design still polls a file.
- **Setup failures reported through the status file, not just a nonzero
  exit.** The generated script wraps the `pfctl` setup commands in `if !
  ( set -e; ...); then write_status 'failed'; exit 1; fi` — POSIX/bash
  exempt an `if` condition (even negated) from an enclosing `set -e`, so
  this cleanly distinguishes "setup failed" (status file says `failed`,
  `execFile` also rejects with the script's stderr) from "helper never
  started at all."
- **Linux stays on the two-`pkexec`-call path**, deliberately not given the
  same treatment yet: no custom polkit `.policy` file is shipped, so
  `pkexec` runs under the generic `org.freedesktop.policykit.pkexec.run-program`
  action, whose default authorization on most desktops is `auth_admin_keep`
  — an admin-auth cache lasting a few minutes. Back-to-back `pkexec` calls
  from the same session often already avoid the second prompt for free.
  This is distro/config-dependent and not something this codebase controls,
  so it's not a proven fix, but it lowers the value of building the FIFO/
  watchdog machinery for Linux right now.

## macOS helper: reused across toggles, not just one capture session (2026-07-22, same day)

The single-elevation helper above still prompted on **every** `enable()` —
"one prompt per capture session" turned out to be the wrong bar once actually
used: a user toggling capture on/off repeatedly within one VS Code session
(the normal workflow while iterating on a channel) still saw a prompt every
time they flipped it on. Confirmed with the user (via a scoped
`AskUserQuestion`, given the real trade-off below) that the right bar is "one
prompt per VS Code session," and extended the helper accordingly.

**A few specific claims in the entry directly above this one are now stale**
— left in place as an accurate record of what shipped first, corrected here:
the FIFO no longer carries only `stop`; `waitForStopped` no longer exists
(generalized into `waitForStatus`); and there is now a readiness-poll step
for the *reuse* path even though the *initial* launch still doesn't need one.

- **Protocol: `apply`/`revert`/`stop`, not just `stop`.** `disable()` now
  sends `revert` (flushes the pf anchor, `do_revert()`) and deliberately
  **does not exit the watchdog** — it keeps listening. A later `enable()`
  with the exact same `RedirectOptions` (rokuIp + proxyPort + ports, compared
  with a plain `optionsEqual`) sends `apply` (`do_apply()`, re-runs the same
  `pfctl` setup) instead of relaunching elevated. Only `stop` still removes
  the FIFO and exits the process — reserved for the real hard-teardown path
  (below) and the heartbeat-timeout self-termination.
- **Heartbeat must keep running across `disable()`, not just while
  "applied."** The whole point is that the helper survives idle between
  toggles, so the heartbeat `setInterval` is now tied to the *helper's*
  lifetime (started on launch, stopped only by `teardown()`), not to whether
  the redirect is currently applied. Getting this wrong (clearing the
  interval on every `disable()`, as the first version did) would make the
  watchdog self-terminate ~15s after every toggle-off — defeating the reuse
  entirely, since by the time the user toggles back on the helper would
  already be gone.
- **A genuinely new failure mode: an idle root process outliving VS Code.**
  Because the helper now survives `disable()`, an ordinary toggle-off is no
  longer enough to guarantee it exits — something has to. Added a distinct
  hard-stop path: `MacHelperDriver.teardown()` (sends `stop`, clears the
  heartbeat, clears session state — unlike `disable()`), a new optional
  `teardown?()` on `SupervisedRedirectDriver` (`redirectController.ts`), and
  `RedirectController.dispose()`, which prefers `macDriver.teardown()` when
  present and falls back to plain `disable()` for every other
  driver/platform (Windows' companion already fully exits on `disable()`, so
  it doesn't need the distinction). `NetworkController.dispose()` now calls
  both `this.disable()` **and** `this.deps.redirect.dispose()` — the latter
  unconditionally, since `disable()` short-circuits as a no-op when capture
  is already off, but an idle helper could still exist and need killing.
  Without this, closing VS Code (or just the Network Inspector panel) while
  capture happened to be toggled off would leak a live root process — a
  strictly worse outcome than the original single-shot design, which never
  had a live process to leak once `disable()` returned.
- **Options-change detection forces a fresh prompt, on purpose.** If
  `enable()` is called with different `rokuIp`/`proxyPort`/`ports` (switched
  active device, or changed `kopytko.network.redirectPorts`) than the
  currently-running helper, the driver calls its own `teardown()` on the old
  session first (a `stop` over the *old* FIFO, no elevation needed for that
  step) and then launches fresh — which **does** need a new prompt, since
  the `pfctl` rules are baked into the helper's script at launch time and
  can't be updated in place without also updating the running `do_apply()`
  body, which isn't worth the complexity for what should be a rare event
  (changing device/ports mid-session).
- **Reuse needs a poll; the very first launch still doesn't.** `apply`/
  `revert` are async FIFO round-trips with no equivalent of `do shell
  script`'s blocking return, so the Node side now has a generic
  `waitForStatus(statusPath, accept: string[], timeoutMs)` that polls until
  the status file matches one of an explicit accept-list (`['ready']` for
  apply, `['reverted']` for revert, `['stopped']` for teardown) — the
  accept-list matters to avoid a stale-read race: right after sending
  `apply`, the status file still shows the *previous* state (`reverted`)
  until the watchdog's `read -t 1` loop actually picks the command up (up to
  ~1s later), so a naive "any non-empty read is done" check would report
  false success immediately. The very first `enable()` still avoids this
  entirely — its `osascript … with administrator privileges` call is
  synchronous and only returns once `do_apply()` inside the script has
  already run and the watchdog is backgrounded, so a resolved `execFile`
  call already means "ready," same as before.
- **Fallback on a dead/unresponsive reuse attempt is silent-to-the-user but
  logged.** If `apply` either fails to send (FIFO gone — helper already
  self-terminated) or doesn't confirm `ready` within the timeout (helper
  wedged, or self-terminated between the send and the poll), `enable()`
  transparently falls through to a full fresh elevated launch rather than
  throwing — the user just sees one more password prompt than expected, with
  the reason logged to the output channel, instead of a hard failure for
  what's fundamentally a best-effort optimization.

## macOS helper: device/port switches also reuse the helper (2026-07-22, same day, second follow-up)

**Supersedes the "Options-change detection forces a fresh prompt, on
purpose" bullet in the entry directly above** — that was the actual shipped
behavior for about an hour before the user asked, correctly, why switching
devices still re-prompted when nothing else did. The bar moved from "one
prompt per VS Code session unless you switch device/ports" to "one prompt
per VS Code session, full stop" (confirmed via `AskUserQuestion`, given the
real added complexity below).

- **`apply` now carries its target instead of assuming the launch-time
  one.** The FIFO line changed from a bare `apply` to `apply <rokuIp>
  <proxyPort> <ports>` (comma-joined). `do_apply()` in `macHelperScript.ts`
  became a 3-argument shell function (`$1`/`$2`/`$3`) that rebuilds the
  `rdr` rules from whatever it's given *at call time* — both for the very
  first (synchronous, pre-background) apply and every later FIFO-driven one
  — rather than each apply replaying a batch of commands frozen into the
  script text back when it was generated. `do_revert()` needed no such
  change: `buildMacTeardown` already ignores its `RedirectOptions` argument
  (`pfctl -a kopytko-net -F all` flushes the whole anchor regardless of what
  was in it), so reverting was always option-independent.
- **This moves real validation responsibility into a root-owned shell
  script — treated as defense-in-depth, not the primary guarantee.** The
  TypeScript `RedirectOptions` type already constrains `proxyPort`/`ports`
  to `number` and `rokuIp` to a device-discovery-sourced string, so in
  practice these values are never attacker-controlled. But now that they
  cross a privilege boundary (unprivileged Node → already-root shell) at
  *runtime* instead of being fixed into a script at generation time and
  elevated as a whole unit, `do_apply` validates their shape before ever
  interpolating them into a `pfctl`/`awk` invocation: `rokuIp` must match
  the glob `[0-9]*.[0-9]*.[0-9]*.[0-9]*` (loose dotted-quad shape — not a
  full range check per octet, which was judged not worth the added
  complexity given the input's real provenance), `proxyPort` and every
  comma-separated port must be all-digits (`case ... in ''|*[!0-9]*)`, the
  classic POSIX "reject anything but digits" idiom). Any failure writes
  `write_status 'failed'` and `return 1` *before* the `pfctl` subshell ever
  runs — verified directly (not just by reading the code) by extracting the
  real generated `do_apply` body into a throwaway harness with `pfctl`/`awk`
  stubbed to capture their invocations: a valid two-port call produced
  exactly the expected `rdr pass ...` lines and the right `pfctl -a
  kopytko-net -f -` invocation; an invalid IP, a non-numeric proxy port, a
  non-numeric port within the list, and an empty ports string all correctly
  exited 1 with `status=failed` and **zero** calls into the stubbed `pfctl`.
- **Values are still passed as separate `read` fields, never `eval`'d or
  shell-interpolated as one blob.** The watchdog's command loop already read
  multiple fields (`read -t 1 -r cmd rokuIp proxyPort portsCsv <&3`) — POSIX
  `read` assigns unmatched trailing variables to empty string when a command
  like `revert`/`stop` supplies no arguments, so there's no stale-value
  bleed-through from a previous iteration to worry about. `PF_ANCHOR` itself
  stays a script-generation-time constant (never influenced by the FIFO), so
  only the redirect *target* is runtime-parameterized, not the anchor name
  or any other structural part of the pf rules.
- **A real bug this surfaced: a test with a dangling `setInterval` hung the
  whole suite.** While rewriting `macHelperSupervisor.test.ts` for this
  change, one test (`disable(): ... revert signal itself fails to send`)
  called `enable()` (starting the heartbeat `setInterval`) and `disable()`
  but never `teardown()` — harmless under the *previous* design (where
  `disable()` itself always cleared the heartbeat, since it was a full stop
  at the time), but fatal under the new one, where `disable()` deliberately
  leaves the heartbeat running so the helper can be reused. `.mocharc.json`
  has no `--exit`, so Node kept the process alive waiting on that one
  interval and `npm test` never returned — no failing assertion, no error,
  just an indefinite hang. General lesson for this codebase: any test that
  calls a `MacHelperDriver.enable()` must reach a `teardown()` (not just
  `disable()`) before the test ends, in a `try`/`finally` or unconditionally
  at the end, or it leaks a live timer into the test process.
- **Net effect on the "asymmetry" note in the very first entry of this
  section:** Windows' `disable()` still fully exits its companion (a fresh
  UAC prompt every `enable()`), which was flagged there as a documented,
  deliberate scope decision (the user asked specifically about macOS). That
  gap is now wider between the two platforms than when this file's macOS
  section was first written, since macOS has since gone from "no reprompt on
  disable" all the way to "no reprompt ever, mid-session" while Windows is
  unchanged — worth a mention if a future session is asked to extend the
  same treatment to Windows.

## macOS helper: fixed a real hang-and-stuck-off bug from the persistent-helper redesign (2026-07-23)

User-reported symptom after toggling capture off/on twice in quick
succession ("disconnected and connected 2 times"): the panel showed capture
as **off** and clicking the toggle back **on did nothing** — yet traffic was
still being captured and the OS-level `pf` redirect was still active. UI
state and real state had diverged, in the worst possible direction (silently
still running while claiming to be off).

**Root cause: `defaultSendCommand`'s FIFO write had no timeout.**
`fs.writeFile(fifoPath, ...)` opens the FIFO for writing, which blocks at the
OS level until a reader is present. The watchdog normally keeps one open for
the whole session, but if it died uncleanly (killed, crashed, reclaimed on
sleep/wake — anything short of reaching `teardown_and_exit`'s `rm -f
"$CMD_FIFO"`), the FIFO file lingers on disk with zero readers, and that
write hangs *forever* — no error, no timeout, nothing. This is the same
class of gotcha as the open-FIFO-blocks-until-writer note earlier in this
file, but on the Node side instead of the shell side, and nobody had put a
bound on it.

Tracing the actual failure chain against `networkController.ts`'s `disable()`:
`this.enabled = false` is set **synchronously, before any `await`** (so the
UI immediately reports "off"), then `await this.deps.redirect.disable()` is
what hangs — meaning the `finally` block that stops the capture proxy and
frees its port **never runs**. The proxy keeps listening and recording (matches
"recording works"), and the `pf` anchor was never reverted (matches "traffic
still redirected"). The next `enable()` call then tries to bind a *new* proxy
instance to the same port the old, never-stopped one still holds — that's
the "cannot toggle it on again" the user saw. One missing timeout, at the very
bottom of the stack, explained every symptom.

**Compounding gap: zero re-entrancy protection.** Nothing between the
webview's toggle handler and `MacHelperDriver` serializes calls — two quick
clicks (or `RedirectController.enable()`'s own "revert first if already
applied" nested call overlapping an in-flight click) run concurrently and
can read/write the same `session` fields out of order. Not the proximate
cause of this specific report (a plain sequential disable-then-enable is
enough to hit the FIFO-timeout bug above), but a real gap that makes hitting
it — and corrupting state in less predictable ways — much easier under rapid
toggling, which is exactly what the user described doing.

**Fix, in `macHelperSupervisor.ts`:**
- `defaultSendCommand` now races its `fs.writeFile` against a 3s timeout
  (`SEND_TIMEOUT_MS`, `withTimeout()`) and rejects with a clear "no reader —
  the helper is likely dead" error instead of hanging. The existing
  catch/timeout-handling logic in `disable()`/`teardown()`/`tryReapply()`
  already assumed sends could fail — it just never actually could before, so
  that logic was true in principle but unreachable in this one specific way.
- `MacHelperDriver` gained a private serial queue (`this.queue`, `serialize()`);
  `enable()`/`disable()`/`teardown()` are now thin wrappers that run their
  actual bodies (`enableLocked`/`disableLocked`/`teardownLocked`) through it,
  so overlapping calls execute one at a time in call order instead of racing.
  `enableLocked`'s internal re-launch path calls `teardownLocked()` directly
  (not the public `teardown()`) — calling back into `serialize()` from
  *inside* an already-serialized function would deadlock (it would enqueue
  behind itself and then await a queue slot it's the one blocking).
- Verified the actual hang (not just the timeout math) with a real
  `mkfifo`'d pipe and no reader in `macHelperSupervisor.test.ts`:
  `defaultSendCommand` rejects around 3000ms as expected. That test then
  opens a reader in a `finally` to let the still-pending background
  `fs.writeFile` finally rendezvous and complete — the timeout only rejects
  the *promise*, it can't cancel the underlying blocked OS call, and leaving
  it truly stuck would tie up a libuv threadpool thread for the rest of the
  test process's life, which risks silently re-creating this file's earlier
  "dangling timer hangs the whole suite" problem in a new form.
- Added a serialization test that fires `disable()`/`enable()` concurrently
  with an artificially slow fake `sendCommand` and asserts every `send:X`/
  `sent:X` pair is contiguous in the observed order — i.e. never interleaved
  with another command's send.
- Not fixed here, intentionally: the webview toggle checkbox itself still
  isn't disabled while a request is in flight, and `NetworkController`/
  `RedirectController` still have no locking of their own. The
  `MacHelperDriver`-level queue is enough to stop the shared FIFO/session
  state from corrupting under overlap (concurrent `RedirectController`
  calls' state fields converge to a self-consistent end value because the
  underlying mac-driver operations they `await` are strictly ordered), but a
  polished "ignore rapid double-clicks" UX fix at the panel layer is a
  separate, smaller follow-up if it comes up again.

## macOS helper: a repeated full pf.conf reload was clobbering Internet Sharing's NAT (2026-07-23, same day, more serious follow-up)

**Worse than the previous entry's bug, and directly caused by the same
persistent-reuse redesign.** User report: with capture enabled, the Roku's
HTTPS connections started failing (timeout/reset) — and unlike every other
issue in this file, **toggling capture off did not fix it, only rebooting the
Mac did.** That "only a reboot fixes it" detail was the key diagnostic
signal: nothing this extension's own `disable()`/`revert` touches could
explain a symptom that survives a full revert, which means something outside
this extension's own tracked state got corrupted.

**Root cause: `do_apply()` re-ran the `/etc/pf.conf` anchor-registration
check on every single `apply`, not just the first launch.** That check
(`pfctl -s Anchor | grep -q kopytko-net || { awk ... | pfctl -f - }`,
originally `buildMacSetup` in `redirectController.ts`, carried over verbatim
into `macHelperScript.ts`'s `do_apply`) is the *only* operation in this whole
codebase with reach beyond our own anchor — the `awk`/`pfctl -f -` branch
reloads macOS's **entire main pf ruleset** from `/etc/pf.conf`, not just
`kopytko-net`'s own rules. In the original one-shot design this could only
ever run once per machine in practice (the anchor's `/etc/pf.conf`
*reference* is permanent once inserted, so the check should short-circuit
every time after). But once `do_apply` became reusable — called from the
FIFO on every toggle, not just at process launch — the check runs after
every `revert` too. If `pfctl -s Anchor` stops listing `kopytko-net` as a
*live* anchor once our own `-F all` flush empties it (plausible: `pfctl -s
Anchor` reflects the kernel's currently-loaded anchor table, which is
distinct from what's merely *referenced* in the pf.conf text — this is a
real macOS/pf behavior difference that needed the user's own machine to
surface, not something visible from source or from this repo's Linux/WSL
test environment), then the very next `apply` after a `revert` spuriously
fails that check and re-triggers the full reload — every single toggle
cycle, forever, instead of once ever. A full reload of `/etc/pf.conf`
triggered from outside Internet Sharing's own lifecycle management doesn't
reliably cause Internet Sharing's NAT anchor to get reinstated afterward,
even though the *reference* to it in the reloaded file is untouched — NAT
for every device behind Internet Sharing (not just the Roku) breaks, and
nothing short of a reboot re-initializes it.

**Why this explains "HTTP still works, HTTPS breaks":** the `kopytko-net`
anchor's only rule (`rdr pass ... to any port 80 -> 127.0.0.1:<proxyPort>`)
redirects the Roku's port-80 traffic straight to loopback — it never needs
NAT/routing out to the real internet at all, so it kept working even with
Internet Sharing's NAT broken. HTTPS (443, never touched by our redirect)
has no such shortcut — it needs the now-broken NAT path to reach anything
outside this Mac, so it failed outright.

**Fix:** split the anchor-registration bootstrap out of `do_apply` into its
own `ensure_anchor_referenced()` function, called **exactly once**, in the
script's synchronous top-level flow, before the watchdog is even
backgrounded — never again from inside the FIFO command loop's `apply)`
case. `do_apply` itself now only ever touches its own anchor (`pfctl -a
"$PF_ANCHOR" -f -`), which is scoped and safe to call as many times as
toggling happens. This matches what the *original* one-shot design actually
did in practice (bootstrap effectively ran once per machine) rather than
introducing a new "recheck every toggle" pattern that had no real reason to
exist — the anchor reference doesn't change after the first successful
insert, so there was never a need to re-verify it on every reapply.

**Process note — this is the second real bug shipped in this reuse
redesign within the same day** (the FIFO-hang bug above being the first).
Both were only found because a real user hit them on real hardware and
described precise, specific symptoms ("only fixed by rebooting" was what
actually cracked this one) — neither was, or realistically could have been,
caught by this repo's test suite, since `pfctl`'s actual kernel-level anchor
tracking behavior and Internet Sharing's NAT management are both macOS
system behaviors this repo cannot exercise from Linux/WSL. The regression
test added (`macHelperScript.test.ts`) can only verify the *shape* of the
fix (bootstrap called once, `do_apply` never touches `pfctl -s Anchor` or
`awk`) — it cannot verify the underlying pf/Internet-Sharing interaction
itself. Anything touching `pfctl` behavior beyond "does this shell script
have the commands we intended" needs on-device verification before being
trusted, no matter how carefully the shell logic is reasoned through
statically.

## macOS helper: the actual root-cause fix — stop touching the main pf ruleset entirely (2026-07-24)

**The "run the bootstrap once" fix directly above was insufficient — the
main-ruleset reload breaks Internet Sharing even when it runs exactly once.**
User rebooted (clearing the broken NAT), launched fresh, enabled capture, and
HTTPS was *still* dead. That falsified the "it's the *repeated* reload" theory
and pinned it on the reload itself: a single `pfctl -f -` of a modified
`/etc/pf.conf`, on the very first enable, flushes the NAT rules Internet
Sharing dynamically loaded into its own `com.apple/*` sub-anchors. "Run it
once" just moved the one guaranteed breakage to the first toggle instead of
every toggle.

**Root cause, stated correctly this time:** the entire approach of
*registering a top-level `rdr-anchor "kopytko-net"` reference in
`/etc/pf.conf` and reloading the main ruleset to activate it* is
fundamentally incompatible with Internet Sharing (which is a hard
prerequisite for this whole feature). Any main-ruleset reload from outside
Internet Sharing's own lifecycle wipes its dynamically-loaded NAT. There is
no "reload it more carefully" — the reload must not happen at all.

**The fix that actually addresses it:** nest our anchor under `com.apple/`
(`PF_ANCHOR` changed from `'kopytko-net'` to `'com.apple/kopytko-net'`). The
default macOS `/etc/pf.conf` already contains `rdr-anchor "com.apple/*"` (and
`nat-anchor`/`anchor` siblings) — a wildcard that evaluates *every*
sub-anchor under `com.apple/` at packet-processing time. This is precisely
how Internet Sharing gets its own rules evaluated: it loads them into a
`com.apple/*` sub-anchor at runtime (via `pfctl -a`, not via the `load
anchor` directive in the file) and the wildcard picks them up. By loading our
rule into `com.apple/kopytko-net` the same way, we get evaluated for free
with **zero** edits to `/etc/pf.conf` and **zero** main-ruleset reloads.
`pfctl -a 'com.apple/kopytko-net' -f -` replaces only our own sub-anchor's
rules; siblings (Internet Sharing's NAT) are untouched. Removed entirely:
the `awk` insert, the `pfctl -f -` reload, the `pfctl -s Anchor` probe, and
`ensure_anchor_referenced` — from both `buildMacSetup`
(`redirectController.ts`) and the helper script (`macHelperScript.ts`). Mac
setup is now just two commands: `printf '<rdr lines>' | pfctl -a
'com.apple/kopytko-net' -f -` and the idempotent `pfctl -e`.

**Failure mode is now safe by construction.** If the assumption is somehow
wrong (a user's `/etc/pf.conf` lacks the `com.apple/*` wildcard, or pf
doesn't evaluate our sub-anchor for some reason), the *only* consequence is
that our redirect silently doesn't work — capture shows no traffic, but the
user's network is completely untouched. Contrast the previous design, whose
failure mode was "break every device's NAT until a reboot." Even without
on-device confirmation of the pf semantics, shipping this is correct because
the worst case degraded from *destructive* to *inert*.

**Confidence / verification honesty (third bug in this redesign — pattern is
now undeniable):** the `com.apple/*` wildcard evaluating manually-loaded
sub-anchors is standard, long-standing pf behavior and is the documented way
tools coexist with Internet Sharing, but this repo *still* cannot execute it
— WSL/Linux has no `pfctl`, no Internet Sharing, no macOS pf kernel. The
tests added only assert the generated commands' shape (nested anchor path
used; `/etc/pf.conf`/`pfctl -f -`/`awk`/`pfctl -s Anchor` all absent). **This
must be confirmed on the user's actual Mac**: with Internet Sharing on and
capture enabled, (a) the Roku's HTTP traffic appears in the capture list, and
(b) HTTPS from the Roku (and every other device behind Internet Sharing)
keeps working normally. If a future session is tempted to add *anything* that
runs `pfctl -f` on the main ruleset, or writes to `/etc/pf.conf`, on macOS —
don't. That is the specific action that broke this three times.

## ⛔ THE ENTIRE macOS PERSISTENT-HELPER FEATURE WAS REVERTED (2026-07-24)

**Everything from "macOS single-elevation persistent helper" onward in this
file describes code that NO LONGER EXISTS.** After three failed fix attempts,
the user asked to drop it and go back to the version that worked. All of
`redirect/mac/`, the `SupervisedRedirectDriver`/`teardown`/`dispose` additions
to `redirectController.ts`, the `macDriver` wiring in `activation/network.ts`,
and the `redirect.dispose()` call in `networkController.ts` were removed;
those files are restored to their pre-feature (`49c803d`) state. macOS is back
to the **original one-shot `ElevatedRunner` path** (`buildMacSetup` with the
`/etc/pf.conf` `rdr-anchor` insert + `pfctl -f -` reload guarded by `pfctl -s
Anchor | grep -q`, then `pfctl -a kopytko-net -f -`). That original design
captures HTTP correctly and leaves HTTPS alone — at the cost of **two admin
prompts per capture session** (one on enable, one on disable), which is the
tradeoff the user accepted.

**The history above is kept on purpose** — it's an accurate record of what was
tried and why each attempt failed, invaluable if anyone revisits the
single-prompt idea. But the key lesson dominates all the technical detail:

- **Do not attempt macOS pf changes without on-device testing.** This repo
  runs on Windows/WSL — there is no `pfctl`, no Internet Sharing, no macOS pf
  kernel anywhere in the dev/CI environment. Every one of the three failures
  was a confident, statically-reasoned change that pf's real behavior then
  contradicted. The `com.apple/*`-wildcard attempt in particular *looked*
  correct and even fixed HTTPS, but the wildcard did **not** evaluate our
  manually-loaded sub-anchor, so HTTP capture silently stopped.
- **The original design's `/etc/pf.conf` reload did NOT break Internet
  Sharing** — proven by the fact that the original shipped with it and worked
  for the user. The reload theory (the basis of two of the three fixes) was
  wrong. What actually differed in the persistent-helper version was never
  conclusively isolated on-device before the revert.
- If the single-prompt feature is revisited: do it as a tight loop with the
  user running `sudo pfctl -sa` / `-s nat` / `-s rdr` and `cat /etc/pf.conf`
  on their actual Mac (Internet Sharing on, capture on) to see what pf really
  does, *before* writing any code — not by reasoning from the source alone.

## ✅ RESOLVED with on-device diagnosis + verified fix (2026-07-24, later same day)

Did exactly the "tight loop with pfctl output" the entry above recommended,
and it cracked the real root cause and produced a fix **empirically verified
on the user's Mac**. **Two conclusions in the revert entry above are now
DISPROVEN** — corrected here (left above intact as an honest record of what
wrong reasoning looked like at the time):

1. ❌ "The `/etc/pf.conf` reload did NOT break Internet Sharing." **It does.**
   The reload theory was right all along.
2. ❌ "The `com.apple/*` wildcard did not evaluate our manually-loaded
   sub-anchor." **It does** evaluate it — HTTP was redirected in the test. The
   `com.apple` attempt (`dc3b993`) failing to capture was NOT a pf-evaluation
   problem; it was almost certainly the persistent-helper machinery around it
   (FIFO/watchdog/apply-validation) failing to actually apply the rule, and/or
   NAT already left broken by a previous build's reload — not the anchor
   approach itself.

**Confirmed root cause (from the user's actual `pfctl` output):** macOS
Internet Sharing injects its NAT anchor into the **running** main ruleset
dynamically at startup — it is NOT in `/etc/pf.conf`. `buildMacSetup`'s
`awk /etc/pf.conf | pfctl -f -` rebuilt the main ruleset from the on-disk
file, which lacks IS's dynamic anchor, so the reload **flushed IS's NAT
anchor reference** out of the running ruleset. Evidence:
- `sudo pfctl -s nat` (captured while broken): showed our redirect reference
  but **no** `com.apple.internet-sharing` NAT reference — flushed.
- `sudo pfctl -s Anchors`: `com.apple.internet-sharing` anchor still *existed*
  but was orphaned (referenced by nothing) → its NAT never ran → device's
  HTTPS (needs NAT to route out) dead; HTTP survived only because our rule
  bounces it to loopback, no NAT needed. Persisted until reboot because IS
  only re-injects on service restart.
- Apple's own `/etc/pf.conf` comment: *"Care must be taken to ensure that the
  main ruleset does not get flushed… some system services would dynamically
  insert anchors into the main ruleset… removed on termination of the
  service."* And `pfctl -f /etc/pf.conf` itself prints: *"could result in
  flushing of rules present in the main ruleset added by the system at
  startup."* macOS was warning about our exact operation.
- **Not** permanently editing `/etc/pf.conf`: `grep kopytko-net /etc/pf.conf`
  was empty. The `awk … | pfctl -f -` modified only the piped stream, never
  the file on disk. (An earlier worry in this file that we permanently edit
  the user's pf.conf was wrong.)

**The verified fix (now in `buildMacSetup`/`buildMacTeardown`, one-shot
path):** load the redirect into the `com.apple/kopytko-net` sub-anchor and
**never reload the main ruleset**:
```
printf '<rdr lines>' | pfctl -a 'com.apple/kopytko-net' -f -
pfctl -e 2>/dev/null || true          # idempotent; IS already enabled pf
```
teardown: `pfctl -a 'com.apple/kopytko-net' -F all`. The default
`/etc/pf.conf`'s `rdr-anchor "com.apple/*"` wildcard already evaluates the
sub-anchor, so no reference needs adding and the main ruleset is never
touched — IS's dynamic NAT anchor stays put.

**On-device proof (user ran these directly):**
- `sudo sh -c 'printf "rdr pass inet proto tcp from <ROKU_IP> to any port 80 -> 127.0.0.1 port 9\n" | pfctl -a "com.apple/kopytko-net" -f -'`
  → Roku HTTP failed (redirected to dead port = rule evaluated), HTTPS kept
  working (IS NAT intact). ✓
- `sudo pfctl -a "com.apple/kopytko-net" -F all` → both HTTP and HTTPS working
  again (clean teardown). ✓

Applied to the **reverted one-shot `ElevatedRunner` path** (NOT the
persistent helper, which stays gone). Because that path runs the pf commands
directly via `osascript`, exactly like the verified manual test — none of the
FIFO/watchdog machinery that may have masked this in `dc3b993`. Still two
admin prompts per session; the single-prompt idea is a separate future task
and MUST reuse this `com.apple/`-nested, no-reload mechanism.

**The enduring lesson, now proven twice over:** never run `pfctl -f` on the
macOS main ruleset while Internet Sharing is active. Scope everything to the
`com.apple/kopytko-net` sub-anchor via `pfctl -a`.

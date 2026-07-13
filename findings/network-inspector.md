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

## Verification gaps / TODO for a later pass

- **On-device transparent redirect not exercised headlessly on macOS/Linux.**
  The real proxy runs in the VS Code Extension Host (native node — WSL can't
  reach the device). To finish: F5 the extension, flip the toggle, launch a
  dev channel calling `http://`, confirm flows appear grouped by origin.
  (Windows is verified live — see the WinDivert entries above.)
- The `auto` fallback (https attempt fails → http) is tested against a
  plaintext upstream; real-TLS `auto` behavior is covered transitively by
  the live https bridge.
- **Crash-residue is not proactively cleaned up on activation** for
  macOS/Linux — if VS Code crashes while capture is on, the OS-level
  redirect survives until the extension runs teardown again, which only
  happens via an explicit disable/dispose/deactivate. A future pass could
  call `redirect.disable()` defensively once at activation. Windows doesn't
  have this gap — the WinDivert companion's redirect dies with the process
  by construction, and self-terminates on its own if the extension host
  goes silent.
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

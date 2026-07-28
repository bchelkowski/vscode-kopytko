# Network Inspector — Reference

> Full history — every approach tried, why three of them failed, and the raw diagnostics:
> [archive/network-inspector-journal.md](archive/network-inspector-journal.md).
> Read it only when revisiting a decision below. Note the archive contains a **reverted**
> macOS persistent-helper feature and two conclusions later disproven; this file is the
> current truth.
>
> User-facing docs: `docs/network-inspector.md`.

---

## ⛔ Never do this

- **Never run `pfctl -f` on the macOS main ruleset, and never write to `/etc/pf.conf`.**
  Internet Sharing injects its NAT anchor into the *running* ruleset at startup — it is not on
  disk — so reloading from the file flushes IS's NAT and kills the device's HTTPS until reboot.
  Apple's own `pf.conf` comment and `pfctl`'s own warning both say this. Scope everything to the
  `com.apple/kopytko-net` sub-anchor via `pfctl -a`. **This broke three times before it was
  understood.**
- **Never change macOS pf behaviour without testing on a real Mac.** There is no `pfctl`, no
  Internet Sharing, and no pf kernel in this repo's Windows/WSL/CI environment. Every one of the
  three failures was a confident, statically-reasoned change that pf's real behaviour contradicted.
- **Never call `nextFlowId()` in a terminal emit path.** Ids are pre-allocated in
  `handleRequest`/`replay` and threaded through `RequestMeta.id`; minting a second id strands a
  pending row forever.
- **Never revive `netsh portproxy` or hosts-file redirect on Windows.** Both are protocol-blind —
  they redirect a hostname, never a hostname *and* port — which broke an app's hardcoded HTTPS
  bootstrap in a live session. WinDivert replaced them.
- **Never assume the device can be reached from WSL.** The 192.168.137.x hotspot range is
  unreachable there; probe from native Windows.

---

## The model: no-CA https↔http bridging

The whole design follows from **HTTP-only on the device side**, which removes the reason mitmproxy
exists (TLS interception, CA generation, device trust store):

- The device speaks plaintext HTTP, so the proxy reads the `Host` header to find upstream — no
  `SO_ORIGINAL_DST` or pf lookups needed.
- The proxy **bridges to HTTPS upstream** and **rewrites `https://` → `http://` in response
  bodies**, so the app stays on HTTP for every follow-up URL it learns from a backend dictionary.
  TLS terminates at the proxy under normal OS trust — HTTPS backends are seen decrypted with **no
  certificate installed on the Roku**.
- Pure Node `http`/`https`, shipped as an ordinary esbuild bundle. No Python, no native module.
- **Transparent redirect is still required.** The app calls real hostnames on :80, so the device's
  :80 packets must be pulled to the proxy at the gateway. The rewrite model changes what the proxy
  does with a request, not how the request reaches it.

---

## Correctness rules the bridging model forces

All covered by tests; all fixed policy in the proxy, not user rules.

| Rule | Why |
|---|---|
| Strip `transfer-encoding`, `content-length`, `host`, `accept-encoding`, `proxy-connection` from forwarded request headers and set `content-length` ourselves | Copying `Transfer-Encoding: chunked` *and* setting `Content-Length` makes an invalid message — the POST body silently vanished |
| Ask upstream for `accept-encoding: identity`, but still decode gzip/deflate/br as fallback | Some servers ignore it. Always re-emit identity downstream with a recomputed `Content-Length` |
| Strip `Secure` from `Set-Cookie`, `SameSite=None` → `Lax` | A device on plaintext HTTP silently drops auth cookies otherwise |
| Rewrite `Location`/`Content-Location` https→http; drop `Strict-Transport-Security` | Same reason |
| Skip TLS `servername` for IPv4/IPv6 literals | SNI to an IP literal is RFC-invalid and triggers Node DEP0123 |

---

## SO_KEEPALIVE kills long-polls (the ETIMEDOUT bug)

**Node's `http.Agent` default `keepAliveMsecs: 1000` is far more aggressive than the OS default
(~2 hours) and is applied to every pooled socket.** On a network path that swallows keepalive
probes, any request quiet for >1s — long-polls especially — dies with a spurious
`read ETIMEDOUT` about 10–12s into the quiet window. Short requests never idle long enough to
probe, so they are unaffected; Charles doesn't probe aggressively, so it never reproduced.

Proven by an A/B diagnostic on the affected machine: `setKeepAlive(true, 1000)` died at ~11.5s,
without it the same request held the full 30s and returned 200 — on both OS-DNS and pinned-IP
connections. DNS was fully exonerated.

**Why it looked like a stale-pool bug first**: Node applies `keepAliveMsecs` in `keepSocketAlive()`,
i.e. when a socket enters the **reuse pool**. Fresh sockets keep the OS default. So only *reused*
sockets carried the 1s probe delay and only they died — perfectly correlated with reuse, causally
unrelated to staleness.

**Current fix**: `socket.setKeepAlive(false)` in `forward()`'s `'socket'` handler — SO_KEEPALIVE
fully off for every in-flight upstream request. `keepAliveMsecs: 60_000` alone was **not** enough on
macOS. The agent re-arms keepalive when a socket is *freed*, so pool-idle sockets still get 60s
probing (useful — it reaps dead pooled sockets), and each new request disables it again before its
quiet window. A reused-socket single-retry stays as defence in depth.

---

## Transparent redirect

`RedirectController` takes an injected `ElevatedRunner` and platform; pure
`buildSetupCommands`/`buildTeardownCommands` are exported and unit-tested per OS. Teardown is
idempotent and runs on panel dispose + extension deactivate.

| OS | Mechanism |
|---|---|
| **macOS** | Load the rdr rule into the **`com.apple/kopytko-net` sub-anchor** (`pfctl -a 'com.apple/kopytko-net' -f -`), then `pfctl -e`. The stock `/etc/pf.conf` `rdr-anchor "com.apple/*"` wildcard already evaluates it, so **nothing references the main ruleset**. Teardown: `pfctl -a 'com.apple/kopytko-net' -F all`. Costs two admin prompts per session — accepted. |
| **Linux** | Dedicated `KOPYTKO_NET` nat chain, created/flushed idempotently, jumped from PREROUTING once. Revert flushes and deletes only that chain. |
| **Windows** | WinDivert companion (`redirect/windows/`). Driver is **bundled** in `resources/win/x64/` (official unmodified 2.2.2 x64 redistributable, ~140 KB, LGPLv3/GPLv2). `kopytko.network.winDivertDir` is an escape hatch, scoped **machine-level not workspace** — a driver path in a shared `.vscode/settings.json` would be fought over by teammates. Without a driver, `enable()` throws `RedirectUnsupportedError` and the proxy keeps running with `redirectStatus: 'unsupported'`. |

`elevate.ts` writes the batch to an auditable `.sh` under global storage, run via `osascript … with
administrator privileges` (macOS) or `pkexec` (Linux).

**Windows companion lesson:** four consecutive live F5 runs produced four distinct real bugs that
unit tests and reasoning had all missed — including a silent `Add-Type` failure that logged nothing
because `Write-CompanionStatus 'starting'` sat *after* it. Generated PowerShell must be run on real
hardware before it is trusted.

---

## Flow lifecycle: `'flow'` is an upsert by id

Requests appear immediately (muted italic row, `…` status, live elapsed ticker) and update in place
on completion. Deliberately **not** a separate message kind. Invariants:

- Every terminal emitter carrying a `meta` uses `meta.id`. The only remaining `nextFlowId()` call
  sites are `handleRequest`, `replay`, and the two meta-less paths
  (`recordUnparseableRequest`, `recordClientError`) — the only exchanges with no pending phase.
  Blocked-by-rule requests skip the pending emit so a blocked flow never flashes.
- `NetworkController.onFlow` merges a known id in place (`Object.assign`, keeping array position)
  and **bypasses the pause and device-IP gates for known ids** — those gates were decided at
  admission, and dropping a completion strands the pending row. Byte accounting is delta-based, and
  `delete existing.pending` is required because `Object.assign` cannot remove keys.
- **Ordering races self-heal**: a pending flow evicted by the ring/byte cap makes its completion an
  unknown id again, so it simply appends. Accepted quirk — Clear during an in-flight request
  re-lists it on completion.
- **Persistence is completion-only.** The NDJSON store is append-only with one immutable line per
  flow; HAR export filters pending out; `replay()` throws on a pending id.
- **"Bodies are immutable per flow" no longer holds.** A detail cached while pending is invalidated
  on the completing upsert *and* on `init` resync (via a `prevPendingIds` set captured before the
  rebuild — the flow may have completed while the panel was hidden).
- Tests that count `'flow'` emits to detect retries must count **terminal** emits only.

---

## Webview performance

- **Incremental rendering, not per-flow rebuilds.** Live `flow`/`trim` messages queue in
  `pendingFlows`/`pendingTrimIds` and flush as targeted `insertAdjacentHTML` / `row.remove()`,
  coalesced per `requestAnimationFrame` **with a 100 ms `setTimeout` fallback** — rAF alone stalls
  while the tab is backgrounded (VS Code throttles hidden webviews) and the queues would grow
  unbounded. First timer wins; a `flushScheduled` flag makes the loser a no-op.
- Full `renderTree()` remains for init/clear/filter/collapse and **must clear both pending queues** —
  forgetting this double-renders rows.
- Bodies are captured capped (`maxBodyBytes`, default 256 KB) for display/HAR; the **full body is
  always forwarded to the device**. Detail bodies load lazily via `select-flow` → `flow-detail`.
- **Error flows carry the request body.** `finishError` originally emitted `requestBytes: 0` and no
  body, so an ERR flow — exactly the one you most need to reproduce — had empty replay,
  copy-as-cURL, and `.req` persistence.

---

## Wiring

- `NetworkController` is deliberately **`vscode`-free** — config, save dialogs, and messages are
  injected from `activation/network.ts`. Unit-testable with plain fakes, no `vscode-mock`.
- Webview `protocol.ts` re-exports rule types from `capture/rewrite/rules.ts` via `import type`
  (erased by esbuild, so no Node code leaks into the browser bundle).

---

## Key files

| Area | File |
|---|---|
| Controller | `src/client/network/networkController.ts` |
| Proxy engine | `src/client/network/capture/captureProxy.ts` |
| Flow records / cURL | `src/client/network/capture/flow.ts`, `capture/curl.ts` |
| Rewrite rules | `src/client/network/capture/rewrite/` |
| Redirect | `src/client/network/redirect/redirectController.ts`, `redirect/elevate.ts` |
| Windows companion | `src/client/network/redirect/windows/` |
| Gateway detection | `src/client/network/discovery/gatewayIp.ts` |
| DNS bypass | `src/client/network/dnsBypass.ts` |
| Session store | `src/client/network/storage/networkSessionStore.ts` |
| Webview | `src/client/network/webview/main.ts` |

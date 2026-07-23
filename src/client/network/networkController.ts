/**
 * Orchestrates the Network Inspector: owns the capture proxy + OS redirect
 * lifecycle behind a single enable/disable, keeps a ring buffer of flows,
 * filters to the active device, hot-reloads rewrite rules, and builds HAR.
 *
 * Deliberately free of any `vscode` import — all editor concerns (config,
 * messages, save dialogs) are injected by `activation/network.ts`, so this
 * class unit-tests with plain fakes.
 */

import { EventEmitter } from 'events';
import { CaptureProxy, CaptureProxyOptions } from './capture/captureProxy';
import { FlowBodies, FlowRecord, toFlowDetail, toSerializedFlow } from './capture/flow';
import { RedirectController, RedirectUnsupportedError } from './redirect/redirectController';
import { RuleSet } from './capture/rewrite/rules';
import { isTextContentType } from './capture/rewrite/engine';
import type { BodyFileKind, NetworkSessionStore } from './storage/networkSessionStore';
import type { FlowDetail, InterceptPayload, InterceptResult, RedirectStatus, SearchHit, SerializedFlow, WebviewState } from './webview/protocol';

export interface DeviceLike {
  ip: string;
  friendlyName?: string;
  modelName?: string;
}

export interface NetworkConfig {
  proxyPort: number;
  redirectPorts: number[];
  maxEntries: number;
  /** Approximate byte budget for retained flows (bodies + header overhead). 0 disables. */
  maxBufferBytes: number;
  filterToActiveDevice: boolean;
  maxBodyBytes: number;
  /** Reuse upstream connections between proxy and origins (device side always closes). */
  upstreamKeepAlive: boolean;
  /** How long a breakpoint pause waits for the user before auto-continuing (ms). */
  breakpointTimeoutMs: number;
  rules: RuleSet;
}

export interface NetworkControllerDeps {
  deviceManager: { getActiveDevice(): DeviceLike | undefined };
  redirect: RedirectController;
  readConfig: () => NetworkConfig;
  /** Optional diagnostic sink (output channel + console). */
  log?: (msg: string) => void;
  /** Overridable for tests. */
  proxyFactory?: (opts: CaptureProxyOptions) => CaptureProxy;
  /**
   * Optional on-disk session store — persists each session's flow metadata
   * and FULL body bytes (the in-memory buffers stay capped at `maxBodyBytes`).
   * Store failures are logged, never allowed to break capture.
   */
  sessionStore?: NetworkSessionStore;
}

/**
 * Emits:
 *  - `'flow'`    (entry: SerializedFlow) — a new flow, or an in-place update
 *                of an already-emitted id (`pending` in-flight record →
 *                terminal record); consumers upsert by `entry.id`
 *  - `'trimmed'` (ids: string[]) — oldest flows evicted by the count/byte caps
 *  - `'state'`   (state: WebviewState)
 *  - `'rules'`   (rules: RuleSet)
 *  - `'cleared'`
 */
export class NetworkController extends EventEmitter {
  private proxy: CaptureProxy | null = null;
  private enabled = false;
  private redirectStatus: RedirectStatus = 'off';
  private message: string | undefined;
  private deviceIp: string | undefined;
  private proxyPort = 8888;

  private readonly flows: FlowRecord[] = [];
  private readonly byId = new Map<string, FlowRecord>();
  private rules: RuleSet;
  private _maxEntries = 5000;
  private maxBufferBytes = 0;
  private bufferBytes = 0;
  private filterToActiveDevice = true;
  private paused = false;
  private breakpointTimeoutMs = 30000;
  /** Paused intercepts awaiting a webview decision, keyed by intercept id. */
  private readonly pendingIntercepts = new Map<string, { payload: InterceptPayload; resolve: (r: InterceptResult) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly deps: NetworkControllerDeps) {
    super();
    const config = deps.readConfig();
    this.rules = config.rules;
    this._maxEntries = Math.max(1, config.maxEntries);
    this.maxBufferBytes = Math.max(0, config.maxBufferBytes);
    this.breakpointTimeoutMs = Math.max(1000, config.breakpointTimeoutMs);
  }

  private log(msg: string): void {
    this.deps.log?.(msg);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Ring-buffer entry cap — the webview mirrors this client-side. */
  get maxEntries(): number {
    return this._maxEntries;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Pauses/resumes recording. Proxy + redirect stay up — traffic still bridges. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.emitState();
  }

  getRules(): RuleSet {
    return this.rules;
  }

  getHistory(): SerializedFlow[] {
    return this.flows.map(toSerializedFlow);
  }

  getState(): WebviewState {
    const device = this.deps.deviceManager.getActiveDevice();
    return {
      enabled: this.enabled,
      paused: this.paused,
      redirectStatus: this.redirectStatus,
      proxyPort: this.proxyPort,
      deviceIp: device?.ip,
      deviceLabel: device ? device.friendlyName ?? device.modelName : undefined,
      message: this.message,
    };
  }

  getDetail(id: string): FlowDetail | undefined {
    const rec = this.byId.get(id);
    return rec ? toFlowDetail(rec) : undefined;
  }

  /** Raw host-side record — for copy-as-curl / replay, not for the webview. */
  getRecord(id: string): FlowRecord | undefined {
    return this.byId.get(id);
  }

  /** Currently-paused intercepts — replayed to the webview on (re)connect. */
  getPendingIntercepts(): InterceptPayload[] {
    return [...this.pendingIntercepts.values()].map((p) => p.payload);
  }

  /**
   * Re-sends a captured request through the running proxy as a new,
   * `replayed`-tagged flow. When the in-memory request body was truncated at
   * the retention cap, the full body is read back from the on-disk session
   * so the replay sends exactly what the device originally sent.
   */
  async replay(id: string): Promise<void> {
    const rec = this.byId.get(id);
    if (!rec) throw new Error('Request is no longer in the capture buffer.');
    if (rec.pending) throw new Error('Request is still in flight — wait for it to complete before replaying.');
    if (!this.proxy) throw new Error('Enable capture to replay requests.');
    const fullBody = rec.requestBodyTruncated
      ? await this.deps.sessionStore?.readBody(id, 'req').catch(() => null)
      : null;
    this.proxy.replay(fullBody ? { ...rec, requestBody: fullBody, requestBodyTruncated: false } : rec);
  }

  /** Whether the full (untruncated) request body is available from the on-disk session. */
  async hasFullRequestBody(id: string): Promise<boolean> {
    try {
      return (await this.deps.sessionStore?.hasBody(id, 'req')) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Full body bytes for a flow — from the on-disk session when present
   * (complete), else the in-memory retained buffer (possibly truncated).
   */
  async getFullBody(
    id: string,
    body: 'request' | 'response',
    variant: 'current' | 'original',
  ): Promise<{ data: Buffer; complete: boolean } | undefined> {
    const rec = this.byId.get(id);
    if (!rec) return undefined;
    const kind: BodyFileKind =
      body === 'request' ? (variant === 'original' ? 'req.orig' : 'req') : variant === 'original' ? 'res.orig' : 'res';
    const fromDisk = await this.deps.sessionStore?.readBody(id, kind).catch(() => null);
    if (fromDisk) return { data: fromDisk, complete: true };
    const mem =
      body === 'request'
        ? variant === 'original'
          ? rec.originalRequestBody
          : rec.requestBody
        : variant === 'original'
          ? rec.originalResponseBody
          : rec.responseBody;
    if (!mem) return undefined;
    // The original* buffers are capped by the same limit; the direction's
    // truncated flag is the closest signal we have for them too.
    const truncated = body === 'request' ? rec.requestBodyTruncated : rec.responseBodyTruncated;
    return { data: mem, complete: !truncated };
  }

  /**
   * Bridges a proxy breakpoint pause to the webview: emits `'intercept'` and
   * returns a promise resolved when the user decides (via `resolveIntercept`)
   * or the timeout fires (auto-continue, so a forgotten breakpoint can never
   * hang the device forever).
   */
  private handleIntercept(payload: InterceptPayload): Promise<InterceptResult> {
    return new Promise<InterceptResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingIntercepts.delete(payload.id)) {
          this.emit('interceptResolved', payload.id);
          resolve({ action: 'continue' });
        }
      }, this.breakpointTimeoutMs);
      this.pendingIntercepts.set(payload.id, { payload, resolve, timer });
      this.emit('intercept', payload);
    });
  }

  /** Applies the user's decision to a paused intercept. */
  resolveIntercept(id: string, result: InterceptResult): void {
    const pending = this.pendingIntercepts.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingIntercepts.delete(id);
    this.emit('interceptResolved', id);
    pending.resolve(result);
  }

  /** Continues every paused intercept unmodified — used when capture stops. */
  private drainIntercepts(): void {
    for (const [id, pending] of this.pendingIntercepts) {
      clearTimeout(pending.timer);
      this.emit('interceptResolved', id);
      pending.resolve({ action: 'continue' });
    }
    this.pendingIntercepts.clear();
  }

  /**
   * Case-insensitive scan across all buffered flows (newest first) over URL,
   * headers, and text bodies. Binary bodies are skipped. Capped at 200 hits.
   */
  search(query: string): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    const LIMIT = 200;
    for (let i = this.flows.length - 1; i >= 0 && hits.length < LIMIT; i--) {
      const rec = this.flows[i];
      const url = `${rec.host}${rec.path}${rec.query ? `?${rec.query}` : ''}`;
      if (url.toLowerCase().includes(q)) {
        hits.push({ id: rec.id, where: 'url', snippet: url });
        continue;
      }
      const headerHit = findHeaderHit(rec.requestHeaders, q) ?? findHeaderHit(rec.responseHeaders, q);
      if (headerHit) {
        hits.push({ id: rec.id, where: headerHit.where, snippet: headerHit.snippet });
        continue;
      }
      const bodyHit = searchBody(rec.requestBody, rec.requestHeaders, q, 'request body')
        ?? searchBody(rec.responseBody, rec.responseHeaders, q, 'response body', rec.contentType);
      if (bodyHit) hits.push({ id: rec.id, where: bodyHit.where, snippet: bodyHit.snippet });
    }
    return hits;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  async enable(): Promise<void> {
    if (this.enabled) return;

    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      throw new Error('No active Roku device selected. Select a device first.');
    }

    const config = this.deps.readConfig();
    this.rules = config.rules;
    this._maxEntries = Math.max(1, config.maxEntries);
    this.maxBufferBytes = Math.max(0, config.maxBufferBytes);
    this.breakpointTimeoutMs = Math.max(1000, config.breakpointTimeoutMs);
    this.filterToActiveDevice = config.filterToActiveDevice;
    this.proxyPort = config.proxyPort;
    this.deviceIp = device.ip;
    this.message = undefined;

    const proxy = (this.deps.proxyFactory ?? ((o) => new CaptureProxy(o)))({
      port: config.proxyPort,
      maxBodyBytes: config.maxBodyBytes,
      keepAlive: config.upstreamKeepAlive,
      onIntercept: (payload) => this.handleIntercept(payload),
    });
    proxy.setRules(this.rules);
    proxy.on('flow', (rec: FlowRecord, bodies?: FlowBodies) => this.onFlow(rec, bodies));
    proxy.on('error', () => {
      /* surfaced via start() rejection; per-request errors are recorded as flows */
    });

    await proxy.start();
    this.proxy = proxy;
    this.proxyPort = proxy.port;
    this.log(`Capture proxy listening on 127.0.0.1:${this.proxyPort}`);

    // Apply the OS redirect. Unsupported (Windows) keeps the proxy running so
    // a user could route traffic manually; a real failure rolls the proxy back.
    try {
      this.redirectStatus = 'applying';
      this.log(`Applying ${this.deps.redirect.targetPlatform} traffic redirect for ${device.ip} :${config.redirectPorts.join(',')} → proxy :${this.proxyPort}`);
      await this.deps.redirect.enable({
        rokuIp: device.ip,
        proxyPort: this.proxyPort,
        ports: config.redirectPorts,
      });
      this.redirectStatus = 'on';
      this.log('Traffic redirect applied.');
    } catch (err) {
      if (err instanceof RedirectUnsupportedError) {
        this.redirectStatus = 'unsupported';
        this.message = err.message;
        this.log(`Automatic redirect unavailable: ${err.message}`);
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        this.log(`Redirect FAILED, rolling back proxy: ${detail}`);
        await proxy.stop();
        this.proxy = null;
        this.redirectStatus = 'error';
        this.message = detail;
        throw err;
      }
    }

    // Start the on-disk session (flow metadata + full body bytes). A store
    // failure only costs persistence — capture itself must keep working.
    try {
      await this.deps.sessionStore?.startSession({
        device: { ip: device.ip, label: device.friendlyName ?? device.modelName },
        proxyPort: this.proxyPort,
      });
      const dir = this.deps.sessionStore?.sessionDir;
      if (dir) this.log(`Session folder: ${dir}`);
    } catch (err) {
      this.log(`Session store unavailable — full bodies won't be persisted: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.enabled = true;
    this.emitState();
  }

  async disable(): Promise<void> {
    if (!this.enabled && !this.proxy) return;
    this.enabled = false;
    this.paused = false;
    this.drainIntercepts();

    try {
      await this.deps.redirect.disable();
    } finally {
      this.redirectStatus = 'off';
      this.message = undefined;
      if (this.proxy) {
        // The controller owns the proxy outright — drop our listeners so a
        // stopped instance can never feed flows into a later session.
        this.proxy.removeAllListeners('flow');
        this.proxy.removeAllListeners('error');
        await this.proxy.stop();
        this.proxy = null;
      }
      try {
        await this.deps.sessionStore?.endSession();
      } catch (err) {
        this.log(`Failed to finalize the session manifest: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.emitState();
    }
  }

  // ── data ──────────────────────────────────────────────────────────────────

  private onFlow(rec: FlowRecord, bodies?: FlowBodies): void {
    // A known id is the second half of an already-recorded exchange (the
    // proxy emits pending → terminal with the same id): merge in place and
    // skip the gates below — they were decided when the pending record was
    // admitted, and dropping a completion here would strand a pending row.
    // If the pending record was evicted (or cleared) first, the id is
    // unknown again and the completion simply appends via the miss path.
    const existing = this.byId.get(rec.id);
    if (existing) {
      this.bufferBytes -= flowCost(existing);
      Object.assign(existing, rec);
      // Completed records omit `pending`; Object.assign can't remove keys.
      if (!rec.pending) delete existing.pending;
      this.bufferBytes += flowCost(existing);
      // Persistence stays completion-only — a pending record has no bodies
      // and no final status, and the NDJSON store is append-only.
      if (!rec.pending) void this.persistFlow(existing, bodies);
      this.emit('flow', toSerializedFlow(existing));
      return;
    }
    // Replays are user-initiated: they bypass both the pause gate and the
    // device-IP filter (their clientIp is a loopback placeholder anyway).
    if (this.paused && !rec.replayed) return;
    // Device-IP filtering only makes sense when the redirect preserves the
    // device's original source IP end to end — true for macOS/Linux's real
    // NAT redirect (`iptables`/`pf`), but NOT for Windows even when
    // `redirectStatus === 'on'` there. Two Windows paths both funnel traffic
    // through a *new* local connection instead of preserving the source IP:
    //  - `unsupported` (netsh portproxy manual fallback): a brand-new local
    //    connection to the proxy.
    //  - `on` via the WinDivert companion: packets are bridged through
    //    127.0.0.1 (both source AND destination rewritten to loopback,
    //    required for Windows to accept the injected packet for local
    //    delivery at all — see findings/network-inspector.md), so the proxy
    //    sees every connection as coming from 127.0.0.1 too, never the real
    //    device IP, despite this otherwise being a "real" transparent
    //    redirect. Filtering on clientIp here would silently drop every flow.
    // There's also nothing to filter *from* on Windows either way: the
    // WinDivert companion's own packet filter is already scoped to exactly
    // the active device's IP, and the manual fallback only ever receives
    // what the user explicitly routed via the generated script.
    const clientIpIsTrustworthy = this.deps.redirect.targetPlatform !== 'win32';
    if (
      this.filterToActiveDevice &&
      this.deviceIp &&
      this.redirectStatus === 'on' &&
      clientIpIsTrustworthy &&
      !rec.replayed &&
      rec.clientIp !== this.deviceIp
    ) {
      return;
    }
    this.flows.push(rec);
    this.byId.set(rec.id, rec);
    this.bufferBytes += flowCost(rec);
    // Persist metadata + full bodies to the session folder. Fire-and-forget —
    // recording must never wait on (or die with) disk I/O. Deliberately only
    // for flows that passed the pause/device-filter gates above, and only
    // once complete (the terminal upsert above persists in-flight flows).
    if (!rec.pending) void this.persistFlow(rec, bodies);

    const trimmed: string[] = [];
    while (this.flows.length > this._maxEntries) {
      this.evictOldest(trimmed);
    }
    // Byte budget on top of the entry cap — a handful of max-size bodies can
    // dwarf thousands of tiny flows, so count alone doesn't bound memory.
    while (this.maxBufferBytes > 0 && this.bufferBytes > this.maxBufferBytes && this.flows.length > 1) {
      this.evictOldest(trimmed);
    }

    this.emit('flow', toSerializedFlow(rec));
    if (trimmed.length > 0) this.emit('trimmed', trimmed);
  }

  private async persistFlow(rec: FlowRecord, bodies?: FlowBodies): Promise<void> {
    const store = this.deps.sessionStore;
    if (!store) return;
    try {
      await store.appendFlow(toSerializedFlow(rec), bodies);
    } catch (err) {
      this.log(`Failed to persist flow ${rec.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private evictOldest(trimmed: string[]): void {
    const dropped = this.flows.shift();
    if (!dropped) return;
    this.byId.delete(dropped.id);
    this.bufferBytes -= flowCost(dropped);
    trimmed.push(dropped.id);
  }

  setRules(rules: RuleSet): void {
    this.rules = rules;
    this.proxy?.setRules(rules);
    this.emit('rules', rules);
  }

  clear(): void {
    this.flows.length = 0;
    this.byId.clear();
    this.bufferBytes = 0;
    this.emit('cleared');
  }

  /** Builds a HAR 1.2 log from the current buffer (bodies included). */
  buildHar(): unknown {
    return {
      log: {
        version: '1.2',
        creator: { name: 'Kopytko Network Inspector', version: '1' },
        // In-flight flows have no response yet — a HAR entry for them would
        // be a lie (status 0, empty timings), so they're simply left out.
        entries: this.flows.filter((rec) => !rec.pending).map((rec) => harEntry(rec)),
      },
    };
  }

  dispose(): void {
    void this.disable();
    // A hard stop distinct from disable(): guarantees no supervised redirect
    // driver (e.g. the mac persistent helper, which deliberately stays alive
    // — reverted but ready to reapply without a new prompt — across ordinary
    // toggle-offs) outlives VS Code. Safe to call even if disable() above was
    // a no-op because capture was already off.
    void this.deps.redirect.dispose();
  }

  private emitState(): void {
    this.emit('state', this.getState());
  }
}

/**
 * Approximate retained memory of one flow: the capped body buffers plus a
 * flat allowance for headers/strings. Exact accounting isn't the goal — the
 * same estimate is added on ingest and subtracted on eviction, so the running
 * total stays consistent with itself.
 */
function flowCost(rec: FlowRecord): number {
  return (
    (rec.requestBody?.length ?? 0) +
    (rec.responseBody?.length ?? 0) +
    (rec.originalRequestBody?.length ?? 0) +
    (rec.originalResponseBody?.length ?? 0) +
    2048
  );
}

// ── HAR helpers ───────────────────────────────────────────────────────────────

function harHeaders(headers: Record<string, string | string[]>): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((v) => out.push({ name, value: v }));
    else out.push({ name, value });
  }
  return out;
}

function harEntry(rec: FlowRecord): unknown {
  const portPart = rec.port && rec.port !== 80 ? `:${rec.port}` : '';
  const url = `http://${rec.host}${portPart}${rec.path}${rec.query ? `?${rec.query}` : ''}`;
  const queryString = rec.query
    ? rec.query.split('&').filter(Boolean).map((pair) => {
        const eq = pair.indexOf('=');
        return eq >= 0
          ? { name: decode(pair.slice(0, eq)), value: decode(pair.slice(eq + 1)) }
          : { name: decode(pair), value: '' };
      })
    : [];

  return {
    startedDateTime: new Date(rec.startedWall).toISOString(),
    time: rec.durationMs,
    request: {
      method: rec.method,
      url,
      httpVersion: 'HTTP/1.1',
      headers: harHeaders(rec.requestHeaders),
      queryString,
      headersSize: -1,
      bodySize: rec.requestBytes,
      ...(rec.requestBody
        ? { postData: { mimeType: contentTypeOf(rec.requestHeaders), text: rec.requestBody.toString('utf8') } }
        : {}),
    },
    response: {
      status: rec.status,
      statusText: rec.statusText,
      httpVersion: 'HTTP/1.1',
      headers: harHeaders(rec.responseHeaders),
      content: harContent(rec),
      redirectURL: '',
      headersSize: -1,
      bodySize: rec.responseBytes,
    },
    cache: {},
    timings: harTimings(rec),
    ...(rec.timings?.socketReused !== undefined ? { _socketReused: rec.timings.socketReused } : {}),
    _upstreamScheme: rec.upstreamScheme,
    _rewrittenBody: rec.rewrittenBody,
  };
}

/**
 * Real per-phase timings when the proxy measured them; HAR's `-1` marks a
 * phase as not applicable (reused socket, plain http, error paths). Flows
 * without timings (errors, pre-upgrade captures) fall back to the legacy
 * whole-duration-as-wait shape.
 */
function harTimings(rec: FlowRecord): unknown {
  const t = rec.timings;
  if (!t) return { send: 0, wait: rec.durationMs, receive: 0 };
  return {
    blocked: t.blockedMs ?? -1,
    dns: t.dnsMs ?? -1,
    connect: t.connectMs ?? -1,
    ssl: t.tlsMs ?? -1,
    send: t.sendMs ?? 0,
    wait: t.waitMs,
    receive: t.receiveMs,
  };
}

function contentTypeOf(headers: Record<string, string | string[]>): string {
  const ct = headers['content-type'];
  if (Array.isArray(ct)) return ct[0] ?? '';
  return ct ?? '';
}

/** HAR `content` object — text bodies as UTF-8, retained binary (images) base64-encoded. */
function harContent(rec: FlowRecord): unknown {
  const mimeType = rec.contentType || 'application/octet-stream';
  const base = { size: rec.responseBytes, mimeType };
  if (!rec.responseBody) return { ...base, text: '' };
  if (isTextContentType(rec.contentType)) return { ...base, text: rec.responseBody.toString('utf8') };
  return { ...base, text: rec.responseBody.toString('base64'), encoding: 'base64' };
}

// ── search helpers ─────────────────────────────────────────────────────────────

function snippetAround(text: string, index: number, matchLen: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + matchLen + 40);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function findHeaderHit(
  headers: Record<string, string | string[]>,
  q: string,
): { where: string; snippet: string } | undefined {
  for (const [name, value] of Object.entries(headers)) {
    const joined = Array.isArray(value) ? value.join(', ') : value;
    const line = `${name}: ${joined}`;
    const idx = line.toLowerCase().indexOf(q);
    if (idx >= 0) return { where: 'header', snippet: snippetAround(line, idx, q.length) };
  }
  return undefined;
}

function searchBody(
  body: Buffer | undefined,
  headers: Record<string, string | string[]>,
  q: string,
  where: string,
  contentType?: string,
): { where: string; snippet: string } | undefined {
  if (!body || body.length === 0) return undefined;
  const ct = contentType ?? contentTypeOf(headers);
  if (!isTextContentType(ct)) return undefined; // don't scan binary payloads
  const text = body.toString('utf8');
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return undefined;
  return { where, snippet: snippetAround(text, idx, q.length) };
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

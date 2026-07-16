/**
 * Pure-Node protocol-bridging HTTP proxy.
 *
 * The device (transparently redirected here) speaks plaintext HTTP in origin
 * form (`GET /path` + `Host:` header). For each request the proxy resolves the
 * upstream scheme (default: upgrade to HTTPS), forwards preserving method +
 * headers, decodes + rewrites the response so the device stays on HTTP, and
 * emits a `FlowRecord`. No TLS is ever terminated on the device side, so no CA
 * needs to be trusted anywhere.
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import type * as net from 'net';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import { FlowBodies, FlowRecord } from './flow';
import type { FlowTimings, InterceptPayload, InterceptResult } from '../webview/protocol';
import { applyBodyRewrites, applyHeaderRules, decodeBody, hasMatchingBodyRules, isImageContentType, isTextContentType, rewriteResponseHeaders } from './rewrite/engine';
import { MapLocalRule, RuleSet, defaultRuleSet, findBlock, findBreakpoint, findLatencyMs, findMapLocal, resolveUpstreamScheme } from './rewrite/rules';
import { pinnedLookup, realHostsBypassResolver, resolveBypassingHosts, type HostsBypassResolver } from '../dnsBypass';

export interface CaptureProxyOptions {
  port: number;
  /** Max bytes of each body retained for display/HAR (full bytes still forwarded). */
  maxBodyBytes?: number;
  /** Reuse upstream connections (default true). Device side always gets `Connection: close`. */
  keepAlive?: boolean;
  /** Overridable for tests — real implementation performs actual DNS queries. */
  hostsResolver?: HostsBypassResolver;
  /** Reads a map-local rule's file. Overridable for tests; default `fs.readFileSync`. */
  fileReader?: (path: string) => Buffer;
  /** Delays a response (latency rules). Overridable for tests; default `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called when a breakpoint rule pauses a request/response — resolves with
   * the user's edits (or an abort). Absent = breakpoints are a no-op pass-through.
   */
  onIntercept?: (payload: InterceptPayload) => Promise<InterceptResult>;
}

interface Target {
  hostname: string;
  /** Port the device addressed (explicit in Host header, else 80). */
  clientPort: number;
  explicitPort: boolean;
  path: string;
  query: string;
}

/**
 * Where the upstream response is written. The live path passes the real
 * `http.ServerResponse` (structurally compatible); replays pass a no-op sink
 * since there's no device connection waiting for the bytes.
 */
export interface DeviceSink {
  headersSent: boolean;
  writeHead(status: number, statusText: string | undefined, headers: http.OutgoingHttpHeaders): void;
  write(chunk: string | Buffer): void;
  end(body?: string | Buffer): void;
  destroy(): void;
}

const NOOP_SINK: DeviceSink = {
  headersSent: false,
  writeHead: () => undefined,
  write: () => undefined,
  end: () => undefined,
  destroy: () => undefined,
};

let flowCounter = 0;
function nextFlowId(): string {
  flowCounter += 1;
  return `flow-${Date.now().toString(36)}-${flowCounter}`;
}

let interceptCounter = 0;
function nextInterceptId(): string {
  interceptCounter += 1;
  return `intercept-${Date.now().toString(36)}-${interceptCounter}`;
}

/**
 * Emits:
 *  - `'flow'`   (rec: FlowRecord, bodies?: FlowBodies) — fires TWICE per
 *               accepted exchange: once with `pending: true` as soon as a
 *               parseable, non-blocked request arrives (headers only, no
 *               status/bodies yet), then once more with the SAME `id` (and
 *               `pending` absent) when the exchange terminates — listeners
 *               must upsert by id. Blocked-by-rule, unparseable, and
 *               client-error exchanges emit only the terminal record.
 *               `rec`'s buffers are capped at `maxBodyBytes`; `bodies`
 *               carries the full pre-cap bytes for listeners that persist
 *               them (absent when there's nothing beyond what the record
 *               already holds).
 *  - `'error'`  (err: Error) — server-level error
 */
export class CaptureProxy extends EventEmitter {
  private server: http.Server | null = null;
  private rules: RuleSet = defaultRuleSet();
  private readonly maxBodyBytes: number;
  private readonly hostsResolver: HostsBypassResolver;
  // Upstream connection pools. The device-facing leg still closes per request
  // (see handleUpstreamResponse), but the proxy→origin leg can safely reuse
  // sockets — that hop is plain Node HTTP(S), no packet relay in between.
  // Note: a pooled socket keeps the IP `pinnedLookup` resolved when it was
  // first opened; that's fine, the pin only exists to defeat local hosts-file
  // redirects and any real address for the host serves the bridge equally.
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;
  private readonly fileReader: (path: string) => Buffer;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onIntercept?: (payload: InterceptPayload) => Promise<InterceptResult>;

  constructor(private readonly options: CaptureProxyOptions) {
    super();
    this.maxBodyBytes = options.maxBodyBytes ?? 256 * 1024;
    this.hostsResolver = options.hostsResolver ?? realHostsBypassResolver;
    this.fileReader = options.fileReader ?? ((p) => fs.readFileSync(p));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onIntercept = options.onIntercept;
    const keepAlive = options.keepAlive ?? true;
    // keepAliveMsecs is the SO_KEEPALIVE probe delay Node applies to pooled
    // sockets — its 1000ms default starts OS keepalive probing 1s into any
    // quiet period. A long-poll held open by the server sits quiet far longer
    // than that, and on networks whose middleboxes silently swallow keepalive
    // probes (observed live: corporate path, probes unanswered), ~10s of
    // unacknowledged probes makes the OS kill the HEALTHY in-flight request
    // with read ETIMEDOUT. 60s keeps probing available for genuinely idle
    // pooled sockets while never firing inside a realistic long-poll hold.
    this.httpAgent = new http.Agent({ keepAlive, keepAliveMsecs: 60_000 });
    this.httpsAgent = new https.Agent({ keepAlive, keepAliveMsecs: 60_000 });
  }

  setRules(rules: RuleSet): void {
    this.rules = rules;
  }

  get port(): number {
    const addr = this.server?.address();
    return addr && typeof addr === 'object' ? addr.port : this.options.port;
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleRequest(req, res));
      server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
      // Node's own HTTP parser can reject a request as malformed before it
      // ever becomes a full IncomingMessage -- handleRequest() (and its
      // recordUnparseableRequest fallback) never runs for these at all, so
      // without this they'd be completely invisible: Node's default
      // behavior is to write its own generic 400 and destroy the socket,
      // silently.
      server.on('clientError', (err: Error, socket: net.Socket) => this.recordClientError(err, socket));
      server.listen(this.options.port, '0.0.0.0', () => resolve());
      this.server = server;
    });
  }

  stop(): Promise<void> {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  dispose(): void {
    void this.stop();
  }

  // ── request handling ────────────────────────────────────────────────────────

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const startedWall = Date.now();
    const clientIp = normalizeIp(req.socket.remoteAddress ?? '');

    let target: Target;
    try {
      target = parseTarget(req);
    } catch (err) {
      this.recordUnparseableRequest(req, res, startedWall, clientIp, err);
      return;
    }

    const meta: RequestMeta = {
      id: nextFlowId(),
      startedWall,
      clientIp,
      method: (req.method ?? 'GET').toUpperCase(),
      requestHeaders: cloneHeaderMap(req.headers),
    };

    // A block rule aborts the connection before we ever touch the upstream —
    // the device sees a reset (ECONNRESET), which is exactly the network
    // failure a developer wants to test the channel's error handling against.
    if (findBlock(this.rules, target.hostname, target.path)) {
      this.recordBlocked(res, target, meta);
      return;
    }

    // The request is accepted: surface it immediately as an in-flight row —
    // before the request body is even collected, so long uploads, long-polls,
    // and streams are visible while they run. The terminal record below
    // reuses meta.id and replaces this one.
    this.emit('flow', this.buildPendingRecord(target, meta));

    const tBodyStart = performance.now();
    collectBody(req)
      .then(async (reqBodyFull) => {
        meta.blockedMs = performance.now() - tBodyStart;
        const rules = this.rules;
        const reqContentType = strHeader(req.headers['content-type']);
        const reqRewrite = applyBodyRewrites(reqBodyFull, rules, {
          host: target.hostname,
          path: target.path,
          contentType: reqContentType,
          direction: 'request',
        });
        meta.originalRequestBody = reqBodyFull;
        meta.requestRewritten = reqRewrite.changed;
        let bodyToSend = reqRewrite.body;

        // Request breakpoint: pause here so the request can be edited (or
        // aborted) before it's forwarded upstream.
        const bp = findBreakpoint(rules, target.hostname, target.path);
        if (bp?.onRequest && this.onIntercept) {
          const editable = isTextContentType(reqContentType) || bodyToSend.length === 0;
          const result = await this.onIntercept({
            id: nextInterceptId(),
            phase: 'request',
            method: meta.method,
            host: target.hostname,
            path: target.path,
            query: target.query,
            upstreamScheme: resolveUpstreamScheme(target.hostname, rules) === 'http' ? 'http' : 'https',
            headers: meta.requestHeaders,
            body: editable ? bodyToSend.toString('utf8') : '',
            bodyEditable: editable,
          });
          if (result.action === 'abort') {
            this.recordBlocked(res, target, meta);
            return;
          }
          if (result.method) meta.method = result.method.toUpperCase();
          if (result.headers) meta.requestHeaders = result.headers;
          if (editable && result.body !== undefined) bodyToSend = Buffer.from(result.body, 'utf8');
        }

        // A map-local rule short-circuits the upstream entirely.
        const mapLocal = findMapLocal(rules, target.hostname, target.path);
        if (mapLocal) {
          void this.serveMapLocal(res, target, meta, mapLocal);
          return;
        }

        const scheme = resolveUpstreamScheme(target.hostname, rules);
        void this.forward(res, target, bodyToSend, scheme, meta);
      })
      .catch((err) => {
        this.finishError(res, target, meta, err instanceof Error ? err : new Error(String(err)));
      });
  }

  /**
   * In-flight placeholder emitted the moment a request is accepted — request
   * metadata only, with zeroed response fields. The terminal record emitted
   * with the same `meta.id` replaces it. `upstreamScheme` shows the first
   * attempt (`auto` starts on https); the terminal record corrects it.
   */
  private buildPendingRecord(target: Target, meta: RequestMeta): FlowRecord {
    return {
      id: meta.id,
      startedWall: meta.startedWall,
      method: meta.method,
      host: target.hostname,
      port: target.clientPort,
      path: target.path,
      query: target.query,
      status: 0,
      statusText: '',
      contentType: '',
      durationMs: 0,
      requestBytes: 0,
      responseBytes: 0,
      clientIp: meta.clientIp,
      upstreamScheme: resolveUpstreamScheme(target.hostname, this.rules) === 'http' ? 'http' : 'https',
      rewrittenBody: false,
      requestHeaders: meta.requestHeaders,
      responseHeaders: {},
      replayed: meta.replayed,
      pending: true,
    };
  }

  private async forward(
    sink: DeviceSink,
    target: Target,
    reqBodyToSend: Buffer,
    scheme: 'https' | 'http' | 'auto',
    meta: RequestMeta,
  ): Promise<void> {
    const attemptScheme: 'https' | 'http' = scheme === 'auto' ? 'https' : scheme;
    const upstreamPort = resolveUpstreamPort(target, attemptScheme);
    const mod = attemptScheme === 'https' ? https : http;

    // Fresh per attempt — the `auto` retry must not inherit the failed
    // HTTPS attempt's marks.
    const marks: TimingMarks = { start: performance.now() };

    const baseHeaders = buildUpstreamHeaders(meta.requestHeaders, target.hostname, upstreamPort, attemptScheme, reqBodyToSend, meta.method);
    const reqHeaderRewrite = applyHeaderRules(baseHeaders as Record<string, string | string[]>, this.rules.headerRules, {
      host: target.hostname,
      direction: 'request',
    });
    const outHeaders = reqHeaderRewrite.headers;
    if (reqHeaderRewrite.changed) meta.headersRewritten = true;

    // On the Windows manual-capture path, the OS hosts file that redirects
    // the ROKU to this proxy also applies to THIS process (the hosts file is
    // global, not scoped to the device) — so resolving target.hostname the
    // normal way would send this very request right back to the gateway IP
    // instead of the real backend, failing with ECONNREFUSED <gatewayIp>:443.
    // Bypass it with a real DNS query, same as discovery's own fetch.
    const resolvedIp = isIpLiteral(target.hostname) ? undefined : await resolveBypassingHosts(target.hostname, this.hostsResolver);

    const upstreamReq = mod.request(
      {
        host: target.hostname,
        port: upstreamPort,
        method: meta.method,
        path: target.path + (target.query ? `?${target.query}` : ''),
        headers: outHeaders,
        agent: attemptScheme === 'https' ? this.httpsAgent : this.httpAgent,
        servername: attemptScheme === 'https' && !isIpLiteral(target.hostname) ? target.hostname : undefined,
        lookup: resolvedIp ? pinnedLookup(resolvedIp) : undefined,
      },
      (upstreamRes) => {
        marks.firstByte = performance.now();
        this.handleUpstreamResponse(sink, target, attemptScheme, upstreamRes, reqBodyToSend, meta, marks);
      },
    );

    upstreamReq.on('socket', (socket) => {
      // No SO_KEEPALIVE probing while a request is in flight. Node arms
      // keepalive on pooled sockets (Agent.keepSocketAlive), and on network
      // paths whose middleboxes swallow keepalive probes, ~10 unanswered
      // probes make the OS kill a HEALTHY held-open request (long-polls
      // especially) with read ETIMEDOUT — verified live against a real
      // long-poll endpoint: identical connections survived a 30s hold with
      // keepalive off and died at ~11.5s with it on. Dead pooled sockets
      // don't need probes to be caught: the reused-socket retry below
      // recovers them on first failed use.
      socket.setKeepAlive(false);
      if (!socket.connecting) {
        marks.reused = true;
        return;
      }
      socket.once('lookup', () => (marks.lookup = performance.now()));
      socket.once('connect', () => (marks.connect = performance.now()));
      socket.once('secureConnect', () => (marks.secure = performance.now()));
    });
    upstreamReq.on('finish', () => (marks.sent = performance.now()));

    let retriedAuto = false;
    let retriedStale = false;
    upstreamReq.on('error', (err) => {
      // For 'auto', a failed HTTPS attempt falls back to plaintext HTTP once.
      if (scheme === 'auto' && attemptScheme === 'https' && !retriedAuto) {
        retriedAuto = true;
        void this.forward(sink, target, reqBodyToSend, 'http', meta);
        return;
      }
      // A pooled keep-alive socket can go stale during a long-held request
      // (e.g. a long-poll) if a network hop silently drops it mid-idle —
      // Node doesn't detect this until the next write/read on it fails. Retry
      // once on a fresh connection rather than surfacing a spurious error for
      // what a plain retry would resolve. Only for reused sockets: a freshly
      // connected socket erroring is a real failure and must still surface.
      if (marks.reused && !retriedStale) {
        retriedStale = true;
        void this.forward(sink, target, reqBodyToSend, scheme, meta);
        return;
      }
      this.finishError(sink, target, meta, err);
    });

    if (reqBodyToSend.length > 0) upstreamReq.write(reqBodyToSend);
    upstreamReq.end();
  }

  private handleUpstreamResponse(
    sink: DeviceSink,
    target: Target,
    scheme: 'https' | 'http',
    upstreamRes: http.IncomingMessage,
    reqBodyToSend: Buffer,
    meta: RequestMeta,
    marks: TimingMarks,
  ): void {
    const contentType = strHeader(upstreamRes.headers['content-type']);
    if (this.shouldStream(upstreamRes, target.hostname, target.path, contentType)) {
      void this.streamUpstream(sink, target, scheme, upstreamRes, reqBodyToSend, meta, marks, contentType);
      return;
    }

    const chunks: Buffer[] = [];
    upstreamRes.on('data', (c: Buffer) => chunks.push(c));
    upstreamRes.on('error', (err) => this.finishError(sink, target, meta, err));
    upstreamRes.on('end', () => {
      void this.finishUpstream(sink, target, scheme, upstreamRes, chunks, reqBodyToSend, meta, marks);
    });
  }

  /**
   * Decides whether to pass a response through chunk-by-chunk instead of
   * buffering it whole. Buffering is required to rewrite bodies and recompute
   * Content-Length, but an open-ended response (Server-Sent Events, or a
   * chunked response with no Content-Length) never fires `end`, so buffering
   * hangs the device forever. We stream those — but only when doing so can't
   * break the https→http bridge:
   *  - always stream SSE (buffering it is a guaranteed hang),
   *  - stream a no-Content-Length response only when no body rule would have
   *    rewritten it (otherwise the bridge needs the buffered/rewritten body),
   *  - never stream a compressed response (we must buffer to decode it, or the
   *    device receives bytes it can't read once we strip Content-Encoding).
   */
  private shouldStream(upstreamRes: http.IncomingMessage, host: string, path: string, contentType: string): boolean {
    const enc = strHeader(upstreamRes.headers['content-encoding']).toLowerCase().trim();
    if (enc !== '' && enc !== 'identity') return false;
    if (contentType.toLowerCase().includes('text/event-stream')) return true;
    if (upstreamRes.headers['content-length'] !== undefined) return false;
    return !hasMatchingBodyRules(this.rules, host, path, contentType, 'response');
  }

  /**
   * Streaming response path: forward each chunk to the device as it arrives
   * (no body rewrite), teeing a capped copy for display, and emit the flow
   * when the stream ends or the connection closes. A never-ending SSE stream
   * therefore appears in the list when it finally closes — the point is that
   * the device is never left hanging on a buffer that never completes.
   */
  private async streamUpstream(
    sink: DeviceSink,
    target: Target,
    scheme: 'https' | 'http',
    upstreamRes: http.IncomingMessage,
    reqBodyToSend: Buffer,
    meta: RequestMeta,
    marks: TimingMarks,
    contentType: string,
  ): Promise<void> {
    const normalized = rewriteResponseHeaders(upstreamRes.headers);
    const headerRewrite = applyHeaderRules(normalized, this.rules.headerRules, {
      host: target.hostname,
      direction: 'response',
    });
    const outHeaders = headerRewrite.headers;
    // Length is unknown up front — omit it and let Node frame the response
    // (chunked / close-delimited). Connection: close per the bridge rule.
    delete outHeaders['content-length'];
    outHeaders['connection'] = 'close';

    const latencyMs = findLatencyMs(this.rules, target.hostname, target.path);
    if (latencyMs > 0) await this.sleep(latencyMs);

    const status = upstreamRes.statusCode ?? 0;
    const statusText = upstreamRes.statusMessage ?? '';
    try {
      sink.writeHead(status, statusText || undefined, outHeaders);
    } catch {
      // Device socket already gone — still tee + record what streams in.
    }

    const retainable = isTextContentType(contentType) || isImageContentType(contentType);
    const teed: Buffer[] = [];
    let teedLen = 0;
    let responseBytes = 0;
    let truncated = false;
    let done = false;

    const finalize = (err?: Error): void => {
      if (done) return;
      done = true;
      const reqCap = capBuffer(reqBodyToSend, this.maxBodyBytes);
      const teedBody = retainable && teed.length > 0 ? Buffer.concat(teed) : undefined;
      const rec: FlowRecord = {
        id: meta.id,
        startedWall: meta.startedWall,
        method: meta.method,
        host: target.hostname,
        port: target.clientPort,
        path: target.path,
        query: target.query,
        status,
        statusText,
        contentType,
        durationMs: Date.now() - meta.startedWall,
        requestBytes: reqBodyToSend.length,
        responseBytes,
        clientIp: meta.clientIp,
        upstreamScheme: scheme,
        rewrittenBody: !!meta.requestRewritten,
        rewrittenHeaders: headerRewrite.changed || !!meta.headersRewritten || undefined,
        requestHeaders: meta.requestHeaders,
        responseHeaders: outHeaders,
        requestBody: reqBodyToSend.length > 0 ? reqCap.buf : undefined,
        requestBodyTruncated: reqCap.truncated,
        responseBody: teedBody,
        responseBodyTruncated: truncated || undefined,
        originalRequestBody: meta.requestRewritten ? capBuffer(meta.originalRequestBody!, this.maxBodyBytes).buf : undefined,
        timings: computeTimings(marks, meta.blockedMs, performance.now()),
        streamed: true,
        latencyInjectedMs: latencyMs > 0 ? latencyMs : undefined,
        replayed: meta.replayed,
        error: err?.message,
      };
      // Streamed responses only ever have the capped teed copy — the full
      // stream was never buffered (that's the point) — so `response` here is
      // best-effort, unlike the buffered paths.
      this.emit('flow', rec, flowBodies({
        request: reqBodyToSend,
        response: teedBody,
        originalRequest: meta.requestRewritten ? meta.originalRequestBody : undefined,
      }));
    };

    upstreamRes.on('data', (c: Buffer) => {
      responseBytes += c.length;
      try {
        sink.write(c);
      } catch {
        // Device leg gone — keep draining upstream so it can close cleanly.
      }
      if (teedLen < this.maxBodyBytes) {
        const take = c.subarray(0, this.maxBodyBytes - teedLen);
        teed.push(take);
        teedLen += take.length;
        if (take.length < c.length) truncated = true;
      }
    });
    upstreamRes.on('end', () => {
      try {
        sink.end();
      } catch {
        // ignore
      }
      finalize();
    });
    upstreamRes.on('close', () => finalize());
    upstreamRes.on('error', (err) => {
      try {
        sink.end();
      } catch {
        // ignore
      }
      finalize(err instanceof Error ? err : new Error(String(err)));
    });
  }

  /** Aborts a request matched by a block rule and records it as a blocked flow. */
  private recordBlocked(res: http.ServerResponse, target: Target, meta: RequestMeta): void {
    try {
      res.destroy(); // reset the device connection → ECONNRESET on the device
    } catch {
      // already gone
    }
    const rec: FlowRecord = {
      id: meta.id,
      startedWall: meta.startedWall,
      method: meta.method,
      host: target.hostname,
      port: target.clientPort,
      path: target.path,
      query: target.query,
      status: 0,
      statusText: '',
      contentType: '',
      durationMs: Date.now() - meta.startedWall,
      requestBytes: 0,
      responseBytes: 0,
      clientIp: meta.clientIp,
      upstreamScheme: 'http',
      rewrittenBody: false,
      requestHeaders: meta.requestHeaders,
      responseHeaders: {},
      blocked: true,
      error: 'Blocked by rule — connection reset',
      replayed: meta.replayed,
    };
    this.emit('flow', rec);
  }

  /** Flow record for a response aborted at a response breakpoint. */
  private buildAbortedResponseRecord(
    target: Target,
    meta: RequestMeta,
    scheme: 'https' | 'http',
    status: number,
    contentType: string,
    marks: TimingMarks,
  ): FlowRecord {
    return {
      id: meta.id,
      startedWall: meta.startedWall,
      method: meta.method,
      host: target.hostname,
      port: target.clientPort,
      path: target.path,
      query: target.query,
      status,
      statusText: '',
      contentType,
      durationMs: Date.now() - meta.startedWall,
      requestBytes: 0,
      responseBytes: 0,
      clientIp: meta.clientIp,
      upstreamScheme: scheme,
      rewrittenBody: false,
      requestHeaders: meta.requestHeaders,
      responseHeaders: {},
      blocked: true,
      error: 'Aborted at response breakpoint — connection reset',
      timings: computeTimings(marks, meta.blockedMs, performance.now()),
      replayed: meta.replayed,
    };
  }

  private async finishUpstream(
    sink: DeviceSink,
    target: Target,
    scheme: 'https' | 'http',
    upstreamRes: http.IncomingMessage,
    chunks: Buffer[],
    reqBodyToSend: Buffer,
    meta: RequestMeta,
    marks: TimingMarks,
  ): Promise<void> {
    const rawBody = Buffer.concat(chunks);
    const decoded = decodeBody(rawBody, strHeader(upstreamRes.headers['content-encoding']));
    const contentType = strHeader(upstreamRes.headers['content-type']);

    const rewrite = applyBodyRewrites(decoded, this.rules, {
      host: target.hostname,
      path: target.path,
      contentType,
      direction: 'response',
    });
    const finalBody = rewrite.body;

    // Bridge-mandated normalizations first, then user header rules, so the
    // proxy-owned headers (content-length/connection, set below) stay
    // authoritative regardless of what a rule tried to do.
    const normalized = rewriteResponseHeaders(upstreamRes.headers);
    const respHeaderRewrite = applyHeaderRules(normalized, this.rules.headerRules, {
      host: target.hostname,
      direction: 'response',
    });
    let outHeaders = respHeaderRewrite.headers;
    let headersRewritten = respHeaderRewrite.changed || !!meta.headersRewritten;
    let outBody = finalBody;
    let status = upstreamRes.statusCode ?? 0;
    const statusText = upstreamRes.statusMessage ?? '';

    // Response breakpoint: pause here so the response can be edited (or
    // aborted) before it reaches the device. Not for replays or streams
    // (streams can't be held; they're handled in streamUpstream).
    const bp = findBreakpoint(this.rules, target.hostname, target.path);
    if (bp?.onResponse && this.onIntercept && !meta.replayed) {
      const editable = isTextContentType(contentType) || outBody.length === 0;
      const result = await this.onIntercept({
        id: nextInterceptId(),
        phase: 'response',
        method: meta.method,
        host: target.hostname,
        path: target.path,
        query: target.query,
        upstreamScheme: scheme,
        status,
        statusText,
        headers: outHeaders,
        body: editable ? outBody.toString('utf8') : '',
        bodyEditable: editable,
      });
      if (result.action === 'abort') {
        sink.destroy();
        this.emit('flow', this.buildAbortedResponseRecord(target, meta, scheme, status, contentType, marks));
        return;
      }
      if (typeof result.status === 'number') status = result.status;
      if (result.headers) {
        outHeaders = result.headers;
        headersRewritten = true;
      }
      if (editable && result.body !== undefined) {
        outBody = Buffer.from(result.body, 'utf8');
        headersRewritten = true;
      }
    }

    outHeaders['content-length'] = String(outBody.length);
    // The device-facing leg always closes per request: the transparent
    // redirect bridges packets through mechanisms that aren't HTTP-aware
    // (WinDivert loopback injection on Windows; NAT rewriting elsewhere),
    // and trusting keep-alive semantics to survive such a hop has bitten
    // this feature before (a half-closed device connection waiting on a
    // body that never arrived). A deterministic fresh connection per
    // request sidesteps that ambiguity; the proxy→origin leg pools
    // connections independently (see httpAgent/httpsAgent).
    outHeaders['connection'] = 'close';

    // Latency injection — delay the device-facing response (not the flow
    // record's phase timings, which stay the real measured values).
    const latencyMs = findLatencyMs(this.rules, target.hostname, target.path);
    if (latencyMs > 0) await this.sleep(latencyMs);

    try {
      sink.writeHead(status, statusText || undefined, outHeaders);
      sink.end(outBody);
    } catch {
      // Device socket already gone — nothing to send, but still record the flow.
    }

    const retainResponse = outBody.length > 0 && (isTextContentType(contentType) || isImageContentType(contentType));
    const reqCap = capBuffer(reqBodyToSend, this.maxBodyBytes);
    const resCap = capBuffer(outBody, this.maxBodyBytes);
    const rec: FlowRecord = {
      id: meta.id,
      startedWall: meta.startedWall,
      method: meta.method,
      host: target.hostname,
      port: target.clientPort,
      path: target.path,
      query: target.query,
      status,
      statusText,
      contentType,
      durationMs: Date.now() - meta.startedWall,
      requestBytes: reqBodyToSend.length,
      responseBytes: outBody.length,
      clientIp: meta.clientIp,
      upstreamScheme: scheme,
      rewrittenBody: rewrite.changed || !!meta.requestRewritten,
      rewrittenHeaders: headersRewritten || undefined,
      requestHeaders: meta.requestHeaders,
      responseHeaders: outHeaders,
      requestBody: reqBodyToSend.length > 0 ? reqCap.buf : undefined,
      requestBodyTruncated: reqCap.truncated,
      responseBody: retainResponse ? resCap.buf : undefined,
      responseBodyTruncated: retainResponse ? resCap.truncated : undefined,
      originalRequestBody: meta.requestRewritten ? capBuffer(meta.originalRequestBody!, this.maxBodyBytes).buf : undefined,
      originalResponseBody: rewrite.changed ? capBuffer(decoded, this.maxBodyBytes).buf : undefined,
      timings: computeTimings(marks, meta.blockedMs, performance.now()),
      latencyInjectedMs: latencyMs > 0 ? latencyMs : undefined,
      replayed: meta.replayed,
    };
    this.emit('flow', rec, flowBodies({
      request: reqBodyToSend,
      response: retainResponse ? outBody : undefined,
      originalRequest: meta.requestRewritten ? meta.originalRequestBody : undefined,
      originalResponse: rewrite.changed ? decoded : undefined,
    }));
  }

  /**
   * Serves a map-local rule's file (or inline body) without contacting the
   * upstream and records it as a flow tagged `servedBy: 'map-local'`. A
   * file-read failure falls through to `finishError` so it's visible.
   */
  private async serveMapLocal(sink: DeviceSink, target: Target, meta: RequestMeta, rule: MapLocalRule): Promise<void> {
    let body: Buffer;
    try {
      body = rule.filePath ? this.fileReader(rule.filePath) : Buffer.from(rule.body ?? '', 'utf8');
    } catch (err) {
      this.finishError(sink, target, meta, err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const contentType = rule.contentType ?? 'application/octet-stream';
    const status = rule.status ?? 200;
    const latencyMs = findLatencyMs(this.rules, target.hostname, target.path);
    if (latencyMs > 0) await this.sleep(latencyMs);

    const outHeaders: http.OutgoingHttpHeaders = {
      'content-type': contentType,
      'content-length': String(body.length),
      connection: 'close',
    };
    try {
      sink.writeHead(status, undefined, outHeaders);
      sink.end(body);
    } catch {
      // Device socket already gone — still record the flow.
    }

    const retainResponse = body.length > 0 && (isTextContentType(contentType) || isImageContentType(contentType));
    const resCap = capBuffer(body, this.maxBodyBytes);
    const rec: FlowRecord = {
      id: meta.id,
      startedWall: meta.startedWall,
      method: meta.method,
      host: target.hostname,
      port: target.clientPort,
      path: target.path,
      query: target.query,
      status,
      statusText: '',
      contentType,
      durationMs: Date.now() - meta.startedWall,
      requestBytes: meta.originalRequestBody?.length ?? 0,
      responseBytes: body.length,
      clientIp: meta.clientIp,
      upstreamScheme: 'http',
      rewrittenBody: false,
      requestHeaders: meta.requestHeaders,
      responseHeaders: { ...outHeaders } as Record<string, string | string[]>,
      responseBody: retainResponse ? resCap.buf : undefined,
      responseBodyTruncated: retainResponse ? resCap.truncated : undefined,
      servedBy: 'map-local',
      latencyInjectedMs: latencyMs > 0 ? latencyMs : undefined,
      replayed: meta.replayed,
    };
    this.emit('flow', rec, flowBodies({ response: retainResponse ? body : undefined }));
  }

  private finishError(sink: DeviceSink, target: Target, meta: RequestMeta, err: Error): void {
    try {
      if (!sink.headersSent) sink.writeHead(502, 'Bad Gateway', { connection: 'close' });
      sink.end(`Kopytko Network Inspector: upstream error — ${err.message}`);
    } catch {
      // ignore secondary failures
    }
    // The device's original request body — a failed request's body is often
    // exactly what's needed to reproduce/debug the failure, so error flows
    // must not drop it. (If a rewrite rule changed the body, the *sent* body
    // isn't in scope here; the original is the more useful one regardless.)
    const reqBody = meta.originalRequestBody;
    const reqCap = reqBody && reqBody.length > 0 ? capBuffer(reqBody, this.maxBodyBytes) : undefined;
    const rec: FlowRecord = {
      id: meta.id,
      startedWall: meta.startedWall,
      method: meta.method,
      host: target.hostname,
      port: target.clientPort,
      path: target.path,
      query: target.query,
      status: 0,
      statusText: '',
      contentType: '',
      durationMs: Date.now() - meta.startedWall,
      requestBytes: reqBody?.length ?? 0,
      responseBytes: 0,
      clientIp: meta.clientIp,
      upstreamScheme: 'https',
      rewrittenBody: false,
      requestHeaders: meta.requestHeaders,
      responseHeaders: {},
      requestBody: reqCap?.buf,
      requestBodyTruncated: reqCap ? reqCap.truncated : false,
      error: err.message,
      replayed: meta.replayed,
    };
    this.emit('flow', rec, flowBodies({ request: reqBody }));
  }

  /**
   * Re-sends a captured request through the same upstream path (current
   * rules decide the scheme) with no device connection involved — the
   * response goes to a no-op sink and the exchange is recorded as a new
   * flow tagged `replayed`. Sends the retained (possibly capped) request
   * body exactly as it was originally forwarded.
   */
  replay(rec: FlowRecord): void {
    const target: Target = {
      hostname: rec.host,
      clientPort: rec.port || 80,
      explicitPort: rec.port !== 0 && rec.port !== 80,
      path: rec.path,
      query: rec.query,
    };
    const meta: RequestMeta = {
      id: nextFlowId(),
      startedWall: Date.now(),
      clientIp: '127.0.0.1',
      method: rec.method,
      requestHeaders: { ...rec.requestHeaders },
      replayed: true,
    };
    // A replay shows an in-flight row too, same as device traffic.
    this.emit('flow', this.buildPendingRecord(target, meta));
    const scheme = resolveUpstreamScheme(rec.host, this.rules);
    void this.forward({ ...NOOP_SINK }, target, rec.requestBody ?? Buffer.alloc(0), scheme, meta);
  }

  /**
   * A request that couldn't even be parsed into a target (e.g. no Host
   * header, or an unparseable absolute-form URL) used to be handled with a
   * bare 400 and NO flow record at all — invisible in the panel no matter
   * how many times the device retried. Charles-style visibility means
   * showing this too, with whatever raw info is available (no hostname to
   * key it on, so the raw Host header — or its absence — becomes the host).
   */
  private recordUnparseableRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    startedWall: number,
    clientIp: string,
    err: unknown,
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    try {
      res.writeHead(400, { connection: 'close' }).end(`Kopytko Network Inspector: bad request — ${message}`);
    } catch {
      // Device socket already gone — nothing to send, but still record the flow.
    }
    const rec: FlowRecord = {
      id: nextFlowId(),
      startedWall,
      method: (req.method ?? 'GET').toUpperCase(),
      host: strHeader(req.headers.host) || '(no Host header)',
      port: 0,
      path: req.url ?? '/',
      query: '',
      status: 400,
      statusText: 'Bad Request',
      contentType: '',
      durationMs: Date.now() - startedWall,
      requestBytes: 0,
      responseBytes: 0,
      clientIp,
      upstreamScheme: 'http',
      rewrittenBody: false,
      requestHeaders: cloneHeaderMap(req.headers),
      responseHeaders: {},
      error: `Bad request target: ${message}`,
    };
    this.emit('flow', rec);
  }

  /**
   * Fires when Node's OWN HTTP parser rejects a request before it becomes an
   * IncomingMessage at all — no method, headers, or URL were ever parsed, so
   * there's nothing to build a Target from. Still worth a flow: on the
   * Windows manual-capture path, a device request that never shows up
   * anywhere (not even here) is meaningfully different from one that fails
   * this way, and this is the only place that distinction is visible.
   */
  private recordClientError(err: Error, socket: net.Socket): void {
    const clientIp = normalizeIp(socket.remoteAddress ?? '');
    try {
      if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    } catch {
      // Socket already gone.
    }
    const rec: FlowRecord = {
      id: nextFlowId(),
      startedWall: Date.now(),
      method: '',
      host: '(rejected before parsing — malformed request)',
      port: 0,
      path: '',
      query: '',
      status: 400,
      statusText: 'Bad Request',
      contentType: '',
      durationMs: 0,
      requestBytes: 0,
      responseBytes: 0,
      clientIp,
      upstreamScheme: 'http',
      rewrittenBody: false,
      requestHeaders: {},
      responseHeaders: {},
      error: `Client error before request could be parsed: ${err.message}`,
    };
    this.emit('flow', rec);
  }
}

interface RequestMeta {
  /**
   * Flow id, allocated up front so the pending record and the terminal
   * record share it (the panel upserts by id). Terminal emitters that carry
   * a `meta` must use this — never call `nextFlowId()` themselves.
   */
  id: string;
  startedWall: number;
  clientIp: string;
  method: string;
  requestHeaders: Record<string, string | string[]>;
  /** Pre-rewrite request body, set once `applyBodyRewrites` has run. */
  originalRequestBody?: Buffer;
  requestRewritten?: boolean;
  /** Time spent receiving the device's request body (`performance.now()` delta). */
  blockedMs?: number;
  /** True when a request-direction header rule changed the forwarded headers. */
  headersRewritten?: boolean;
  /** True when this exchange is a user-initiated replay, not device traffic. */
  replayed?: boolean;
}

/** Raw `performance.now()` marks collected while one upstream attempt runs. */
interface TimingMarks {
  start: number;
  lookup?: number;
  connect?: number;
  secure?: number;
  sent?: number;
  firstByte?: number;
  reused?: boolean;
}

/**
 * Folds raw marks into the per-phase breakdown. Phases whose events never
 * fired (reused socket, plain http, IP-literal host) are simply absent
 * rather than reported as 0 — absence means "didn't happen", 0 means
 * "happened in under half a millisecond".
 */
function computeTimings(marks: TimingMarks, blockedMs: number | undefined, end: number): FlowTimings {
  const round = (v: number) => Math.max(0, Math.round(v));
  const sentAt = marks.sent ?? marks.start;
  const firstByte = marks.firstByte ?? sentAt;
  const timings: FlowTimings = {
    waitMs: round(firstByte - sentAt),
    receiveMs: round(end - firstByte),
  };
  if (blockedMs !== undefined) timings.blockedMs = round(blockedMs);
  if (marks.reused) timings.socketReused = true;
  if (marks.lookup !== undefined) timings.dnsMs = round(marks.lookup - marks.start);
  if (marks.connect !== undefined) timings.connectMs = round(marks.connect - (marks.lookup ?? marks.start));
  if (marks.secure !== undefined) timings.tlsMs = round(marks.secure - (marks.connect ?? marks.start));
  if (marks.sent !== undefined) timings.sendMs = round(marks.sent - (marks.secure ?? marks.connect ?? marks.start));
  return timings;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function parseTarget(req: http.IncomingMessage): Target {
  const url = req.url ?? '/';

  // Absolute-form (explicit-proxy clients): GET http://host/path
  if (/^https?:\/\//i.test(url)) {
    const u = new URL(url);
    return {
      hostname: u.hostname,
      clientPort: u.port ? parseInt(u.port, 10) : 80,
      explicitPort: !!u.port,
      path: u.pathname,
      query: u.search.replace(/^\?/, ''),
    };
  }

  // Origin-form (transparently redirected clients): GET /path + Host header
  const hostHeader = strHeader(req.headers.host);
  if (!hostHeader) throw new Error('missing Host header');
  const [hostname, portStr] = splitHostPort(hostHeader);
  const qIdx = url.indexOf('?');
  return {
    hostname,
    clientPort: portStr ? parseInt(portStr, 10) : 80,
    explicitPort: !!portStr,
    path: qIdx >= 0 ? url.slice(0, qIdx) : url,
    query: qIdx >= 0 ? url.slice(qIdx + 1) : '',
  };
}

function splitHostPort(host: string): [string, string | undefined] {
  const idx = host.lastIndexOf(':');
  // Guard against IPv6 literals (which contain multiple colons).
  if (idx > 0 && host.indexOf(':') === idx) return [host.slice(0, idx), host.slice(idx + 1)];
  return [host, undefined];
}

function resolveUpstreamPort(target: Target, scheme: 'https' | 'http'): number {
  if (target.explicitPort) return target.clientPort;
  return scheme === 'https' ? 443 : 80;
}

function buildUpstreamHeaders(
  reqHeaders: http.IncomingHttpHeaders,
  hostname: string,
  upstreamPort: number,
  scheme: 'https' | 'http',
  bodyToSend: Buffer,
  method: string | undefined,
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(reqHeaders)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (
      key === 'proxy-connection' ||
      key === 'accept-encoding' ||
      key === 'content-length' ||
      key === 'transfer-encoding' ||
      key === 'host'
    ) {
      continue;
    }
    out[key] = v;
  }
  // Ask for identity so we normally avoid decompression; the engine still
  // decodes as a fallback if a server ignores this.
  out['accept-encoding'] = 'identity';
  const isDefault = (scheme === 'https' && upstreamPort === 443) || (scheme === 'http' && upstreamPort === 80);
  out['host'] = isDefault ? hostname : `${hostname}:${upstreamPort}`;

  const methodHasBody = method !== 'GET' && method !== 'HEAD';
  if (bodyToSend.length > 0 || (methodHasBody && 'content-length' in reqHeaders)) {
    out['content-length'] = String(bodyToSend.length);
  }
  return out;
}

function cloneHeaderMap(headers: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function collectBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function capBuffer(buf: Buffer, max: number): { buf: Buffer; truncated: boolean } {
  if (buf.length <= max) return { buf, truncated: false };
  return { buf: buf.subarray(0, max), truncated: true };
}

/** Drops empty/absent buffers; returns undefined when nothing is worth persisting. */
function flowBodies(b: FlowBodies): FlowBodies | undefined {
  const out: FlowBodies = {};
  if (b.request && b.request.length > 0) out.request = b.request;
  if (b.response && b.response.length > 0) out.response = b.response;
  if (b.originalRequest && b.originalRequest.length > 0) out.originalRequest = b.originalRequest;
  if (b.originalResponse && b.originalResponse.length > 0) out.originalResponse = b.originalResponse;
  return Object.keys(out).length > 0 ? out : undefined;
}

function strHeader(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, '');
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

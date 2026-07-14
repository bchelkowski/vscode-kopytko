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
import { FlowRecord } from './flow';
import type { FlowTimings } from '../webview/protocol';
import { applyBodyRewrites, applyHeaderRules, decodeBody, isImageContentType, isTextContentType, rewriteResponseHeaders } from './rewrite/engine';
import { MapLocalRule, RuleSet, defaultRuleSet, findLatencyMs, findMapLocal, resolveUpstreamScheme } from './rewrite/rules';
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
  end(body: string | Buffer): void;
}

const NOOP_SINK: DeviceSink = {
  headersSent: false,
  writeHead: () => undefined,
  end: () => undefined,
};

let flowCounter = 0;
function nextFlowId(): string {
  flowCounter += 1;
  return `flow-${Date.now().toString(36)}-${flowCounter}`;
}

/**
 * Emits:
 *  - `'flow'`   (rec: FlowRecord) — one completed (or errored) exchange
 *  - `'error'`  (err: Error)      — server-level error
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

  constructor(private readonly options: CaptureProxyOptions) {
    super();
    this.maxBodyBytes = options.maxBodyBytes ?? 256 * 1024;
    this.hostsResolver = options.hostsResolver ?? realHostsBypassResolver;
    this.fileReader = options.fileReader ?? ((p) => fs.readFileSync(p));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const keepAlive = options.keepAlive ?? true;
    this.httpAgent = new http.Agent({ keepAlive, keepAliveMsecs: 1000 });
    this.httpsAgent = new https.Agent({ keepAlive, keepAliveMsecs: 1000 });
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
      startedWall,
      clientIp,
      method: (req.method ?? 'GET').toUpperCase(),
      requestHeaders: cloneHeaderMap(req.headers),
    };

    const tBodyStart = performance.now();
    collectBody(req)
      .then((reqBodyFull) => {
        meta.blockedMs = performance.now() - tBodyStart;
        const rules = this.rules;
        const reqContentType = strHeader(req.headers['content-type']);
        const reqRewrite = applyBodyRewrites(reqBodyFull, rules, {
          host: target.hostname,
          contentType: reqContentType,
          direction: 'request',
        });
        meta.originalRequestBody = reqBodyFull;
        meta.requestRewritten = reqRewrite.changed;

        // A map-local rule short-circuits the upstream entirely.
        const mapLocal = findMapLocal(rules, target.hostname, target.path);
        if (mapLocal) {
          void this.serveMapLocal(res, target, meta, mapLocal);
          return;
        }

        const scheme = resolveUpstreamScheme(target.hostname, rules);
        void this.forward(res, target, reqRewrite.body, scheme, meta);
      })
      .catch((err) => {
        this.finishError(res, target, meta, err instanceof Error ? err : new Error(String(err)));
      });
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
      if (!socket.connecting) {
        marks.reused = true;
        return;
      }
      socket.once('lookup', () => (marks.lookup = performance.now()));
      socket.once('connect', () => (marks.connect = performance.now()));
      socket.once('secureConnect', () => (marks.secure = performance.now()));
    });
    upstreamReq.on('finish', () => (marks.sent = performance.now()));

    let retried = false;
    upstreamReq.on('error', (err) => {
      // For 'auto', a failed HTTPS attempt falls back to plaintext HTTP once.
      if (scheme === 'auto' && attemptScheme === 'https' && !retried) {
        retried = true;
        void this.forward(sink, target, reqBodyToSend, 'http', meta);
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
    const chunks: Buffer[] = [];
    upstreamRes.on('data', (c: Buffer) => chunks.push(c));
    upstreamRes.on('error', (err) => this.finishError(sink, target, meta, err));
    upstreamRes.on('end', () => {
      void this.finishUpstream(sink, target, scheme, upstreamRes, chunks, reqBodyToSend, meta, marks);
    });
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
    const outHeaders = respHeaderRewrite.headers;
    const headersRewritten = respHeaderRewrite.changed || !!meta.headersRewritten;
    outHeaders['content-length'] = String(finalBody.length);
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

    const status = upstreamRes.statusCode ?? 0;
    const statusText = upstreamRes.statusMessage ?? '';
    try {
      sink.writeHead(status, statusText || undefined, outHeaders);
      sink.end(finalBody);
    } catch {
      // Device socket already gone — nothing to send, but still record the flow.
    }

    const retainResponse = finalBody.length > 0 && (isTextContentType(contentType) || isImageContentType(contentType));
    const reqCap = capBuffer(reqBodyToSend, this.maxBodyBytes);
    const resCap = capBuffer(finalBody, this.maxBodyBytes);
    const rec: FlowRecord = {
      id: nextFlowId(),
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
      responseBytes: finalBody.length,
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
    this.emit('flow', rec);
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
      id: nextFlowId(),
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
    this.emit('flow', rec);
  }

  private finishError(sink: DeviceSink, target: Target, meta: RequestMeta, err: Error): void {
    try {
      if (!sink.headersSent) sink.writeHead(502, 'Bad Gateway', { connection: 'close' });
      sink.end(`Kopytko Network Inspector: upstream error — ${err.message}`);
    } catch {
      // ignore secondary failures
    }
    const rec: FlowRecord = {
      id: nextFlowId(),
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
      upstreamScheme: 'https',
      rewrittenBody: false,
      requestHeaders: meta.requestHeaders,
      responseHeaders: {},
      error: err.message,
      replayed: meta.replayed,
    };
    this.emit('flow', rec);
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
      startedWall: Date.now(),
      clientIp: '127.0.0.1',
      method: rec.method,
      requestHeaders: { ...rec.requestHeaders },
      replayed: true,
    };
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

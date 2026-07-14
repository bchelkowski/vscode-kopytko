/**
 * Message protocol between the extension host and the Network Inspector webview.
 *
 * Runtime-import-free: the only imports are `import type`, which esbuild erases,
 * so this bundles into the browser without pulling in Node/VS Code APIs. Rule
 * shapes are re-exported from the capture layer so there's a single source of truth.
 */

import type {
  BodyRewriteRule,
  HeaderRule,
  LatencyRule,
  MapLocalRule,
  RuleSet,
  UpstreamScheme,
  UpstreamSchemeRule,
} from '../capture/rewrite/rules';

export type { BodyRewriteRule, HeaderRule, LatencyRule, MapLocalRule, RuleSet, UpstreamScheme, UpstreamSchemeRule };

/** Whether the automatic OS traffic redirect is applied. */
export type RedirectStatus = 'off' | 'applying' | 'on' | 'unsupported' | 'error';

export interface WebviewState {
  /** Master toggle — is the proxy capturing? */
  enabled: boolean;
  /** Recording paused — traffic still bridges, flows aren't recorded. */
  paused: boolean;
  redirectStatus: RedirectStatus;
  proxyPort: number;
  deviceIp?: string;
  deviceLabel?: string;
  /** Human-readable note for unsupported/error redirect states. */
  message?: string;
}

/**
 * Per-phase timing breakdown of one exchange, measured at the proxy.
 * Phases absent when they didn't happen: dns/connect/tls are missing when the
 * upstream socket was reused from the keep-alive pool (see `socketReused`),
 * tls also for plain-http upstreams, dns for IP-literal hosts.
 */
export interface FlowTimings {
  /** Receiving the device's request body. */
  blockedMs?: number;
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  /** Writing the request to the upstream. */
  sendMs?: number;
  /** Request fully sent → first response byte (TTFB). */
  waitMs: number;
  /** First response byte → last. */
  receiveMs: number;
  socketReused?: boolean;
}

/** A cross-flow search hit — which flow, where the match was, and a short snippet. */
export interface SearchHit {
  id: string;
  where: string;
  snippet: string;
}

/** One captured HTTP exchange — list-row metadata + headers (bodies load lazily). */
export interface SerializedFlow {
  id: string;
  startedWall: number;
  method: string;
  host: string;
  port: number;
  path: string;
  query: string;
  status: number;
  statusText: string;
  contentType: string;
  durationMs: number;
  requestBytes: number;
  responseBytes: number;
  clientIp: string;
  /** Scheme the proxy used to reach the origin (`https` bridge, or `http`). */
  upstreamScheme: 'https' | 'http';
  rewrittenBody: boolean;
  /** A header rule changed request and/or response headers. */
  rewrittenHeaders?: boolean;
  /** `map-local` when the response was served from a rule instead of the upstream. */
  servedBy?: 'upstream' | 'map-local';
  /** Milliseconds of artificial latency injected by a rule. */
  latencyInjectedMs?: number;
  requestHeaders: Record<string, string | string[]>;
  responseHeaders: Record<string, string | string[]>;
  timings?: FlowTimings;
  /** True when this flow is a user-initiated replay, not device traffic. */
  replayed?: boolean;
  error?: string;
}

/** Lazily-loaded bodies for a single flow (sent on `select-flow`). */
export interface FlowDetail {
  id: string;
  requestBody?: string;
  responseBody?: string;
  /** How `responseBody` is encoded — `base64` for retained binary (images). */
  responseBodyEncoding?: 'utf8' | 'base64';
  /** Present only when a rewrite changed the request body. */
  originalRequestBody?: string;
  /** Present only when a rewrite changed the response body. */
  originalResponseBody?: string;
  requestBodyTruncated?: boolean;
  responseBodyTruncated?: boolean;
}

// ── Extension → Webview ──────────────────────────────────────────────────────
export type ExtMsg =
  | { kind: 'init'; state: WebviewState; history: SerializedFlow[]; rules: RuleSet; maxEntries: number }
  | { kind: 'flow'; entry: SerializedFlow }
  /** Oldest flows evicted from the host buffer (count or byte cap) — drop them client-side too. */
  | { kind: 'trim'; ids: string[] }
  | { kind: 'flow-detail'; detail: FlowDetail }
  | { kind: 'state'; state: WebviewState }
  | { kind: 'rules'; rules: RuleSet }
  | { kind: 'search-results'; query: string; hits: SearchHit[] }
  | { kind: 'cleared' }
  | { kind: 'error'; message: string };

// ── Webview → Extension ──────────────────────────────────────────────────────
export type WebMsg =
  | { kind: 'ready' }
  | { kind: 'set-enabled'; enabled: boolean }
  | { kind: 'set-paused'; paused: boolean }
  | { kind: 'clear' }
  | { kind: 'export-har' }
  | { kind: 'select-flow'; id: string }
  | { kind: 'copy-flow'; id: string; what: 'url' | 'curl' | 'request-body' | 'response-body' }
  | { kind: 'replay-flow'; id: string }
  | { kind: 'search'; query: string }
  | { kind: 'set-rules'; rules: RuleSet };

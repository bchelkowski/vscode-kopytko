/**
 * Message protocol between the extension host and the Network Inspector webview.
 *
 * Runtime-import-free: the only imports are `import type`, which esbuild erases,
 * so this bundles into the browser without pulling in Node/VS Code APIs. Rule
 * shapes are re-exported from the capture layer so there's a single source of truth.
 */

import type {
  BodyRewriteRule,
  RuleSet,
  UpstreamScheme,
  UpstreamSchemeRule,
} from '../capture/rewrite/rules';

export type { BodyRewriteRule, RuleSet, UpstreamScheme, UpstreamSchemeRule };

/** Whether the automatic OS traffic redirect is applied. */
export type RedirectStatus = 'off' | 'applying' | 'on' | 'unsupported' | 'error';

export interface WebviewState {
  /** Master toggle — is the proxy capturing? */
  enabled: boolean;
  redirectStatus: RedirectStatus;
  proxyPort: number;
  deviceIp?: string;
  deviceLabel?: string;
  /** Human-readable note for unsupported/error redirect states. */
  message?: string;
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
  requestHeaders: Record<string, string | string[]>;
  responseHeaders: Record<string, string | string[]>;
  error?: string;
}

/** Lazily-loaded bodies for a single flow (sent on `select-flow`). */
export interface FlowDetail {
  id: string;
  requestBody?: string;
  responseBody?: string;
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
  | { kind: 'cleared' }
  | { kind: 'error'; message: string };

// ── Webview → Extension ──────────────────────────────────────────────────────
export type WebMsg =
  | { kind: 'ready' }
  | { kind: 'set-enabled'; enabled: boolean }
  | { kind: 'clear' }
  | { kind: 'export-har' }
  | { kind: 'select-flow'; id: string }
  | { kind: 'set-rules'; rules: RuleSet };

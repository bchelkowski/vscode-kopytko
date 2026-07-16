/**
 * Host-side record of one captured HTTP exchange, plus mappers to the
 * webview-facing `SerializedFlow` (list metadata) and `FlowDetail` (lazy bodies).
 * Bodies are stored capped for display/HAR; the proxy forwards the full bytes
 * to the device separately.
 */

import { isTextContentType } from './rewrite/engine';
import type { FlowDetail, FlowTimings, SerializedFlow } from '../webview/protocol';

export interface FlowRecord {
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
  upstreamScheme: 'https' | 'http';
  rewrittenBody: boolean;
  /** A header rule changed request and/or response headers. */
  rewrittenHeaders?: boolean;
  /** How the response was produced — `map-local` when served from a rule, else upstream. */
  servedBy?: 'upstream' | 'map-local';
  /** Milliseconds of artificial latency injected by a rule (separate from measured timings). */
  latencyInjectedMs?: number;
  /** True when the response was passed through chunk-by-chunk (not buffered); body capture is best-effort. */
  streamed?: boolean;
  /** True when a block rule aborted the request before it reached the upstream. */
  blocked?: boolean;
  requestHeaders: Record<string, string | string[]>;
  responseHeaders: Record<string, string | string[]>;
  requestBody?: Buffer;
  requestBodyTruncated?: boolean;
  responseBody?: Buffer;
  responseBodyTruncated?: boolean;
  /** Original (pre-rewrite) request body, only when a rewrite fired. */
  originalRequestBody?: Buffer;
  /** Original (pre-rewrite) response body, only when a rewrite fired. */
  originalResponseBody?: Buffer;
  /** Per-phase timings; absent for flows that errored before a response. */
  timings?: FlowTimings;
  /** True when this flow is a user-initiated replay, not device traffic. */
  replayed?: boolean;
  /**
   * True while the exchange is still in flight — a terminal record with the
   * same `id` (and this field absent) replaces it when the exchange finishes.
   */
  pending?: true;
  error?: string;
}

/**
 * Full (pre-cap) body buffers for one flow — emitted by the proxy alongside
 * the `FlowRecord` (whose own buffers are capped at `maxBodyBytes`) so a
 * session store can persist the complete bytes to disk. Streamed responses
 * only carry the capped teed copy (best-effort, as documented).
 */
export interface FlowBodies {
  request?: Buffer;
  response?: Buffer;
  originalRequest?: Buffer;
  originalResponse?: Buffer;
}

export function toSerializedFlow(rec: FlowRecord): SerializedFlow {
  return {
    id: rec.id,
    startedWall: rec.startedWall,
    method: rec.method,
    host: rec.host,
    port: rec.port,
    path: rec.path,
    query: rec.query,
    status: rec.status,
    statusText: rec.statusText,
    contentType: rec.contentType,
    durationMs: rec.durationMs,
    requestBytes: rec.requestBytes,
    responseBytes: rec.responseBytes,
    clientIp: rec.clientIp,
    upstreamScheme: rec.upstreamScheme,
    rewrittenBody: rec.rewrittenBody,
    rewrittenHeaders: rec.rewrittenHeaders,
    servedBy: rec.servedBy,
    latencyInjectedMs: rec.latencyInjectedMs,
    streamed: rec.streamed,
    blocked: rec.blocked,
    requestHeaders: rec.requestHeaders,
    responseHeaders: rec.responseHeaders,
    timings: rec.timings,
    replayed: rec.replayed,
    pending: rec.pending,
    error: rec.error,
  };
}

export function toFlowDetail(rec: FlowRecord): FlowDetail {
  // Text bodies go as UTF-8; retained binary (images) goes base64 so the
  // webview can render a preview or hex dump without corruption.
  const responseIsText = isTextContentType(rec.contentType);
  return {
    id: rec.id,
    requestBody: rec.requestBody?.toString('utf8'),
    responseBody: rec.responseBody?.toString(responseIsText ? 'utf8' : 'base64'),
    responseBodyEncoding: rec.responseBody ? (responseIsText ? 'utf8' : 'base64') : undefined,
    originalRequestBody: rec.originalRequestBody?.toString('utf8'),
    originalResponseBody: rec.originalResponseBody?.toString('utf8'),
    requestBodyTruncated: rec.requestBodyTruncated,
    responseBodyTruncated: rec.responseBodyTruncated,
  };
}

/**
 * Host-side record of one captured HTTP exchange, plus mappers to the
 * webview-facing `SerializedFlow` (list metadata) and `FlowDetail` (lazy bodies).
 * Bodies are stored capped for display/HAR; the proxy forwards the full bytes
 * to the device separately.
 */

import type { FlowDetail, SerializedFlow } from '../webview/protocol';

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
  requestHeaders: Record<string, string | string[]>;
  responseHeaders: Record<string, string | string[]>;
  requestBody?: Buffer;
  requestBodyTruncated?: boolean;
  responseBody?: Buffer;
  responseBodyTruncated?: boolean;
  /** Original (pre-rewrite) response body, only when a rewrite fired. */
  originalResponseBody?: Buffer;
  error?: string;
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
    requestHeaders: rec.requestHeaders,
    responseHeaders: rec.responseHeaders,
    error: rec.error,
  };
}

export function toFlowDetail(rec: FlowRecord): FlowDetail {
  return {
    id: rec.id,
    requestBody: rec.requestBody?.toString('utf8'),
    responseBody: rec.responseBody?.toString('utf8'),
    originalResponseBody: rec.originalResponseBody?.toString('utf8'),
    requestBodyTruncated: rec.requestBodyTruncated,
    responseBodyTruncated: rec.responseBodyTruncated,
  };
}

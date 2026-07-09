/**
 * Thin HTTPS executor for the Roku Pay cloud API, built on Node's global
 * fetch (Node >= 24). The `kopytko-roku-device` httpClient is deliberately
 * NOT reused here: it is plain-HTTP only, built for LAN device traffic.
 * Requests run on the extension host — the webview CSP blocks network access.
 */

export const REQUEST_TIMEOUT_MS = 30_000;

export interface PayHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface PayHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

export class RokuPayClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** Executes the request; rejects on network failure/timeout (never on HTTP errors). */
  async execute(request: PayHttpRequest): Promise<PayHttpResponse> {
    const startedAt = Date.now();
    const response = await this.fetchFn(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Builds copy-friendly representations of a captured flow: the effective
 * upstream URL and an equivalent `curl` command line. Pure — no vscode, no
 * network — so the panel can call it and tests can cover it directly.
 */

import type { FlowRecord } from './flow';
import { isTextContentType } from './rewrite/engine';

/**
 * The URL the proxy actually fetched: upstream scheme + host + the port the
 * device addressed (omitted when it's the scheme's default) + path + query.
 */
export function buildUrl(rec: FlowRecord): string {
  const defaultPort = rec.upstreamScheme === 'https' ? 443 : 80;
  // Port 80 with an https upstream is the bridge's normal shape (device on
  // :80, proxy upgraded) — the real fetch went to 443, so no port suffix.
  const isDefault = !rec.port || rec.port === defaultPort || (rec.upstreamScheme === 'https' && rec.port === 80);
  const portPart = isDefault ? '' : `:${rec.port}`;
  return `${rec.upstreamScheme}://${rec.host}${portPart}${rec.path}${rec.query ? `?${rec.query}` : ''}`;
}

/** Headers the proxy manages itself — including them would mislead a replayed curl. */
const CURL_SKIPPED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'proxy-connection',
  'accept-encoding',
]);

/** Escapes a value for a single-quoted POSIX shell string. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildCurl(rec: FlowRecord): string {
  const parts: string[] = ['curl'];
  if (rec.method !== 'GET') parts.push(`-X ${rec.method}`);
  parts.push(shellQuote(buildUrl(rec)));

  for (const [name, value] of Object.entries(rec.requestHeaders)) {
    if (CURL_SKIPPED_HEADERS.has(name.toLowerCase())) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) parts.push(`-H ${shellQuote(`${name}: ${v}`)}`);
  }

  if (rec.requestBody && rec.requestBody.length > 0) {
    const contentType = String(rec.requestHeaders['content-type'] ?? '');
    if (isTextContentType(contentType) || contentType === '') {
      parts.push(`--data-raw ${shellQuote(rec.requestBody.toString('utf8'))}`);
    } else {
      parts.push("--data-raw '<binary body omitted>'");
    }
  }

  let cmd = parts.join(' \\\n  ');
  if (rec.requestBodyTruncated) {
    cmd += '\n# NOTE: request body was truncated at capture time — this curl sends only the retained prefix';
  }
  return cmd;
}

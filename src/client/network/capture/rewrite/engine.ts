/**
 * The rewrite engine: body find/replace, response-header normalization, and
 * content-encoding decoding for the bridging proxy.
 *
 * The bridging model keeps the device on plaintext HTTP while the proxy speaks
 * HTTPS upstream. For that to hold end to end we must:
 *  - rewrite `https://` (and any user rules) out of text bodies,
 *  - rewrite `Location`/`Content-Location` so redirects stay on the proxy path,
 *  - strip `Secure`/`SameSite=None` from cookies (a device on HTTP would drop them),
 *  - drop `Strict-Transport-Security`,
 *  - and always hand the device an identity-encoded body with a correct length.
 */

import * as zlib from 'zlib';
import { BodyRewriteRule, HeaderRule, RuleSet, matchContentType, matchHost } from './rules';

const TEXT_CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'text/',
  'javascript',
  'application/x-www-form-urlencoded',
  'application/graphql',
  '+json',
  '+xml',
];

/** True when a body of this content type is safe to treat as UTF-8 text. */
export function isTextContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return TEXT_CONTENT_TYPES.some((t) => ct.includes(t));
}

/** True for `image/*` — retained as binary for preview, never rewritten. */
export function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().trim().startsWith('image/');
}

/**
 * Decodes a (possibly compressed) body to raw bytes. We normally ask upstream
 * for `identity`, but some servers ignore that — this handles gzip/deflate/br as
 * a fallback so a rewrite never corrupts a compressed payload.
 */
export function decodeBody(body: Buffer, contentEncoding: string | undefined): Buffer {
  const enc = (contentEncoding ?? '').toLowerCase().trim();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(body);
    if (enc === 'deflate') return zlib.inflateSync(body);
    if (enc === 'br') return zlib.brotliDecompressSync(body);
  } catch {
    // Corrupt/partial encoding — return the raw bytes untouched.
    return body;
  }
  return body;
}

export interface BodyRewriteResult {
  body: Buffer;
  changed: boolean;
}

/**
 * Whether any enabled body rule *could* rewrite a response of this
 * content-type from this host — used to decide if a response is safe to
 * stream (streaming skips body rewrite, so we only stream when nothing would
 * have been rewritten, keeping the https→http bridge intact).
 */
export function hasMatchingBodyRules(
  ruleSet: RuleSet,
  host: string,
  contentType: string,
  direction: 'response' | 'request',
): boolean {
  if (!isTextContentType(contentType)) return false;
  return ruleSet.bodyRules.some(
    (r) =>
      r.enabled &&
      r.direction === direction &&
      matchHost(r.hostPattern, host) &&
      matchContentType(r.contentTypePattern, contentType),
  );
}

/**
 * Applies every enabled, matching body rule to a text body. Binary bodies and
 * unmatched content types pass through unchanged.
 */
export function applyBodyRewrites(
  body: Buffer,
  ruleSet: RuleSet,
  ctx: { host: string; contentType: string; direction: 'response' | 'request' },
): BodyRewriteResult {
  if (body.length === 0) return { body, changed: false };
  if (!isTextContentType(ctx.contentType)) return { body, changed: false };

  const rules = ruleSet.bodyRules.filter(
    (r) =>
      r.enabled &&
      r.direction === ctx.direction &&
      matchHost(r.hostPattern, ctx.host) &&
      matchContentType(r.contentTypePattern, ctx.contentType),
  );
  if (rules.length === 0) return { body, changed: false };

  let text = body.toString('utf8');
  let changed = false;
  for (const rule of rules) {
    const next = applyOne(text, rule);
    if (next !== text) changed = true;
    text = next;
  }

  if (!changed) return { body, changed: false };
  return { body: Buffer.from(text, 'utf8'), changed: true };
}

function applyOne(text: string, rule: BodyRewriteRule): string {
  if (rule.isRegex) {
    try {
      const re = new RegExp(rule.find, 'g');
      return text.replace(re, rule.replace);
    } catch {
      // Invalid regex — leave the text untouched rather than throw into the proxy.
      return text;
    }
  }
  if (rule.find === '') return text;
  return text.split(rule.find).join(rule.replace);
}

/**
 * Header names the proxy owns outright — user header rules must never touch
 * these, or they'd fight the bridge's own content-length/connection handling.
 */
const RESERVED_HEADER_NAMES = new Set(['content-length', 'transfer-encoding', 'connection', 'host']);

export interface HeaderRewriteResult {
  headers: Record<string, string | string[]>;
  changed: boolean;
}

/**
 * Applies user header rules (set/add/remove) for one direction. Names are
 * matched case-insensitively; the output map keeps lowercase keys (matching
 * the rest of the bridge's header handling). Reserved proxy-owned names are
 * silently skipped.
 */
export function applyHeaderRules(
  headers: Record<string, string | string[]>,
  rules: HeaderRule[] | undefined,
  ctx: { host: string; direction: 'request' | 'response' },
): HeaderRewriteResult {
  const applicable = (rules ?? []).filter(
    (r) =>
      r.enabled &&
      r.direction === ctx.direction &&
      !RESERVED_HEADER_NAMES.has(r.name.toLowerCase()) &&
      matchHost(r.hostPattern, ctx.host),
  );
  if (applicable.length === 0) return { headers, changed: false };

  const out: Record<string, string | string[]> = { ...headers };
  let changed = false;
  for (const rule of applicable) {
    const name = rule.name.toLowerCase();
    if (rule.op === 'remove') {
      if (name in out) {
        delete out[name];
        changed = true;
      }
      continue;
    }
    const value = rule.value ?? '';
    if (rule.op === 'set') {
      if (out[name] !== value) changed = true;
      out[name] = value;
      continue;
    }
    // add — append to an existing header rather than replacing it.
    const existing = out[name];
    out[name] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
    changed = true;
  }
  return { headers: out, changed };
}

/**
 * Normalizes outgoing response headers for the bridging model. Mutates and
 * returns a lowercase-keyed header map suitable for `res.writeHead`.
 *
 * `Content-Length`/`Content-Encoding` are set by the caller after the body is
 * finalized; this function removes the values that would fight the bridge.
 */
export function rewriteResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const k = key.toLowerCase();

    // These are recomputed/normalized by the proxy after rewriting the body.
    if (k === 'content-length' || k === 'content-encoding' || k === 'transfer-encoding') continue;
    // Would force the device back onto TLS or break plaintext connection reuse.
    if (k === 'strict-transport-security' || k === 'connection' || k === 'proxy-connection') continue;

    if (k === 'location' || k === 'content-location') {
      out[k] = downgradeUrl(value);
      continue;
    }
    if (k === 'set-cookie') {
      out[k] = stripCookieSecurity(value);
      continue;
    }
    out[k] = value;
  }

  return out;
}

function downgradeUrl(value: string | string[]): string | string[] {
  const fix = (v: string) => v.replace(/^https:\/\//i, 'http://');
  return Array.isArray(value) ? value.map(fix) : fix(value);
}

/**
 * Removes `Secure` and downgrades `SameSite=None` on Set-Cookie so a device
 * talking plaintext HTTP still stores and returns the cookies.
 */
function stripCookieSecurity(value: string | string[]): string[] {
  const cookies = Array.isArray(value) ? value : [value];
  return cookies.map((cookie) =>
    cookie
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.toLowerCase() !== 'secure')
      .map((p) => (p.toLowerCase() === 'samesite=none' ? 'SameSite=Lax' : p))
      .join('; '),
  );
}

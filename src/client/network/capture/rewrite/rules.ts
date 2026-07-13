/**
 * Rule model for the Network Inspector's protocol-bridging proxy.
 *
 * Two independent concerns:
 *  - **Body rewrite rules** — find/replace applied to text request/response
 *    bodies (default: response `https://` → `http://`, which keeps the device
 *    on plaintext HTTP so we can see every subsequent call).
 *  - **Upstream-scheme rules** — decide whether the proxy talks to a given host
 *    over `https` (default) or `http` when the device called it over HTTP.
 *
 * Kept dependency-free (no vscode/Node type imports beyond plain TS) so the same
 * shapes can be shared with the webview via `webview/protocol.ts`.
 */

export type UpstreamScheme = 'https' | 'http' | 'auto';

export interface BodyRewriteRule {
  id: string;
  enabled: boolean;
  /** Which direction this rule applies to. Response bodies are the common case. */
  direction: 'response' | 'request';
  /** Host glob (`*` wildcards) or substring. Empty = every host. */
  hostPattern?: string;
  /** Content-type substring (e.g. `json`). Empty = every text content type. */
  contentTypePattern?: string;
  find: string;
  replace: string;
  /** Treat `find` as a JS regular expression (applied with the global flag). */
  isRegex?: boolean;
}

export interface UpstreamSchemeRule {
  /** Host glob (`*` wildcards) or substring. */
  hostPattern: string;
  scheme: UpstreamScheme;
}

export interface RuleSet {
  bodyRules: BodyRewriteRule[];
  upstreamSchemes: UpstreamSchemeRule[];
  defaultUpstreamScheme: UpstreamScheme;
}

/** The one built-in rule that makes the whole no-CA bridging model work. */
export const HTTPS_TO_HTTP_RULE: BodyRewriteRule = {
  id: 'builtin-https-to-http',
  enabled: true,
  direction: 'response',
  find: 'https://',
  replace: 'http://',
  isRegex: false,
};

export function defaultRuleSet(): RuleSet {
  return {
    bodyRules: [{ ...HTTPS_TO_HTTP_RULE }],
    upstreamSchemes: [],
    defaultUpstreamScheme: 'https',
  };
}

/**
 * Matches a host against a pattern. Empty pattern matches everything; a pattern
 * containing `*` is treated as a glob, otherwise as a case-insensitive substring.
 */
export function matchHost(pattern: string | undefined, host: string): boolean {
  if (!pattern) return true;
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.includes('*')) {
    const re = new RegExp('^' + p.split('*').map(escapeRegex).join('.*') + '$');
    return re.test(h);
  }
  return h.includes(p);
}

/** Matches a content-type against a substring pattern (empty = any). */
export function matchContentType(pattern: string | undefined, contentType: string): boolean {
  if (!pattern) return true;
  return contentType.toLowerCase().includes(pattern.toLowerCase());
}

/** Resolves which scheme the proxy should use to reach `host`. */
export function resolveUpstreamScheme(host: string, rules: RuleSet): UpstreamScheme {
  for (const rule of rules.upstreamSchemes) {
    if (matchHost(rule.hostPattern, host)) return rule.scheme;
  }
  return rules.defaultUpstreamScheme;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a RuleSet from loosely-typed config values (VS Code settings arrays),
 * always keeping the built-in https→http rule first unless the user explicitly
 * provided their own body rules.
 */
export function ruleSetFromConfig(
  bodyRulesRaw: unknown,
  upstreamSchemesRaw: unknown,
  defaultUpstreamScheme: unknown,
): RuleSet {
  const bodyRules = Array.isArray(bodyRulesRaw) && bodyRulesRaw.length > 0
    ? bodyRulesRaw.map(coerceBodyRule).filter((r): r is BodyRewriteRule => r !== null)
    : [{ ...HTTPS_TO_HTTP_RULE }];

  const upstreamSchemes = Array.isArray(upstreamSchemesRaw)
    ? upstreamSchemesRaw.map(coerceSchemeRule).filter((r): r is UpstreamSchemeRule => r !== null)
    : [];

  const def = defaultUpstreamScheme === 'http' || defaultUpstreamScheme === 'auto'
    ? defaultUpstreamScheme
    : 'https';

  return { bodyRules, upstreamSchemes, defaultUpstreamScheme: def };
}

let ruleCounter = 0;
function nextRuleId(): string {
  ruleCounter += 1;
  return `rule-${Date.now().toString(36)}-${ruleCounter}`;
}

function coerceBodyRule(raw: unknown): BodyRewriteRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.find !== 'string' || typeof o.replace !== 'string') return null;
  return {
    id: typeof o.id === 'string' ? o.id : nextRuleId(),
    enabled: o.enabled !== false,
    direction: o.direction === 'request' ? 'request' : 'response',
    hostPattern: typeof o.hostPattern === 'string' ? o.hostPattern : undefined,
    contentTypePattern: typeof o.contentTypePattern === 'string' ? o.contentTypePattern : undefined,
    find: o.find,
    replace: o.replace,
    isRegex: o.isRegex === true,
  };
}

function coerceSchemeRule(raw: unknown): UpstreamSchemeRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.hostPattern !== 'string' || !o.hostPattern) return null;
  const scheme = o.scheme === 'http' || o.scheme === 'auto' ? o.scheme : 'https';
  return { hostPattern: o.hostPattern, scheme };
}

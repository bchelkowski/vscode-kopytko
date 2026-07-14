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

/** Serve a local file (or inline body) instead of contacting the upstream. */
export interface MapLocalRule {
  id: string;
  enabled: boolean;
  /** Host glob (`*` wildcards) or substring. Empty = every host. */
  hostPattern: string;
  /** Path glob (`*` wildcards) or substring. Empty = every path. */
  pathPattern?: string;
  /** Absolute path of the file to serve. Wins over `body` when both are set. */
  filePath?: string;
  /** Inline body to serve when no `filePath` is given. */
  body?: string;
  contentType?: string;
  /** Response status (default 200). */
  status?: number;
}

/** Delay matched responses before sending them to the device. */
export interface LatencyRule {
  id: string;
  enabled: boolean;
  hostPattern: string;
  pathPattern?: string;
  delayMs: number;
}

/** Add/set/remove a request or response header for matched hosts. */
export interface HeaderRule {
  id: string;
  enabled: boolean;
  direction: 'request' | 'response';
  hostPattern?: string;
  op: 'set' | 'add' | 'remove';
  name: string;
  value?: string;
}

/** Abort the connection for matched requests — the device sees a network error. */
export interface BlockRule {
  id: string;
  enabled: boolean;
  hostPattern: string;
  pathPattern?: string;
}

/** Pause a matched request and/or response so it can be edited live before continuing. */
export interface BreakpointRule {
  id: string;
  enabled: boolean;
  hostPattern: string;
  pathPattern?: string;
  /** Pause the request before it's forwarded upstream. */
  onRequest: boolean;
  /** Pause the response before it's returned to the device. */
  onResponse: boolean;
}

export interface RuleSet {
  bodyRules: BodyRewriteRule[];
  upstreamSchemes: UpstreamSchemeRule[];
  defaultUpstreamScheme: UpstreamScheme;
  // Optional so every persisted config / webview literal / `set-rules`
  // payload from before these existed stays valid.
  mapLocal?: MapLocalRule[];
  latency?: LatencyRule[];
  headerRules?: HeaderRule[];
  block?: BlockRule[];
  breakpoints?: BreakpointRule[];
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
    mapLocal: [],
    latency: [],
    headerRules: [],
    block: [],
    breakpoints: [],
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

/** Same glob/substring semantics as {@link matchHost}, applied to a request path. */
export function matchPath(pattern: string | undefined, path: string): boolean {
  return matchHost(pattern, path);
}

/** First enabled map-local rule matching host+path, or undefined. */
export function findMapLocal(rules: RuleSet, host: string, path: string): MapLocalRule | undefined {
  return (rules.mapLocal ?? []).find(
    (r) => r.enabled && matchHost(r.hostPattern, host) && matchPath(r.pathPattern, path),
  );
}

/** Delay for the first enabled latency rule matching host+path, or 0. */
export function findLatencyMs(rules: RuleSet, host: string, path: string): number {
  const rule = (rules.latency ?? []).find(
    (r) => r.enabled && r.delayMs > 0 && matchHost(r.hostPattern, host) && matchPath(r.pathPattern, path),
  );
  return rule?.delayMs ?? 0;
}

/** First enabled block rule matching host+path, or undefined. */
export function findBlock(rules: RuleSet, host: string, path: string): BlockRule | undefined {
  return (rules.block ?? []).find(
    (r) => r.enabled && matchHost(r.hostPattern, host) && matchPath(r.pathPattern, path),
  );
}

/** First enabled breakpoint rule matching host+path, or undefined. */
export function findBreakpoint(rules: RuleSet, host: string, path: string): BreakpointRule | undefined {
  return (rules.breakpoints ?? []).find(
    (r) => r.enabled && (r.onRequest || r.onResponse) && matchHost(r.hostPattern, host) && matchPath(r.pathPattern, path),
  );
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
  mapLocalRaw?: unknown,
  latencyRaw?: unknown,
  headerRulesRaw?: unknown,
  blockRaw?: unknown,
  breakpointsRaw?: unknown,
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

  const mapLocal = Array.isArray(mapLocalRaw)
    ? mapLocalRaw.map(coerceMapLocalRule).filter((r): r is MapLocalRule => r !== null)
    : [];
  const latency = Array.isArray(latencyRaw)
    ? latencyRaw.map(coerceLatencyRule).filter((r): r is LatencyRule => r !== null)
    : [];
  const headerRules = Array.isArray(headerRulesRaw)
    ? headerRulesRaw.map(coerceHeaderRule).filter((r): r is HeaderRule => r !== null)
    : [];
  const block = Array.isArray(blockRaw)
    ? blockRaw.map(coerceBlockRule).filter((r): r is BlockRule => r !== null)
    : [];
  const breakpoints = Array.isArray(breakpointsRaw)
    ? breakpointsRaw.map(coerceBreakpointRule).filter((r): r is BreakpointRule => r !== null)
    : [];

  return { bodyRules, upstreamSchemes, defaultUpstreamScheme: def, mapLocal, latency, headerRules, block, breakpoints };
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

function coerceMapLocalRule(raw: unknown): MapLocalRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const filePath = typeof o.filePath === 'string' && o.filePath ? o.filePath : undefined;
  const body = typeof o.body === 'string' ? o.body : undefined;
  // A rule that serves nothing is a config mistake, not "serve empty 200".
  if (filePath === undefined && body === undefined) return null;
  return {
    id: typeof o.id === 'string' ? o.id : nextRuleId(),
    enabled: o.enabled !== false,
    hostPattern: typeof o.hostPattern === 'string' ? o.hostPattern : '',
    pathPattern: typeof o.pathPattern === 'string' ? o.pathPattern : undefined,
    filePath,
    body,
    contentType: typeof o.contentType === 'string' ? o.contentType : undefined,
    status: typeof o.status === 'number' && o.status >= 100 && o.status <= 599 ? Math.floor(o.status) : undefined,
  };
}

function coerceLatencyRule(raw: unknown): LatencyRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.delayMs !== 'number' || !(o.delayMs > 0)) return null;
  return {
    id: typeof o.id === 'string' ? o.id : nextRuleId(),
    enabled: o.enabled !== false,
    hostPattern: typeof o.hostPattern === 'string' ? o.hostPattern : '',
    pathPattern: typeof o.pathPattern === 'string' ? o.pathPattern : undefined,
    delayMs: Math.floor(o.delayMs),
  };
}

function coerceHeaderRule(raw: unknown): HeaderRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name) return null;
  const op = o.op === 'add' || o.op === 'remove' ? o.op : 'set';
  return {
    id: typeof o.id === 'string' ? o.id : nextRuleId(),
    enabled: o.enabled !== false,
    direction: o.direction === 'request' ? 'request' : 'response',
    hostPattern: typeof o.hostPattern === 'string' ? o.hostPattern : undefined,
    op,
    name: o.name,
    value: typeof o.value === 'string' ? o.value : undefined,
  };
}

function coerceBlockRule(raw: unknown): BlockRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.hostPattern !== 'string' || !o.hostPattern) return null;
  return {
    id: typeof o.id === 'string' ? o.id : nextRuleId(),
    enabled: o.enabled !== false,
    hostPattern: o.hostPattern,
    pathPattern: typeof o.pathPattern === 'string' ? o.pathPattern : undefined,
  };
}

function coerceBreakpointRule(raw: unknown): BreakpointRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.hostPattern !== 'string' || !o.hostPattern) return null;
  // Default to pausing the request if neither side is specified, so a rule
  // added with just a host still does something.
  const onRequest = o.onRequest === undefined ? o.onResponse !== true : o.onRequest === true;
  const onResponse = o.onResponse === true;
  return {
    id: typeof o.id === 'string' ? o.id : nextRuleId(),
    enabled: o.enabled !== false,
    hostPattern: o.hostPattern,
    pathPattern: typeof o.pathPattern === 'string' ? o.pathPattern : undefined,
    onRequest,
    onResponse,
  };
}

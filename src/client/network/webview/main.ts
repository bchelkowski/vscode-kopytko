/**
 * Network Inspector webview. A Charles-style view: a master capture toggle, a
 * request list grouped by origin, a detail pane (headers + bodies + metrics),
 * and a live-editable rewrite/upstream rules panel. Browser context only.
 */

import './styles.css';
import type {
  BodyRewriteRule,
  ExtMsg,
  FlowDetail,
  FlowTimings,
  RuleSet,
  SerializedFlow,
  UpstreamScheme,
  UpstreamSchemeRule,
  WebMsg,
  WebviewState,
} from './protocol';

interface VsCodeApi {
  postMessage(msg: WebMsg): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

/** Per body-section find state — current matches + which one is active. Not in `state` since it's transient DOM-derived UI, not app data. */
const findState = new WeakMap<HTMLDetailsElement, { matches: HTMLElement[]; index: number }>();

const state: {
  flows: SerializedFlow[];
  byId: Map<string, SerializedFlow>;
  details: Map<string, FlowDetail>;
  selectedId: string | null;
  collapsed: Set<string>;
  filter: string;
  statusChips: Set<string>;
  methodChips: Set<string>;
  maxEntries: number;
  rules: RuleSet;
  view: WebviewState;
  rulesOpen: boolean;
} = {
  flows: [],
  byId: new Map(),
  details: new Map(),
  selectedId: null,
  collapsed: new Set(),
  filter: '',
  statusChips: new Set(),
  methodChips: new Set(),
  maxEntries: 5000,
  rules: { bodyRules: [], upstreamSchemes: [], defaultUpstreamScheme: 'https' },
  view: { enabled: false, paused: false, redirectStatus: 'off', proxyPort: 8888 },
  rulesOpen: false,
};

// ── DOM skeleton ────────────────────────────────────────────────────────────

function buildDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <label class="switch" title="Start/stop capturing device traffic">
    <input type="checkbox" id="toggle">
    <span class="slider"></span>
    <span id="toggle-label">Capture off</span>
  </label>
  <button id="btn-pause" class="secondary" style="display:none" title="Pause recording — traffic keeps flowing through the proxy">⏸ Pause</button>
  <span class="dot" id="dot"></span>
  <span id="device-label">No device</span>
  <span id="redirect-badge" class="badge"></span>
  <span class="spacer"></span>
  <input id="filter" type="text" placeholder="Filter host / path / method">
  <button id="btn-rules" class="secondary">Rules</button>
  <button id="btn-clear" class="secondary">Clear</button>
  <button id="btn-export" class="secondary">Export HAR</button>
</div>
<div id="chip-bar">
  <span class="chip-group" id="status-chips">
    ${['2xx', '3xx', '4xx', '5xx', 'ERR'].map((c) => `<button class="chip" data-status-chip="${c}">${c}</button>`).join('')}
  </span>
  <span class="chip-group" id="method-chips">
    ${['GET', 'POST', 'PUT', 'DELETE', 'other'].map((c) => `<button class="chip" data-method-chip="${c}">${c}</button>`).join('')}
  </span>
</div>
<div id="rules-panel" style="display:none"></div>
<div id="notice" style="display:none"></div>
<div id="main">
  <div id="tree"></div>
  <div id="detail"><div class="empty">Select a request to inspect it.</div></div>
</div>`;
}

// ── rendering ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function originKey(f: SerializedFlow): string {
  // 443 with an HTTPS bridge is a default port too — the row's TLS tag
  // already says it was bridged, so `host:443` would just be noise.
  const isDefaultPort = !f.port || f.port === 80 || (f.port === 443 && f.upstreamScheme === 'https');
  return isDefaultPort ? f.host : `${f.host}:${f.port}`;
}

function renderState(): void {
  const v = state.view;
  (byId('toggle') as HTMLInputElement).checked = v.enabled;
  byId('toggle-label').textContent = v.enabled ? 'Capturing' : 'Capture off';
  byId('device-label').textContent = v.deviceLabel
    ? `${v.deviceLabel}${v.deviceIp ? ` @ ${v.deviceIp}` : ''}`
    : 'No device';

  const dot = byId('dot');
  dot.className = 'dot ' + (v.enabled ? (v.paused ? 'paused' : 'live') : 'off');

  const pauseBtn = byId('btn-pause');
  pauseBtn.style.display = v.enabled ? '' : 'none';
  pauseBtn.textContent = v.paused ? '▶ Resume' : '⏸ Pause';

  const badge = byId('redirect-badge');
  const map: Record<string, string> = {
    off: '', applying: 'redirect: applying…', on: `proxy :${v.proxyPort} · redirect on`,
    unsupported: `proxy :${v.proxyPort} · redirect not configured`, error: 'redirect error',
  };
  badge.textContent = map[v.redirectStatus] ?? '';
  badge.className = 'badge ' + v.redirectStatus;
  badge.title = v.message ?? '';

  const notice = byId('notice');
  const isError = v.redirectStatus === 'error' && !!v.message;
  const isInfo = v.redirectStatus === 'on' && !!v.message;
  if (isError || isInfo) {
    notice.style.display = 'block';
    notice.className = isError ? 'error' : 'info';
    notice.innerHTML = isError
      ? `<strong>Traffic redirect failed.</strong> The capture proxy was stopped. Details (also in the “Kopytko Network Inspector” output channel):<pre>${esc(v.message!)}</pre>`
      : `<strong>Heads up.</strong> ${esc(v.message!)}`;
  } else if (v.redirectStatus === 'unsupported' && v.message) {
    notice.style.display = 'block';
    notice.className = 'info';
    notice.innerHTML = `<strong>Redirect not configured.</strong> The capture proxy is running, but nothing is routed into it yet. ${esc(v.message)}`;
  } else {
    notice.style.display = 'none';
    notice.innerHTML = '';
  }
}

function statusChipOf(f: SerializedFlow): string {
  if (f.error) return 'ERR';
  if (f.status >= 500) return '5xx';
  if (f.status >= 400) return '4xx';
  if (f.status >= 300) return '3xx';
  return '2xx';
}

const METHOD_CHIPS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

function methodChipOf(f: SerializedFlow): string {
  return METHOD_CHIPS.has(f.method) ? f.method : 'other';
}

function passesFilter(f: SerializedFlow): boolean {
  if (state.statusChips.size > 0 && !state.statusChips.has(statusChipOf(f))) return false;
  if (state.methodChips.size > 0 && !state.methodChips.has(methodChipOf(f))) return false;
  if (!state.filter) return true;
  const q = state.filter.toLowerCase();
  return (
    f.host.toLowerCase().includes(q) ||
    f.path.toLowerCase().includes(q) ||
    f.method.toLowerCase().includes(q) ||
    String(f.status).includes(q)
  );
}

function renderTree(): void {
  // A full rebuild supersedes any queued incremental work.
  pendingFlows = [];
  pendingTrimIds = [];

  const tree = byId('tree');
  const groups = new Map<string, SerializedFlow[]>();
  for (const f of state.flows) {
    if (!passesFilter(f)) continue;
    const key = originKey(f);
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  if (groups.size === 0) {
    tree.innerHTML = `<div class="empty">${
      state.view.enabled ? 'Waiting for traffic…' : 'Capture is off. Flip the toggle to start.'
    }</div>`;
    return;
  }

  const parts: string[] = [];
  for (const [origin, flows] of groups) {
    parts.push(originGroupHtml(origin, flows.map((f) => rowHtml(f)).join(''), flows.length));
  }
  tree.innerHTML = parts.join('');
}

function originGroupHtml(origin: string, rows: string, count: number): string {
  const collapsed = state.collapsed.has(origin);
  return `<div class="origin${collapsed ? ' collapsed' : ''}" data-origin="${esc(origin)}">
    <div class="origin-head" data-origin="${esc(origin)}">
      <span class="twisty">${collapsed ? '▸' : '▾'}</span>
      <span class="origin-name">${esc(origin)}</span>
      <span class="origin-count">${count}</span>
    </div>
    <div class="origin-rows">${rows}</div>
  </div>`;
}

// ── incremental list updates ────────────────────────────────────────────────
//
// The full `renderTree()` rebuild is O(all rows) — fine for filter changes
// and init, but far too expensive to run once per arriving flow when the
// buffer holds thousands of entries. Live `flow`/`trim` messages instead
// queue here and are flushed as targeted DOM appends/removals, coalesced per
// animation frame (with a timeout fallback — rAF stalls while the panel tab
// is backgrounded, and flows must not pile up unboundedly there).

let pendingFlows: SerializedFlow[] = [];
let pendingTrimIds: string[] = [];
let flushScheduled = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleTreeFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => {
    if (!flushScheduled) return;
    flushScheduled = false;
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    flushTree();
  };
  requestAnimationFrame(run);
  flushTimer = setTimeout(run, 100);
}

function flushTree(): void {
  const tree = byId('tree');
  // The empty placeholder isn't a group structure we can append into.
  if (tree.querySelector(':scope > .empty')) {
    renderTree();
    return;
  }

  const flows = pendingFlows;
  const trims = pendingTrimIds;
  pendingFlows = [];
  pendingTrimIds = [];

  for (const f of flows) {
    if (passesFilter(f)) appendFlowRow(tree, f);
  }
  for (const id of trims) removeFlowRow(tree, id);

  if (!tree.firstElementChild) renderTree(); // last group removed → empty state
}

function appendFlowRow(tree: HTMLElement, f: SerializedFlow): void {
  const origin = originKey(f);
  const group = tree.querySelector<HTMLElement>(`:scope > .origin[data-origin="${CSS.escape(origin)}"]`);
  if (!group) {
    // New origins go to the end — the same position a full rebuild gives
    // them, since renderTree groups in Map-insertion (= arrival) order.
    tree.insertAdjacentHTML('beforeend', originGroupHtml(origin, rowHtml(f), 1));
    return;
  }
  group.querySelector('.origin-rows')!.insertAdjacentHTML('beforeend', rowHtml(f));
  updateGroupCount(group);
}

function removeFlowRow(tree: HTMLElement, id: string): void {
  const row = tree.querySelector<HTMLElement>(`.row[data-id="${CSS.escape(id)}"]`);
  if (!row) return; // filtered out, or already gone — nothing to remove
  const group = row.closest<HTMLElement>('.origin');
  row.remove();
  if (!group) return;
  if (group.querySelector('.row')) updateGroupCount(group);
  else group.remove();
}

function updateGroupCount(group: HTMLElement): void {
  const count = group.querySelectorAll('.row').length;
  const label = group.querySelector('.origin-count');
  if (label) label.textContent = String(count);
}

function fmtTime(wallMs: number): string {
  const d = new Date(wallMs);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function rowHtml(f: SerializedFlow): string {
  const sel = f.id === state.selectedId ? ' selected' : '';
  const statusClass = f.error ? 'err' : f.status >= 400 ? 'warn' : f.status >= 300 ? 'redir' : 'ok';
  const statusText = f.error ? 'ERR' : String(f.status || '—');
  const rw = f.rewrittenBody ? '<span class="tag" title="Response body rewritten">rw</span>' : '';
  const up = f.upstreamScheme === 'https' ? '<span class="tag https" title="Bridged to HTTPS upstream">TLS</span>' : '';
  const rp = f.replayed ? '<span class="tag replay" title="User-initiated replay, not device traffic">replay</span>' : '';
  return `<div class="row${sel}" data-id="${f.id}">
    <span class="time">${fmtTime(f.startedWall)}</span>
    <span class="method ${f.method.toLowerCase()}">${esc(f.method)}</span>
    <span class="status ${statusClass}">${statusText}</span>
    <span class="path" title="${esc(f.path)}${f.query ? '?' + esc(f.query) : ''}">${esc(f.path)}</span>
    ${up}${rw}${rp}
    <span class="dur">${f.durationMs}ms</span>
    <span class="size">${fmtBytes(f.responseBytes)}</span>
  </div>`;
}

function renderDetail(): void {
  const el = byId('detail');
  const id = state.selectedId;
  if (!id) {
    el.innerHTML = '<div class="empty">Select a request to inspect it.</div>';
    return;
  }
  const f = state.byId.get(id);
  if (!f) return;
  const d = state.details.get(id);

  const overview = `<table class="kv">
    <tr><td>URL</td><td>http://${esc(originKey(f))}${esc(f.path)}${f.query ? '?' + esc(f.query) : ''}</td></tr>
    <tr><td>Method</td><td>${esc(f.method)}</td></tr>
    <tr><td>Status</td><td>${f.error ? esc(f.error) : `${f.status} ${esc(f.statusText)}`}</td></tr>
    <tr><td>Upstream</td><td>${f.upstreamScheme.toUpperCase()}${f.rewrittenBody ? ' · body rewritten' : ''}</td></tr>
    <tr><td>Duration</td><td>${f.durationMs} ms</td></tr>
    <tr><td>Size</td><td>req ${fmtBytes(f.requestBytes)} · resp ${fmtBytes(f.responseBytes)}</td></tr>
    <tr><td>Client</td><td>${esc(f.clientIp)}</td></tr>
  </table>`;

  const actions = `<div class="detail-actions">
    <button class="secondary" data-copy="url">Copy URL</button>
    <button class="secondary" data-copy="curl">Copy as cURL</button>
    <button class="secondary" data-replay title="Re-send this request through the proxy as a new flow">Replay</button>
  </div>`;

  const parts = [
    section('Overview', actions + overview),
    timingSection(f),
    headersSection('Request headers', f.requestHeaders),
    bodySectionShell('request', 'Request body', f.requestBytes, !!d?.requestBody, !!d?.originalRequestBody),
    headersSection('Response headers', f.responseHeaders),
    bodySectionShell('response', 'Response body', f.responseBytes, !!d?.responseBody, !!d?.originalResponseBody),
  ];
  el.innerHTML = parts.join('');

  // Body content (raw/formatted/tree) is only computed once its section is
  // actually opened — never eagerly for a section the user hasn't looked at.
  el.querySelectorAll<HTMLDetailsElement>('.body-section').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) ensureBodyContent(details, d);
    });
  });
}

function section(title: string, inner: string): string {
  return `<div class="section"><h3>${esc(title)}</h3>${inner}</div>`;
}

const TIMING_PHASES: Array<{ key: keyof FlowTimings; label: string; cls: string }> = [
  { key: 'blockedMs', label: 'Blocked (request body)', cls: 'blocked' },
  { key: 'dnsMs', label: 'DNS', cls: 'dns' },
  { key: 'connectMs', label: 'Connect', cls: 'connect' },
  { key: 'tlsMs', label: 'TLS', cls: 'tls' },
  { key: 'sendMs', label: 'Send', cls: 'send' },
  { key: 'waitMs', label: 'Wait (TTFB)', cls: 'wait' },
  { key: 'receiveMs', label: 'Receive', cls: 'receive' },
];

/** Stacked bar + per-phase table. Absent phases (reused socket, plain http) simply don't appear. */
function timingSection(f: SerializedFlow): string {
  const t = f.timings;
  if (!t) return '';
  const phases = TIMING_PHASES.filter((p) => typeof t[p.key] === 'number').map((p) => ({
    ...p,
    ms: t[p.key] as number,
  }));
  const total = phases.reduce((sum, p) => sum + p.ms, 0);
  const bar =
    total > 0
      ? `<div class="tbar">${phases
          .filter((p) => p.ms > 0)
          .map((p) => `<span class="tseg ${p.cls}" style="width:${((p.ms / total) * 100).toFixed(2)}%" title="${p.label}: ${p.ms} ms"></span>`)
          .join('')}</div>`
      : '';
  const rows = phases
    .map((p) => `<tr><td><span class="tdot ${p.cls}"></span>${p.label}</td><td>${p.ms} ms</td></tr>`)
    .join('');
  const reused = t.socketReused
    ? '<div class="hint">Upstream socket reused (keep-alive) — no DNS/connect/TLS cost for this request.</div>'
    : '';
  return `<details class="dsec" open>
    <summary>Timing<span class="count">${f.durationMs} ms</span></summary>
    <div class="section-body">${bar}<table class="kv">${rows}</table>${reused}</div>
  </details>`;
}

function headersSection(title: string, headers: Record<string, string | string[]>): string {
  const count = Object.keys(headers).length;
  return `<details class="dsec" open>
    <summary>${esc(title)}<span class="count">${count}</span></summary>
    <div class="section-body">${headersHtml(headers)}</div>
  </details>`;
}

function headersHtml(headers: Record<string, string | string[]>): string {
  const rows = Object.entries(headers)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`)
    .join('');
  return `<table class="kv">${rows || '<tr><td colspan="2">(none)</td></tr>'}</table>`;
}

/**
 * Renders only the collapsed shell (summary + empty content placeholder) —
 * deliberately closed by default. The body itself is only fetched from
 * `state` and formatted once the user actually opens it (see
 * `ensureBodyContent`), so a request with a large JSON/XML body never pays
 * for parsing/formatting unless someone looks at it.
 */
function bodySectionShell(
  kind: 'request' | 'response',
  title: string,
  byteSize: number,
  hasBody: boolean,
  hasOriginal: boolean,
): string {
  if (!hasBody) return '';
  return `<details class="dsec body-section" data-kind="${kind}">
    <summary>${esc(title)}<span class="count">${fmtBytes(byteSize)}</span></summary>
    <div class="body-toolbar">
      <div class="tabs">
        <button type="button" class="tab active" data-tab="raw">Raw</button>
        <button type="button" class="tab" data-tab="formatted">Formatted</button>
        <button type="button" class="tab" data-tab="tree">Tree</button>
      </div>
      <div class="find-group">
        <input type="text" class="find-input" data-find-input placeholder="Find">
        <span class="find-count" data-find-count></span>
        <button type="button" class="find-nav" data-find-prev title="Previous match">˄</button>
        <button type="button" class="find-nav" data-find-next title="Next match">˅</button>
      </div>
      <button type="button" class="find-nav" data-copy-body title="Copy the body as sent/received (host-side, untruncated view of the retained bytes)">Copy</button>
      ${hasOriginal ? '<label class="rewritten-toggle"><input type="checkbox" data-rewritten-toggle> Show rewritten</label>' : ''}
    </div>
    <div class="body-content"></div>
  </details>`;
}

function ensureBodyContent(details: HTMLDetailsElement, d: FlowDetail | undefined): void {
  const content = details.querySelector<HTMLElement>('.body-content');
  if (!content || content.dataset.rendered === '1') return;
  content.dataset.rendered = '1';
  renderBodyTab(details, d);
}

/** Computes exactly one (tab × original-vs-rewritten) view — the one currently selected — never all of them. */
function renderBodyTab(details: HTMLDetailsElement, d: FlowDetail | undefined): void {
  const content = details.querySelector<HTMLElement>('.body-content');
  if (!content) return;

  const kind = details.dataset.kind;
  const tab = details.querySelector<HTMLElement>('.tab.active')?.dataset.tab ?? 'raw';
  const showRewritten = details.querySelector<HTMLInputElement>('[data-rewritten-toggle]')?.checked ?? false;

  const original = kind === 'request' ? d?.originalRequestBody : d?.originalResponseBody;
  const current = kind === 'request' ? d?.requestBody : d?.responseBody;
  const truncated = kind === 'request' ? d?.requestBodyTruncated : d?.responseBodyTruncated;
  // Default (unchecked) shows the original, pre-rewrite body; checking the
  // box reveals what the rule actually produced. When nothing was rewritten
  // for this direction, `original` is absent and `current` covers both.
  const text = (original !== undefined && !showRewritten ? original : current) ?? '';

  content.innerHTML = bodyView(text, tab, truncated);
  // A find query survives tab switches / the rewritten toggle — re-apply it
  // against the freshly rendered content instead of losing it.
  const query = details.dataset.findQuery ?? '';
  if (query) runFind(details, query);
}

function bodyView(text: string, tab: string, truncated?: boolean): string {
  const truncNote = truncated ? '<div class="hint">Truncated for display — the full body was still forwarded to the device.</div>' : '';
  if (tab === 'formatted') return truncNote + formattedBodyHtml(text);
  if (tab === 'tree') return truncNote + jsonTreeBodyHtml(text);
  return truncNote + `<pre class="body">${esc(text)}</pre>`;
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function formattedBodyHtml(text: string): string {
  const parsed = tryParseJson(text);
  if (parsed.ok) return `<pre class="body">${highlightJson(JSON.stringify(parsed.value, null, 2))}</pre>`;
  const xml = tryFormatXml(text);
  if (xml !== null) return `<pre class="body">${highlightXml(xml)}</pre>`;
  return `<div class="hint">Not valid JSON or XML — showing raw text.</div><pre class="body">${esc(text)}</pre>`;
}

/** Regex-based JSON token highlighter — reuses the `.jt-*` classes from the tree view. */
function highlightJson(text: string): string {
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    out += esc(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      const cls = match[2] ? 'jt-key' : 'jt-string';
      out += `<span class="${cls}">${esc(match[1])}</span>${esc(match[2] ?? '')}`;
    } else if (match[3] !== undefined) {
      out += `<span class="${match[3] === 'null' ? 'jt-null' : 'jt-bool'}">${esc(match[3])}</span>`;
    } else if (match[4] !== undefined) {
      out += `<span class="jt-number">${esc(match[4])}</span>`;
    }
    lastIndex = pattern.lastIndex;
  }
  out += esc(text.slice(lastIndex));
  return out;
}

/** Best-effort XML token highlighter — tag names + attribute values, not a real parser. */
function highlightXml(text: string): string {
  const pattern = /(<!--[\s\S]*?-->)|(<\/?)([a-zA-Z][\w:.-]*)|([a-zA-Z_][\w:.-]*)(=)("[^"]*"|'[^']*')/g;
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    out += esc(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      out += `<span class="jt-null">${esc(match[1])}</span>`;
    } else if (match[3] !== undefined) {
      out += `${esc(match[2])}<span class="jt-key">${esc(match[3])}</span>`;
    } else if (match[4] !== undefined) {
      out += `<span class="jt-bool">${esc(match[4])}</span>${esc(match[5])}<span class="jt-string">${esc(match[6])}</span>`;
    }
    lastIndex = pattern.lastIndex;
  }
  out += esc(text.slice(lastIndex));
  return out;
}

/** Best-effort indent by tag depth — not a real XML parser, just a readability aid. */
function tryFormatXml(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<')) return null;
  try {
    let indent = 0;
    const lines = trimmed.replace(/>\s*</g, '>\n<').split('\n');
    const out = lines.map((line) => {
      const isClosing = /^<\//.test(line);
      const isSelfClosingOrDecl = /\/>\s*$/.test(line) || /^<\?/.test(line) || /^<!/.test(line);
      if (isClosing) indent = Math.max(0, indent - 1);
      const rendered = '  '.repeat(indent) + line;
      if (!isClosing && !isSelfClosingOrDecl && /^<[a-zA-Z]/.test(line)) indent += 1;
      return rendered;
    });
    return out.join('\n');
  } catch {
    return null;
  }
}

function jsonTreeBodyHtml(text: string): string {
  const parsed = tryParseJson(text);
  if (!parsed.ok) return `<div class="hint">Tree view needs valid JSON.</div><pre class="body">${esc(text)}</pre>`;
  return `<div class="json-tree">${jsonNodeHtml(parsed.value, null)}</div>`;
}

/** Only the root node (depth 0) starts open — every deeper node starts folded. */
function jsonNodeHtml(value: unknown, key: string | null, depth = 0): string {
  const label = key !== null ? `<span class="jt-key">${esc(key)}</span><span class="jt-colon">: </span>` : '';
  const openAttr = depth === 0 ? ' open' : '';
  if (value === null) return `<div class="jt-row">${label}<span class="jt-null">null</span></div>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `<div class="jt-row">${label}<span class="jt-punct">[]</span></div>`;
    return `<details class="jt-node"${openAttr}><summary>${label}<span class="jt-punct">Array(${value.length})</span></summary>${value
      .map((v, i) => jsonNodeHtml(v, String(i), depth + 1))
      .join('')}</details>`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `<div class="jt-row">${label}<span class="jt-punct">{}</span></div>`;
    return `<details class="jt-node"${openAttr}><summary>${label}<span class="jt-punct">{${entries.length}}</span></summary>${entries
      .map(([k, v]) => jsonNodeHtml(v, k, depth + 1))
      .join('')}</details>`;
  }
  const cls = typeof value === 'string' ? 'jt-string' : typeof value === 'number' ? 'jt-number' : 'jt-bool';
  const disp = typeof value === 'string' ? `"${esc(value)}"` : String(value);
  return `<div class="jt-row">${label}<span class="${cls}">${disp}</span></div>`;
}

// ── find-in-body ────────────────────────────────────────────────────────────

/**
 * Finds `query` (case-insensitive) inside the currently rendered body
 * content — works across Raw, Formatted, and Tree alike since it walks the
 * rendered DOM's text nodes rather than re-parsing the source text, so it
 * naturally sees through syntax-highlighting spans and the JSON tree's
 * nested elements without any tab-specific logic.
 */
function runFind(details: HTMLDetailsElement, query: string): void {
  const content = details.querySelector<HTMLElement>('.body-content');
  if (!content) return;
  details.dataset.findQuery = query;
  clearFindHighlights(content);

  if (!query) {
    findState.delete(details);
    updateFindCount(details, 0, 0);
    return;
  }

  const matches = highlightBodyMatches(content, query);
  findState.set(details, { matches, index: matches.length > 0 ? 0 : -1 });
  if (matches.length > 0) matches[0].classList.add('current');
  updateFindCount(details, matches.length, matches.length > 0 ? 1 : 0);
  if (matches.length > 0) matches[0].scrollIntoView({ block: 'nearest' });
}

function clearFindHighlights(container: HTMLElement): void {
  container.querySelectorAll('mark.body-match').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  });
}

function highlightBodyMatches(container: HTMLElement, query: string): HTMLElement[] {
  const q = query.toLowerCase();
  const marks: HTMLElement[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  // Collect first — mutating the tree while the walker is mid-traversal skips nodes.
  while ((node = walker.nextNode())) textNodes.push(node as Text);

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    const lower = text.toLowerCase();
    let idx = lower.indexOf(q);
    if (idx === -1) continue;

    const frag = document.createDocumentFragment();
    let pos = 0;
    while (idx !== -1) {
      if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
      const mark = document.createElement('mark');
      mark.className = 'body-match';
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      marks.push(mark);
      pos = idx + query.length;
      idx = lower.indexOf(q, pos);
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return marks;
}

function updateFindCount(details: HTMLDetailsElement, total: number, current: number): void {
  const label = details.querySelector<HTMLElement>('[data-find-count]');
  if (!label) return;
  const query = details.dataset.findQuery;
  label.textContent = !query ? '' : total === 0 ? '0/0' : `${current}/${total}`;
}

function gotoFindMatch(details: HTMLDetailsElement, delta: number): void {
  const s = findState.get(details);
  if (!s || s.matches.length === 0) return;
  s.matches[s.index]?.classList.remove('current');
  s.index = (s.index + delta + s.matches.length) % s.matches.length;
  const next = s.matches[s.index];
  next.classList.add('current');
  next.scrollIntoView({ block: 'nearest' });
  updateFindCount(details, s.matches.length, s.index + 1);
}

// ── rules panel ───────────────────────────────────────────────────────────────

function renderRules(): void {
  const panel = byId('rules-panel');
  panel.style.display = state.rulesOpen ? 'block' : 'none';
  if (!state.rulesOpen) return;

  const r = state.rules;
  const bodyRows = r.bodyRules
    .map(
      (rule, i) => `<div class="rule" data-i="${i}">
      <input type="checkbox" data-f="enabled" ${rule.enabled ? 'checked' : ''} title="Enabled">
      <select data-f="direction">
        <option value="response" ${rule.direction === 'response' ? 'selected' : ''}>response</option>
        <option value="request" ${rule.direction === 'request' ? 'selected' : ''}>request</option>
      </select>
      <input type="text" data-f="hostPattern" placeholder="host (blank = all)" value="${esc(rule.hostPattern ?? '')}">
      <input type="text" data-f="contentTypePattern" placeholder="content-type (blank = any)" value="${esc(rule.contentTypePattern ?? '')}">
      <input type="text" data-f="find" placeholder="find" value="${esc(rule.find)}">
      <input type="text" data-f="replace" placeholder="replace" value="${esc(rule.replace)}">
      <label class="rx"><input type="checkbox" data-f="isRegex" ${rule.isRegex ? 'checked' : ''}>regex</label>
      <button class="link del-body" data-i="${i}">✕</button>
    </div>`,
    )
    .join('');

  const schemeRows = r.upstreamSchemes
    .map(
      (rule, i) => `<div class="scheme" data-i="${i}">
      <input type="text" data-f="hostPattern" placeholder="host pattern" value="${esc(rule.hostPattern)}">
      <select data-f="scheme">
        ${['https', 'http', 'auto']
          .map((s) => `<option value="${s}" ${rule.scheme === s ? 'selected' : ''}>${s}</option>`)
          .join('')}
      </select>
      <button class="link del-scheme" data-i="${i}">✕</button>
    </div>`,
    )
    .join('');

  panel.innerHTML = `
  <div class="rules-inner">
    <h3>Body rewrite rules</h3>
    <div id="body-rules">${bodyRows || '<div class="empty">No rules.</div>'}</div>
    <button class="link" id="add-body">+ add body rule</button>

    <h3>Upstream scheme</h3>
    <label>Default:
      <select id="default-scheme">
        ${['https', 'http', 'auto']
          .map((s) => `<option value="${s}" ${r.defaultUpstreamScheme === s ? 'selected' : ''}>${s}</option>`)
          .join('')}
      </select>
    </label>
    <div id="scheme-rules">${schemeRows}</div>
    <button class="link" id="add-scheme">+ add host override</button>

    <div class="rules-actions">
      <button id="apply-rules">Apply rules</button>
      <button class="secondary" id="close-rules">Close</button>
    </div>
  </div>`;
}

function collectRulesFromDom(): RuleSet {
  const bodyRules: BodyRewriteRule[] = [];
  document.querySelectorAll('#body-rules .rule').forEach((row) => {
    const get = (f: string) => row.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
    const existing = state.rules.bodyRules[Number((row as HTMLElement).dataset.i)];
    bodyRules.push({
      id: existing?.id ?? `rule-${Date.now()}-${bodyRules.length}`,
      enabled: !!get('enabled')?.checked,
      direction: (get('direction')?.value as 'response' | 'request') ?? 'response',
      hostPattern: get('hostPattern')?.value || undefined,
      contentTypePattern: get('contentTypePattern')?.value || undefined,
      find: get('find')?.value ?? '',
      replace: get('replace')?.value ?? '',
      isRegex: !!get('isRegex')?.checked,
    });
  });

  const upstreamSchemes: UpstreamSchemeRule[] = [];
  document.querySelectorAll('#scheme-rules .scheme').forEach((row) => {
    const host = row.querySelector<HTMLInputElement>('[data-f="hostPattern"]')?.value ?? '';
    const scheme = (row.querySelector<HTMLSelectElement>('[data-f="scheme"]')?.value as UpstreamScheme) ?? 'https';
    if (host) upstreamSchemes.push({ hostPattern: host, scheme });
  });

  const def = (byId('default-scheme') as HTMLSelectElement).value as UpstreamScheme;
  return { bodyRules, upstreamSchemes, defaultUpstreamScheme: def };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── events ──────────────────────────────────────────────────────────────────

function wireEvents(): void {
  byId('toggle').addEventListener('change', (e) => {
    vscode.postMessage({ kind: 'set-enabled', enabled: (e.target as HTMLInputElement).checked });
  });
  // Re-filtering is a full list rebuild — debounce so fast typing pays once.
  let filterTimer: ReturnType<typeof setTimeout> | undefined;
  byId('filter').addEventListener('input', (e) => {
    state.filter = (e.target as HTMLInputElement).value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(renderTree, 150);
  });
  byId('filter').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    clearTimeout(filterTimer);
    renderTree();
  });
  byId('btn-clear').addEventListener('click', () => vscode.postMessage({ kind: 'clear' }));
  byId('btn-export').addEventListener('click', () => vscode.postMessage({ kind: 'export-har' }));
  byId('btn-pause').addEventListener('click', () => {
    vscode.postMessage({ kind: 'set-paused', paused: !state.view.paused });
  });

  byId('chip-bar').addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip');
    if (!chip) return;
    const statusKey = chip.dataset.statusChip;
    const set = statusKey !== undefined ? state.statusChips : state.methodChips;
    const key = statusKey ?? chip.dataset.methodChip!;
    if (set.has(key)) {
      set.delete(key);
      chip.classList.remove('active');
    } else {
      set.add(key);
      chip.classList.add('active');
    }
    renderTree();
  });
  byId('btn-rules').addEventListener('click', () => {
    state.rulesOpen = !state.rulesOpen;
    renderRules();
  });

  byId('tree').addEventListener('click', (e) => {
    const head = (e.target as HTMLElement).closest<HTMLElement>('.origin-head');
    if (head) {
      const origin = head.dataset.origin!;
      if (state.collapsed.has(origin)) state.collapsed.delete(origin);
      else state.collapsed.add(origin);
      renderTree();
      return;
    }
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (row) {
      state.selectedId = row.dataset.id!;
      if (!state.details.has(state.selectedId)) {
        vscode.postMessage({ kind: 'select-flow', id: state.selectedId });
      }
      // Selection only moves a highlight — two class swaps, not a rebuild.
      byId('tree').querySelector('.row.selected')?.classList.remove('selected');
      row.classList.add('selected');
      renderDetail();
    }
  });

  byId('detail').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const copyBtn = target.closest<HTMLElement>('[data-copy]');
    if (copyBtn && state.selectedId) {
      vscode.postMessage({ kind: 'copy-flow', id: state.selectedId, what: copyBtn.dataset.copy as 'url' | 'curl' });
      return;
    }
    const replayBtn = target.closest<HTMLElement>('[data-replay]');
    if (replayBtn && state.selectedId) {
      vscode.postMessage({ kind: 'replay-flow', id: state.selectedId });
      return;
    }
    const copyBodyBtn = target.closest<HTMLElement>('[data-copy-body]');
    if (copyBodyBtn && state.selectedId) {
      const details = copyBodyBtn.closest<HTMLDetailsElement>('.body-section');
      if (details) {
        vscode.postMessage({
          kind: 'copy-flow',
          id: state.selectedId,
          what: details.dataset.kind === 'request' ? 'request-body' : 'response-body',
        });
      }
      return;
    }

    const tabBtn = target.closest<HTMLElement>('.tab');
    if (tabBtn) {
      const details = tabBtn.closest<HTMLDetailsElement>('.body-section');
      if (!details) return;
      details.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      tabBtn.classList.add('active');
      renderBodyTab(details, state.selectedId ? state.details.get(state.selectedId) : undefined);
      return;
    }

    const findNav = target.closest<HTMLElement>('.find-nav');
    if (findNav) {
      const details = findNav.closest<HTMLDetailsElement>('.body-section');
      if (!details) return;
      gotoFindMatch(details, findNav.hasAttribute('data-find-prev') ? -1 : 1);
    }
  });

  byId('detail').addEventListener('change', (e) => {
    const input = e.target as HTMLElement;
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-rewritten-toggle')) return;
    const details = input.closest<HTMLDetailsElement>('.body-section');
    if (!details) return;
    renderBodyTab(details, state.selectedId ? state.details.get(state.selectedId) : undefined);
  });

  byId('detail').addEventListener('input', (e) => {
    const input = e.target as HTMLElement;
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-find-input')) return;
    const details = input.closest<HTMLDetailsElement>('.body-section');
    if (!details) return;
    runFind(details, input.value);
  });

  byId('detail').addEventListener('keydown', (e) => {
    const input = e.target as HTMLElement;
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-find-input')) return;
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const details = input.closest<HTMLDetailsElement>('.body-section');
    if (!details) return;
    gotoFindMatch(details, e.shiftKey ? -1 : 1);
  });

  byId('rules-panel').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'apply-rules') {
      state.rules = collectRulesFromDom();
      vscode.postMessage({ kind: 'set-rules', rules: state.rules });
      renderRules();
    } else if (t.id === 'close-rules') {
      state.rulesOpen = false;
      renderRules();
    } else if (t.id === 'add-body') {
      state.rules = collectRulesFromDom();
      state.rules.bodyRules.push({ id: `rule-${Date.now()}`, enabled: true, direction: 'response', find: '', replace: '' });
      renderRules();
    } else if (t.id === 'add-scheme') {
      state.rules = collectRulesFromDom();
      state.rules.upstreamSchemes.push({ hostPattern: '', scheme: 'https' });
      renderRules();
    } else if (t.classList.contains('del-body')) {
      state.rules = collectRulesFromDom();
      state.rules.bodyRules.splice(Number(t.dataset.i), 1);
      renderRules();
    } else if (t.classList.contains('del-scheme')) {
      state.rules = collectRulesFromDom();
      state.rules.upstreamSchemes.splice(Number(t.dataset.i), 1);
      renderRules();
    }
  });
}

// ── message handling ──────────────────────────────────────────────────────────

function ingestFlow(f: SerializedFlow): void {
  state.flows.push(f);
  state.byId.set(f.id, f);
  // Mirror the host's ring buffer so a long visible session can't grow the
  // webview past `maxEntries` (live `flow` messages are the only growth path;
  // the host's own trims arrive separately as `trim` messages).
  while (state.flows.length > state.maxEntries) {
    const dropped = state.flows.shift()!;
    state.byId.delete(dropped.id);
    state.details.delete(dropped.id);
    pendingTrimIds.push(dropped.id);
    if (state.selectedId === dropped.id) {
      state.selectedId = null;
      renderDetail();
    }
  }
}

function dropFlows(ids: string[]): void {
  const drop = new Set(ids.filter((id) => state.byId.has(id)));
  if (drop.size > 0) {
    state.flows = state.flows.filter((f) => !drop.has(f.id));
    for (const id of drop) {
      state.byId.delete(id);
      state.details.delete(id);
    }
    if (state.selectedId && drop.has(state.selectedId)) {
      state.selectedId = null;
      renderDetail();
    }
  }
  // Queue DOM removal even for ids already dropped from state (the client
  // ring may have beaten the host's trim message) — removal is idempotent.
  pendingTrimIds.push(...ids);
}

window.addEventListener('message', (ev) => {
  const msg = ev.data as ExtMsg;
  switch (msg.kind) {
    case 'init': {
      state.view = msg.state;
      state.rules = msg.rules;
      state.maxEntries = Math.max(1, msg.maxEntries ?? 5000);
      // Rebuild from host history, but keep the user's place: the selection
      // and any already-fetched bodies survive a tab hide→restore resync
      // (bodies are immutable per flow, so the cache stays valid).
      const prevSelected = state.selectedId;
      const prevDetails = state.details;
      pendingFlows = [];
      pendingTrimIds = [];
      state.flows = [];
      state.byId.clear();
      for (const f of msg.history) {
        state.flows.push(f);
        state.byId.set(f.id, f);
      }
      state.selectedId = prevSelected && state.byId.has(prevSelected) ? prevSelected : null;
      state.details = new Map([...prevDetails].filter(([id]) => state.byId.has(id)));
      renderState();
      renderTree();
      renderDetail();
      renderRules();
      break;
    }
    case 'flow':
      ingestFlow(msg.entry);
      pendingFlows.push(msg.entry);
      scheduleTreeFlush();
      break;
    case 'trim':
      dropFlows(msg.ids);
      scheduleTreeFlush();
      break;
    case 'flow-detail':
      state.details.set(msg.detail.id, msg.detail);
      if (state.selectedId === msg.detail.id) renderDetail();
      break;
    case 'state':
      state.view = msg.state;
      renderState();
      renderTree();
      break;
    case 'rules':
      state.rules = msg.rules;
      if (state.rulesOpen) renderRules();
      break;
    case 'cleared':
      state.flows = [];
      state.byId.clear();
      state.details.clear();
      state.selectedId = null;
      renderTree();
      renderDetail();
      break;
    case 'error': {
      const n = byId('notice');
      n.style.display = 'block';
      n.className = 'error';
      n.innerHTML = `<strong>Error.</strong><pre>${esc(msg.message)}</pre>`;
      break;
    }
  }
});

// ── init ────────────────────────────────────────────────────────────────────

buildDom();
wireEvents();
renderState();
renderTree();
vscode.postMessage({ kind: 'ready' });

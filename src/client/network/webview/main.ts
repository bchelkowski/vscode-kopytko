/**
 * Network Inspector webview. A Charles-style view: a master capture toggle, a
 * request list grouped by origin, a detail pane (headers + bodies + metrics),
 * and a live-editable rewrite/upstream rules panel. Browser context only.
 */

import './styles.css';
import { tryFormatXml } from '../../webview/bodyFormat';
import { diffLines } from '../textDiff';
import { findBlock, matchHost, matchPath } from '../capture/rewrite/rules';
import { el as byId, formatBytes as fmtBytes } from '../../webview/domUtils';
import type {
  BlockRule,
  BodyRewriteRule,
  BreakpointRule,
  ExtMsg,
  FlowDetail,
  FlowTimings,
  HeaderRule,
  InterceptPayload,
  InterceptResult,
  LatencyRule,
  MapLocalRule,
  RewriteExcludeRule,
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

/** Parsed JSON of each section's currently rendered Tree tab — used by the copy context menu. */
const treeData = new WeakMap<HTMLDetailsElement, unknown>();

const state: {
  flows: SerializedFlow[];
  byId: Map<string, SerializedFlow>;
  details: Map<string, FlowDetail>;
  selectedId: string | null;
  collapsed: Set<string>;
  filter: string;
  statusChips: Set<string>;
  methodChips: Set<string>;
  /** Per-section open state (keyed by `data-sec`) — survives flow switches. Only Overview starts open. */
  sectionOpen: Record<string, boolean>;
  /** Section the user last opened/clicked — scrolled back into view when switching flows. */
  lastFocusedSection: string | null;
  /** Whether the detail pane is currently scrolled to its bottom — restored on the next flow instead of `lastFocusedSection` when set. */
  detailScrolledToBottom: boolean;
  /** Last body-view tab picked per body kind (raw/formatted/tree) — reused so switching flows doesn't reset it. */
  bodyTab: { request: string; response: string };
  /** Last picked tab for binary bodies (preview/hex) — kept separate since binary sections use a different tab set. */
  binaryBodyTab: string;
  /** Flow marked as the "A" side for a comparison, if any. */
  diffBaseId: string | null;
  /** When set, the detail pane shows a diff of these two flows instead of one flow. */
  diffView: { aId: string; bId: string } | null;
  /** Paused breakpoints awaiting the user's edits, oldest first. */
  intercepts: InterceptPayload[];
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
  sectionOpen: { overview: true },
  lastFocusedSection: null,
  detailScrolledToBottom: false,
  bodyTab: { request: 'raw', response: 'raw' },
  binaryBodyTab: 'preview',
  diffBaseId: null,
  diffView: null,
  intercepts: [],
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
  <button id="btn-intercepts" class="secondary" style="display:none" title="Paused breakpoints awaiting your edits"></button>
  <span class="spacer"></span>
  <input id="filter" type="text" placeholder="Filter host / path / method">
  <button id="btn-search" class="secondary" title="Search across all captured requests (URL, headers, text bodies)">Search</button>
  <button id="btn-rules" class="secondary">Rules</button>
  <button id="btn-clear" class="secondary">Clear</button>
  <button id="btn-export" class="secondary">Export HAR</button>
</div>
<div id="search-panel" style="display:none">
  <div class="search-inner">
    <input id="search-input" type="text" placeholder="Search URL, headers, and text bodies — Enter to run">
    <button id="search-close" class="secondary">Close</button>
    <div id="search-results"></div>
  </div>
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
<div id="intercept-panel" style="display:none"></div>
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
  // In-flight flows have no status yet — status chips can't classify them,
  // so they stay visible and get re-checked when the completion arrives.
  if (state.statusChips.size > 0 && !f.pending && !state.statusChips.has(statusChipOf(f))) return false;
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
  syncPendingTicker();
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
    // A `flow` message is an upsert: a row may already exist for this id
    // (the in-flight placeholder) — update it in place, or remove it when
    // the completion no longer passes the active filter (e.g. a 404
    // arriving while only the 2xx chip is on).
    const row = tree.querySelector<HTMLElement>(`.row[data-id="${CSS.escape(f.id)}"]`);
    if (row) {
      if (passesFilter(f)) updateFlowRow(tree, row, f);
      else removeFlowRow(tree, f.id);
    } else if (passesFilter(f)) {
      appendFlowRow(tree, f);
    }
  }
  for (const id of trims) removeFlowRow(tree, id);

  if (!tree.firstElementChild) renderTree(); // last group removed → empty state
  syncPendingTicker();
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

function updateFlowRow(tree: HTMLElement, row: HTMLElement, f: SerializedFlow): void {
  const group = row.closest<HTMLElement>('.origin');
  // The origin key can change between the in-flight row and the completion —
  // an `auto` scheme resolves its real upstream (https→http fallback) only at
  // completion, which moves an explicit :443 between "host" and "host:443".
  if (group && group.dataset.origin !== originKey(f)) {
    removeFlowRow(tree, f.id);
    appendFlowRow(tree, f);
    return;
  }
  row.outerHTML = rowHtml(f); // rowHtml re-applies .selected from state.selectedId
}

function refreshFlowRowById(id: string | null): void {
  if (!id) return;
  const f = state.flows.find((x) => x.id === id);
  const row = byId('tree').querySelector<HTMLElement>(`.row[data-id="${CSS.escape(id)}"]`);
  if (f && row) row.outerHTML = rowHtml(f);
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
  const statusClass = f.pending ? 'pending' : f.error ? 'err' : f.status >= 400 ? 'warn' : f.status >= 300 ? 'redir' : 'ok';
  const statusText = f.pending ? '…' : f.error ? 'ERR' : String(f.status || '—');
  // Result tags (rewrites, map-local, stream, block) can't be known while the
  // exchange is still in flight — only the request-side TLS/replay tags show.
  const rw = !f.pending && f.rewrittenBody ? '<span class="tag" title="Response body rewritten">rw</span>' : '';
  const hdr = !f.pending && f.rewrittenHeaders ? '<span class="tag" title="Headers changed by a rule">hdr</span>' : '';
  const up = f.upstreamScheme === 'https' ? '<span class="tag https" title="Bridged to HTTPS upstream">TLS</span>' : '';
  const rp = f.replayed ? '<span class="tag replay" title="User-initiated replay, not device traffic">replay</span>' : '';
  const local = !f.pending && f.servedBy === 'map-local' ? '<span class="tag local" title="Served from a map-local rule">local</span>' : '';
  const stream = !f.pending && f.streamed ? '<span class="tag stream" title="Streamed through chunk-by-chunk; body capture is best-effort">stream</span>' : '';
  const block = !f.pending && f.blocked ? '<span class="tag block" title="Aborted by a block rule">block</span>' : '';
  const marked = f.id === state.diffBaseId ? '<span class="tag diff-marked" title="Marked for diff">◆ diff</span>' : '';
  const dur = f.pending
    ? `<span class="dur pending-dur" data-started="${f.startedWall}">…</span>`
    : `<span class="dur">${f.durationMs}ms</span>`;
  const size = f.pending ? '<span class="size">—</span>' : `<span class="size">${fmtBytes(f.responseBytes)}</span>`;
  return `<div class="row${sel}${f.pending ? ' pending' : ''}" data-id="${f.id}">
    <span class="time">${fmtTime(f.startedWall)}</span>
    <span class="method ${f.method.toLowerCase()}">${esc(f.method)}</span>
    <span class="status ${statusClass}">${statusText}</span>
    <span class="path" title="${esc(f.path)}${f.query ? '?' + esc(f.query) : ''}">${esc(f.path)}</span>
    ${up}${rw}${hdr}${rp}${local}${stream}${block}${marked}
    ${dur}
    ${size}
  </div>`;
}

// ── in-flight elapsed ticker ─────────────────────────────────────────────────
//
// While any pending row exists, a 1s interval refreshes just the elapsed-time
// text of `.pending-dur` cells — no re-render. Self-cancels once the last
// pending flow resolves. Synced from renderTree/flushTree, which every list
// mutation funnels through.

let pendingTicker: ReturnType<typeof setInterval> | undefined;

function syncPendingTicker(): void {
  const anyPending = state.flows.some((f) => f.pending);
  if (anyPending && pendingTicker === undefined) {
    pendingTicker = setInterval(() => {
      document.querySelectorAll<HTMLElement>('.pending-dur').forEach((el) => {
        const started = Number(el.dataset.started);
        if (started > 0) el.textContent = `${((Date.now() - started) / 1000).toFixed(1)}s`;
      });
      syncPendingTicker();
    }, 1000);
  } else if (!anyPending && pendingTicker !== undefined) {
    clearInterval(pendingTicker);
    pendingTicker = undefined;
  }
}

// ── block / unblock quick action ────────────────────────────────────────────
//
// Reuses the existing BlockRule model and set-rules round-trip (same message
// the Rules panel's Apply button sends) — purely forward-looking (does a
// *future* matching request get blocked), independent of the historical
// `blocked` tag a completed row already carries.

/** Whether a currently-enabled block rule would match this flow's host+path. */
function isFlowBlocked(f: SerializedFlow): boolean {
  return !!findBlock(state.rules, f.host, f.path);
}

function persistRules(rules: RuleSet): void {
  state.rules = rules;
  vscode.postMessage({ kind: 'set-rules', rules });
  renderDetail();
  if (state.rulesOpen) renderRules();
}

function blockFlow(f: SerializedFlow): void {
  const block = [...(state.rules.block ?? []), { id: `block-${Date.now()}`, enabled: true, hostPattern: f.host, pathPattern: f.path }];
  persistRules({ ...state.rules, block });
}

/**
 * Removes exact host+path rules this quick action would have created;
 * merely disables a broader rule (e.g. a `*` host glob set up manually in the
 * Rules panel) so unblocking one request can't silently unblock others too.
 */
function unblockFlow(f: SerializedFlow): void {
  const block = (state.rules.block ?? []).flatMap((rule) => {
    if (!rule.enabled || !matchHost(rule.hostPattern, f.host) || !matchPath(rule.pathPattern, f.path)) return [rule];
    if (rule.hostPattern === f.host && rule.pathPattern === f.path) return [];
    return [{ ...rule, enabled: false }];
  });
  persistRules({ ...state.rules, block });
}

function renderDetail(): void {
  const el = byId('detail');
  if (state.diffView) {
    renderDiff(el);
    return;
  }
  const id = state.selectedId;
  if (!id) {
    el.innerHTML = '<div class="empty">Select a request to inspect it.</div>';
    return;
  }
  const f = state.byId.get(id);
  if (!f) return;
  const d = state.details.get(id);

  const servedNote = f.servedBy === 'map-local' ? ' · served locally' : '';
  const latencyNote = f.latencyInjectedMs ? ` · +${f.latencyInjectedMs} ms injected` : '';
  const streamNote = f.streamed ? ' · streamed' : '';
  const blockNote = f.blocked ? ' · blocked' : '';
  const upstreamExtras = `${f.rewrittenBody ? ' · body rewritten' : ''}${f.rewrittenHeaders ? ' · headers rewritten' : ''}${servedNote}${latencyNote}${streamNote}${blockNote}`;
  const statusCell = f.pending ? 'pending…' : f.error ? esc(f.error) : `${f.status} ${esc(f.statusText)}`;
  const durationCell = f.pending ? 'in flight' : `${f.durationMs} ms`;
  const sizeCell = f.pending ? '—' : `req ${fmtBytes(f.requestBytes)} · resp ${fmtBytes(f.responseBytes)}`;
  const overview = `<table class="kv">
    <tr><td>URL</td><td>${esc(f.upstreamScheme)}://${esc(originKey(f))}${esc(f.path)}${f.query ? '?' + esc(f.query) : ''}</td></tr>
    <tr><td>Method</td><td>${esc(f.method)}</td></tr>
    <tr><td>Status</td><td>${statusCell}</td></tr>
    <tr><td>Upstream</td><td>${f.upstreamScheme.toUpperCase()}${upstreamExtras}</td></tr>
    <tr><td>Duration</td><td>${durationCell}</td></tr>
    <tr><td>Size</td><td>${sizeCell}</td></tr>
    <tr><td>Client</td><td>${esc(f.clientIp)}</td></tr>
  </table>${f.pending ? '<div class="hint">Response pending — this view updates when the request completes.</div>' : ''}`;

  const diffBtn =
    state.diffBaseId && state.diffBaseId !== id
      ? `<button class="secondary" data-diff-run title="Compare this request with the one marked for diff">Diff against marked</button>`
      : '';
  const markLabel = state.diffBaseId === id ? 'Marked for diff ✓' : 'Mark for diff';
  const blocked = isFlowBlocked(f);
  const blockTitle = blocked
    ? 'Remove/disable the block rule matching this host + path'
    : 'Add a block rule for this host + path — future matching requests are reset';
  // Replay/diff need the completed exchange (captured body, final response) —
  // for an in-flight flow only Copy URL is meaningful.
  const actions = `<div class="detail-actions">
    <button class="secondary" data-copy="url">Copy URL</button>
    ${f.pending ? '' : `<button class="secondary" data-copy="curl">Copy as cURL</button>
    <button class="secondary" data-replay title="Re-send this request through the proxy as a new flow">Replay</button>
    <button class="secondary" data-diff-mark>${markLabel}</button>
    ${diffBtn}`}
    <button class="secondary" data-block-toggle title="${blockTitle}">${blocked ? 'Unblock' : 'Block'}</button>
  </div>`;

  const responseIsBinary = d?.responseBodyEncoding === 'base64';
  const parts = [
    dsec('overview', 'Overview', '', `<div class="section-body">${actions}${overview}</div>`),
    timingSection(f),
    querySection(f.query),
    headersSection('req-headers', 'Request headers', f.requestHeaders),
    cookiesSection(f),
    bodySectionShell('request', 'Request body', f.requestBytes, !!d?.requestBody, !!d?.originalRequestBody, false),
    headersSection('resp-headers', 'Response headers', f.responseHeaders),
    bodySectionShell('response', 'Response body', f.responseBytes, !!d?.responseBody, !!d?.originalResponseBody, responseIsBinary),
  ];
  el.innerHTML = parts.join('');

  // Body content (raw/formatted/tree) is only computed once its section is
  // actually open — never eagerly for a section the user hasn't looked at.
  // Sections restored pre-opened get no `toggle` event (the attribute is in
  // the markup), so render those explicitly; user toggles are handled by the
  // delegated capturing listener in wireEvents.
  el.querySelectorAll<HTMLDetailsElement>('.body-section[open]').forEach((details) => {
    ensureBodyContent(details, d, f);
  });

  // Put the user back where they were on the previous request. If they were
  // scrolled to the bottom, stay pinned to the bottom (e.g. reading the tail
  // of a long response body) — otherwise restore the section they last
  // opened/clicked. Absent sections (e.g. this flow has no response body)
  // stay top.
  if (state.detailScrolledToBottom) {
    el.scrollTop = el.scrollHeight;
  } else if (state.lastFocusedSection) {
    el.querySelector(`.dsec[data-sec="${CSS.escape(state.lastFocusedSection)}"]`)?.scrollIntoView({ block: 'start' });
  }
}

/**
 * Collapsible detail section whose open state persists across flow switches
 * via `state.sectionOpen[key]` (only `overview` starts open by default).
 * `count` and `inner` are raw HTML; `title` is escaped here.
 */
function dsec(key: string, title: string, count: string, inner: string, extraClass = '', extraAttrs = ''): string {
  const open = state.sectionOpen[key] ? ' open' : '';
  return `<details class="dsec${extraClass}" data-sec="${key}"${extraAttrs}${open}>
    <summary>${esc(title)}${count}</summary>
    ${inner}
  </details>`;
}

// ── diff view ────────────────────────────────────────────────────────────────

function flowLabel(f: SerializedFlow): string {
  const status = f.error ? 'ERR' : String(f.status || '—');
  return `${f.method} ${f.host}${f.path} · ${status}`;
}

function headersToText(headers: Record<string, string | string[]>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .sort()
    .join('\n');
}

/** Body text for diffing — undefined for binary (base64) bodies, which aren't line-diffable. */
function diffBodyText(detail: FlowDetail | undefined, kind: 'request' | 'response'): string | undefined {
  if (kind === 'request') return detail?.requestBody ?? '';
  if (detail?.responseBodyEncoding === 'base64') return undefined;
  return detail?.responseBody ?? '';
}

function renderDiff(el: HTMLElement): void {
  const { aId, bId } = state.diffView!;
  const a = state.byId.get(aId);
  const b = state.byId.get(bId);
  if (!a || !b) {
    // One of the flows was trimmed out of the buffer — bail back to normal.
    state.diffView = null;
    renderDetail();
    return;
  }
  const da = state.details.get(aId);
  const db = state.details.get(bId);
  // Bodies load lazily — request any missing detail and show a placeholder;
  // the `flow-detail` handler re-renders the diff once both arrive.
  for (const [id, d] of [[aId, da], [bId, db]] as const) {
    if (!d) vscode.postMessage({ kind: 'select-flow', id });
  }

  const header = `<div class="diff-head">
    <div><span class="diff-tag a">A</span> ${esc(flowLabel(a))}</div>
    <div><span class="diff-tag b">B</span> ${esc(flowLabel(b))}</div>
    <button class="secondary" data-diff-close>Close diff</button>
  </div>`;

  if (!da || !db) {
    el.innerHTML = header + '<div class="empty">Loading bodies…</div>';
    return;
  }

  const summaryA = `${a.method} http://${a.host}${a.path}${a.query ? '?' + a.query : ''}\nstatus: ${a.error ? a.error : `${a.status} ${a.statusText}`}\nsize: req ${a.requestBytes} · resp ${a.responseBytes}`;
  const summaryB = `${b.method} http://${b.host}${b.path}${b.query ? '?' + b.query : ''}\nstatus: ${b.error ? b.error : `${b.status} ${b.statusText}`}\nsize: req ${b.requestBytes} · resp ${b.responseBytes}`;

  const reqBodyA = diffBodyText(da, 'request');
  const reqBodyB = diffBodyText(db, 'request');
  const respBodyA = diffBodyText(da, 'response');
  const respBodyB = diffBodyText(db, 'response');

  el.innerHTML =
    header +
    diffSection('Summary', summaryA, summaryB) +
    diffSection('Request headers', headersToText(a.requestHeaders), headersToText(b.requestHeaders)) +
    diffSection('Response headers', headersToText(a.responseHeaders), headersToText(b.responseHeaders)) +
    diffSectionMaybeBinary('Request body', reqBodyA, reqBodyB) +
    diffSectionMaybeBinary('Response body', respBodyA, respBodyB);
}

function diffSectionMaybeBinary(title: string, a: string | undefined, b: string | undefined): string {
  if (a === undefined || b === undefined) {
    return `<details class="dsec"><summary>${esc(title)}</summary><div class="section-body"><div class="hint">Binary body — not line-diffable.</div></div></details>`;
  }
  return diffSection(title, a, b);
}

function diffSection(title: string, aText: string, bText: string): string {
  const rows = diffLines(aText, bText);
  const changed = rows.some((r) => r.op !== 'equal');
  const body = rows
    .map((r) => {
      const sign = r.op === 'add' ? '+' : r.op === 'del' ? '-' : ' ';
      return `<div class="diff-line ${r.op}">${esc(sign + ' ' + r.text)}</div>`;
    })
    .join('');
  return `<details class="dsec"${changed ? ' open' : ''}>
    <summary>${esc(title)}${changed ? '<span class="count">changed</span>' : '<span class="count">identical</span>'}</summary>
    <div class="section-body"><div class="diff-block">${body || '<div class="hint">(empty)</div>'}</div></div>
  </details>`;
}

/** Parsed query-string section — one row per parameter. Hidden when empty. */
function querySection(query: string): string {
  if (!query) return '';
  const rows = query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      const name = eq >= 0 ? pair.slice(0, eq) : pair;
      const value = eq >= 0 ? pair.slice(eq + 1) : '';
      return `<tr><td>${esc(decodeParam(name))}</td><td>${esc(decodeParam(value))}</td></tr>`;
    })
    .join('');
  const count = `<span class="count">${query.split('&').filter(Boolean).length}</span>`;
  return dsec('query', 'Query parameters', count, `<div class="section-body"><table class="kv">${rows}</table></div>`);
}

/** Request Cookie header + response Set-Cookie, parsed into rows. Hidden when neither is present. */
function cookiesSection(f: SerializedFlow): string {
  const reqCookie = f.requestHeaders['cookie'];
  const reqCookieStr = Array.isArray(reqCookie) ? reqCookie.join('; ') : reqCookie ?? '';
  const reqRows = reqCookieStr
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const eq = c.indexOf('=');
      const name = eq >= 0 ? c.slice(0, eq) : c;
      const value = eq >= 0 ? c.slice(eq + 1) : '';
      return `<tr><td>${esc(name)}</td><td>${esc(value)}</td></tr>`;
    })
    .join('');

  const setCookie = f.responseHeaders['set-cookie'];
  const setCookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const respRows = setCookies.map((c) => `<tr><td colspan="2">${esc(c)}</td></tr>`).join('');

  if (!reqRows && !respRows) return '';
  const reqTable = reqRows ? `<div class="hint">Request cookies</div><table class="kv">${reqRows}</table>` : '';
  const respTable = respRows ? `<div class="hint">Set-Cookie</div><table class="kv">${respRows}</table>` : '';
  const count = `<span class="count">${(reqRows ? reqCookieStr.split(';').filter(Boolean).length : 0) + setCookies.length}</span>`;
  return dsec('cookies', 'Cookies', count, `<div class="section-body">${reqTable}${respTable}</div>`);
}

function decodeParam(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
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
  const count = `<span class="count">${f.durationMs} ms</span>`;
  return dsec('timing', 'Timing', count, `<div class="section-body">${bar}<table class="kv">${rows}</table>${reused}</div>`);
}

function headersSection(key: string, title: string, headers: Record<string, string | string[]>): string {
  const count = `<span class="count">${Object.keys(headers).length}</span>`;
  return dsec(key, title, count, `<div class="section-body">${headersHtml(headers)}</div>`);
}

function headersHtml(headers: Record<string, string | string[]>): string {
  const rows = Object.entries(headers)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`)
    .join('');
  return `<table class="kv">${rows || '<tr><td colspan="2">(none)</td></tr>'}</table>`;
}

const TEXT_BODY_TABS = ['raw', 'formatted', 'tree'];
const BINARY_BODY_TABS = ['preview', 'hex'];

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
  binary: boolean,
): string {
  if (!hasBody) return '';
  // Binary bodies (images) get Preview/Hex instead of Raw/Formatted/Tree, and
  // no rewritten toggle (binary is never rewritten). The active tab is
  // whatever the user last picked for this kind — falling back to the first
  // tab when the stored pick isn't valid for this variant (e.g. a text tab
  // stored for `response` but this response turns out to be binary).
  const validTabs = binary ? BINARY_BODY_TABS : TEXT_BODY_TABS;
  const stored = binary ? state.binaryBodyTab : state.bodyTab[kind];
  const active = validTabs.includes(stored) ? stored : validTabs[0];
  const tabBtn = (tab: string, label: string) =>
    `<button type="button" class="tab${tab === active ? ' active' : ''}" data-tab="${tab}">${label}</button>`;
  const tabs = binary
    ? `${tabBtn('preview', 'Preview')}${tabBtn('hex', 'Hex')}`
    : `${tabBtn('raw', 'Raw')}${tabBtn('formatted', 'Formatted')}${tabBtn('tree', 'Tree')}`;
  const openInEditor = binary
    ? ''
    : '<button type="button" class="find-nav" data-open-body title="Open the full body, formatted, in a new editor tab">Open in editor</button>';
  const inner = `<div class="body-toolbar">
      <div class="tabs">${tabs}</div>
      <div class="find-group">
        <input type="text" class="find-input" data-find-input placeholder="Find">
        <span class="find-count" data-find-count></span>
        <button type="button" class="find-nav" data-find-prev title="Previous match">˄</button>
        <button type="button" class="find-nav" data-find-next title="Next match">˅</button>
      </div>
      <button type="button" class="find-nav" data-copy-body title="Copy the body as sent/received (host-side view of the retained bytes)">Copy</button>
      ${openInEditor}
      ${hasOriginal ? '<label class="rewritten-toggle"><input type="checkbox" data-rewritten-toggle> Show rewritten</label>' : ''}
    </div>
    <div class="body-content"></div>`;
  const count = `<span class="count">${fmtBytes(byteSize)}</span>`;
  const key = kind === 'request' ? 'req-body' : 'resp-body';
  return dsec(key, title, count, inner, ' body-section', ` data-kind="${kind}"${binary ? ' data-binary="1"' : ''}`);
}

function ensureBodyContent(details: HTMLDetailsElement, d: FlowDetail | undefined, f: SerializedFlow | undefined): void {
  const content = details.querySelector<HTMLElement>('.body-content');
  if (!content || content.dataset.rendered === '1') return;
  content.dataset.rendered = '1';
  renderBodyTab(details, d, f);
}

/** Computes exactly one (tab × original-vs-rewritten) view — the one currently selected — never all of them. */
function renderBodyTab(details: HTMLDetailsElement, d: FlowDetail | undefined, f: SerializedFlow | undefined): void {
  const content = details.querySelector<HTMLElement>('.body-content');
  if (!content) return;

  const kind = details.dataset.kind;
  const tab = details.querySelector<HTMLElement>('.tab.active')?.dataset.tab ?? 'raw';

  // Binary response body — Preview (image) or Hex, from the base64 payload.
  if (details.dataset.binary === '1' && kind === 'response') {
    content.innerHTML = binaryBodyView(d?.responseBody ?? '', tab, f?.contentType ?? '', d?.responseBodyTruncated);
    return;
  }

  const showRewritten = details.querySelector<HTMLInputElement>('[data-rewritten-toggle]')?.checked ?? false;
  const original = kind === 'request' ? d?.originalRequestBody : d?.originalResponseBody;
  const current = kind === 'request' ? d?.requestBody : d?.responseBody;
  const truncated = kind === 'request' ? d?.requestBodyTruncated : d?.responseBodyTruncated;
  // Default (unchecked) shows the original, pre-rewrite body; checking the
  // box reveals what the rule actually produced. When nothing was rewritten
  // for this direction, `original` is absent and `current` covers both.
  const text = (original !== undefined && !showRewritten ? original : current) ?? '';

  // A cut body is useless to read — offer the full one (persisted to the
  // session folder on disk) in an editor tab instead of rendering the stump.
  if (truncated) {
    const fullBytes = (kind === 'request' ? f?.requestBytes : f?.responseBytes) ?? 0;
    content.innerHTML = `<div class="trunc-warning">Body is ${fmtBytes(fullBytes)} — too large to show here (only the first ${fmtBytes(text.length)} was kept in memory).
      <button type="button" class="link" data-open-body>Open full body in editor</button></div>`;
    return;
  }

  // Cache the parsed JSON per section so the context menu can copy any
  // node's subtree without re-parsing on every right-click.
  if (tab === 'tree') {
    const parsed = tryParseJson(text);
    if (parsed.ok) treeData.set(details, parsed.value);
    else treeData.delete(details);
  }

  content.innerHTML = bodyView(text, tab);
  // A find query survives tab switches / the rewritten toggle — re-apply it
  // against the freshly rendered content instead of losing it.
  const query = details.dataset.findQuery ?? '';
  if (query) runFind(details, query);
}

/** Renders a base64 binary body as an inline image (Preview) or a hex dump (Hex). */
function binaryBodyView(base64: string, tab: string, contentType: string, truncated?: boolean): string {
  const truncNote = truncated ? '<div class="hint">Truncated for display — the full body was still forwarded to the device.</div>' : '';
  if (tab === 'preview') {
    if (contentType.toLowerCase().startsWith('image/') && base64) {
      return `${truncNote}<img class="body-img" src="data:${esc(contentType)};base64,${base64}" alt="response preview">`;
    }
    return `${truncNote}<div class="hint">No inline preview for this content type — switch to Hex.</div>`;
  }
  // Hex
  const bytes = base64ToBytes(base64);
  if (bytes.length === 0) return `${truncNote}<div class="hint">Empty body.</div>`;
  if (bytes.length > 64 * 1024) {
    return `${truncNote}<div class="hint">Body is ${fmtBytes(bytes.length)} — too large to hex-dump inline.</div>`;
  }
  return truncNote + `<pre class="body">${esc(hexDump(bytes))}</pre>`;
}

function base64ToBytes(base64: string): Uint8Array {
  try {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const slice = bytes.subarray(off, off + 16);
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  return lines.join('\n');
}

function bodyView(text: string, tab: string): string {
  if (tab === 'formatted') return formattedBodyHtml(text);
  if (tab === 'tree') return jsonTreeBodyHtml(text);
  return `<pre class="body">${esc(text)}</pre>`;
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

function jsonTreeBodyHtml(text: string): string {
  const parsed = tryParseJson(text);
  if (!parsed.ok) return `<div class="hint">Tree view needs valid JSON.</div><pre class="body">${esc(text)}</pre>`;
  return `<div class="json-tree">${jsonNodeHtml(parsed.value, null)}</div>`;
}

/**
 * Only the root node (depth 0) starts open — every deeper node starts folded.
 * Each node carries its `data-path` (JSON-encoded segment array) so the copy
 * context menu can resolve its value against the cached parsed body.
 */
function jsonNodeHtml(value: unknown, key: string | null, depth = 0, path: Array<string | number> = []): string {
  const label = key !== null ? `<span class="jt-key">${esc(key)}</span><span class="jt-colon">: </span>` : '';
  const openAttr = depth === 0 ? ' open' : '';
  const pathAttr = ` data-path="${esc(JSON.stringify(path))}"`;
  if (value === null) return `<div class="jt-row"${pathAttr}>${label}<span class="jt-null">null</span></div>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `<div class="jt-row"${pathAttr}>${label}<span class="jt-punct">[]</span></div>`;
    return `<details class="jt-node"${openAttr}${pathAttr}><summary>${label}<span class="jt-punct">Array(${value.length})</span></summary>${value
      .map((v, i) => jsonNodeHtml(v, String(i), depth + 1, [...path, i]))
      .join('')}</details>`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `<div class="jt-row"${pathAttr}>${label}<span class="jt-punct">{}</span></div>`;
    return `<details class="jt-node"${openAttr}${pathAttr}><summary>${label}<span class="jt-punct">{${entries.length}}</span></summary>${entries
      .map(([k, v]) => jsonNodeHtml(v, k, depth + 1, [...path, k]))
      .join('')}</details>`;
  }
  const cls = typeof value === 'string' ? 'jt-string' : typeof value === 'number' ? 'jt-number' : 'jt-bool';
  const disp = typeof value === 'string' ? `"${esc(value)}"` : String(value);
  return `<div class="jt-row"${pathAttr}>${label}<span class="${cls}">${disp}</span></div>`;
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
  if (matches.length > 0) revealMatch(details, matches[0]);
}

/**
 * Makes a match actually visible before scrolling to it: a Tree-tab match
 * can sit inside collapsed `<details>` nodes (their text is in the DOM, just
 * hidden), so every closed ancestor node up to the section's content is
 * expanded first. Only the current match's chain is opened — expanding all
 * matches at once would unfold huge payloads on every keystroke.
 */
function revealMatch(details: HTMLDetailsElement, mark: HTMLElement): void {
  const content = details.querySelector<HTMLElement>('.body-content');
  let anc = mark.parentElement?.closest('details');
  while (anc && content?.contains(anc)) {
    anc.open = true;
    anc = anc.parentElement?.closest('details');
  }
  mark.scrollIntoView({ block: 'nearest' });
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
  revealMatch(details, next);
  updateFindCount(details, s.matches.length, s.index + 1);
}

// ── copy context menu ───────────────────────────────────────────────────────

interface CtxItem {
  label: string;
  onClick: () => void;
}

/** Builds a copy-to-clipboard `CtxItem` — clipboard goes through the host
 * (`vscode.env.clipboard`) since webview `navigator.clipboard` permission is flaky. */
function copyItem(label: string, text: string): CtxItem {
  return { label, onClick: () => vscode.postMessage({ kind: 'copy-text', text }) };
}

function hideCtxMenu(): void {
  document.getElementById('ctx-menu')?.remove();
}

/** Small self-built floating menu — webviews get no native extension context menu. */
function showCtxMenu(x: number, y: number, items: CtxItem[]): void {
  hideCtxMenu();
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      item.onClick();
      hideCtxMenu();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  // Clamp so the menu never opens half off-screen near an edge.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 4))}px`;
}

/** Copy items for a right-click target, or null when it isn't on a key/value row. */
function copyMenuItemsFor(target: HTMLElement): CtxItem[] | null {
  // JSON tree nodes first — they're the most specific match.
  const treeNode = target.closest<HTMLElement>('[data-path]');
  if (treeNode) return treeCopyItems(treeNode);

  const row = target.closest<HTMLTableRowElement>('table.kv tr');
  if (row) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
      const key = cells[0].textContent?.trim() ?? '';
      const value = cells[1].textContent?.trim() ?? '';
      return [copyItem('Copy key', key), copyItem('Copy value', value), copyItem('Copy key: value', `${key}: ${value}`)];
    }
    // Single-cell rows (e.g. Set-Cookie lines) only have a value.
    if (cells.length === 1) return [copyItem('Copy value', cells[0].textContent?.trim() ?? '')];
  }
  return null;
}

/**
 * Copy items for a JSON-tree node: the key is the node's own name; the value
 * is resolved from the cached parsed body via the node's `data-path`, so an
 * object/array node copies its whole subtree as pretty-printed JSON (strings
 * copy unquoted).
 */
function treeCopyItems(node: HTMLElement): CtxItem[] | null {
  const details = node.closest<HTMLDetailsElement>('.body-section');
  if (!details || !treeData.has(details)) return null;
  let path: Array<string | number>;
  try {
    path = JSON.parse(node.dataset.path ?? '') as Array<string | number>;
  } catch {
    return null;
  }
  let value: unknown = treeData.get(details);
  for (const seg of path) {
    if (value === null || typeof value !== 'object') return null;
    value = (value as Record<string | number, unknown>)[seg];
    if (value === undefined) return null;
  }
  const valueText = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (path.length === 0) return [copyItem('Copy value', valueText)]; // root has no key
  const key = String(path[path.length - 1]);
  return [copyItem('Copy key', key), copyItem('Copy value', valueText), copyItem('Copy key: value', `${key}: ${valueText}`)];
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
      <input type="text" data-f="pathPattern" placeholder="path (blank = all)" value="${esc(rule.pathPattern ?? '')}">
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

  const mapLocalRows = (r.mapLocal ?? [])
    .map(
      (rule, i) => `<div class="maplocal" data-i="${i}">
      <input type="checkbox" data-f="enabled" ${rule.enabled ? 'checked' : ''} title="Enabled">
      <input type="text" data-f="hostPattern" placeholder="host" value="${esc(rule.hostPattern ?? '')}">
      <input type="text" data-f="pathPattern" placeholder="path (blank = all)" value="${esc(rule.pathPattern ?? '')}">
      <input type="number" data-f="status" placeholder="200" value="${rule.status ?? ''}" title="Status" style="width:56px">
      <input type="text" data-f="contentType" placeholder="content-type" value="${esc(rule.contentType ?? '')}">
      <input type="text" data-f="filePath" placeholder="file path (wins over body)" value="${esc(rule.filePath ?? '')}">
      <input type="text" data-f="body" placeholder="inline body" value="${esc(rule.body ?? '')}">
      <button class="link del-maplocal" data-i="${i}">✕</button>
    </div>`,
    )
    .join('');

  const latencyRows = (r.latency ?? [])
    .map(
      (rule, i) => `<div class="latency" data-i="${i}">
      <input type="checkbox" data-f="enabled" ${rule.enabled ? 'checked' : ''} title="Enabled">
      <input type="text" data-f="hostPattern" placeholder="host" value="${esc(rule.hostPattern ?? '')}">
      <input type="text" data-f="pathPattern" placeholder="path (blank = all)" value="${esc(rule.pathPattern ?? '')}">
      <input type="number" data-f="delayMs" placeholder="ms" value="${rule.delayMs ?? ''}" style="width:80px">
      <button class="link del-latency" data-i="${i}">✕</button>
    </div>`,
    )
    .join('');

  const headerRows = (r.headerRules ?? [])
    .map(
      (rule, i) => `<div class="headerrule" data-i="${i}">
      <input type="checkbox" data-f="enabled" ${rule.enabled ? 'checked' : ''} title="Enabled">
      <select data-f="direction">
        <option value="response" ${rule.direction === 'response' ? 'selected' : ''}>response</option>
        <option value="request" ${rule.direction === 'request' ? 'selected' : ''}>request</option>
      </select>
      <input type="text" data-f="hostPattern" placeholder="host (blank = all)" value="${esc(rule.hostPattern ?? '')}">
      <select data-f="op">
        ${['set', 'add', 'remove'].map((o) => `<option value="${o}" ${rule.op === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
      <input type="text" data-f="name" placeholder="header name" value="${esc(rule.name ?? '')}">
      <input type="text" data-f="value" placeholder="value" value="${esc(rule.value ?? '')}" ${rule.op === 'remove' ? 'disabled' : ''}>
      <button class="link del-header" data-i="${i}">✕</button>
    </div>`,
    )
    .join('');

  const blockRows = (r.block ?? [])
    .map(
      (rule, i) => `<div class="blockrule" data-i="${i}">
      <input type="checkbox" data-f="enabled" ${rule.enabled ? 'checked' : ''} title="Enabled">
      <input type="text" data-f="hostPattern" placeholder="host" value="${esc(rule.hostPattern ?? '')}">
      <input type="text" data-f="pathPattern" placeholder="path (blank = all)" value="${esc(rule.pathPattern ?? '')}">
      <button class="link del-block" data-i="${i}">✕</button>
    </div>`,
    )
    .join('');

  const breakpointRows = (r.breakpoints ?? [])
    .map(
      (rule, i) => `<div class="breakpoint" data-i="${i}">
      <input type="checkbox" data-f="enabled" ${rule.enabled ? 'checked' : ''} title="Enabled">
      <input type="text" data-f="hostPattern" placeholder="host" value="${esc(rule.hostPattern ?? '')}">
      <input type="text" data-f="pathPattern" placeholder="path (blank = all)" value="${esc(rule.pathPattern ?? '')}">
      <label class="rx"><input type="checkbox" data-f="onRequest" ${rule.onRequest ? 'checked' : ''}>request</label>
      <label class="rx"><input type="checkbox" data-f="onResponse" ${rule.onResponse ? 'checked' : ''}>response</label>
      <button class="link del-breakpoint" data-i="${i}">✕</button>
    </div>`,
    )
    .join('');

  const rewriteExcludeRows = (r.rewriteExcludes ?? [])
    .map(
      (rule, i) => `<div class="rewriteexclude" data-i="${i}">
      <input type="checkbox" data-f="enabled" ${rule.enabled ? 'checked' : ''} title="Enabled">
      <input type="text" data-f="hostPattern" placeholder="host (blank = all)" value="${esc(rule.hostPattern ?? '')}">
      <input type="text" data-f="pathPattern" placeholder="path (blank = all)" value="${esc(rule.pathPattern ?? '')}">
      <button class="link del-rewriteexclude" data-i="${i}">✕</button>
    </div>`,
    )
    .join('');

  panel.innerHTML = `
  <div class="rules-inner">
    <h3>Body rewrite rules</h3>
    <div id="body-rules">${bodyRows || '<div class="empty">No rules.</div>'}</div>
    <button class="link" id="add-body">+ add body rule</button>

    <h3>Rewrite excludes <span class="rules-hint">skip ALL body rewriting for matched host+path — for a response that must reach the device byte-for-byte</span></h3>
    <div id="rewriteexclude-rules">${rewriteExcludeRows}</div>
    <button class="link" id="add-rewriteexclude">+ add rewrite exclude</button>

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

    <h3>Map local <span class="rules-hint">serve a file or inline body instead of the upstream</span></h3>
    <div id="maplocal-rules">${mapLocalRows}</div>
    <button class="link" id="add-maplocal">+ add map-local rule</button>

    <h3>Latency <span class="rules-hint">delay matched responses</span></h3>
    <div id="latency-rules">${latencyRows}</div>
    <button class="link" id="add-latency">+ add latency rule</button>

    <h3>Header rules <span class="rules-hint">add / set / remove request or response headers</span></h3>
    <div id="header-rules">${headerRows}</div>
    <button class="link" id="add-header">+ add header rule</button>

    <h3>Block <span class="rules-hint">abort matched requests — the device sees a connection reset</span></h3>
    <div id="block-rules">${blockRows}</div>
    <button class="link" id="add-block">+ add block rule</button>

    <h3>Breakpoints <span class="rules-hint">pause matched request/response to edit it live before continuing</span></h3>
    <div id="breakpoint-rules">${breakpointRows}</div>
    <button class="link" id="add-breakpoint">+ add breakpoint</button>

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
      pathPattern: get('pathPattern')?.value || undefined,
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

  const mapLocal: MapLocalRule[] = [];
  document.querySelectorAll('#maplocal-rules .maplocal').forEach((row) => {
    const get = (f: string) => row.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
    const existing = state.rules.mapLocal?.[Number((row as HTMLElement).dataset.i)];
    const statusVal = get('status')?.value;
    mapLocal.push({
      id: existing?.id ?? `maplocal-${Date.now()}-${mapLocal.length}`,
      enabled: !!get('enabled')?.checked,
      hostPattern: get('hostPattern')?.value ?? '',
      pathPattern: get('pathPattern')?.value || undefined,
      filePath: get('filePath')?.value || undefined,
      body: get('body')?.value || undefined,
      contentType: get('contentType')?.value || undefined,
      status: statusVal ? Number(statusVal) : undefined,
    });
  });

  const latency: LatencyRule[] = [];
  document.querySelectorAll('#latency-rules .latency').forEach((row) => {
    const get = (f: string) => row.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
    const existing = state.rules.latency?.[Number((row as HTMLElement).dataset.i)];
    latency.push({
      id: existing?.id ?? `latency-${Date.now()}-${latency.length}`,
      enabled: !!get('enabled')?.checked,
      hostPattern: get('hostPattern')?.value ?? '',
      pathPattern: get('pathPattern')?.value || undefined,
      delayMs: Number(get('delayMs')?.value ?? 0),
    });
  });

  const headerRules: HeaderRule[] = [];
  document.querySelectorAll('#header-rules .headerrule').forEach((row) => {
    const get = (f: string) => row.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
    const existing = state.rules.headerRules?.[Number((row as HTMLElement).dataset.i)];
    headerRules.push({
      id: existing?.id ?? `header-${Date.now()}-${headerRules.length}`,
      enabled: !!get('enabled')?.checked,
      direction: (get('direction')?.value as 'request' | 'response') ?? 'response',
      hostPattern: get('hostPattern')?.value || undefined,
      op: (get('op')?.value as 'set' | 'add' | 'remove') ?? 'set',
      name: get('name')?.value ?? '',
      value: get('value')?.value || undefined,
    });
  });

  const block: BlockRule[] = [];
  document.querySelectorAll('#block-rules .blockrule').forEach((row) => {
    const get = (f: string) => row.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
    const existing = state.rules.block?.[Number((row as HTMLElement).dataset.i)];
    block.push({
      id: existing?.id ?? `block-${Date.now()}-${block.length}`,
      enabled: !!get('enabled')?.checked,
      hostPattern: get('hostPattern')?.value ?? '',
      pathPattern: get('pathPattern')?.value || undefined,
    });
  });

  const breakpoints: BreakpointRule[] = [];
  document.querySelectorAll('#breakpoint-rules .breakpoint').forEach((row) => {
    const get = (f: string) => row.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
    const existing = state.rules.breakpoints?.[Number((row as HTMLElement).dataset.i)];
    breakpoints.push({
      id: existing?.id ?? `bp-${Date.now()}-${breakpoints.length}`,
      enabled: !!get('enabled')?.checked,
      hostPattern: get('hostPattern')?.value ?? '',
      pathPattern: get('pathPattern')?.value || undefined,
      onRequest: !!get('onRequest')?.checked,
      onResponse: !!get('onResponse')?.checked,
    });
  });

  const rewriteExcludes: RewriteExcludeRule[] = [];
  document.querySelectorAll('#rewriteexclude-rules .rewriteexclude').forEach((row) => {
    const get = (f: string) => row.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
    const existing = state.rules.rewriteExcludes?.[Number((row as HTMLElement).dataset.i)];
    rewriteExcludes.push({
      id: existing?.id ?? `rwex-${Date.now()}-${rewriteExcludes.length}`,
      enabled: !!get('enabled')?.checked,
      hostPattern: get('hostPattern')?.value || undefined,
      pathPattern: get('pathPattern')?.value || undefined,
    });
  });

  const def = (byId('default-scheme') as HTMLSelectElement).value as UpstreamScheme;
  return { bodyRules, upstreamSchemes, defaultUpstreamScheme: def, mapLocal, latency, headerRules, block, breakpoints, rewriteExcludes };
}

// ── breakpoints / intercept ─────────────────────────────────────────────────

function parseHeadersText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    if (name) out[name] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Toolbar indicator + the edit panel for the first paused breakpoint. */
function renderIntercepts(): void {
  const btn = byId('btn-intercepts');
  const n = state.intercepts.length;
  btn.style.display = n > 0 ? '' : 'none';
  btn.textContent = `⏸ ${n} paused`;

  const panel = byId('intercept-panel');
  if (n === 0) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  const ic = state.intercepts[0];
  const isResp = ic.phase === 'response';
  panel.style.display = 'block';
  panel.innerHTML = `
  <div class="intercept-inner">
    <div class="intercept-head">
      <strong>Paused ${esc(ic.phase)}</strong>
      ${esc(ic.method)} ${esc(ic.upstreamScheme)}://${esc(ic.host)}${esc(ic.path)}${ic.query ? '?' + esc(ic.query) : ''}
      <span class="intercept-count">${n} paused</span>
    </div>
    <div class="intercept-fields">
      ${isResp
        ? `<label>Status <input type="number" id="ic-status" value="${ic.status ?? 200}"></label>`
        : `<label>Method <input type="text" id="ic-method" value="${esc(ic.method)}"></label>`}
    </div>
    <label class="intercept-label">Headers — one per line, <code>Name: value</code></label>
    <textarea id="ic-headers" rows="6" spellcheck="false">${esc(headersToText(ic.headers))}</textarea>
    ${ic.bodyEditable
      ? `<label class="intercept-label">Body</label><textarea id="ic-body" rows="8" spellcheck="false">${esc(ic.body)}</textarea>`
      : '<div class="hint">Binary body — not editable; forwarded unchanged.</div>'}
    <div class="intercept-actions">
      <button id="ic-continue">Continue</button>
      <button class="secondary" id="ic-abort">Abort (reset)</button>
    </div>
  </div>`;
}

function submitIntercept(action: 'continue' | 'abort'): void {
  const ic = state.intercepts[0];
  if (!ic) return;
  let result: InterceptResult;
  if (action === 'abort') {
    result = { action: 'abort' };
  } else {
    result = { action: 'continue', headers: parseHeadersText((byId('ic-headers') as HTMLTextAreaElement).value) };
    if (ic.phase === 'request') {
      const m = (document.getElementById('ic-method') as HTMLInputElement | null)?.value;
      if (m) result.method = m;
    } else {
      const s = (document.getElementById('ic-status') as HTMLInputElement | null)?.value;
      if (s) result.status = Number(s);
    }
    if (ic.bodyEditable) result.body = (document.getElementById('ic-body') as HTMLTextAreaElement | null)?.value ?? '';
  }
  vscode.postMessage({ kind: 'resolve-intercept', id: ic.id, result });
  // Optimistically drop it; the `intercept-resolved` echo is idempotent.
  state.intercepts = state.intercepts.filter((x) => x.id !== ic.id);
  renderIntercepts();
}

// ── helpers ─────────────────────────────────────────────────────────────────

function selectedDetail(): FlowDetail | undefined {
  return state.selectedId ? state.details.get(state.selectedId) : undefined;
}

function selectedFlow(): SerializedFlow | undefined {
  return state.selectedId ? state.byId.get(state.selectedId) : undefined;
}

/** Selects a flow from a search hit: expand its origin, scroll the row into view, load detail. */
function jumpToFlow(id: string): void {
  const f = state.byId.get(id);
  if (!f) return;
  state.collapsed.delete(originKey(f)); // ensure the group is expanded
  state.selectedId = id;
  if (!state.details.has(id)) vscode.postMessage({ kind: 'select-flow', id });
  renderTree();
  renderDetail();
  byId('tree').querySelector<HTMLElement>(`.row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
}

function renderSearchResults(query: string, hits: Array<{ id: string; where: string; snippet: string }>): void {
  const el = byId('search-results');
  if (hits.length === 0) {
    el.innerHTML = `<div class="hint">No matches for “${esc(query)}”.</div>`;
    return;
  }
  el.innerHTML = hits
    .map((h) => {
      const f = state.byId.get(h.id);
      const label = f ? `${esc(f.method)} ${esc(f.host)}${esc(f.path)}` : esc(h.id);
      return `<div class="search-hit" data-id="${esc(h.id)}">
        <div class="search-hit-head"><span class="search-where">${esc(h.where)}</span> ${label}</div>
        <div class="search-snippet">${esc(h.snippet)}</div>
      </div>`;
    })
    .join('');
}

/** Selects a row (highlight + detail pane), exiting any diff view — shared by row click and right-click. */
function selectRow(row: HTMLElement): void {
  state.selectedId = row.dataset.id!;
  state.diffView = null;
  if (!state.details.has(state.selectedId)) {
    vscode.postMessage({ kind: 'select-flow', id: state.selectedId });
  }
  byId('tree').querySelector('.row.selected')?.classList.remove('selected');
  row.classList.add('selected');
  renderDetail();
}

/**
 * The full set of per-request actions, in the same order and under the same
 * conditions as the detail pane's action bar — used to build both that bar's
 * buttons (via the data-attribute click handlers below) and the row context
 * menu, so right-clicking a row offers everything the detail pane does.
 */
function flowActionItems(f: SerializedFlow): CtxItem[] {
  const items: CtxItem[] = [{ label: 'Copy URL', onClick: () => vscode.postMessage({ kind: 'copy-flow', id: f.id, what: 'url' }) }];
  if (!f.pending) {
    items.push({ label: 'Copy as cURL', onClick: () => vscode.postMessage({ kind: 'copy-flow', id: f.id, what: 'curl' }) });
    items.push({ label: 'Replay', onClick: () => vscode.postMessage({ kind: 'replay-flow', id: f.id }) });
    items.push({
      label: state.diffBaseId === f.id ? 'Unmark for diff' : 'Mark for diff',
      onClick: () => {
        const prevId = state.diffBaseId;
        state.diffBaseId = state.diffBaseId === f.id ? null : f.id;
        refreshFlowRowById(prevId);
        refreshFlowRowById(state.diffBaseId);
        renderDetail();
      },
    });
    if (state.diffBaseId && state.diffBaseId !== f.id) {
      items.push({
        label: 'Diff against marked',
        onClick: () => {
          state.diffView = { aId: state.diffBaseId!, bId: f.id };
          renderDetail();
        },
      });
    }
  }
  items.push(isFlowBlocked(f) ? { label: 'Unblock', onClick: () => unblockFlow(f) } : { label: 'Block', onClick: () => blockFlow(f) });
  return items;
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

  byId('btn-intercepts').addEventListener('click', () => {
    byId('intercept-panel').scrollIntoView({ block: 'nearest' });
  });
  byId('intercept-panel').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'ic-continue') submitIntercept('continue');
    else if (t.id === 'ic-abort') submitIntercept('abort');
  });

  byId('btn-search').addEventListener('click', () => {
    const panel = byId('search-panel');
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    if (!open) (byId('search-input') as HTMLInputElement).focus();
  });
  byId('search-close').addEventListener('click', () => {
    byId('search-panel').style.display = 'none';
  });
  byId('search-input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = (e.target as HTMLInputElement).value.trim();
    if (q) vscode.postMessage({ kind: 'search', query: q });
  });
  byId('search-results').addEventListener('click', (e) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>('.search-hit');
    if (!hit) return;
    jumpToFlow(hit.dataset.id!);
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
    if (row) selectRow(row);
  });

  // Full action parity with the detail pane's action bar — right-click a
  // row without needing to select it and hunt for the button first.
  byId('tree').addEventListener('contextmenu', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (!row) return; // origin headers etc. — fall through to the native menu
    e.preventDefault();
    const f = state.byId.get(row.dataset.id!);
    if (!f) return;
    selectRow(row);
    showCtxMenu(e.clientX, e.clientY, flowActionItems(f));
  });

  // <details> `toggle` doesn't bubble — a capturing listener catches every
  // section (and the lazily-rendered body sections) with one registration.
  byId('detail').addEventListener(
    'toggle',
    (e) => {
      const details = e.target as HTMLElement;
      if (!(details instanceof HTMLDetailsElement)) return;
      const key = details.dataset.sec;
      if (key) {
        state.sectionOpen[key] = details.open;
        if (details.open) state.lastFocusedSection = key;
      }
      if (details.classList.contains('body-section') && details.open) {
        ensureBodyContent(details, selectedDetail(), selectedFlow());
      }
    },
    true,
  );

  byId('detail').addEventListener('contextmenu', (e) => {
    const items = copyMenuItemsFor(e.target as HTMLElement);
    if (!items) return; // fall through to the native menu elsewhere
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, items);
  });
  // Dismiss the copy menu on any click outside it, Escape, or scrolling.
  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target as HTMLElement).closest('#ctx-menu')) hideCtxMenu();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCtxMenu();
  });
  byId('detail').addEventListener('scroll', hideCtxMenu, true);
  // Tracks whether the pane is currently scrolled to its bottom — a pure
  // derivation from live scroll position, so it stays correct whether the
  // scroll was user-driven or from our own restore in `renderDetail()`.
  byId('detail').addEventListener(
    'scroll',
    () => {
      const el = byId('detail');
      state.detailScrolledToBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    },
    true,
  );

  byId('detail').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Any interaction inside a section marks it as the user's "place" —
    // restored (scrolled to) when they select another request.
    const secEl = target.closest<HTMLElement>('.dsec[data-sec]');
    if (secEl?.dataset.sec) state.lastFocusedSection = secEl.dataset.sec;

    const openBodyBtn = target.closest<HTMLElement>('[data-open-body]');
    if (openBodyBtn && state.selectedId) {
      const details = openBodyBtn.closest<HTMLDetailsElement>('.body-section');
      if (details) {
        const kind = details.dataset.kind === 'request' ? 'request' : 'response';
        const d = selectedDetail();
        const original = kind === 'request' ? d?.originalRequestBody : d?.originalResponseBody;
        const showRewritten = details.querySelector<HTMLInputElement>('[data-rewritten-toggle]')?.checked ?? false;
        vscode.postMessage({
          kind: 'open-body',
          id: state.selectedId,
          body: kind,
          // Open what's on screen: unchecked toggle shows the original,
          // pre-rewrite body whenever one exists.
          variant: original !== undefined && !showRewritten ? 'original' : 'current',
        });
      }
      return;
    }

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
    if (target.closest('[data-diff-mark]') && state.selectedId) {
      const prevId = state.diffBaseId;
      state.diffBaseId = state.diffBaseId === state.selectedId ? null : state.selectedId;
      refreshFlowRowById(prevId);
      refreshFlowRowById(state.diffBaseId);
      renderDetail();
      return;
    }
    if (target.closest('[data-diff-run]') && state.selectedId && state.diffBaseId) {
      state.diffView = { aId: state.diffBaseId, bId: state.selectedId };
      renderDetail();
      return;
    }
    if (target.closest('[data-diff-close]')) {
      state.diffView = null;
      renderDetail();
      return;
    }
    if (target.closest('[data-block-toggle]') && state.selectedId) {
      const f = state.byId.get(state.selectedId);
      if (f) (isFlowBlocked(f) ? unblockFlow : blockFlow)(f);
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
      const pickedTab = tabBtn.dataset.tab!;
      if (details.dataset.binary === '1') state.binaryBodyTab = pickedTab;
      else if (details.dataset.kind === 'request' || details.dataset.kind === 'response') state.bodyTab[details.dataset.kind] = pickedTab;
      renderBodyTab(details, selectedDetail(), selectedFlow());
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
    renderBodyTab(details, selectedDetail(), selectedFlow());
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
    } else if (t.id === 'add-maplocal') {
      state.rules = collectRulesFromDom();
      (state.rules.mapLocal ??= []).push({ id: `maplocal-${Date.now()}`, enabled: true, hostPattern: '', body: '' });
      renderRules();
    } else if (t.id === 'add-latency') {
      state.rules = collectRulesFromDom();
      (state.rules.latency ??= []).push({ id: `latency-${Date.now()}`, enabled: true, hostPattern: '', delayMs: 500 });
      renderRules();
    } else if (t.id === 'add-header') {
      state.rules = collectRulesFromDom();
      (state.rules.headerRules ??= []).push({ id: `header-${Date.now()}`, enabled: true, direction: 'response', op: 'set', name: '' });
      renderRules();
    } else if (t.id === 'add-block') {
      state.rules = collectRulesFromDom();
      (state.rules.block ??= []).push({ id: `block-${Date.now()}`, enabled: true, hostPattern: '' });
      renderRules();
    } else if (t.id === 'add-breakpoint') {
      state.rules = collectRulesFromDom();
      (state.rules.breakpoints ??= []).push({ id: `bp-${Date.now()}`, enabled: true, hostPattern: '', onRequest: true, onResponse: false });
      renderRules();
    } else if (t.id === 'add-rewriteexclude') {
      state.rules = collectRulesFromDom();
      (state.rules.rewriteExcludes ??= []).push({ id: `rwex-${Date.now()}`, enabled: true, hostPattern: '' });
      renderRules();
    } else if (t.classList.contains('del-body')) {
      state.rules = collectRulesFromDom();
      state.rules.bodyRules.splice(Number(t.dataset.i), 1);
      renderRules();
    } else if (t.classList.contains('del-scheme')) {
      state.rules = collectRulesFromDom();
      state.rules.upstreamSchemes.splice(Number(t.dataset.i), 1);
      renderRules();
    } else if (t.classList.contains('del-maplocal')) {
      state.rules = collectRulesFromDom();
      state.rules.mapLocal?.splice(Number(t.dataset.i), 1);
      renderRules();
    } else if (t.classList.contains('del-latency')) {
      state.rules = collectRulesFromDom();
      state.rules.latency?.splice(Number(t.dataset.i), 1);
      renderRules();
    } else if (t.classList.contains('del-header')) {
      state.rules = collectRulesFromDom();
      state.rules.headerRules?.splice(Number(t.dataset.i), 1);
      renderRules();
    } else if (t.classList.contains('del-block')) {
      state.rules = collectRulesFromDom();
      state.rules.block?.splice(Number(t.dataset.i), 1);
      renderRules();
    } else if (t.classList.contains('del-breakpoint')) {
      state.rules = collectRulesFromDom();
      state.rules.breakpoints?.splice(Number(t.dataset.i), 1);
      renderRules();
    } else if (t.classList.contains('del-rewriteexclude')) {
      state.rules = collectRulesFromDom();
      state.rules.rewriteExcludes?.splice(Number(t.dataset.i), 1);
      renderRules();
    }
  });
}

// ── message handling ──────────────────────────────────────────────────────────

function ingestFlow(f: SerializedFlow): void {
  // Upsert: a known id is the completion (or update) of an in-flight flow —
  // replace it in place, no growth, and drop any detail fetched while it was
  // pending (bodies exist only once the exchange completes, so a cached
  // pending detail is stale the moment the terminal record lands).
  if (state.byId.has(f.id)) {
    for (let i = state.flows.length - 1; i >= 0; i--) {
      if (state.flows[i].id === f.id) {
        state.flows[i] = f;
        break;
      }
    }
    state.byId.set(f.id, f);
    if (!f.pending) state.details.delete(f.id);
    return;
  }
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
      const prevPendingIds = new Set([...state.byId.values()].filter((f) => f.pending).map((f) => f.id));
      pendingFlows = [];
      pendingTrimIds = [];
      state.flows = [];
      state.byId.clear();
      for (const f of msg.history) {
        state.flows.push(f);
        state.byId.set(f.id, f);
      }
      state.selectedId = prevSelected && state.byId.has(prevSelected) ? prevSelected : null;
      // Bodies are immutable once a flow completes, so cached details stay
      // valid across the rebuild — EXCEPT details fetched while the flow was
      // still pending (`prevPendingIds`): the flow may have completed while
      // the panel was hidden, making that cache stale. Dropping them just
      // causes a clean re-fetch on the next select.
      state.details = new Map(
        [...prevDetails].filter(([id]) => {
          const cur = state.byId.get(id);
          return cur !== undefined && !cur.pending && !prevPendingIds.has(id);
        }),
      );
      state.intercepts = msg.intercepts ?? [];
      // The selected flow's detail may be missing now — dropped above as
      // pending-era, or its `flow-detail` reply was lost while the panel was
      // hidden (`_post` drops messages then). Re-request instead of silently
      // rendering body sections as absent.
      if (state.selectedId && !state.details.has(state.selectedId) && !state.byId.get(state.selectedId)?.pending) {
        vscode.postMessage({ kind: 'select-flow', id: state.selectedId });
      }
      renderState();
      renderTree();
      renderDetail();
      renderRules();
      renderIntercepts();
      break;
    }
    case 'flow':
      ingestFlow(msg.entry);
      pendingFlows.push(msg.entry);
      scheduleTreeFlush();
      // The selected flow just completed: refresh the detail pane (and
      // re-fetch bodies — the pending-era detail cache was just dropped).
      if (state.selectedId === msg.entry.id && !msg.entry.pending) {
        if (!state.details.has(msg.entry.id)) vscode.postMessage({ kind: 'select-flow', id: msg.entry.id });
        renderDetail();
      }
      break;
    case 'trim':
      dropFlows(msg.ids);
      scheduleTreeFlush();
      break;
    case 'flow-detail': {
      state.details.set(msg.detail.id, msg.detail);
      const inDiff = state.diffView && (state.diffView.aId === msg.detail.id || state.diffView.bId === msg.detail.id);
      if (state.selectedId === msg.detail.id || inDiff) renderDetail();
      break;
    }
    case 'state':
      state.view = msg.state;
      renderState();
      renderTree();
      break;
    case 'rules':
      state.rules = msg.rules;
      if (state.rulesOpen) renderRules();
      break;
    case 'search-results':
      renderSearchResults(msg.query, msg.hits);
      break;
    case 'intercept':
      state.intercepts.push(msg.intercept);
      renderIntercepts();
      break;
    case 'intercept-resolved':
      state.intercepts = state.intercepts.filter((x) => x.id !== msg.id);
      renderIntercepts();
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

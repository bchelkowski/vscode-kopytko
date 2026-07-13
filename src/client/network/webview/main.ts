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

const state: {
  flows: SerializedFlow[];
  byId: Map<string, SerializedFlow>;
  details: Map<string, FlowDetail>;
  selectedId: string | null;
  collapsed: Set<string>;
  filter: string;
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
  rules: { bodyRules: [], upstreamSchemes: [], defaultUpstreamScheme: 'https' },
  view: { enabled: false, redirectStatus: 'off', proxyPort: 8888 },
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
  <span class="dot" id="dot"></span>
  <span id="device-label">No device</span>
  <span id="redirect-badge" class="badge"></span>
  <span class="spacer"></span>
  <input id="filter" type="text" placeholder="Filter host / path / method">
  <button id="btn-rules" class="secondary">Rules</button>
  <button id="btn-clear" class="secondary">Clear</button>
  <button id="btn-export" class="secondary">Export HAR</button>
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
  return f.port && f.port !== 80 ? `${f.host}:${f.port}` : f.host;
}

function renderState(): void {
  const v = state.view;
  (byId('toggle') as HTMLInputElement).checked = v.enabled;
  byId('toggle-label').textContent = v.enabled ? 'Capturing' : 'Capture off';
  byId('device-label').textContent = v.deviceLabel
    ? `${v.deviceLabel}${v.deviceIp ? ` @ ${v.deviceIp}` : ''}`
    : 'No device';

  const dot = byId('dot');
  dot.className = 'dot ' + (v.enabled ? 'live' : 'off');

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

function passesFilter(f: SerializedFlow): boolean {
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
    const collapsed = state.collapsed.has(origin);
    parts.push(`<div class="origin${collapsed ? ' collapsed' : ''}" data-origin="${esc(origin)}">
      <div class="origin-head" data-origin="${esc(origin)}">
        <span class="twisty">${collapsed ? '▸' : '▾'}</span>
        <span class="origin-name">${esc(origin)}</span>
        <span class="origin-count">${flows.length}</span>
      </div>
      <div class="origin-rows">
        ${flows.map((f) => rowHtml(f)).join('')}
      </div>
    </div>`);
  }
  tree.innerHTML = parts.join('');
}

function rowHtml(f: SerializedFlow): string {
  const sel = f.id === state.selectedId ? ' selected' : '';
  const statusClass = f.error ? 'err' : f.status >= 400 ? 'warn' : f.status >= 300 ? 'redir' : 'ok';
  const statusText = f.error ? 'ERR' : String(f.status || '—');
  const rw = f.rewrittenBody ? '<span class="tag" title="Response body rewritten">rw</span>' : '';
  const up = f.upstreamScheme === 'https' ? '<span class="tag https" title="Bridged to HTTPS upstream">TLS</span>' : '';
  return `<div class="row${sel}" data-id="${f.id}">
    <span class="method ${f.method.toLowerCase()}">${esc(f.method)}</span>
    <span class="status ${statusClass}">${statusText}</span>
    <span class="path" title="${esc(f.path)}${f.query ? '?' + esc(f.query) : ''}">${esc(f.path)}</span>
    ${up}${rw}
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

  const sections = [
    section('Overview', overview),
    section('Request headers', headersHtml(f.requestHeaders)),
    d?.requestBody ? section('Request body', bodyHtml(d.requestBody, d.requestBodyTruncated)) : '',
    section('Response headers', headersHtml(f.responseHeaders)),
    d?.responseBody ? section('Response body', bodyHtml(d.responseBody, d.responseBodyTruncated)) : '',
    d?.originalResponseBody
      ? section('Original response body (pre-rewrite)', bodyHtml(d.originalResponseBody))
      : '',
  ];
  el.innerHTML = sections.join('');
}

function section(title: string, inner: string): string {
  return `<div class="section"><h3>${esc(title)}</h3>${inner}</div>`;
}

function headersHtml(headers: Record<string, string | string[]>): string {
  const rows = Object.entries(headers)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`)
    .join('');
  return `<table class="kv">${rows || '<tr><td colspan="2">(none)</td></tr>'}</table>`;
}

function bodyHtml(text: string, truncated?: boolean): string {
  return `<pre class="body">${esc(text)}${truncated ? '\n…(truncated)' : ''}</pre>`;
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
  byId('filter').addEventListener('input', (e) => {
    state.filter = (e.target as HTMLInputElement).value;
    renderTree();
  });
  byId('btn-clear').addEventListener('click', () => vscode.postMessage({ kind: 'clear' }));
  byId('btn-export').addEventListener('click', () => vscode.postMessage({ kind: 'export-har' }));
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
      renderTree();
      renderDetail();
    }
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
}

window.addEventListener('message', (ev) => {
  const msg = ev.data as ExtMsg;
  switch (msg.kind) {
    case 'init':
      state.view = msg.state;
      state.rules = msg.rules;
      state.flows = [];
      state.byId.clear();
      state.details.clear();
      msg.history.forEach(ingestFlow);
      renderState();
      renderTree();
      renderDetail();
      renderRules();
      break;
    case 'flow':
      ingestFlow(msg.entry);
      renderTree();
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

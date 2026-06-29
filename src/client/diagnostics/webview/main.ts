/**
 * Kopytko Diagnostics webview — main entry point.
 * Runs entirely in a browser context (VS Code WebviewView); no Node.js APIs.
 *
 * esbuild bundles this file (+ uPlot + styles) into out/diagnostics-webview/main.js.
 */

import './styles.css';
import uPlot from 'uplot';
import type {
  ExtMsg,
  WebMsg,
  WebviewState,
  SerializedMemCpuPoint,
  SerializedNodePoint,
  SerializedRendezvousPoint,
  SerializedNodeTypeEntry,
  SerializedSessionInfo,
} from './protocol';

// ── VS Code webview API ───────────────────────────────────────────────────────

interface VsCodeApi { postMessage(msg: WebMsg): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

// ── Cursor sync — all 3 main charts share this key ───────────────────────────

const SYNC_KEY = 'kopytko-diag';

// ── Panel mode ────────────────────────────────────────────────────────────────

type PanelMode = 'live' | 'replay';
let panelMode: PanelMode = 'live';

// ── Live recording state ──────────────────────────────────────────────────────

let recording = false;
let sessionStartWall = 0;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

// ── Chart data ────────────────────────────────────────────────────────────────

const mcTimes: number[] = [];   // wall ms (from chanperf events)
const mcMem: number[] = [];     // total channel memory, MB
const mcAnon: number[] = [];
const mcFile: number[] = [];
const mcCpu: number[] = [];     // total cpu %
const mcUser: number[] = [];
const mcSys: number[] = [];

const nodeTimes: number[] = [];
const nodeTotal: number[] = [];
const renTimes: number[] = [];  // wall ms timestamps of rendezvous events

// ── Zoom state (set by navigator brush) ──────────────────────────────────────

let zoomMin: number | undefined;
let zoomMax: number | undefined;

// ── List data ─────────────────────────────────────────────────────────────────

let latestNodeTypes: SerializedNodeTypeEntry[] = [];
let initialNodeCounts: Map<string, number> | undefined;

interface RendezvousGroup { file: string; line: number; count: number; totalMs: number }
const renGroups = new Map<string, RendezvousGroup>();

// ── Chart instances ───────────────────────────────────────────────────────────

let memChart: uPlot | undefined;
let cpuChart: uPlot | undefined;
let nodeChart: uPlot | undefined;
let navChart: uPlot | undefined;   // navigator / range selector

// ── Color helpers ─────────────────────────────────────────────────────────────

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartColors() {
  return {
    fg:     cssVar('--vscode-editor-foreground', '#cccccc'),
    grid:   cssVar('--vscode-editorWidget-border', 'rgba(128,128,128,0.22)'),
    blue:   cssVar('--vscode-charts-blue',   '#4FC3F7'),
    green:  cssVar('--vscode-charts-green',  '#81C784'),
    yellow: cssVar('--vscode-charts-yellow', '#FFD54F'),
    red:    cssVar('--vscode-charts-red',    '#EF9A9A'),
    orange: cssVar('--vscode-charts-orange', '#FFCC80'),
    purple: cssVar('--vscode-charts-purple', '#CE93D8'),
  };
}

// ── Chart factory ─────────────────────────────────────────────────────────────

function chartFont(): string {
  return '10px ' + cssVar('--vscode-font-family', 'system-ui');
}

function makeYAxis(label: string, c: ReturnType<typeof chartColors>): uPlot.Axis {
  return {
    side: 3,
    label,
    labelSize: 14,
    labelFont: chartFont(),
    stroke: c.fg,
    size: 52,                 // fixed px width so labels never clip
    ticks: { stroke: c.grid, width: 1, size: 4 },
    grid:  { stroke: c.grid, width: 1 },
    font: chartFont(),
  };
}

function makeXAxis(c: ReturnType<typeof chartColors>): uPlot.Axis {
  return {
    stroke: c.fg,
    ticks: { stroke: c.grid, width: 1, size: 4 },
    grid:  { stroke: c.grid, width: 1 },
    font: chartFont(),
  };
}

function makeMemChart(host: HTMLElement): uPlot {
  const c = chartColors();
  const { width, height } = host.getBoundingClientRect();
  return new uPlot({
    width: Math.max(100, width), height: Math.max(60, height), pxAlign: 1, ms: 1,
    axes: [makeXAxis(c), makeYAxis('MB', c)],
    scales: {
      x: { time: true },
      y: { range: (_u, min, max) => [Math.max(0, min - 1), max + 1] },
    },
    series: [
      {},
      { label: 'Total', stroke: c.blue,   width: 2 },
      { label: 'Anon',  stroke: c.green,  width: 1.5 },
      { label: 'File',  stroke: c.yellow, width: 1.5 },
    ],
    cursor: { show: true, sync: { key: SYNC_KEY } },
    legend: { show: false },
  }, [mcTimes, mcMem, mcAnon, mcFile], host);
}

function makeCpuChart(host: HTMLElement): uPlot {
  const c = chartColors();
  const { width, height } = host.getBoundingClientRect();
  return new uPlot({
    width: Math.max(100, width), height: Math.max(60, height), pxAlign: 1, ms: 1,
    axes: [makeXAxis(c), makeYAxis('%', c)],
    scales: {
      x: { time: true },
      y: { range: (_u, min, max) => [Math.max(0, min - 1), Math.max(max + 1, 5)] },
    },
    series: [
      {},
      { label: 'Total', stroke: c.red,    width: 2 },
      { label: 'User',  stroke: c.orange, width: 1.5 },
      { label: 'Sys',   stroke: c.purple, width: 1.5 },
    ],
    cursor: { show: true, sync: { key: SYNC_KEY } },
    legend: { show: false },
  }, [mcTimes, mcCpu, mcUser, mcSys], host);
}

function makeNodeChart(host: HTMLElement): uPlot {
  const c = chartColors();
  const { width, height } = host.getBoundingClientRect();
  return new uPlot({
    width: Math.max(100, width), height: Math.max(60, height), pxAlign: 1, ms: 1,
    axes: [makeXAxis(c), makeYAxis('#', c)],
    scales: {
      x: { time: true },
      y: { range: (_u, min, max) => [Math.max(0, min - 1), max + 1] },
    },
    series: [ {}, { label: 'Nodes', stroke: c.blue, width: 2 } ],
    hooks: {
      draw: [
        (u) => {
          if (renTimes.length === 0) return;
          const ctx = u.ctx;
          const xMin = u.scales.x.min ?? 0;
          const xMax = u.scales.x.max ?? 0;
          ctx.save();
          ctx.strokeStyle = c.orange;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1;
          for (const t of renTimes) {
            if (t < xMin || t > xMax) continue;
            const xPos = Math.round(u.valToPos(t, 'x', true));
            ctx.beginPath();
            ctx.moveTo(xPos, u.bbox.top);
            ctx.lineTo(xPos, u.bbox.top + u.bbox.height);
            ctx.stroke();
          }
          ctx.restore();
        },
      ],
    },
    cursor: { show: true, sync: { key: SYNC_KEY } },
    legend: { show: false },
  }, [nodeTimes, nodeTotal], host);
}

/**
 * Navigator chart — thin overview spanning the full time range.
 * Shows CPU % so the user can identify activity. The brush selection on this
 * chart zooms all 3 main charts to the selected window.
 */
function makeNavChart(host: HTMLElement): uPlot {
  const c = chartColors();
  const { width, height } = host.getBoundingClientRect();
  return new uPlot({
    width: Math.max(100, width), height: Math.max(36, height), pxAlign: 1, ms: 1,
    axes: [
      {
        ...makeXAxis(c),
        space: 60,          // fewer x-axis ticks on the small navigator
        ticks: { ...makeXAxis(c).ticks, size: 2 },
        grid:  { show: false },
      },
      { show: false },      // hide y-axis completely
    ],
    padding: [0, 0, 0, 0],
    scales: { x: { time: true } },
    series: [ {}, { label: 'CPU', stroke: c.red, width: 1 } ],
    select: { show: true, over: true },
    hooks: {
      setSelect: [(u) => {
        if (u.select.width > 0) {
          const min = u.posToVal(u.select.left, 'x');
          const max = u.posToVal(u.select.left + u.select.width, 'x');
          applyZoom(min, max);
        }
      }],
    },
    cursor: { show: false },
    legend: { show: false },
  }, [mcTimes, mcCpu], host);
}

// ── Zoom ──────────────────────────────────────────────────────────────────────

function applyZoom(min: number, max: number): void {
  zoomMin = min;
  zoomMax = max;
  memChart?.setScale('x', { min, max });
  cpuChart?.setScale('x', { min, max });
  nodeChart?.setScale('x', { min, max });
  el('btn-reset-zoom').style.display = '';
}

function resetZoom(): void {
  zoomMin = undefined;
  zoomMax = undefined;
  navChart?.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);
  el('btn-reset-zoom').style.display = 'none';
  // Redraw with resetScales=true to restore auto-range
  redrawAll();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── Build DOM ─────────────────────────────────────────────────────────────────

function buildDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <div class="status-dot" id="status-dot"></div>
  <span id="device-label">No device</span>
  <select id="session-select" title="Switch between live view and recorded sessions">
    <option value="live">● Live</option>
  </select>
  <button id="btn-toggle">Start</button>
  <button id="btn-new-session" title="Save current session and start fresh">New Session</button>
  <button id="btn-reset-zoom" class="secondary" title="Clear range selection and show all data" style="display:none">Clear Range</button>
  <span id="elapsed"></span>
</div>
<div id="main-area">
  <div id="charts">
    <div class="chart-pane">
      <div class="chart-title">Memory</div>
      <div class="chart-host" id="host-mem">
        <div class="empty-hint" id="hint-mem">Waiting for data…</div>
      </div>
      <div class="legend-row" id="legend-mem"></div>
    </div>
    <div class="chart-pane">
      <div class="chart-title">CPU</div>
      <div class="chart-host" id="host-cpu">
        <div class="empty-hint" id="hint-cpu">Waiting for data…</div>
      </div>
      <div class="legend-row" id="legend-cpu"></div>
    </div>
    <div class="chart-pane">
      <div class="chart-title">SceneGraph Nodes</div>
      <div class="chart-host" id="host-nodes">
        <div class="empty-hint" id="hint-nodes">Waiting for data…</div>
      </div>
      <div class="legend-row" id="legend-nodes"></div>
    </div>
    <div class="nav-pane">
      <div class="nav-chart-host" id="host-nav">
        <div class="empty-hint nav-empty-hint" id="hint-nav">Brush to select a time range</div>
      </div>
    </div>
  </div>
  <div id="lists">
    <div class="list-pane">
      <div class="list-header">
        <span class="list-title">Nodes</span>
        <span class="list-badge" id="node-badge"></span>
      </div>
      <div class="list-scroll">
        <table class="data-table" id="table-nodes">
          <thead><tr>
            <th class="col-type">Type</th>
            <th class="col-num">Count</th>
            <th class="col-num">Δ</th>
            <th class="col-num">kB</th>
          </tr></thead>
          <tbody id="tbody-nodes"></tbody>
        </table>
        <div class="empty-hint list-empty" id="hint-list-nodes">Start a session to see node types</div>
      </div>
    </div>
    <div class="list-pane">
      <div class="list-header">
        <span class="list-title">Rendezvous</span>
        <span class="list-badge" id="rdv-badge"></span>
        <span class="list-hint">click to open file</span>
      </div>
      <div class="list-scroll">
        <table class="data-table" id="table-rendezvous">
          <thead><tr>
            <th class="col-file">Location</th>
            <th class="col-num">Count</th>
            <th class="col-num">Total ms</th>
            <th class="col-num">Avg ms</th>
          </tr></thead>
          <tbody id="tbody-rendezvous"></tbody>
        </table>
        <div class="empty-hint list-empty" id="hint-list-rdv">No rendezvous recorded yet</div>
      </div>
    </div>
  </div>
</div>`;

  el('btn-toggle').addEventListener('click', () => {
    if (panelMode === 'replay') return;
    vscode.postMessage(recording ? { kind: 'stop' } : { kind: 'start' });
  });

  el('btn-new-session').addEventListener('click', () => {
    if (panelMode === 'replay') {
      // In replay mode, "New Session" just clears the view and returns to live
      vscode.postMessage({ kind: 'load-live' });
      return;
    }
    vscode.postMessage({ kind: 'new-session' });
  });

  el('btn-reset-zoom').addEventListener('click', () => resetZoom());

  el('session-select').addEventListener('change', () => {
    const val = el<HTMLSelectElement>('session-select').value;
    if (val === 'live') vscode.postMessage({ kind: 'load-live' });
    else vscode.postMessage({ kind: 'load-session', dir: val });
  });
}

// ── Chart init & resize ───────────────────────────────────────────────────────

function initCharts(): void {
  // Defer until after first layout pass so getBoundingClientRect() returns real sizes.
  requestAnimationFrame(() => {
    const c = chartColors();
    memChart  = makeMemChart(el('host-mem'));
    cpuChart  = makeCpuChart(el('host-cpu'));
    nodeChart = makeNodeChart(el('host-nodes'));
    navChart  = makeNavChart(el('host-nav'));

    makeLegend('mem',   [{ label: 'Total', color: c.blue }, { label: 'Anon', color: c.green }, { label: 'File', color: c.yellow }]);
    makeLegend('cpu',   [{ label: 'Total', color: c.red  }, { label: 'User', color: c.orange }, { label: 'Sys', color: c.purple }]);
    makeLegend('nodes', [{ label: 'Total', color: c.blue }, { label: 'Rendezvous', color: c.orange }]);

    const ro = new ResizeObserver(() => resizeAll());
    ro.observe(el('charts'));
    resizeAll();
  });
}

function resizeAll(): void {
  const resize = (chart: uPlot | undefined, host: HTMLElement | null) => {
    if (!chart || !host) return;
    const { width, height } = host.getBoundingClientRect();
    const w = Math.max(100, Math.floor(width));
    const h = Math.max(36, Math.floor(height));
    if (chart.width !== w || chart.height !== h) chart.setSize({ width: w, height: h });
  };
  resize(memChart,  el('host-mem'));
  resize(cpuChart,  el('host-cpu'));
  resize(nodeChart, el('host-nodes'));
  resize(navChart,  el('host-nav'));
}

function makeLegend(hostId: string, items: { label: string; color: string }[]): void {
  const legend = document.getElementById(`legend-${hostId}`);
  if (legend) {
    legend.innerHTML = items.map((i) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${i.color}"></span>${i.label}</span>`
    ).join('');
  }
}

// ── Data ingestion ────────────────────────────────────────────────────────────

function clearData(): void {
  mcTimes.length = 0; mcMem.length = 0; mcAnon.length = 0;
  mcFile.length = 0; mcCpu.length = 0; mcUser.length = 0; mcSys.length = 0;
  nodeTimes.length = 0; nodeTotal.length = 0; renTimes.length = 0;
  latestNodeTypes = []; initialNodeCounts = undefined; renGroups.clear();
  zoomMin = undefined; zoomMax = undefined;
}

function ingestMemCpu(points: SerializedMemCpuPoint[]): void {
  for (const p of points) {
    mcTimes.push(p.wall);
    mcMem.push(p.memKiB / 1024);
    mcAnon.push(p.anonKiB / 1024);
    mcFile.push(p.fileKiB / 1024);
    mcCpu.push(p.cpuPct);
    mcUser.push(p.cpuUser);
    mcSys.push(p.cpuSys);
  }
}

function ingestNodes(points: SerializedNodePoint[]): void {
  for (const p of points) {
    nodeTimes.push(p.wall);
    nodeTotal.push(p.totalCount);
    if (p.types.length > 0) {
      if (!initialNodeCounts) {
        initialNodeCounts = new Map(p.types.map((t) => [t.type, t.count]));
      }
      latestNodeTypes = p.types;
    }
  }
}

function ingestRendezvous(points: SerializedRendezvousPoint[]): void {
  for (const p of points) {
    renTimes.push(p.wall);
    const key = `${p.file}:${p.line}`;
    const g = renGroups.get(key);
    if (g) { g.count++; g.totalMs += p.durationMs; }
    else renGroups.set(key, { file: p.file, line: p.line, count: 1, totalMs: p.durationMs });
  }
}

// ── Chart redraw ──────────────────────────────────────────────────────────────

/** Redraw all charts. When zoomed, preserves the zoom range on main charts. */
function redrawAll(): void {
  if (!memChart || !cpuChart || !nodeChart) return;
  const zoomed = zoomMin != null;

  if (mcTimes.length > 0) {
    hideHint('hint-mem'); hideHint('hint-cpu');
    memChart.setData([mcTimes, mcMem, mcAnon, mcFile], !zoomed);
    cpuChart.setData([mcTimes, mcCpu, mcUser, mcSys], !zoomed);
    if (zoomed) {
      memChart.setScale('x', { min: zoomMin, max: zoomMax });
      cpuChart.setScale('x', { min: zoomMin, max: zoomMax });
    }
    // Navigator always shows full range
    if (navChart) {
      navChart.setData([mcTimes, mcCpu], true);
      hideHint('hint-nav');
      // Restore selection rectangle if zoomed
      if (zoomed) {
        const left  = navChart.valToPos(zoomMin!, 'x');
        const right = navChart.valToPos(zoomMax!, 'x');
        navChart.setSelect({ left, width: Math.max(0, right - left), top: 0, height: navChart.bbox.height / devicePixelRatio }, false);
      }
    }
  }
  if (nodeTimes.length > 0) {
    hideHint('hint-nodes');
    nodeChart.setData([nodeTimes, nodeTotal], !zoomed);
    if (zoomed) nodeChart.setScale('x', { min: zoomMin, max: zoomMax });
    if (renTimes.length > 0) nodeChart.redraw(false);
  }
}

function hideHint(id: string): void {
  const h = document.getElementById(id);
  if (h) h.style.display = 'none';
}

// ── List rendering ────────────────────────────────────────────────────────────

function renderNodeTable(): void {
  const tbody = el<HTMLTableSectionElement>('tbody-nodes');
  const sorted = [...latestNodeTypes].sort((a, b) => b.count - a.count);
  if (sorted.length === 0) return;
  hideHint('hint-list-nodes');

  tbody.innerHTML = sorted.slice(0, 120).map((t) => {
    const initial = initialNodeCounts?.get(t.type) ?? t.count;
    const delta = t.count - initial;
    const deltaLabel = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '—';
    const deltaClass = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : '';
    const kb = (t.staticBytes / 1024).toFixed(0);
    return `<tr>
      <td class="col-type" title="${escHtml(t.type)}">${escHtml(t.type)}</td>
      <td class="col-num">${t.count}</td>
      <td class="col-num ${deltaClass}">${deltaLabel}</td>
      <td class="col-num">${kb}</td>
    </tr>`;
  }).join('');

  const total = sorted.reduce((s, t) => s + t.count, 0);
  el('node-badge').textContent = `${total} nodes · ${sorted.length} types`;
}

function renderRendezvousTable(): void {
  const tbody = el<HTMLTableSectionElement>('tbody-rendezvous');
  const sorted = [...renGroups.values()].sort((a, b) => b.count - a.count);
  if (sorted.length === 0) return;
  hideHint('hint-list-rdv');

  tbody.innerHTML = sorted.slice(0, 120).map((g) => {
    const avgMs  = (g.totalMs / g.count).toFixed(1);
    const totMs  = g.totalMs.toFixed(0);
    const parts  = g.file.split('/');
    const label  = `${parts[parts.length - 1]}:${g.line}`;
    return `<tr class="nav-row" data-file="${escHtml(g.file)}" data-line="${g.line}">
      <td class="col-file" title="${escHtml(g.file)}:${g.line}">${escHtml(label)}</td>
      <td class="col-num">${g.count}</td>
      <td class="col-num">${totMs}</td>
      <td class="col-num">${avgMs}</td>
    </tr>`;
  }).join('');

  for (const row of tbody.querySelectorAll<HTMLElement>('tr.nav-row')) {
    row.addEventListener('click', () => {
      vscode.postMessage({ kind: 'open-rendezvous', file: row.dataset.file!, line: Number(row.dataset.line) });
    });
  }

  el('rdv-badge').textContent = `${renTimes.length} events · ${sorted.length} locations`;
}

// ── Session selector ──────────────────────────────────────────────────────────

function padN(n: number): string { return n.toString().padStart(2, '0'); }

function formatDate(wall: number): string {
  const d = new Date(wall);
  return `${d.getFullYear()}-${padN(d.getMonth() + 1)}-${padN(d.getDate())} ${padN(d.getHours())}:${padN(d.getMinutes())}`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function populateSessionSelector(sessions: SerializedSessionInfo[]): void {
  const sel = el<HTMLSelectElement>('session-select');
  while (sel.options.length > 1) sel.remove(1);
  for (const s of sessions) {
    const dateStr = formatDate(s.startedWall);
    const durStr  = s.endedWall ? formatDuration(s.endedWall - s.startedWall) : '…';
    const opt = document.createElement('option');
    opt.value = s.dir;
    opt.textContent = `${s.appTitle ?? 'session'}  ${dateStr}  (${durStr})`;
    sel.appendChild(opt);
  }
}

// ── Toolbar helpers ───────────────────────────────────────────────────────────

function updateToolbar(): void {
  const btn = el<HTMLButtonElement>('btn-toggle');
  const btnNew = el<HTMLButtonElement>('btn-new-session');
  btn.textContent = recording ? 'Stop' : 'Start';
  btn.classList.toggle('stop', recording);
  btn.disabled = panelMode === 'replay';
  btnNew.textContent = panelMode === 'replay' ? 'Back to Live' : 'New Session';
  el('status-dot').classList.toggle('recording', recording && panelMode === 'live');
  el('status-dot').classList.toggle('replay', panelMode === 'replay');
}

function updateDeviceLabel(state: WebviewState): void {
  const d = state.device;
  el('device-label').textContent = d ? `${d.appTitle ?? '—'} @ ${d.ip}` : 'No device selected';
}

function startElapsed(): void {
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    if (!recording || !sessionStartWall) return;
    const secs = Math.floor((Date.now() - sessionStartWall) / 1000);
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    el('elapsed').textContent = `${m}:${s}`;
  }, 1000);
}

function stopElapsed(): void {
  clearInterval(elapsedTimer);
  el('elapsed').textContent = '';
}

function applyState(state: WebviewState): void {
  panelMode = 'live';
  recording = state.recording;
  sessionStartWall = state.sessionStartWall ?? 0;
  const sel = el<HTMLSelectElement>('session-select');
  if (sel.value !== 'live') sel.value = 'live';
  updateToolbar();
  updateDeviceLabel(state);
  if (recording && sessionStartWall) startElapsed();
  else stopElapsed();
}

function applyReplayState(session: SerializedSessionInfo): void {
  panelMode = 'replay';
  recording = false;
  stopElapsed();
  updateToolbar();
  const durStr = session.endedWall ? formatDuration(session.endedWall - session.startedWall) : '?';
  el('device-label').textContent =
    `${session.appTitle ?? 'session'}  ·  ${formatDate(session.startedWall)}  ·  ${durStr}`;
}

// ── Message handler ───────────────────────────────────────────────────────────

window.addEventListener('message', (ev) => {
  const msg = ev.data as ExtMsg;
  switch (msg.kind) {
    case 'init':
      clearData();
      ingestMemCpu(msg.history.memCpu);
      ingestNodes(msg.history.nodes);
      ingestRendezvous(msg.history.rendezvous);
      applyState(msg.state);
      redrawAll();
      renderNodeTable();
      renderRendezvousTable();
      el('btn-reset-zoom').style.display = 'none';
      break;

    case 'batch':
      ingestMemCpu(msg.memCpu);
      ingestNodes(msg.nodes);
      ingestRendezvous(msg.rendezvous);
      redrawAll();
      renderNodeTable();
      renderRendezvousTable();
      break;

    case 'state':
      applyState(msg.state);
      break;

    case 'sessions':
      populateSessionSelector(msg.sessions);
      break;

    case 'replay':
      clearData();
      ingestMemCpu(msg.history.memCpu);
      ingestNodes(msg.history.nodes);
      ingestRendezvous(msg.history.rendezvous);
      applyReplayState(msg.session);
      redrawAll();
      renderNodeTable();
      renderRendezvousTable();
      el<HTMLSelectElement>('session-select').value = msg.session.dir;
      el('btn-reset-zoom').style.display = 'none';
      break;

    case 'status': {
      const banner = el('status-banner');
      if (msg.message) {
        banner.textContent = msg.message;
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
        banner.textContent = '';
      }
      break;
    }
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

buildDom();
initCharts();

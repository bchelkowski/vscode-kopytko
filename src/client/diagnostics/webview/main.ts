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

// ── Panel mode ────────────────────────────────────────────────────────────────

type PanelMode = 'live' | 'replay';
let panelMode: PanelMode = 'live';

// ── Live recording state ──────────────────────────────────────────────────────

let recording = false;
let sessionStartWall = 0;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

// ── Chart data (all charts share these arrays) ────────────────────────────────

const mcTimes: number[] = [];   // wall ms timestamps (x axis for mem/cpu + nav)
const mcMem:   number[] = [];   // MB
const mcAnon:  number[] = [];
const mcFile:  number[] = [];
const mcCpu:   number[] = [];   // %
const mcUser:  number[] = [];
const mcSys:   number[] = [];

const nodeTimes: number[] = [];
const nodeTotal: number[] = [];
const renTimes:  number[] = [];  // ms wall, used for vertical markers on node chart

// ── List data ─────────────────────────────────────────────────────────────────

let latestNodeTypes: SerializedNodeTypeEntry[] = [];
let initialNodeCounts: Map<string, number> | undefined;

interface RendezvousGroup { file: string; line: number; count: number; totalMs: number }
const renGroups = new Map<string, RendezvousGroup>();

// ── Chart instances ───────────────────────────────────────────────────────────

let memChart:  uPlot | undefined;
let cpuChart:  uPlot | undefined;
let nodeChart: uPlot | undefined;
let navChart:  uPlot | undefined;   // overview / range-selector chart

// ── Time range state ──────────────────────────────────────────────────────────

let selectedRange: [number, number] | null = null;

// ── Color helpers ─────────────────────────────────────────────────────────────

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartColors() {
  return {
    fg:     cssVar('--vscode-editor-foreground', '#cccccc'),
    grid:   cssVar('--vscode-editorWidget-border', 'rgba(128,128,128,0.25)'),
    blue:   cssVar('--vscode-charts-blue',   '#4FC3F7'),
    green:  cssVar('--vscode-charts-green',  '#81C784'),
    yellow: cssVar('--vscode-charts-yellow', '#FFD54F'),
    red:    cssVar('--vscode-charts-red',    '#EF9A9A'),
    orange: cssVar('--vscode-charts-orange', '#FFCC80'),
    purple: cssVar('--vscode-charts-purple', '#CE93D8'),
  };
}

// ── Chart factory helpers ─────────────────────────────────────────────────────

function makeAxis(label: string, side: number, c: ReturnType<typeof chartColors>): uPlot.Axis {
  const font = '10px ' + cssVar('--vscode-font-family', 'system-ui');
  return {
    side, label, labelSize: 12, labelFont: font,
    stroke: c.fg,
    ticks: { stroke: c.grid, width: 1, size: 3 },
    grid:  { stroke: c.grid, width: 1 },
    font,
  };
}

function dims(host: HTMLElement): { width: number; height: number } {
  const r = host.getBoundingClientRect();
  return { width: Math.max(100, Math.floor(r.width)), height: Math.max(40, Math.floor(r.height)) };
}

// ── Main chart factories ──────────────────────────────────────────────────────

function makeMemChart(host: HTMLElement): uPlot {
  const c = chartColors(); const { width, height } = dims(host);
  return new uPlot({
    width, height, pxAlign: 1, ms: 1,
    axes: [
      { stroke: c.fg, ticks: { stroke: c.grid }, grid: { stroke: c.grid }, font: '10px ' + cssVar('--vscode-font-family', 'system-ui') },
      makeAxis('MB', 3, c),
    ],
    scales: { x: { time: true }, y: { range: (_u, _mn, mx) => [0, Math.max(mx * 1.05, 1)] } },
    series: [
      {},
      { label: 'Total', stroke: c.blue,   width: 2 },
      { label: 'Anon',  stroke: c.green,  width: 1.5 },
      { label: 'File',  stroke: c.yellow, width: 1.5 },
    ],
    cursor: { show: false }, legend: { show: false },
  }, [mcTimes, mcMem, mcAnon, mcFile], host);
}

function makeCpuChart(host: HTMLElement): uPlot {
  const c = chartColors(); const { width, height } = dims(host);
  return new uPlot({
    width, height, pxAlign: 1, ms: 1,
    axes: [
      { stroke: c.fg, ticks: { stroke: c.grid }, grid: { stroke: c.grid }, font: '10px ' + cssVar('--vscode-font-family', 'system-ui') },
      makeAxis('%', 3, c),
    ],
    scales: { x: { time: true }, y: { range: (_u, _mn, mx) => [0, Math.max(mx * 1.05, 5)] } },
    series: [
      {},
      { label: 'Total', stroke: c.red,    width: 2 },
      { label: 'User',  stroke: c.orange, width: 1.5 },
      { label: 'Sys',   stroke: c.purple, width: 1.5 },
    ],
    cursor: { show: false }, legend: { show: false },
  }, [mcTimes, mcCpu, mcUser, mcSys], host);
}

function makeNodeChart(host: HTMLElement): uPlot {
  const c = chartColors(); const { width, height } = dims(host);
  return new uPlot({
    width, height, pxAlign: 1, ms: 1,
    axes: [
      { stroke: c.fg, ticks: { stroke: c.grid }, grid: { stroke: c.grid }, font: '10px ' + cssVar('--vscode-font-family', 'system-ui') },
      makeAxis('#', 3, c),
    ],
    scales: { x: { time: true }, y: { range: (_u, _mn, mx) => [0, Math.max(mx * 1.05, 10)] } },
    series: [ {}, { label: 'Nodes', stroke: c.blue, width: 2 } ],
    hooks: {
      draw: [(u) => {
        if (renTimes.length === 0) return;
        const ctx = u.ctx;
        const xMin = u.scales.x.min ?? 0;
        const xMax = u.scales.x.max ?? 0;
        ctx.save();
        ctx.strokeStyle = c.orange;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        for (const t of renTimes) {
          if (t < xMin || t > xMax) continue;
          const x = Math.round(u.valToPos(t, 'x', true));
          ctx.beginPath();
          ctx.moveTo(x, u.bbox.top);
          ctx.lineTo(x, u.bbox.top + u.bbox.height);
          ctx.stroke();
        }
        ctx.restore();
      }],
    },
    cursor: { show: false }, legend: { show: false },
  }, [nodeTimes, nodeTotal], host);
}

// ── Navigator (range-selector) chart ─────────────────────────────────────────

function makeNavChart(host: HTMLElement): uPlot {
  const c = chartColors(); const { width, height } = dims(host);
  return new uPlot({
    width, height, pxAlign: 1, ms: 1,
    select: { show: true, left: 0, width: 0, top: 0, height },
    axes: [
      {
        stroke: c.fg, size: 22,
        ticks: { stroke: c.grid, width: 1, size: 3 },
        grid: { stroke: c.grid, width: 1 },
        font: '9px ' + cssVar('--vscode-font-family', 'system-ui'),
      },
      { show: false },
    ],
    scales: { x: { time: true }, y: { range: (_u, _mn, mx) => [0, Math.max(mx * 1.1, 1)] } },
    series: [
      {},
      {
        stroke: c.blue,
        fill: `${c.blue}22`,
        width: 1,
      },
    ],
    hooks: {
      setSelect: [(u) => {
        if (u.select.width > 0) {
          const tMin = u.posToVal(u.select.left, 'x');
          const tMax = u.posToVal(u.select.left + u.select.width, 'x');
          applyTimeRange(tMin, tMax);
        }
      }],
    },
    cursor: { show: false }, legend: { show: false },
  }, [mcTimes, mcMem], host);
}

// ── Time range ────────────────────────────────────────────────────────────────

function applyTimeRange(min: number, max: number): void {
  selectedRange = [min, max];
  memChart?.setScale('x',  { min, max });
  cpuChart?.setScale('x',  { min, max });
  nodeChart?.setScale('x', { min, max });
  el('btn-clear-range').style.display = '';
}

function clearTimeRange(): void {
  selectedRange = null;
  el('btn-clear-range').style.display = 'none';
  // Reset main charts to full range
  if (mcTimes.length > 0) {
    memChart?.setData([mcTimes, mcMem, mcAnon, mcFile], true);
    cpuChart?.setData([mcTimes, mcCpu, mcUser, mcSys], true);
  }
  if (nodeTimes.length > 0) {
    nodeChart?.setData([nodeTimes, nodeTotal], true);
  }
  // Clear the navigator selection box
  navChart?.setSelect({ left: 0, width: 0, top: 0, height: navChart.height }, false);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── DOM build ─────────────────────────────────────────────────────────────────

function buildDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <div class="status-dot" id="status-dot"></div>
  <span id="device-label">No device</span>
  <select id="session-select" title="Switch between live view and recorded sessions">
    <option value="live">● Live</option>
  </select>
  <button id="btn-toggle">Start</button>
  <button id="btn-clear">Clear</button>
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
  </div>
  <div id="navigator-area">
    <div id="nav-toolbar">
      <span class="nav-label">Drag to select time range — zooms all charts</span>
      <button id="btn-clear-range" style="display:none">✕ Clear range</button>
    </div>
    <div class="chart-host" id="host-nav">
      <div class="empty-hint" id="hint-nav">No data yet</div>
    </div>
  </div>
  <div id="lists">
    <div class="list-pane">
      <div class="list-header">
        <span class="list-title">Nodes</span>
        <span class="list-badge" id="node-badge"></span>
        <span class="list-hint">click to open component</span>
      </div>
      <div class="list-scroll">
        <table class="data-table" id="table-nodes">
          <thead><tr>
            <th class="col-label">Type</th>
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
            <th class="col-label">Location</th>
            <th class="col-num">Count</th>
            <th class="col-num">Avg ms</th>
            <th class="col-num">Total ms</th>
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

  el('btn-clear').addEventListener('click', () => {
    if (panelMode === 'replay') {
      vscode.postMessage({ kind: 'load-live' });
    } else if (recording) {
      vscode.postMessage({ kind: 'new-session' });
    } else {
      vscode.postMessage({ kind: 'clear-view' });
    }
  });

  el('btn-clear-range').addEventListener('click', clearTimeRange);

  el('session-select').addEventListener('change', () => {
    const val = el<HTMLSelectElement>('session-select').value;
    vscode.postMessage(val === 'live' ? { kind: 'load-live' } : { kind: 'load-session', dir: val });
  });
}

// ── Chart init & resize ───────────────────────────────────────────────────────

function initCharts(): void {
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
  ro.observe(el('navigator-area'));
  resizeAll();
}

function resizeAll(): void {
  const resize = (chart: uPlot | undefined, host: HTMLElement) => {
    if (!chart) return;
    const { width, height } = dims(host);
    if (chart.width !== width || chart.height !== height) chart.setSize({ width, height });
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
  selectedRange = null;
  el('btn-clear-range').style.display = 'none';
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

function redrawCharts(): void {
  // Always reset scales to full range, then re-apply any selection.
  if (mcTimes.length > 0) {
    hideHint('hint-mem'); hideHint('hint-cpu'); hideHint('hint-nav');
    memChart?.setData([mcTimes, mcMem, mcAnon, mcFile], true);
    cpuChart?.setData([mcTimes, mcCpu, mcUser, mcSys], true);
    navChart?.setData([mcTimes, mcMem], true);
  }
  if (nodeTimes.length > 0) {
    hideHint('hint-nodes');
    nodeChart?.setData([nodeTimes, nodeTotal], true);
    if (renTimes.length > 0) nodeChart?.redraw(false);
  }
  // Restore zoom if a range was selected before this data update.
  if (selectedRange) {
    memChart?.setScale('x',  { min: selectedRange[0], max: selectedRange[1] });
    cpuChart?.setScale('x',  { min: selectedRange[0], max: selectedRange[1] });
    nodeChart?.setScale('x', { min: selectedRange[0], max: selectedRange[1] });
    // Navigator always shows full range — do not apply range to it.
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
    return `<tr class="nav-row" data-type="${escHtml(t.type)}">
      <td class="col-label" title="${escHtml(t.type)}">${escHtml(t.type)}</td>
      <td class="col-num">${t.count}</td>
      <td class="col-num ${deltaClass}">${deltaLabel}</td>
      <td class="col-num">${kb}</td>
    </tr>`;
  }).join('');

  for (const row of tbody.querySelectorAll<HTMLElement>('tr.nav-row')) {
    row.addEventListener('click', () => {
      vscode.postMessage({ kind: 'open-node', nodeType: row.dataset.type! });
    });
  }

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
    const totalMs = g.totalMs.toFixed(0);
    const parts = g.file.split('/');
    const label = `${parts[parts.length - 1]}:${g.line}`;
    return `<tr class="nav-row" data-file="${escHtml(g.file)}" data-line="${g.line}">
      <td class="col-label" title="${escHtml(g.file)}:${g.line}">${escHtml(label)}</td>
      <td class="col-num">${g.count}</td>
      <td class="col-num">${avgMs}</td>
      <td class="col-num">${totalMs}</td>
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
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function populateSessionSelector(sessions: SerializedSessionInfo[]): void {
  const sel = el<HTMLSelectElement>('session-select');
  while (sel.options.length > 1) sel.remove(1);
  for (const s of sessions) {
    const opt = document.createElement('option');
    opt.value = s.dir;
    opt.textContent = `${s.appTitle ?? 'session'}  ${formatDate(s.startedWall)}  (${s.endedWall ? formatDuration(s.endedWall - s.startedWall) : '…'})`;
    sel.appendChild(opt);
  }
}

// ── Toolbar helpers ───────────────────────────────────────────────────────────

function updateToolbar(): void {
  const btn = el<HTMLButtonElement>('btn-toggle');
  btn.textContent = recording ? 'Stop' : 'Start';
  btn.classList.toggle('stop', recording);
  btn.disabled = panelMode === 'replay';

  const btnClear = el<HTMLButtonElement>('btn-clear');
  if (panelMode === 'replay') {
    btnClear.textContent = 'Exit Replay';
    btnClear.classList.remove('stop');
  } else if (recording) {
    btnClear.textContent = 'New Session';
    btnClear.classList.remove('stop');
  } else {
    btnClear.textContent = 'Clear';
    btnClear.classList.remove('stop');
  }

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
  const dur = session.endedWall ? formatDuration(session.endedWall - session.startedWall) : '?';
  el('device-label').textContent = `${session.appTitle ?? 'session'}  ·  ${formatDate(session.startedWall)}  ·  ${dur}`;
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
      redrawCharts();
      renderNodeTable();
      renderRendezvousTable();
      break;

    case 'batch':
      ingestMemCpu(msg.memCpu);
      ingestNodes(msg.nodes);
      ingestRendezvous(msg.rendezvous);
      redrawCharts();
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
      redrawCharts();
      renderNodeTable();
      renderRendezvousTable();
      el<HTMLSelectElement>('session-select').value = msg.session.dir;
      break;
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

buildDom();
initCharts();

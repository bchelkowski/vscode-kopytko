/**
 * Kopytko Diagnostics webview — main entry point.
 * Runs entirely in a browser context (VS Code WebviewView); no Node.js APIs.
 *
 * esbuild bundles this file (+ uPlot, styles) into out/diagnostics-webview/main.js.
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
} from './protocol';

// ── VS Code webview API ───────────────────────────────────────────────────────

interface VsCodeApi {
  postMessage(msg: WebMsg): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

// ── State ─────────────────────────────────────────────────────────────────────

let recording = false;
let sessionStartWall = 0;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

// In-memory chart data (grows until panel is closed or session clears)
const mcTimes: number[] = [];  // seconds
const mcMem: number[] = [];    // MB
const mcAnon: number[] = [];
const mcFile: number[] = [];
const mcCpu: number[] = [];    // %
const mcUser: number[] = [];
const mcSys: number[] = [];

const nodeTimes: number[] = [];
const nodeTotal: number[] = [];

// Rendezvous timestamps (seconds) — used as vertical markers on node chart
const renTimes: number[] = [];

// ── uPlot chart instances ─────────────────────────────────────────────────────

let memChart: uPlot | undefined;
let cpuChart: uPlot | undefined;
let nodeChart: uPlot | undefined;

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

// ── Chart factory ─────────────────────────────────────────────────────────────

function makeAxis(label: string, side: number, c: ReturnType<typeof chartColors>): uPlot.Axis {
  return {
    side,
    label,
    labelSize: 12,
    labelFont: '10px ' + cssVar('--vscode-font-family', 'system-ui'),
    stroke: c.fg,
    ticks: { stroke: c.grid, width: 1, size: 3 },
    grid:  { stroke: c.grid, width: 1 },
    font:  '10px ' + cssVar('--vscode-font-family', 'system-ui'),
  };
}

function makeMemChart(el: HTMLElement): uPlot {
  const c = chartColors();
  const { width, height } = el.getBoundingClientRect();
  const opts: uPlot.Options = {
    width: Math.max(100, width),
    height: Math.max(60, height),
    pxAlign: 1,
    ms: 1,   // x axis in milliseconds (we'll pass wall ms directly)
    axes: [
      { stroke: c.fg, ticks: { stroke: c.grid }, grid: { stroke: c.grid }, font: '10px ' + cssVar('--vscode-font-family', 'system-ui') },
      makeAxis('MB', 3, c),
    ],
    scales: {
      x: { time: true },
      y: { range: (_u, _min, max) => [0, Math.max(max * 1.05, 1)] },
    },
    series: [
      {},
      { label: 'Total', stroke: c.blue,   width: 2 },
      { label: 'Anon',  stroke: c.green,  width: 1.5 },
      { label: 'File',  stroke: c.yellow, width: 1.5 },
    ],
    cursor: { show: false },
    legend: { show: false },
  };
  return new uPlot(opts, [mcTimes, mcMem, mcAnon, mcFile], el);
}

function makeCpuChart(el: HTMLElement): uPlot {
  const c = chartColors();
  const { width, height } = el.getBoundingClientRect();
  const opts: uPlot.Options = {
    width: Math.max(100, width),
    height: Math.max(60, height),
    pxAlign: 1,
    ms: 1,
    axes: [
      { stroke: c.fg, ticks: { stroke: c.grid }, grid: { stroke: c.grid }, font: '10px ' + cssVar('--vscode-font-family', 'system-ui') },
      makeAxis('%', 3, c),
    ],
    scales: {
      x: { time: true },
      y: { range: (_u, _min, max) => [0, Math.max(max * 1.05, 5)] },
    },
    series: [
      {},
      { label: 'Total', stroke: c.red,    width: 2 },
      { label: 'User',  stroke: c.orange, width: 1.5 },
      { label: 'Sys',   stroke: c.purple, width: 1.5 },
    ],
    cursor: { show: false },
    legend: { show: false },
  };
  return new uPlot(opts, [mcTimes, mcCpu, mcUser, mcSys], el);
}

function makeNodeChart(el: HTMLElement): uPlot {
  const c = chartColors();
  const { width, height } = el.getBoundingClientRect();
  const opts: uPlot.Options = {
    width: Math.max(100, width),
    height: Math.max(60, height),
    pxAlign: 1,
    ms: 1,
    axes: [
      { stroke: c.fg, ticks: { stroke: c.grid }, grid: { stroke: c.grid }, font: '10px ' + cssVar('--vscode-font-family', 'system-ui') },
      makeAxis('#', 3, c),
    ],
    scales: {
      x: { time: true },
      y: { range: (_u, _min, max) => [0, Math.max(max * 1.05, 10)] },
    },
    series: [
      {},
      { label: 'Nodes', stroke: c.blue, width: 2 },
    ],
    hooks: {
      draw: [
        (u) => {
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
    cursor: { show: false },
    legend: { show: false },
  };
  return new uPlot(opts, [nodeTimes, nodeTotal], el);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function buildDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <div class="status-dot" id="status-dot"></div>
  <span id="device-label">No device</span>
  <button id="btn-toggle">Start</button>
  <span id="elapsed"></span>
</div>
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
</div>`;

  el('btn-toggle').addEventListener('click', () => {
    vscode.postMessage(recording ? { kind: 'stop' } : { kind: 'start' });
  });
}

function updateToolbar(): void {
  el('btn-toggle').textContent = recording ? 'Stop' : 'Start';
  el('btn-toggle').classList.toggle('stop', recording);
  el('status-dot').classList.toggle('recording', recording);
}

function updateDeviceLabel(state: WebviewState): void {
  const d = state.device;
  const label = d
    ? `${d.appTitle ?? '—'} @ ${d.ip}`
    : 'No device selected';
  el('device-label').textContent = label;
}

function makeLegend(hostId: string, items: { label: string; color: string }[]): void {
  const legend = document.getElementById(`legend-${hostId}`);
  if (!legend) return;
  legend.innerHTML = items
    .map(
      (i) =>
        `<span class="legend-item">
          <span class="legend-swatch" style="background:${i.color}"></span>
          ${i.label}
        </span>`,
    )
    .join('');
}

// ── Chart initialization ──────────────────────────────────────────────────────

function initCharts(): void {
  const c = chartColors();

  const hostMem = el('host-mem');
  const hostCpu = el('host-cpu');
  const hostNodes = el('host-nodes');

  memChart = makeMemChart(hostMem);
  cpuChart = makeCpuChart(hostCpu);
  nodeChart = makeNodeChart(hostNodes);

  makeLegend('mem', [
    { label: 'Total',  color: c.blue   },
    { label: 'Anon',   color: c.green  },
    { label: 'File',   color: c.yellow },
  ]);
  makeLegend('cpu', [
    { label: 'Total', color: c.red    },
    { label: 'User',  color: c.orange },
    { label: 'Sys',   color: c.purple },
  ]);
  makeLegend('nodes', [
    { label: 'Total',       color: c.blue   },
    { label: 'Rendezvous',  color: c.orange },
  ]);

  // Resize charts whenever their container changes
  const ro = new ResizeObserver(() => resizeAll());
  ro.observe(el('charts'));
  resizeAll();
}

function resizeAll(): void {
  if (!memChart || !cpuChart || !nodeChart) return;
  const resize = (chart: uPlot, host: HTMLElement) => {
    const { width, height } = host.getBoundingClientRect();
    const w = Math.max(100, Math.floor(width));
    const h = Math.max(60, Math.floor(height));
    if (chart.width !== w || chart.height !== h) {
      chart.setSize({ width: w, height: h });
    }
  };
  resize(memChart, el('host-mem'));
  resize(cpuChart, el('host-cpu'));
  resize(nodeChart, el('host-nodes'));
}

// ── Data ingestion ────────────────────────────────────────────────────────────

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
  }
}

function ingestRendezvous(points: SerializedRendezvousPoint[]): void {
  for (const p of points) {
    renTimes.push(p.wall);
  }
}

function redrawCharts(): void {
  if (!memChart || !cpuChart || !nodeChart) return;

  const hasMcData = mcTimes.length > 0;
  const hasNodeData = nodeTimes.length > 0;

  if (hasMcData) {
    hideHint('hint-mem');
    hideHint('hint-cpu');
    memChart.setData([mcTimes, mcMem, mcAnon, mcFile], true);
    cpuChart.setData([mcTimes, mcCpu, mcUser, mcSys], true);
  }
  if (hasNodeData) {
    hideHint('hint-nodes');
    nodeChart.setData([nodeTimes, nodeTotal], true);
    if (renTimes.length > 0) {
      nodeChart.redraw(false);
    }
  }
}

function hideHint(id: string): void {
  const hint = document.getElementById(id);
  if (hint) hint.style.display = 'none';
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────

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

// ── Message handler ───────────────────────────────────────────────────────────

function applyState(state: WebviewState): void {
  recording = state.recording;
  sessionStartWall = state.sessionStartWall ?? 0;
  updateToolbar();
  updateDeviceLabel(state);
  if (recording && sessionStartWall) {
    startElapsed();
  } else {
    stopElapsed();
  }
}

window.addEventListener('message', (ev) => {
  const msg = ev.data as ExtMsg;
  switch (msg.kind) {
    case 'init':
      // Clear existing data and seed from history
      mcTimes.length = 0; mcMem.length = 0; mcAnon.length = 0;
      mcFile.length = 0; mcCpu.length = 0; mcUser.length = 0; mcSys.length = 0;
      nodeTimes.length = 0; nodeTotal.length = 0;
      renTimes.length = 0;
      ingestMemCpu(msg.history.memCpu);
      ingestNodes(msg.history.nodes);
      ingestRendezvous(msg.history.rendezvous);
      applyState(msg.state);
      redrawCharts();
      break;

    case 'batch':
      ingestMemCpu(msg.memCpu);
      ingestNodes(msg.nodes);
      ingestRendezvous(msg.rendezvous);
      redrawCharts();
      break;

    case 'state':
      applyState(msg.state);
      break;
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

buildDom();
initCharts();

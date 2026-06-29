/**
 * Kopytko Diagnostics webview — D3 time-series charts with incremental updates.
 *
 * Key design: SVG elements are created once and their attributes updated in-place
 * so there is no flicker or zoom-reset on live data batches.
 */

import './styles.css';
import {
  select,
  type Selection,
} from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { line as d3line, area as d3area } from 'd3-shape';
import { axisBottom, axisLeft } from 'd3-axis';
import { brushX, type D3BrushEvent } from 'd3-brush';
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

interface VsCodeApi { postMessage(msg: WebMsg): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── Panel / session state ─────────────────────────────────────────────────────

type PanelMode = 'live' | 'replay';
let panelMode: PanelMode = 'live';
let recording = false;
let sessionStartWall = 0;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

// ── Chart data ────────────────────────────────────────────────────────────────

const mcTimes:  number[] = [];
const mcMem:    number[] = [];   // MB
const mcAnon:   number[] = [];
const mcFile:   number[] = [];
const mcCpu:    number[] = [];   // %
const mcUser:   number[] = [];
const mcSys:    number[] = [];

const nodeTimes:  number[] = [];
const nodeCounts: number[] = [];

interface RenEvent { wall: number; durationMs: number; file: string; line: number }
const renEvents: RenEvent[] = [];

let xVisible: [number, number] | null = null;
let lastNodeTypes: SerializedNodeTypeEntry[] = [];
let prevNodeTypes  = new Map<string, number>();

interface RenGroup { file: string; line: number; count: number; totalMs: number }
const renGroups = new Map<string, RenGroup>();

// ── Colours ───────────────────────────────────────────────────────────────────

const C = {
  mem:  '#4e79a7', anon: '#59a14f', file: '#f28e2b',
  cpu:  '#e15759', user: '#76b7b2', sys:  '#b07aa1',
  nodes:'#4e79a7', rdv: 'rgba(255,180,0,0.8)',
};

// ── Shared cursor ─────────────────────────────────────────────────────────────

let cursorMs: number | null = null;
const cursorListeners: Array<(ms: number | null) => void> = [];
function setCursorAll(ms: number | null): void {
  cursorMs = ms;
  cursorListeners.forEach(fn => fn(ms));
}

// ── Chart factory — incremental update ───────────────────────────────────────

interface SeriesDef {
  values: () => number[];
  color:  string;
  label:  string;
  area?:  boolean;
}
interface ChartConfig {
  hostId: string;
  times:  () => number[];
  series: SeriesDef[];
  yFmt?:  (v: number) => string;
  extras?: (g: Selection<SVGGElement, unknown, null, undefined>, xSc: (ms: number) => number, h: number) => void;
}
interface ChartHandle { redraw(): void; }

function createChart(cfg: ChartConfig): ChartHandle {
  const M = { top: 6, right: 8, bottom: 20, left: 44 };
  const host = document.getElementById(cfg.hostId)!;

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  svgEl.style.cssText = 'position:absolute;inset:0;overflow:visible';
  host.appendChild(svgEl);

  const svg   = select(svgEl);
  const gMain = svg.append('g').attr('class', 'chart-main');
  const gAxes = svg.append('g').attr('class', 'chart-axes');
  const gCursor = svg.append('line')
    .attr('stroke', 'rgba(200,200,200,0.45)')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,2')
    .style('pointer-events', 'none')
    .style('display', 'none');

  // Persistent SVG elements (created once, updated on each redraw)
  const clipId = `clip-${cfg.hostId}`;
  const clipRect = gMain.append('clipPath').attr('id', clipId)
    .append('rect');
  const extrasSel = gMain.append('g').attr('class', 'extras');

  const areaSels: Array<Selection<SVGPathElement, unknown, null, undefined> | null> = [];
  const pathSels: Array<Selection<SVGPathElement, unknown, null, undefined>> = [];

  for (const s of cfg.series) {
    if (s.area) {
      areaSels.push(
        gMain.append('path')
          .attr('fill', s.color).attr('fill-opacity', 0.15)
          .attr('clip-path', `url(#${clipId})`),
      );
    } else {
      areaSels.push(null);
    }
    pathSels.push(
      gMain.append('path')
        .attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 1.5)
        .attr('clip-path', `url(#${clipId})`),
    );
  }

  const xAxisSel = gAxes.append('g').attr('class', 'axis-x');
  const yAxisSel = gAxes.append('g').attr('class', 'axis-y');

  // Cursor sync
  svgEl.addEventListener('mousemove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const w = rect.width - M.left - M.right;
    if (w <= 0) return;
    const domain = visibleDomain();
    if (!domain) return;
    const ms = domain[0] + ((e.clientX - rect.left - M.left) / w) * (domain[1] - domain[0]);
    setCursorAll(ms);
  });
  svgEl.addEventListener('mouseleave', () => setCursorAll(null));

  function visibleDomain(): [number, number] | null {
    if (xVisible) return xVisible;
    const ts = cfg.times();
    return ts.length < 2 ? null : [ts[0], ts[ts.length - 1]];
  }

  function dims() {
    const W = host.clientWidth  || 200;
    const H = host.clientHeight || 80;
    return { W, H, w: Math.max(1, W - M.left - M.right), h: Math.max(1, H - M.top - M.bottom) };
  }

  function setCursor(ms: number | null): void {
    const domain = visibleDomain();
    if (!ms || !domain) { gCursor.style('display', 'none'); return; }
    const { w, h } = dims();
    const x = M.left + scaleLinear().domain(domain).range([0, w])(ms);
    gCursor.style('display', null)
      .attr('x1', x).attr('x2', x)
      .attr('y1', M.top).attr('y2', M.top + h);
  }
  cursorListeners.push(setCursor);

  function redraw(): void {
    const { W, H, w, h } = dims();
    svgEl.setAttribute('width',  W + 'px');
    svgEl.setAttribute('height', H + 'px');
    svg.attr('viewBox', `0 0 ${W} ${H}`);

    const domain = visibleDomain();
    const ts     = cfg.times();
    const hint   = host.querySelector<HTMLElement>('.empty-hint');
    const hasData = domain && ts.length >= 2;

    if (hint) hint.style.display = hasData ? 'none' : '';
    if (!hasData) return;

    clipRect.attr('width', w).attr('height', h);
    gMain.attr('transform', `translate(${M.left},${M.top})`);

    const xSc = scaleLinear().domain(domain!).range([0, w]);

    // Auto y-range across visible window
    let yMin = Infinity, yMax = -Infinity;
    for (const s of cfg.series) {
      const vs = s.values();
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] < domain![0] || ts[i] > domain![1]) continue;
        const v = vs[i] ?? 0;
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    if (!isFinite(yMin)) yMin = 0;
    if (!isFinite(yMax)) yMax = 1;
    if (yMax === yMin) yMax = yMin + 1;
    const pad = (yMax - yMin) * 0.08;
    const ySc = scaleLinear().domain([yMin - pad, yMax + pad]).range([h, 0]).nice();

    const lineGen = d3line<number>()
      .defined((_, i) => ts[i] >= domain![0] && ts[i] <= domain![1])
      .x((_, i) => xSc(ts[i]))
      .y(v => ySc(v));

    // Update each series path in-place
    for (let i = 0; i < cfg.series.length; i++) {
      const vs = cfg.series[i].values();
      pathSels[i].attr('d', lineGen(vs) ?? '');
      if (areaSels[i]) {
        const areaGen = d3area<number>()
          .defined((_, j) => ts[j] >= domain![0] && ts[j] <= domain![1])
          .x((_, j) => xSc(ts[j]))
          .y0(h).y1(v => ySc(v));
        areaSels[i]!.attr('d', areaGen(vs) ?? '');
      }
    }

    // Extras (rendezvous markers) — only clear the extras group
    extrasSel.selectAll('*').remove();
    cfg.extras?.(extrasSel, ms => xSc(ms), h);

    // Update axes in-place (D3 call() does incremental DOM update)
    const t0 = sessionStartWall || domain![0];
    const xAxis = axisBottom(xSc)
      .ticks(Math.max(2, Math.floor(w / 80)))
      .tickFormat(v => {
        const s = Math.floor((+v - t0) / 1000);
        const m = Math.floor(Math.abs(s) / 60);
        return `${s < 0 ? '-' : ''}${m}:${String(Math.abs(s) % 60).padStart(2, '0')}`;
      });
    const yAxis = axisLeft(ySc).ticks(4)
      .tickFormat(cfg.yFmt ?? (v => String(Math.round(+v))));

    xAxisSel
      .attr('transform', `translate(${M.left},${M.top + h})`)
      .call(xAxis as never)
      .call(g => {
        g.select('.domain').attr('stroke', 'rgba(128,128,128,0.3)');
        g.selectAll('.tick line').attr('stroke', 'rgba(128,128,128,0.2)');
        g.selectAll('.tick text').attr('fill', 'var(--vscode-editorHint-foreground,#aaa)').attr('font-size', 9);
      });
    yAxisSel
      .attr('transform', `translate(${M.left},${M.top})`)
      .call(yAxis as never)
      .call(g => {
        g.select('.domain').remove();
        g.selectAll('.tick line').attr('stroke', 'rgba(128,128,128,0.12)').attr('x2', w);
        g.selectAll('.tick text').attr('fill', 'var(--vscode-editorHint-foreground,#aaa)').attr('font-size', 9);
      });

    setCursor(cursorMs);
  }

  return { redraw };
}

// ── Navigator ─────────────────────────────────────────────────────────────────

function createNavigator(hostId: string): { redraw(): void } {
  const M = { top: 4, right: 8, bottom: 18, left: 44 };
  const host = document.getElementById(hostId)!;

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  svgEl.style.cssText = 'position:absolute;inset:0;overflow:visible';
  host.appendChild(svgEl);

  const svg = select(svgEl);
  const gNav = svg.append('g');
  const linePath = gNav.append('path')
    .attr('fill', 'none').attr('stroke', C.cpu)
    .attr('stroke-width', 1).attr('opacity', 0.6);
  const xAxisSel = gNav.append('g');
  const brushG   = gNav.append('g').attr('class', 'brush');

  let brushBeh = brushX<unknown>();

  function dims() {
    const W = host.clientWidth  || 200;
    const H = host.clientHeight || 40;
    return { W, H, w: Math.max(1, W - M.left - M.right), h: Math.max(1, H - M.top - M.bottom) };
  }

  function redraw(): void {
    const { W, H, w, h } = dims();
    svgEl.setAttribute('width',  W + 'px');
    svgEl.setAttribute('height', H + 'px');
    svg.attr('viewBox', `0 0 ${W} ${H}`);
    gNav.attr('transform', `translate(${M.left},${M.top})`);

    const hint = host.querySelector<HTMLElement>('.empty-hint');
    if (mcTimes.length < 2) { if (hint) hint.style.display = ''; return; }
    if (hint) hint.style.display = 'none';

    const fullDomain: [number, number] = [mcTimes[0], mcTimes[mcTimes.length - 1]];
    const xSc = scaleLinear().domain(fullDomain).range([0, w]);
    const yMax = Math.max(...mcCpu, 1);
    const ySc  = scaleLinear().domain([0, yMax * 1.1]).range([h, 0]);

    const lineGen = d3line<number>().x((_, i) => xSc(mcTimes[i])).y(v => ySc(v));
    linePath.attr('d', lineGen(mcCpu) ?? '');

    const t0 = mcTimes[0];
    xAxisSel.attr('transform', `translate(0,${h})`)
      .call(axisBottom(xSc).ticks(4).tickFormat(v => {
        const sec = Math.floor((+v - t0) / 1000);
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      }) as never)
      .call(g => {
        g.select('.domain').attr('stroke', 'rgba(128,128,128,0.3)');
        g.selectAll('.tick line').attr('stroke', 'rgba(128,128,128,0.2)');
        g.selectAll('.tick text').attr('fill', 'var(--vscode-editorHint-foreground,#aaa)').attr('font-size', 9);
      });

    brushBeh = brushX<unknown>()
      .extent([[0, 0], [w, h]])
      .on('end', (event: D3BrushEvent<unknown>) => {
        const sel = event.selection as [number, number] | null;
        if (!sel) {
          xVisible = null;
          el('btn-reset-zoom').style.display = 'none';
        } else {
          xVisible = [xSc.invert(sel[0]), xSc.invert(sel[1])];
          el('btn-reset-zoom').style.display = '';
        }
        redrawCharts();
      });

    brushG.call(brushBeh as never)
      .call((g: Selection<SVGGElement, unknown, null, undefined>) => {
        g.select('.selection')
          .attr('fill', 'rgba(255,255,255,0.1)')
          .attr('stroke', 'rgba(255,255,255,0.25)');
      });

    if (xVisible) {
      brushG.call(brushBeh.move as never, [xSc(xVisible[0]), xSc(xVisible[1])] as never);
    }
  }

  return { redraw };
}

// ── Legend ────────────────────────────────────────────────────────────────────

function buildLegend(hostId: string, series: Array<{ color: string; label: string }>): void {
  const host = document.getElementById(hostId)!;
  host.innerHTML = series.map(s =>
    `<div class="legend-item">
       <div class="legend-swatch" style="background:${s.color}"></div>
       <span>${s.label}</span>
     </div>`,
  ).join('');
}

// ── Chart handles ─────────────────────────────────────────────────────────────

let memChart:   ChartHandle;
let cpuChart:   ChartHandle;
let nodesChart: ChartHandle;
let navChart:   { redraw(): void };

function initCharts(): void {
  memChart = createChart({
    hostId: 'host-mem',
    times:  () => mcTimes,
    yFmt:   v => `${(+v).toFixed(0)} MB`,
    series: [
      { values: () => mcMem,  color: C.mem,  label: 'Total MB', area: true },
      { values: () => mcAnon, color: C.anon, label: 'Anon MB' },
      { values: () => mcFile, color: C.file, label: 'File MB' },
    ],
  });
  buildLegend('legend-mem', [
    { color: C.mem, label: 'Total' }, { color: C.anon, label: 'Anon' }, { color: C.file, label: 'File' },
  ]);

  cpuChart = createChart({
    hostId: 'host-cpu',
    times:  () => mcTimes,
    yFmt:   v => `${(+v).toFixed(0)}%`,
    series: [
      { values: () => mcCpu,  color: C.cpu,  label: 'Total %', area: true },
      { values: () => mcUser, color: C.user, label: 'User %' },
      { values: () => mcSys,  color: C.sys,  label: 'Sys %' },
    ],
  });
  buildLegend('legend-cpu', [
    { color: C.cpu, label: 'Total' }, { color: C.user, label: 'User' }, { color: C.sys, label: 'Sys' },
  ]);

  nodesChart = createChart({
    hostId: 'host-nodes',
    times:  () => nodeTimes,
    yFmt:   v => String(Math.round(+v)),
    series: [{ values: () => nodeCounts, color: C.nodes, label: 'Count' }],
    extras: (g, xSc, h) => {
      const domain = xVisible ?? (mcTimes.length > 1 ? [mcTimes[0], mcTimes[mcTimes.length - 1]] as [number, number] : null);
      if (!domain) return;
      for (const ev of renEvents) {
        if (ev.wall < domain[0] || ev.wall > domain[1]) continue;
        g.append('line')
          .attr('x1', xSc(ev.wall)).attr('x2', xSc(ev.wall))
          .attr('y1', 0).attr('y2', h)
          .attr('stroke', C.rdv).attr('stroke-width', 1);
      }
    },
  });
  buildLegend('legend-nodes', [
    { color: C.nodes, label: 'Nodes' }, { color: C.rdv, label: 'Rendezvous' },
  ]);

  navChart = createNavigator('host-nav');

  const ro = new ResizeObserver(() => redrawCharts());
  ['host-mem','host-cpu','host-nodes','host-nav'].forEach(id => {
    const e = document.getElementById(id);
    if (e) ro.observe(e);
  });
}

function redrawCharts(): void {
  memChart?.redraw();
  cpuChart?.redraw();
  nodesChart?.redraw();
  navChart?.redraw();
}

// ── Data ingest ───────────────────────────────────────────────────────────────

function ingestMemCpu(pts: SerializedMemCpuPoint[]): void {
  for (const p of pts) {
    mcTimes.push(p.wall);
    mcMem.push(p.memKiB / 1024); mcAnon.push(p.anonKiB / 1024);
    mcFile.push(p.fileKiB / 1024);
    mcCpu.push(p.cpuPct);  mcUser.push(p.cpuUser); mcSys.push(p.cpuSys);
  }
}

function ingestNodes(pts: SerializedNodePoint[]): void {
  for (const p of pts) {
    nodeTimes.push(p.wall); nodeCounts.push(p.totalCount);
    if (p.types.length > 0) lastNodeTypes = p.types;
  }
}

function ingestRendezvous(pts: SerializedRendezvousPoint[]): void {
  for (const p of pts) {
    renEvents.push({ wall: p.wall, durationMs: p.durationMs, file: p.file, line: p.line });
    const key = `${p.file}:${p.line}`;
    const g = renGroups.get(key) ?? { file: p.file, line: p.line, count: 0, totalMs: 0 };
    g.count++; g.totalMs += p.durationMs;
    renGroups.set(key, g);
  }
}

function clearData(): void {
  [mcTimes, mcMem, mcAnon, mcFile, mcCpu, mcUser, mcSys, nodeTimes, nodeCounts, renEvents].forEach(a => a.length = 0);
  renGroups.clear(); lastNodeTypes = []; prevNodeTypes.clear();
  xVisible = null; el('btn-reset-zoom').style.display = 'none';
}

// ── Tables ────────────────────────────────────────────────────────────────────

function renderNodeTable(): void {
  const tbody = el('tbody-nodes');
  const hint  = el('hint-list-nodes');
  if (!lastNodeTypes.length) { tbody.innerHTML = ''; hint.style.display = ''; el('node-badge').textContent = ''; return; }
  hint.style.display = 'none';
  const sorted = [...lastNodeTypes].sort((a, b) => b.count - a.count).slice(0, 50);
  let total = 0;
  tbody.innerHTML = sorted.map(t => {
    total += t.count;
    const delta = t.count - (prevNodeTypes.get(t.type) ?? t.count);
    const cls   = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : '';
    const dStr  = delta === 0 ? '' : (delta > 0 ? '+' : '') + delta;
    return `<tr><td class="col-type">${t.type}</td>
      <td class="col-num">${t.count}</td>
      <td class="col-num ${cls}">${dStr}</td>
      <td class="col-num">${t.staticBytes ? Math.round(t.staticBytes / 1024) : '—'}</td></tr>`;
  }).join('');
  prevNodeTypes = new Map(lastNodeTypes.map(t => [t.type, t.count]));
  el('node-badge').textContent = `${total} nodes · ${sorted.length} types`;
}

function renderRendezvousTable(): void {
  const tbody = el('tbody-rendezvous');
  const hint  = el('hint-list-rdv');
  if (!renGroups.size) { tbody.innerHTML = ''; hint.style.display = ''; el('rdv-badge').textContent = ''; return; }
  hint.style.display = 'none';
  const sorted = [...renGroups.values()].sort((a, b) => b.count - a.count).slice(0, 50);
  tbody.innerHTML = sorted.map(g => {
    const avg  = (g.totalMs / g.count).toFixed(1);
    const file = g.file.split('/').pop() ?? g.file;
    return `<tr class="nav-row" data-file="${g.file}" data-line="${g.line}">
      <td class="col-file" title="${g.file}:${g.line}">${file}:${g.line}</td>
      <td class="col-num">${g.count}</td>
      <td class="col-num">${g.totalMs.toFixed(0)}</td>
      <td class="col-num">${avg}</td></tr>`;
  }).join('');
  el('rdv-badge').textContent = `${renEvents.length} events · ${renGroups.size} locations`;
  tbody.querySelectorAll<HTMLElement>('.nav-row').forEach(row => {
    row.addEventListener('click', () => {
      vscode.postMessage({ kind: 'open-rendezvous', file: row.dataset.file!, line: Number(row.dataset.line) });
    });
  });
}

// ── State display ─────────────────────────────────────────────────────────────

function applyState(state: WebviewState): void {
  recording = state.recording;
  sessionStartWall = state.sessionStartWall ?? 0;
  const btn = el<HTMLButtonElement>('btn-toggle');
  const btnNew = el<HTMLButtonElement>('btn-new-session');
  btn.textContent = recording ? 'Stop' : 'Start';
  btn.classList.toggle('stop', recording);
  btn.disabled = panelMode === 'replay';
  btnNew.textContent = panelMode === 'replay' ? 'Back to Live' : 'New Session';
  el('status-dot').classList.toggle('recording', recording && panelMode === 'live');
  el('status-dot').classList.toggle('replay', panelMode === 'replay');
  const d = state.device;
  el('device-label').textContent = d ? `${d.appTitle ?? '—'} @ ${d.ip}` : 'No device selected';
  clearInterval(elapsedTimer);
  if (recording) {
    elapsedTimer = setInterval(() => {
      if (!sessionStartWall) return;
      const sec = Math.floor((Date.now() - sessionStartWall) / 1000);
      el('elapsed').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    }, 1000);
  } else {
    el('elapsed').textContent = '';
  }
}

function applyReplayState(session: SerializedSessionInfo): void {
  panelMode = 'replay';
  el('status-dot').classList.remove('recording'); el('status-dot').classList.add('replay');
  (el<HTMLButtonElement>('btn-toggle')).disabled = true;
  (el<HTMLButtonElement>('btn-new-session')).textContent = 'Back to Live';
  el('device-label').textContent = `${session.appTitle ?? session.id} @ ${session.deviceIp ?? '—'}`;
}

function populateSessionSelector(sessions: SerializedSessionInfo[]): void {
  const sel = el<HTMLSelectElement>('session-select');
  while (sel.options.length > 1) sel.remove(1);
  for (const s of sessions) {
    const dur = s.endedWall ? `${Math.round((s.endedWall - s.startedWall) / 1000)}s` : 'live';
    const opt = document.createElement('option');
    opt.value = s.dir;
    opt.textContent = `${s.appTitle ?? 'session'}  ${new Date(s.startedWall).toLocaleTimeString()}  (${dur})`;
    sel.appendChild(opt);
  }
}

// ── DOM ───────────────────────────────────────────────────────────────────────

function buildDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <div class="status-dot" id="status-dot"></div>
  <span id="device-label">No device</span>
  <select id="session-select" title="Switch sessions">
    <option value="live">● Live</option>
  </select>
  <button id="btn-toggle">Start</button>
  <button id="btn-new-session">New Session</button>
  <button id="btn-reset-zoom" class="secondary" style="display:none">Clear Range</button>
  <span id="elapsed"></span>
</div>
<div id="main-area">
  <div id="charts">
    <div class="chart-pane"><div class="chart-title">Memory</div>
      <div class="chart-host" id="host-mem"><div class="empty-hint" id="hint-mem">Waiting for data…</div></div>
      <div class="legend-row" id="legend-mem"></div></div>
    <div class="chart-pane"><div class="chart-title">CPU</div>
      <div class="chart-host" id="host-cpu"><div class="empty-hint" id="hint-cpu">Waiting for data…</div></div>
      <div class="legend-row" id="legend-cpu"></div></div>
    <div class="chart-pane"><div class="chart-title">SceneGraph Nodes</div>
      <div class="chart-host" id="host-nodes"><div class="empty-hint" id="hint-nodes">Waiting for data…</div></div>
      <div class="legend-row" id="legend-nodes"></div></div>
    <div class="nav-pane"><div class="nav-chart-host" id="host-nav">
      <div class="empty-hint nav-empty-hint" id="hint-nav">Brush to select a time range</div></div></div>
  </div>
  <div id="lists">
    <div class="list-pane">
      <div class="list-header"><span class="list-title">Nodes</span><span class="list-badge" id="node-badge"></span></div>
      <div class="list-scroll">
        <table class="data-table" id="table-nodes">
          <thead><tr><th class="col-type">Type</th><th class="col-num">Count</th><th class="col-num">Δ</th><th class="col-num">kB</th></tr></thead>
          <tbody id="tbody-nodes"></tbody>
        </table>
        <div class="empty-hint list-empty" id="hint-list-nodes">Start a session to see node types</div>
      </div>
    </div>
    <div class="list-pane">
      <div class="list-header"><span class="list-title">Rendezvous</span><span class="list-badge" id="rdv-badge"></span><span class="list-hint">click to open file</span></div>
      <div class="list-scroll">
        <table class="data-table" id="table-rendezvous">
          <thead><tr><th class="col-file">Location</th><th class="col-num">Count</th><th class="col-num">Total ms</th><th class="col-num">Avg ms</th></tr></thead>
          <tbody id="tbody-rendezvous"></tbody>
        </table>
        <div class="empty-hint list-empty" id="hint-list-rdv">No rendezvous recorded yet</div>
      </div>
    </div>
  </div>
</div>
<div id="status-banner" style="display:none;padding:6px 10px;background:var(--vscode-inputValidation-warningBackground);border-top:1px solid var(--vscode-inputValidation-warningBorder);font-size:12px;line-height:1.4;flex-shrink:0"></div>`;
}

// ── Messages ──────────────────────────────────────────────────────────────────

window.addEventListener('message', ev => {
  const msg = ev.data as ExtMsg;
  switch (msg.kind) {
    case 'init':
      clearData(); panelMode = 'live';
      ingestMemCpu(msg.history.memCpu); ingestNodes(msg.history.nodes); ingestRendezvous(msg.history.rendezvous);
      applyState(msg.state);
      el<HTMLSelectElement>('session-select').value = 'live';
      redrawCharts(); renderNodeTable(); renderRendezvousTable();
      break;
    case 'batch':
      ingestMemCpu(msg.memCpu); ingestNodes(msg.nodes); ingestRendezvous(msg.rendezvous);
      redrawCharts(); renderNodeTable(); renderRendezvousTable();
      break;
    case 'state':
      applyState(msg.state);
      break;
    case 'sessions':
      populateSessionSelector(msg.sessions);
      break;
    case 'replay':
      clearData();
      ingestMemCpu(msg.history.memCpu); ingestNodes(msg.history.nodes); ingestRendezvous(msg.history.rendezvous);
      applyReplayState(msg.session);
      el<HTMLSelectElement>('session-select').value = msg.session.dir;
      redrawCharts(); renderNodeTable(); renderRendezvousTable();
      break;
    case 'status': {
      const banner = el('status-banner');
      banner.textContent = msg.message ?? '';
      banner.style.display = msg.message ? 'block' : 'none';
      break;
    }
  }
});

document.addEventListener('click', e => {
  const id = (e.target as HTMLElement).id;
  if (id === 'btn-toggle') {
    vscode.postMessage({ kind: recording ? 'stop' : 'start' });
  } else if (id === 'btn-new-session') {
    if (panelMode === 'replay') { panelMode = 'live'; el<HTMLSelectElement>('session-select').value = 'live'; vscode.postMessage({ kind: 'load-live' }); }
    else vscode.postMessage({ kind: 'new-session' });
  } else if (id === 'btn-reset-zoom') {
    xVisible = null; el('btn-reset-zoom').style.display = 'none'; redrawCharts();
  }
});

document.addEventListener('change', e => {
  const t = e.target as HTMLSelectElement;
  if (t.id === 'session-select') {
    const val = t.value;
    if (val === 'live') { panelMode = 'live'; vscode.postMessage({ kind: 'load-live' }); }
    else vscode.postMessage({ kind: 'load-session', dir: val });
  }
});

buildDom();
initCharts();

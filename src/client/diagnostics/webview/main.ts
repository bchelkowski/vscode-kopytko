/**
 * Kopytko Diagnostics webview — D3-based time series charts.
 * Replaces uPlot with D3 for library consistency with the Node Tree Explorer.
 *
 * esbuild bundles this file into out/diagnostics-webview/main.js.
 */

import './styles.css';
import {
  select, type Selection,
  pointer,
} from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { line as d3line, area as d3area } from 'd3-shape';
import { axisBottom, axisLeft } from 'd3-axis';
import { brushX, type BrushBehavior } from 'd3-brush';
import { extent } from 'd3-array';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── Panel state ───────────────────────────────────────────────────────────────

type PanelMode = 'live' | 'replay';
let panelMode: PanelMode = 'live';
let recording = false;
let sessionStartWall = 0;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

// ── Chart data ────────────────────────────────────────────────────────────────

// mem-cpu series (wall ms, values in MB or %)
const mcTimes:  number[] = [];
const mcMem:    number[] = [];  // total MB
const mcAnon:   number[] = [];
const mcFile:   number[] = [];
const mcCpu:    number[] = [];  // total %
const mcUser:   number[] = [];
const mcSys:    number[] = [];

// node-counts series
const nodeTimes:  number[] = [];
const nodeCounts: number[] = [];

// rendezvous events
interface RenEvent { wall: number; durationMs: number; file: string; line: number }
const renEvents: RenEvent[] = [];

// Visible x domain (ms).  null = show all.
let xVisible: [number, number] | null = null;

// Latest node type breakdown (for the table)
let lastNodeTypes: SerializedNodeTypeEntry[] = [];
let prevNodeTypes: Map<string, number>       = new Map();

// Rendezvous aggregate table
interface RenGroup { file: string; line: number; count: number; totalMs: number }
const renGroups = new Map<string, RenGroup>();

// ── Chart colours ─────────────────────────────────────────────────────────────

const C = {
  mem:    '#4e79a7',
  anon:   '#59a14f',
  file:   '#f28e2b',
  cpu:    '#e15759',
  user:   '#76b7b2',
  sys:    '#b07aa1',
  nodes:  '#4e79a7',
  rdv:    'rgba(255,180,0,0.7)',
};

// ── Chart handles ─────────────────────────────────────────────────────────────

interface ChartHandle {
  redraw(): void;
  setCursor(ms: number | null): void;
  resize(): void;
}

let memChart:   ChartHandle;
let cpuChart:   ChartHandle;
let nodesChart: ChartHandle;
let navChart:   NavHandle;

interface NavHandle { redraw(): void; }

let cursorMs: number | null = null;

function setCursorAll(ms: number | null): void {
  cursorMs = ms;
  memChart?.setCursor(ms);
  cpuChart?.setCursor(ms);
  nodesChart?.setCursor(ms);
}

// ── Generic time-series chart factory ────────────────────────────────────────

interface SeriesDef {
  values: () => number[];
  color: string;
  label: string;
  area?: boolean;
}

interface ChartConfig {
  hostId: string;
  times: () => number[];
  series: SeriesDef[];
  yFmt?: (v: number) => string;
  yDomain?: () => [number, number] | null;  // null = auto
  /** Extra rendering after main series (e.g. rendezvous markers) */
  extras?: (g: Selection<SVGGElement, unknown, null, undefined>, x: (ms: number) => number, y0: number, h: number) => void;
}

function createChart(cfg: ChartConfig): ChartHandle {
  const MARGIN = { top: 6, right: 8, bottom: 20, left: 44 };
  const host = document.getElementById(cfg.hostId)!;

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
  host.appendChild(svgEl);

  const svg   = select(svgEl);
  const gMain = svg.append('g').attr('class', 'chart-main');
  const gAxes = svg.append('g').attr('class', 'chart-axes');
  const gCursor = svg.append('g').attr('class', 'chart-cursor');

  const cursorLine = gCursor.append('line')
    .attr('stroke', 'rgba(200,200,200,0.45)')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,2')
    .style('display', 'none');

  // Zoom for pan
  const zoomBeh = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 1])  // pan only, no scale
    .on('zoom', () => {});  // we handle panning via brush

  // Mouse events for cursor sync
  svgEl.addEventListener('mousemove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const W = rect.width;
    const innerW = W - MARGIN.left - MARGIN.right;
    if (innerW <= 0) return;
    const localX = e.clientX - rect.left - MARGIN.left;
    if (localX < 0 || localX > innerW) { setCursorAll(null); return; }
    const domain = xDomain();
    if (!domain) return;
    const ms = domain[0] + (localX / innerW) * (domain[1] - domain[0]);
    setCursorAll(ms);
  });
  svgEl.addEventListener('mouseleave', () => setCursorAll(null));

  void zoomBeh;

  function dims() {
    const W = host.clientWidth  || 200;
    const H = host.clientHeight || 80;
    const w = Math.max(1, W - MARGIN.left - MARGIN.right);
    const h = Math.max(1, H - MARGIN.top  - MARGIN.bottom);
    return { W, H, w, h };
  }

  function xDomain(): [number, number] | null {
    if (xVisible) return xVisible;
    const ts = cfg.times();
    if (ts.length < 2) return null;
    return [ts[0], ts[ts.length - 1]];
  }

  function redraw() {
    const { W, H, w, h } = dims();
    svg.attr('viewBox', `0 0 ${W} ${H}`);

    const domain = xDomain();
    const ts     = cfg.times();
    const hint   = host.querySelector<HTMLElement>('.empty-hint');
    if (!domain || ts.length < 2) {
      gMain.selectAll('*').remove();
      gAxes.selectAll('*').remove();
      if (hint) hint.style.display = '';
      return;
    }
    if (hint) hint.style.display = 'none';

    const xSc = scaleLinear().domain(domain).range([0, w]);
    const xFn = (ms: number) => MARGIN.left + xSc(ms);

    // Y domain
    let yMin = Infinity, yMax = -Infinity;
    const custYDom = cfg.yDomain?.();
    if (custYDom) {
      [yMin, yMax] = custYDom;
    } else {
      for (const s of cfg.series) {
        const vs = s.values();
        const idx = ts.map((t, i) => ({ t, i }))
          .filter(({ t }) => t >= domain[0] && t <= domain[1])
          .map(({ i }) => i);
        for (const i of idx) {
          yMin = Math.min(yMin, vs[i] ?? 0);
          yMax = Math.max(yMax, vs[i] ?? 0);
        }
      }
    }
    if (!isFinite(yMin)) yMin = 0;
    if (!isFinite(yMax)) yMax = 1;
    if (yMax === yMin) yMax = yMin + 1;
    const yPad = (yMax - yMin) * 0.08;
    const ySc = scaleLinear().domain([yMin - yPad, yMax + yPad]).range([h, 0]).nice();
    const yFn = (v: number) => MARGIN.top + ySc(v);

    // Paths
    gMain.attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
    gMain.selectAll('*').remove();

    // Clip path
    const clipId = `clip-${cfg.hostId}`;
    gMain.append('clipPath').attr('id', clipId)
      .append('rect').attr('width', w).attr('height', h);

    const lineGen = d3line<number>()
      .defined((_, i) => ts[i] >= domain[0] && ts[i] <= domain[1])
      .x((_, i) => xSc(ts[i]))
      .y((v) => ySc(v));

    for (const s of cfg.series) {
      const vs = s.values();

      if (s.area) {
        const areaGen = d3area<number>()
          .defined((_, i) => ts[i] >= domain[0] && ts[i] <= domain[1])
          .x((_, i) => xSc(ts[i]))
          .y0(h)
          .y1((v) => ySc(v));
        gMain.append('path')
          .attr('clip-path', `url(#${clipId})`)
          .attr('fill', s.color)
          .attr('fill-opacity', 0.15)
          .attr('d', areaGen(vs) ?? '');
      }

      gMain.append('path')
        .attr('clip-path', `url(#${clipId})`)
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 1.5)
        .attr('d', lineGen(vs) ?? '');
    }

    // Extras (rendezvous markers etc.)
    cfg.extras?.(gMain, xFn, MARGIN.top, h);

    // Axes
    gAxes.selectAll('*').remove();

    const xAxis = axisBottom(xSc)
      .ticks(Math.max(2, Math.floor(w / 80)))
      .tickFormat((v) => {
        const sec = Math.floor((Number(v) - (sessionStartWall || Number(domain[0]))) / 1000);
        const m = Math.floor(Math.abs(sec) / 60);
        const s = String(Math.abs(sec) % 60).padStart(2, '0');
        return `${sec < 0 ? '-' : ''}${m}:${s}`;
      });

    const yAxis = axisLeft(ySc)
      .ticks(4)
      .tickFormat(cfg.yFmt ?? ((v) => String(Math.round(Number(v)))));

    gAxes.append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top + h})`)
      .attr('class', 'axis-x')
      .call(xAxis as never)
      .call((g) => {
        g.select('.domain').attr('stroke', 'rgba(128,128,128,0.3)');
        g.selectAll('.tick line').attr('stroke', 'rgba(128,128,128,0.2)');
        g.selectAll('.tick text').attr('fill', 'var(--vscode-editorHint-foreground,#aaa)').attr('font-size', 9);
      });

    gAxes.append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)
      .attr('class', 'axis-y')
      .call(yAxis as never)
      .call((g) => {
        g.select('.domain').remove();
        g.selectAll('.tick line').attr('stroke', 'rgba(128,128,128,0.15)').attr('x2', w);
        g.selectAll('.tick text').attr('fill', 'var(--vscode-editorHint-foreground,#aaa)').attr('font-size', 9);
      });

    // Update cursor position if active
    setCursor(cursorMs);
  }

  function setCursor(ms: number | null) {
    const domain = xDomain();
    if (!ms || !domain) { cursorLine.style('display', 'none'); return; }
    const { w, h } = dims();
    const xSc = scaleLinear().domain(domain).range([0, w]);
    const px = MARGIN.left + xSc(ms);
    cursorLine
      .style('display', null)
      .attr('x1', px).attr('x2', px)
      .attr('y1', MARGIN.top).attr('y2', MARGIN.top + h);
  }

  function resize() { redraw(); }

  return { redraw, setCursor, resize };
}

// ── Navigator chart ───────────────────────────────────────────────────────────

function createNavigator(hostId: string): NavHandle {
  const MARGIN = { top: 4, right: 8, bottom: 18, left: 44 };
  const host   = document.getElementById(hostId)!;

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
  host.appendChild(svgEl);

  const svg  = select(svgEl);
  const gNav = svg.append('g');
  let brushBeh: BrushBehavior<unknown>;

  function redraw() {
    const W = host.clientWidth  || 200;
    const H = host.clientHeight || 40;
    const w = Math.max(1, W - MARGIN.left - MARGIN.right);
    const h = Math.max(1, H - MARGIN.top  - MARGIN.bottom);
    svg.attr('viewBox', `0 0 ${W} ${H}`);

    gNav.selectAll('*').remove();
    gNav.attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    const hint = host.querySelector<HTMLElement>('.empty-hint');

    if (mcTimes.length < 2) {
      if (hint) hint.style.display = '';
      return;
    }
    if (hint) hint.style.display = 'none';

    const fullDomain: [number, number] = [mcTimes[0], mcTimes[mcTimes.length - 1]];
    const xSc = scaleLinear().domain(fullDomain).range([0, w]);
    const [yMinV, yMaxV] = extent(mcCpu) as [number, number];
    const ySc = scaleLinear().domain([Math.min(0, yMinV ?? 0), (yMaxV ?? 1) * 1.1 + 0.01]).range([h, 0]);

    // CPU overview line (thin)
    const lineGen = d3line<number>()
      .x((_, i) => xSc(mcTimes[i]))
      .y((v) => ySc(v));
    gNav.append('path')
      .attr('fill', 'none')
      .attr('stroke', C.cpu)
      .attr('stroke-width', 1)
      .attr('opacity', 0.6)
      .attr('d', lineGen(mcCpu) ?? '');

    // x axis (minimal)
    gNav.append('g')
      .attr('transform', `translate(0,${h})`)
      .call(axisBottom(xSc).ticks(4).tickFormat((v) => {
        const sec = Math.floor((Number(v) - mcTimes[0]) / 1000);
        const m = Math.floor(sec / 60), s = String(sec % 60).padStart(2, '0');
        return `${m}:${s}`;
      }) as never)
      .call((g) => {
        g.select('.domain').attr('stroke', 'rgba(128,128,128,0.3)');
        g.selectAll('.tick line').attr('stroke', 'rgba(128,128,128,0.2)');
        g.selectAll('.tick text').attr('fill', 'var(--vscode-editorHint-foreground,#aaa)').attr('font-size', 9);
      });

    // Brush
    brushBeh = brushX<unknown>()
      .extent([[0, 0], [w, h]])
      .on('end', (event) => {
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

    gNav.append('g').attr('class', 'brush').call(brushBeh as never)
      .call((g) => {
        g.select('.selection')
          .attr('fill', 'rgba(255,255,255,0.1)')
          .attr('stroke', 'rgba(255,255,255,0.3)');
      });

    // Restore brush if zoomed
    if (xVisible) {
      const [a, b] = xVisible;
      gNav.select<SVGGElement>('.brush')
        .call(brushBeh.move as never, [xSc(a), xSc(b)] as never);
    }
  }

  return { redraw };
}

// ── Legend rows ───────────────────────────────────────────────────────────────

function buildLegend(
  hostId: string,
  series: Array<{ color: string; label: string }>,
): void {
  const host = document.getElementById(hostId)!;
  host.innerHTML = series.map(s =>
    `<div class="legend-item">
       <div class="legend-swatch" style="background:${s.color}"></div>
       <span>${s.label}</span>
     </div>`,
  ).join('');
}

// ── Rendezvous marker extra renderer ──────────────────────────────────────────

function rdvExtras(
  g: Selection<SVGGElement, unknown, null, undefined>,
  xFn: (ms: number) => number,
  marginTop: number,
  h: number,
): void {
  const domain = xVisible ?? (mcTimes.length > 1 ? [mcTimes[0], mcTimes[mcTimes.length - 1]] as [number,number] : null);
  if (!domain) return;
  for (const ev of renEvents) {
    if (ev.wall < domain[0] || ev.wall > domain[1]) continue;
    const px = xFn(ev.wall) - (g.node() as SVGGElement).getBoundingClientRect().left;
    // relative x within the translated group
    const rx = xFn(ev.wall) - 44; // approx, re-calculated via xSc inside extras
    void rx;
    const rx2 = px - 44;
    void rx2;
    // Use the passed xFn which already accounts for MARGIN.left
    const lineX = xFn(ev.wall);
    void lineX;
  }
  // We can't easily use xFn directly since it includes MARGIN.left.
  // Instead compute the x scale inline.
  const xSc = scaleLinear()
    .domain(domain)
    .range([0, (g.node()?.closest('svg')?.clientWidth ?? 200) - 44 - 8]);
  for (const ev of renEvents) {
    if (ev.wall < domain[0] || ev.wall > domain[1]) continue;
    g.append('line')
      .attr('x1', xSc(ev.wall)).attr('x2', xSc(ev.wall))
      .attr('y1', 0).attr('y2', h)
      .attr('stroke', C.rdv)
      .attr('stroke-width', 1);
  }
}

// ── Chart initialisation ──────────────────────────────────────────────────────

function initCharts(): void {
  memChart = createChart({
    hostId: 'host-mem',
    times:  () => mcTimes,
    yFmt:   (v) => `${v.toFixed(0)} MB`,
    series: [
      { values: () => mcMem,  color: C.mem,  label: 'Total MB', area: true },
      { values: () => mcAnon, color: C.anon, label: 'Anon MB' },
      { values: () => mcFile, color: C.file, label: 'File MB' },
    ],
  });
  buildLegend('legend-mem', [
    { color: C.mem,  label: 'Total' },
    { color: C.anon, label: 'Anon' },
    { color: C.file, label: 'File' },
  ]);

  cpuChart = createChart({
    hostId: 'host-cpu',
    times:  () => mcTimes,
    yFmt:   (v) => `${v.toFixed(0)}%`,
    yDomain: () => [0, Math.max(5, ...(xVisible ? mcCpu.filter((_, i) => mcTimes[i] >= (xVisible![0]) && mcTimes[i] <= (xVisible![1])) : mcCpu))],
    series: [
      { values: () => mcCpu,  color: C.cpu,  label: 'Total %', area: true },
      { values: () => mcUser, color: C.user, label: 'User %' },
      { values: () => mcSys,  color: C.sys,  label: 'Sys %' },
    ],
  });
  buildLegend('legend-cpu', [
    { color: C.cpu,  label: 'Total' },
    { color: C.user, label: 'User' },
    { color: C.sys,  label: 'Sys' },
  ]);

  nodesChart = createChart({
    hostId: 'host-nodes',
    times:  () => nodeTimes,
    yFmt:   (v) => String(Math.round(v)),
    series: [
      { values: () => nodeCounts, color: C.nodes, label: 'Count' },
    ],
    extras: rdvExtras,
  });
  buildLegend('legend-nodes', [
    { color: C.nodes, label: 'Nodes' },
    { color: C.rdv,   label: 'Rendezvous' },
  ]);

  navChart = createNavigator('host-nav');

  // Resize on container size change
  const ro = new ResizeObserver(() => redrawCharts());
  ['host-mem', 'host-cpu', 'host-nodes', 'host-nav'].forEach((id) => {
    const el2 = document.getElementById(id);
    if (el2) ro.observe(el2);
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
    mcMem.push(p.memKiB / 1024);
    mcAnon.push(p.anonKiB / 1024);
    mcFile.push(p.fileKiB / 1024);
    mcCpu.push(p.cpuPct);
    mcUser.push(p.cpuUser);
    mcSys.push(p.cpuSys);
  }
}

function ingestNodes(pts: SerializedNodePoint[]): void {
  for (const p of pts) {
    nodeTimes.push(p.wall);
    nodeCounts.push(p.totalCount);
    if (p.types.length > 0) {
      lastNodeTypes = p.types;
    }
  }
}

function ingestRendezvous(pts: SerializedRendezvousPoint[]): void {
  for (const p of pts) {
    renEvents.push({ wall: p.wall, durationMs: p.durationMs, file: p.file, line: p.line });
    const key = `${p.file}:${p.line}`;
    const grp = renGroups.get(key) ?? { file: p.file, line: p.line, count: 0, totalMs: 0 };
    grp.count++;
    grp.totalMs += p.durationMs;
    renGroups.set(key, grp);
  }
}

function clearData(): void {
  mcTimes.length = 0;  mcMem.length = 0; mcAnon.length = 0; mcFile.length = 0;
  mcCpu.length   = 0;  mcUser.length= 0; mcSys.length  = 0;
  nodeTimes.length = 0; nodeCounts.length = 0;
  renEvents.length = 0; renGroups.clear();
  lastNodeTypes = []; prevNodeTypes.clear();
  xVisible = null;
  el('btn-reset-zoom').style.display = 'none';
}

// ── Node table ────────────────────────────────────────────────────────────────

function renderNodeTable(): void {
  const tbody = el('tbody-nodes');
  const hint  = el('hint-list-nodes');
  if (lastNodeTypes.length === 0) {
    tbody.innerHTML = '';
    hint.style.display = '';
    el('node-badge').textContent = '';
    return;
  }
  hint.style.display = 'none';

  const sorted = [...lastNodeTypes].sort((a, b) => b.count - a.count).slice(0, 50);
  let total = 0;
  tbody.innerHTML = sorted.map(t => {
    total += t.count;
    const delta = t.count - (prevNodeTypes.get(t.type) ?? t.count);
    const cls = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : '';
    const dStr = delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`;
    const kb = t.staticBytes ? `${Math.round(t.staticBytes / 1024)}` : '—';
    return `<tr><td class="col-type">${t.type}</td>
      <td class="col-num">${t.count}</td>
      <td class="col-num ${cls}">${dStr}</td>
      <td class="col-num">${kb}</td></tr>`;
  }).join('');

  prevNodeTypes = new Map(lastNodeTypes.map(t => [t.type, t.count]));
  el('node-badge').textContent = `${total} nodes · ${sorted.length} types`;
}

// ── Rendezvous table ──────────────────────────────────────────────────────────

function renderRendezvousTable(): void {
  const tbody = el('tbody-rendezvous');
  const hint  = el('hint-list-rdv');
  if (renGroups.size === 0) {
    tbody.innerHTML = '';
    hint.style.display = '';
    el('rdv-badge').textContent = '';
    return;
  }
  hint.style.display = 'none';

  const sorted = [...renGroups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  tbody.innerHTML = sorted.map(g => {
    const avg = g.count ? (g.totalMs / g.count).toFixed(1) : '—';
    const file = g.file.split('/').pop() ?? g.file;
    return `<tr class="nav-row" data-file="${g.file}" data-line="${g.line}">
      <td class="col-file" title="${g.file}:${g.line}">${file}:${g.line}</td>
      <td class="col-num">${g.count}</td>
      <td class="col-num">${g.totalMs.toFixed(0)}</td>
      <td class="col-num">${avg}</td></tr>`;
  }).join('');

  el('rdv-badge').textContent =
    `${renEvents.length} events · ${renGroups.size} locations`;

  tbody.querySelectorAll<HTMLElement>('.nav-row').forEach(row => {
    row.addEventListener('click', () => {
      vscode.postMessage({
        kind: 'open-rendezvous',
        file: row.dataset.file!,
        line: Number(row.dataset.line),
      });
    });
  });
}

// ── Session selector ──────────────────────────────────────────────────────────

function populateSessionSelector(sessions: SerializedSessionInfo[]): void {
  const sel = el<HTMLSelectElement>('session-select');
  while (sel.options.length > 1) sel.remove(1);
  for (const s of sessions) {
    const dur = s.endedWall
      ? `${Math.round((s.endedWall - s.startedWall) / 1000)}s`
      : 'live';
    const date = new Date(s.startedWall).toLocaleTimeString();
    const opt = document.createElement('option');
    opt.value = s.dir;
    opt.textContent = `${s.appTitle ?? 'session'}  ${date}  (${dur})`;
    sel.appendChild(opt);
  }
}

// ── UI state ──────────────────────────────────────────────────────────────────

function applyState(state: WebviewState): void {
  recording = state.recording;
  sessionStartWall = state.sessionStartWall ?? 0;

  const btn    = el<HTMLButtonElement>('btn-toggle');
  const btnNew = el<HTMLButtonElement>('btn-new-session');
  btn.textContent = recording ? 'Stop' : 'Start';
  btn.classList.toggle('stop', recording);
  btn.disabled = panelMode === 'replay';
  btnNew.textContent = panelMode === 'replay' ? 'Back to Live' : 'New Session';

  el('status-dot').classList.toggle('recording', recording && panelMode === 'live');
  el('status-dot').classList.toggle('replay', panelMode === 'replay');

  const d = state.device;
  el('device-label').textContent = d
    ? `${d.appTitle ?? '—'} @ ${d.ip}`
    : 'No device selected';

  clearInterval(elapsedTimer);
  if (recording) {
    elapsedTimer = setInterval(() => {
      if (!recording || !sessionStartWall) return;
      const secs = Math.floor((Date.now() - sessionStartWall) / 1000);
      const m = Math.floor(secs / 60), s = String(secs % 60).padStart(2, '0');
      el('elapsed').textContent = `${m}:${s}`;
    }, 1000);
  } else {
    el('elapsed').textContent = '';
  }
}

function applyReplayState(session: SerializedSessionInfo): void {
  panelMode = 'replay';
  el('status-dot').classList.remove('recording');
  el('status-dot').classList.add('replay');
  el<HTMLButtonElement>('btn-toggle').disabled = true;
  el<HTMLButtonElement>('btn-new-session').textContent = 'Back to Live';
  el('device-label').textContent =
    `${session.appTitle ?? session.id} @ ${session.deviceIp ?? '—'}`;
}

function resetZoom(): void {
  xVisible = null;
  el('btn-reset-zoom').style.display = 'none';
  redrawCharts();
}

// ── DOM builder ───────────────────────────────────────────────────────────────

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
</div>
<div id="status-banner" style="display:none;padding:6px 10px;background:var(--vscode-inputValidation-warningBackground);border-top:1px solid var(--vscode-inputValidation-warningBorder);font-size:12px;line-height:1.4;flex-shrink:0"></div>
`;
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
      panelMode = 'live';
      el<HTMLSelectElement>('session-select').value = 'live';
      redrawCharts();
      renderNodeTable();
      renderRendezvousTable();
      el('btn-reset-zoom').style.display = 'none';
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

// ── Button handlers ───────────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const id = target.id;

  if (id === 'btn-toggle') {
    if (recording) {
      vscode.postMessage({ kind: 'stop' });
    } else {
      vscode.postMessage({ kind: 'start' });
    }
  } else if (id === 'btn-new-session') {
    if (panelMode === 'replay') {
      panelMode = 'live';
      el<HTMLSelectElement>('session-select').value = 'live';
      vscode.postMessage({ kind: 'load-live' });
    } else {
      vscode.postMessage({ kind: 'new-session' });
    }
  } else if (id === 'btn-reset-zoom') {
    resetZoom();
  }
});

document.addEventListener('change', (e) => {
  const target = e.target as HTMLSelectElement;
  if (target.id === 'session-select') {
    const val = target.value;
    if (val === 'live') {
      panelMode = 'live';
      vscode.postMessage({ kind: 'load-live' });
    } else {
      vscode.postMessage({ kind: 'load-session', dir: val });
    }
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

buildDom();
initCharts();

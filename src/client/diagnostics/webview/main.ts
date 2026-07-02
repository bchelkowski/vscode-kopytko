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
  SerializedObjectPoint,
  SerializedObjectTypeEntry,
  SerializedRendezvousPoint,
  SerializedNodeTypeEntry,
  SerializedSessionInfo,
  SerializedTexturePoint,
  SerializedAppStatePoint,
  SerializedBeaconPoint,
  HistoryPayload,
  ChartId,
  TableId,
  RecordableAppOption,
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
let selectedAppId = 'dev';
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

// ── Chart data ────────────────────────────────────────────────────────────────

const mcTimes:  number[] = [];
const mcMem:    number[] = [];   // MB
const mcAnon:   number[] = [];
const mcFile:   number[] = [];
const mcShared: number[] = [];
const mcSwap:   number[] = [];
const mcCpu:    number[] = [];   // %
const mcUser:   number[] = [];
const mcSys:    number[] = [];
let mcLimitMB: number | null = null;
/** Roku's published background-app DRAM guidance — not device-reported, see WebviewState.backgroundMemLimitMB. */
let bgMemLimitMB = 100;

const nodeTimes:  number[] = [];
const nodeCounts: number[] = [];

interface NodeTypeSnapshot { wall: number; types: Map<string, number> }
const nodeTypeHistory: NodeTypeSnapshot[] = [];
const NODE_TOP_N = 8;
let topTypeNames: string[] = [];

const objTimes:  number[] = [];
const objCounts: number[] = [];

/** Per-timestamp object counts aggregated by <type> (roSGNode subtypes summed into one bucket) for the stacked chart. */
const objTypeHistory: NodeTypeSnapshot[] = [];
const OBJ_TOP_N = 8;
let topObjTypeNames: string[] = [];
/** Latest raw (subtype-preserving) entries for the table view. */
let lastObjectTypes: SerializedObjectTypeEntry[] = [];
let lastObjectTotal = 0;
let prevObjectRows = new Map<string, number>();

const texTimes:  number[] = [];
const texUsedMB: number[] = [];
const texMaxMB:  number[] = [];
interface BitmapEntry { width: number; height: number; sizeBytes: number; name: string }
let lastBitmaps: BitmapEntry[] = [];

interface AppStatePoint { wall: number; state: 'active' | 'background' | 'inactive' | 'unknown' }
const appStateEvents: AppStatePoint[] = [];

interface BeaconEvent { wall: number; name: string }
const beaconEvents: BeaconEvent[] = [];

interface RenEvent { wall: number; durationMs: number; file: string; line: number }
const renEvents: RenEvent[] = [];

let xVisible: [number, number] | null = null;
let lastNodeTypes: SerializedNodeTypeEntry[] = [];
let prevNodeTypes  = new Map<string, number>();
let showRendezvousOverlay = true;
let showBeaconOverlay = true;
let showHelperLines = true;

const visibleCharts = new Set<ChartId>(['memory', 'cpu', 'nodes']);
const visibleTables  = new Set<TableId>(['nodes', 'rendezvous']);

interface RenGroup { file: string; line: number; count: number; totalMs: number }
const renGroups = new Map<string, RenGroup>();

// ── Colours ───────────────────────────────────────────────────────────────────

const C = {
  mem:  '#4e79a7', anon: '#59a14f', file: '#f28e2b', shared: '#edc949', swap: '#e15759',
  cpu:  '#e15759', user: '#76b7b2', sys:  '#b07aa1',
  nodes:'#4e79a7', objects: '#59a14f', rdv: 'rgba(255,180,0,0.8)', beacon: 'rgba(100,200,255,0.85)',
  tex:  '#af7aa1', texMax: 'rgba(239,154,154,0.8)',
  memLimit: 'rgba(239,154,154,0.8)', bgMemLimit: 'rgba(159,206,239,0.85)',
  suspendBg: 'rgba(240,173,78,0.22)', suspendInactive: 'rgba(224,82,82,0.22)',
};

const NODE_PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7'];
const NODE_OTHER_COLOR = '#888888';

// ── Shared cursor ─────────────────────────────────────────────────────────────

let cursorMs: number | null = null;
const cursorListeners: Array<(ms: number | null) => void> = [];
function setCursorAll(ms: number | null): void {
  cursorMs = ms;
  cursorListeners.forEach(fn => fn(ms));
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function nearestIndex(ts: number[], ms: number): number {
  let lo = 0, hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < ms) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function showTooltipHtml(x: number, y: number, html: string): void {
  const t = el('chart-tooltip');
  t.innerHTML = html;
  t.style.display = 'block';
  t.style.left = `${x + 14}px`;
  t.style.top  = `${y + 14}px`;
}

function hideTooltip(): void {
  el('chart-tooltip').style.display = 'none';
}

function nearestRendezvous(ms: number, domain: [number, number], thresholdMs: number): RenEvent | undefined {
  if (!showRendezvousOverlay) return undefined;
  let best: RenEvent | undefined;
  let bestDist = thresholdMs;
  for (const ev of renEvents) {
    if (ev.wall < domain[0] || ev.wall > domain[1]) continue;
    const dist = Math.abs(ev.wall - ms);
    if (dist <= bestDist) { best = ev; bestDist = dist; }
  }
  return best;
}

function nearestBeacon(ms: number, domain: [number, number], thresholdMs: number): BeaconEvent | undefined {
  if (!showBeaconOverlay) return undefined;
  let best: BeaconEvent | undefined;
  let bestDist = thresholdMs;
  for (const ev of beaconEvents) {
    if (ev.wall < domain[0] || ev.wall > domain[1]) continue;
    const dist = Math.abs(ev.wall - ms);
    if (dist <= bestDist) { best = ev; bestDist = dist; }
  }
  return best;
}

// ── Redraw scheduling (perf) ─────────────────────────────────────────────────

let redrawScheduled = false;
function scheduleRedraw(): void {
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => { redrawScheduled = false; redrawCharts(); });
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
  extras?: (g: Selection<SVGGElement, unknown, null, undefined>, xSc: (ms: number) => number, h: number, ySc: (v: number) => number, w: number) => void;
  /** Render series as a cumulative stack (e.g. node counts by type) instead of independent overlaid areas. */
  stacked?: boolean;
  /** Optional extra value the auto y-range must also cover (e.g. a reference line). */
  extraYMax?: () => number | null;
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

  // Brush-to-zoom: dragging directly on this chart sets `xVisible` the same way
  // dragging the navigator does. Structural DOM/listener (re)attachment is
  // gated to actual size changes only — rebuilding this on every redraw (every
  // batch while recording) was the dominant cost of range selection before
  // the same fix was applied to the navigator's brush.
  const chartBrushG = svg.append('g').attr('class', 'chart-brush');
  let currentChartXSc = scaleLinear<number, number>();
  let suppressChartBrushEvent = false;
  let chartBrushAttachedW = -1, chartBrushAttachedH = -1;
  const chartBrushBeh = brushX<unknown>()
    .on('end', (event: D3BrushEvent<unknown>) => {
      if (suppressChartBrushEvent) { suppressChartBrushEvent = false; return; }
      const sel = event.selection as [number, number] | null;
      if (!sel) return; // a plain click without dragging — leave any existing zoom as-is
      xVisible = [currentChartXSc.invert(sel[0]), currentChartXSc.invert(sel[1])];
      el('btn-reset-zoom').style.display = '';
      // The dragged rectangle is just an input gesture; the persistent zoom
      // indicator lives on the navigator strip, so clear it here immediately.
      suppressChartBrushEvent = true;
      chartBrushG.call(chartBrushBeh.move as never, null as never);
      redrawCharts();
    });

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

  // Cursor sync + tooltip
  svgEl.addEventListener('mousemove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const w = rect.width - M.left - M.right;
    if (w <= 0) return;
    const domain = visibleDomain();
    if (!domain) return;
    const ms = domain[0] + ((e.clientX - rect.left - M.left) / w) * (domain[1] - domain[0]);
    setCursorAll(ms);
    updateTooltip(ms, e.clientX, e.clientY, domain, w);
  });
  svgEl.addEventListener('mouseleave', () => { setCursorAll(null); hideTooltip(); });

  function updateTooltip(ms: number, clientX: number, clientY: number, domain: [number, number], w: number): void {
    const ts = cfg.times();
    if (ts.length < 1) { hideTooltip(); return; }
    const idx = Math.min(nearestIndex(ts, ms), ts.length - 1);
    const rows = cfg.series.map(s => {
      const v = s.values()[idx];
      return `<div class="tt-row"><span class="tt-swatch" style="background:${s.color}"></span><span>${s.label}</span><span class="tt-val">${v == null ? '—' : v.toFixed(1)}</span></div>`;
    }).join('');
    const thresholdMs = ((domain[1] - domain[0]) / w) * 6;
    const nearestRdv = nearestRendezvous(ms, domain, thresholdMs);
    let rdvRow = '';
    if (nearestRdv) {
      const file = nearestRdv.file.split('/').pop() ?? nearestRdv.file;
      rdvRow = `<div class="tt-row tt-rdv">${file}:${nearestRdv.line} — ${nearestRdv.durationMs.toFixed(1)} ms</div>`;
    }
    const nearestBcn = nearestBeacon(ms, domain, thresholdMs);
    let bcnRow = '';
    if (nearestBcn) {
      bcnRow = `<div class="tt-row tt-bcn">${nearestBcn.name}</div>`;
    }
    const t0  = sessionStartWall || domain[0];
    const sec = Math.floor((ts[idx] - t0) / 1000);
    const m   = Math.floor(Math.abs(sec) / 60);
    const timeLabel = `${sec < 0 ? '-' : ''}${m}:${String(Math.abs(sec) % 60).padStart(2, '0')}`;
    showTooltipHtml(clientX, clientY, `<div class="tt-time">${timeLabel}</div>${rows}${rdvRow}${bcnRow}`);
  }

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
    if (!hasData) {
      // Clear any previously drawn series/overlays/axes — otherwise the last
      // session's lines/areas/gridlines stay visually rendered even though
      // the underlying data was just cleared (e.g. "New Session").
      pathSels.forEach(p => p.attr('d', ''));
      areaSels.forEach(a => a?.attr('d', ''));
      extrasSel.selectAll('*').remove();
      xAxisSel.selectAll('*').remove();
      yAxisSel.selectAll('*').remove();
      gCursor.style('display', 'none');
      return;
    }

    clipRect.attr('width', w).attr('height', h);
    gMain.attr('transform', `translate(${M.left},${M.top})`);

    const xSc = scaleLinear().domain(domain!).range([0, w]);
    currentChartXSc = xSc;

    // (structural) reattach the chart's brush-to-zoom overlay only on real size changes
    if (w !== chartBrushAttachedW || h !== chartBrushAttachedH) {
      chartBrushAttachedW = w; chartBrushAttachedH = h;
      chartBrushBeh.extent([[0, 0], [w, h]]);
      chartBrushG.attr('transform', `translate(${M.left},${M.top})`);
      chartBrushG.call(chartBrushBeh as never)
        .call((g: Selection<SVGGElement, unknown, null, undefined>) => {
          g.select('.selection')
            .attr('fill', 'rgba(255,255,255,0.12)')
            .attr('stroke', 'rgba(255,255,255,0.3)');
        });
    }

    // Auto y-range across visible window
    let yMin = Infinity, yMax = -Infinity;
    if (cfg.stacked) {
      yMin = 0;
      for (let i = 0; i < ts.length; i++) {
        if (ts[i] < domain![0] || ts[i] > domain![1]) continue;
        let sum = 0;
        for (const s of cfg.series) sum += s.values()[i] ?? 0;
        if (sum > yMax) yMax = sum;
      }
    } else {
      for (const s of cfg.series) {
        const vs = s.values();
        for (let i = 0; i < ts.length; i++) {
          if (ts[i] < domain![0] || ts[i] > domain![1]) continue;
          const v = vs[i] ?? 0;
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!isFinite(yMin)) yMin = 0;
    if (!isFinite(yMax)) yMax = 1;
    const extra = cfg.extraYMax?.();
    if (extra != null && extra > yMax) yMax = extra;
    if (yMax === yMin) yMax = yMin + 1;
    const pad = (yMax - yMin) * 0.08;
    const ySc = scaleLinear().domain([yMin - pad, yMax + pad]).range([h, 0]).nice();

    if (cfg.stacked) {
      // Cumulative stack: each series' baseline is the running total of series below it.
      const cum = new Array(ts.length).fill(0);
      for (let i = 0; i < cfg.series.length; i++) {
        const vs = cfg.series[i].values();
        const baseline = cum.slice();
        for (let j = 0; j < ts.length; j++) cum[j] += vs[j] ?? 0;
        const top = cum.slice();
        const areaGen = d3area<number>()
          .defined((_, j) => ts[j] >= domain![0] && ts[j] <= domain![1])
          .x((_, j) => xSc(ts[j]))
          .y0((_, j) => ySc(baseline[j]))
          .y1((_, j) => ySc(top[j]));
        areaSels[i]?.attr('d', areaGen(vs) ?? '');
        pathSels[i].attr('d', '');
      }
    } else {
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
    }

    // Extras (overlays) — only clear the extras group
    extrasSel.selectAll('*').remove();
    cfg.extras?.(extrasSel, ms => xSc(ms), h, v => ySc(v), w);

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

// ── Shared overlays (suspend shading, rendezvous + beacon markers) ────────────

function fullDomain(): [number, number] | null {
  if (mcTimes.length > 1) return [mcTimes[0], mcTimes[mcTimes.length - 1]];
  if (nodeTimes.length > 1) return [nodeTimes[0], nodeTimes[nodeTimes.length - 1]];
  if (objTimes.length > 1) return [objTimes[0], objTimes[objTimes.length - 1]];
  if (texTimes.length > 1) return [texTimes[0], texTimes[texTimes.length - 1]];
  return null;
}

function overlayDomain(): [number, number] | null {
  return xVisible ?? fullDomain();
}

function drawEventMarkers(g: Selection<SVGGElement, unknown, null, undefined>, xSc: (ms: number) => number, h: number, domain: [number, number]): void {
  if (!showRendezvousOverlay) return;
  for (const ev of renEvents) {
    if (ev.wall < domain[0] || ev.wall > domain[1]) continue;
    g.append('line')
      .attr('x1', xSc(ev.wall)).attr('x2', xSc(ev.wall))
      .attr('y1', 0).attr('y2', h)
      .attr('stroke', C.rdv).attr('stroke-width', 1);
  }
}

function drawBeaconMarkers(g: Selection<SVGGElement, unknown, null, undefined>, xSc: (ms: number) => number, h: number, domain: [number, number]): void {
  if (!showBeaconOverlay) return;
  for (const ev of beaconEvents) {
    if (ev.wall < domain[0] || ev.wall > domain[1]) continue;
    g.append('line')
      .attr('x1', xSc(ev.wall)).attr('x2', xSc(ev.wall))
      .attr('y1', 0).attr('y2', h)
      .attr('stroke', C.beacon).attr('stroke-width', 1).attr('stroke-dasharray', '2,2');
  }
}

/** Contiguous background/inactive ranges within `domain`, derived from `appStateEvents`. */
function computeShadeRanges(domain: [number, number]): Array<{ start: number; end: number; state: 'background' | 'inactive' }> {
  if (!appStateEvents.length) return [];
  const ranges: Array<{ start: number; end: number; state: 'background' | 'inactive' }> = [];
  let curState: AppStatePoint['state'] = 'active';
  let curStart = domain[0];
  for (const ev of appStateEvents) {
    if (ev.wall < domain[0]) { curState = ev.state; continue; }
    if (ev.wall > domain[1]) break;
    if (ev.state !== curState) {
      if (curState === 'background' || curState === 'inactive') ranges.push({ start: curStart, end: ev.wall, state: curState });
      curState = ev.state;
      curStart = ev.wall;
    }
  }
  if (curState === 'background' || curState === 'inactive') ranges.push({ start: curStart, end: domain[1], state: curState });
  return ranges;
}

function drawSuspendShading(g: Selection<SVGGElement, unknown, null, undefined>, xSc: (ms: number) => number, h: number, domain: [number, number]): void {
  for (const r of computeShadeRanges(domain)) {
    const x0 = xSc(r.start), x1 = xSc(r.end);
    g.append('rect')
      .attr('x', x0).attr('width', Math.max(0, x1 - x0))
      .attr('y', 0).attr('height', h)
      .attr('fill', r.state === 'background' ? C.suspendBg : C.suspendInactive)
      .style('pointer-events', 'none');
  }
}

/** Composed overlay used by every main chart: suspend shading behind, then beacon + rendezvous markers. */
function chartExtras(g: Selection<SVGGElement, unknown, null, undefined>, xSc: (ms: number) => number, h: number): void {
  const domain = overlayDomain();
  if (!domain) return;
  drawSuspendShading(g, xSc, h, domain);
  drawBeaconMarkers(g, xSc, h, domain);
  drawEventMarkers(g, xSc, h, domain);
}

/** Draws a horizontal dashed reference line (e.g. a max/limit value) with a trailing label. */
function drawLimitLine(g: Selection<SVGGElement, unknown, null, undefined>, w: number, ySc: (v: number) => number, value: number | null, color: string, label = 'max'): void {
  if (!showHelperLines || !value) return;
  const y = ySc(value);
  g.append('line')
    .attr('x1', 0).attr('x2', w)
    .attr('y1', y).attr('y2', y)
    .attr('stroke', color).attr('stroke-width', 1).attr('stroke-dasharray', '4,2');
  g.append('text')
    .attr('x', w).attr('y', y - 3)
    .attr('text-anchor', 'end')
    .attr('fill', color).attr('font-size', 9)
    .text(`${label} ${value.toFixed(1)} MB`);
}

// ── Navigator ─────────────────────────────────────────────────────────────────

interface NavSeries { times: number[]; values: number[]; label: string; color: string }
const MAX_NAV_SERIES = 5;

/** All currently-visible chart headline metrics for the navigator. */
function allNavSeries(): NavSeries[] {
  const result: NavSeries[] = [];
  if (visibleCharts.has('memory') && mcTimes.length > 1)    result.push({ times: mcTimes, values: mcMem, label: 'Mem MB', color: C.mem });
  if (visibleCharts.has('cpu')    && mcTimes.length > 1)    result.push({ times: mcTimes, values: mcCpu, label: 'CPU %',  color: C.cpu });
  if (visibleCharts.has('nodes')  && nodeTimes.length > 1)  result.push({ times: nodeTimes, values: nodeCounts, label: 'Nodes', color: C.nodes });
  if (visibleCharts.has('objects') && objTimes.length > 1)  result.push({ times: objTimes, values: objCounts, label: 'Objects', color: C.objects });
  if (visibleCharts.has('textures') && texTimes.length > 1) result.push({ times: texTimes, values: texUsedMB, label: 'Tex MB', color: C.tex });
  return result;
}

function createNavigator(hostId: string): { redraw(): void } {
  const M = { top: 4, right: 8, bottom: 18, left: 44 };
  const host = document.getElementById(hostId)!;

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  svgEl.style.cssText = 'position:absolute;inset:0;overflow:visible';
  host.appendChild(svgEl);

  const svg = select(svgEl);
  const gNav = svg.append('g');
  // Pre-allocate MAX_NAV_SERIES paths so we never recreate SVG elements on redraw.
  const linePaths = Array.from({ length: MAX_NAV_SERIES }, () =>
    gNav.append('path').attr('fill', 'none').attr('stroke-width', 1).attr('opacity', 0.7).style('display', 'none'),
  );
  const xAxisSel = gNav.append('g');
  const brushG   = gNav.append('g').attr('class', 'brush');

  // The brush behavior is created ONCE and its DOM (overlay/selection/handles +
  // all pointer/touch listeners) is only re-attached when the pixel size actually
  // changes (resize) — re-attaching on every data redraw was the main perf cost
  // here (4x/sec while recording). `currentXSc` lets the 'end' handler read the
  // scale from whichever redraw most recently ran, without recreating the brush
  // (and its closure) every time that scale changes.
  let currentXSc = scaleLinear<number, number>();
  let suppressBrushEvent = false;
  let attachedW = -1, attachedH = -1;
  let visualSelLeft: number | null = null;

  const brushBeh = brushX<unknown>()
    .on('end', (event: D3BrushEvent<unknown>) => {
      // `.move()` below repositions the selection rect to track live data without
      // re-triggering this handler — guard against that, or every redraw would
      // cascade into another full redrawCharts() call.
      if (suppressBrushEvent) { suppressBrushEvent = false; return; }
      const sel = event.selection as [number, number] | null;
      if (!sel) {
        xVisible = null;
        el('btn-reset-zoom').style.display = 'none';
      } else {
        xVisible = [currentXSc.invert(sel[0]), currentXSc.invert(sel[1])];
        el('btn-reset-zoom').style.display = '';
      }
      redrawCharts();
    });

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

    const series = allNavSeries();
    const hint = host.querySelector<HTMLElement>('.empty-hint');
    if (series.length === 0) { if (hint) hint.style.display = ''; linePaths.forEach(p => p.style('display', 'none')); return; }
    if (hint) hint.style.display = 'none';

    // Combined time domain across all series
    let tMin = Infinity, tMax = -Infinity;
    for (const s of series) {
      if (s.times[0] < tMin) tMin = s.times[0];
      if (s.times[s.times.length - 1] > tMax) tMax = s.times[s.times.length - 1];
    }
    const fullDomain: [number, number] = [tMin, tMax];
    const xSc = scaleLinear().domain(fullDomain).range([0, w]);
    currentXSc = xSc;
    // All series normalized to [0,1] on a shared y-axis so different units (MB/% /count) coexist.
    const ySc = scaleLinear().domain([0, 1]).range([h, 0]);

    for (let si = 0; si < MAX_NAV_SERIES; si++) {
      if (si >= series.length) { linePaths[si].style('display', 'none'); continue; }
      const s = series[si];
      const vMax = Math.max(...s.values, 1);
      const lineGen = d3line<number>().x((_, i) => xSc(s.times[i])).y(v => ySc(v / vMax));
      linePaths[si]
        .attr('stroke', s.color)
        .style('display', null)
        .attr('d', lineGen(s.values) ?? '');
    }

    const t0 = tMin;
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

    // Structural: only (re)attach the brush's DOM + listeners when the pixel
    // size actually changed. This used to run unconditionally on every redraw
    // (every batch while recording) and was the dominant cost of range selection.
    if (w !== attachedW || h !== attachedH) {
      attachedW = w; attachedH = h;
      brushBeh.extent([[0, 0], [w, h]]);
      brushG.call(brushBeh as never)
        .call((g: Selection<SVGGElement, unknown, null, undefined>) => {
          g.select('.selection')
            .attr('fill', 'rgba(255,255,255,0.1)')
            .attr('stroke', 'rgba(255,255,255,0.25)');
        });
      visualSelLeft = null; // re-attach reset the DOM selection; force a resync below
    }

    // Cosmetic: reposition the selection rect to track xVisible as live data
    // shifts the time→pixel mapping, without re-triggering the brush's 'end'
    // handler (suppressBrushEvent) — that re-trigger was causing every redraw
    // to cascade into another full redrawCharts() call.
    if (xVisible) {
      const left = xSc(xVisible[0]), right = xSc(xVisible[1]);
      if (left !== visualSelLeft) {
        suppressBrushEvent = true;
        brushG.call(brushBeh.move as never, [left, right] as never);
        visualSelLeft = left;
      }
    } else if (visualSelLeft !== null) {
      suppressBrushEvent = true;
      brushG.call(brushBeh.move as never, null as never);
      visualSelLeft = null;
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

let memChart:     ChartHandle;
let cpuChart:     ChartHandle;
let nodesChart:   ChartHandle;
let objectsChart: ChartHandle;
let texturesChart: ChartHandle;
let navChart:     { redraw(): void };
const nodeSeriesDefs: SeriesDef[] = [];
const objectSeriesDefs: SeriesDef[] = [];

/** Recomputes which node types occupy the 8 stacked slots, based on the latest snapshot. */
function updateNodeLegend(): void {
  const sorted = [...lastNodeTypes].sort((a, b) => b.count - a.count);
  topTypeNames = sorted.slice(0, NODE_TOP_N).map(t => t.type);
  for (let slot = 0; slot <= NODE_TOP_N; slot++) {
    nodeSeriesDefs[slot].label = slot < topTypeNames.length ? topTypeNames[slot] : 'Other';
  }
  buildLegend('legend-nodes', nodeSeriesDefs.map(s => ({ color: s.color, label: s.label })));
}

function nodeSlotValues(slot: number): number[] {
  return nodeTimes.map(t => {
    const types = typesAt(t);
    if (!types) return 0;
    if (slot < topTypeNames.length) return types.get(topTypeNames[slot]) ?? 0;
    let known = 0;
    for (const name of topTypeNames) known += types.get(name) ?? 0;
    let total = 0;
    types.forEach(v => { total += v; });
    return Math.max(0, total - known);
  });
}

function typesAt(ms: number): Map<string, number> | null {
  if (!nodeTypeHistory.length) return null;
  let lo = 0, hi = nodeTypeHistory.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nodeTypeHistory[mid].wall <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return nodeTypeHistory[ans].types;
}

/** Recomputes which object types occupy the 8 stacked slots, based on the latest snapshot. */
function updateObjectLegend(): void {
  const latest = objTypeHistory.length ? objTypeHistory[objTypeHistory.length - 1].types : new Map<string, number>();
  const sorted = [...latest.entries()].sort((a, b) => b[1] - a[1]);
  topObjTypeNames = sorted.slice(0, OBJ_TOP_N).map(([type]) => type);
  for (let slot = 0; slot <= OBJ_TOP_N; slot++) {
    objectSeriesDefs[slot].label = slot < topObjTypeNames.length ? topObjTypeNames[slot] : 'Other';
  }
  buildLegend('legend-objects', objectSeriesDefs.map(s => ({ color: s.color, label: s.label })));
}

function objectSlotValues(slot: number): number[] {
  return objTimes.map(t => {
    const types = objTypesAt(t);
    if (!types) return 0;
    if (slot < topObjTypeNames.length) return types.get(topObjTypeNames[slot]) ?? 0;
    let known = 0;
    for (const name of topObjTypeNames) known += types.get(name) ?? 0;
    let total = 0;
    types.forEach(v => { total += v; });
    return Math.max(0, total - known);
  });
}

function objTypesAt(ms: number): Map<string, number> | null {
  if (!objTypeHistory.length) return null;
  let lo = 0, hi = objTypeHistory.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (objTypeHistory[mid].wall <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return objTypeHistory[ans].types;
}

function initCharts(): void {
  memChart = createChart({
    hostId: 'host-mem',
    times:  () => mcTimes,
    yFmt:   v => `${(+v).toFixed(0)} MB`,
    series: [
      { values: () => mcMem,    color: C.mem,    label: 'Total MB',  area: true },
      { values: () => mcAnon,   color: C.anon,   label: 'Anon MB' },
      { values: () => mcFile,   color: C.file,   label: 'File MB' },
      { values: () => mcShared, color: C.shared, label: 'Shared MB' },
      { values: () => mcSwap,   color: C.swap,   label: 'Swap MB' },
    ],
    extraYMax: () => showHelperLines ? Math.max(mcLimitMB ?? 0, bgMemLimitMB) : null,
    extras: (g, xSc, h, ySc, w) => {
      chartExtras(g, xSc, h);
      drawLimitLine(g, w, ySc, mcLimitMB, C.memLimit, 'FG limit');
      drawLimitLine(g, w, ySc, bgMemLimitMB, C.bgMemLimit, 'BG limit');
    },
  });
  buildLegend('legend-mem', [
    { color: C.mem, label: 'Total' }, { color: C.anon, label: 'Anon' }, { color: C.file, label: 'File' },
    { color: C.shared, label: 'Shared' }, { color: C.swap, label: 'Swap' },
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
    extras: chartExtras,
  });
  buildLegend('legend-cpu', [
    { color: C.cpu, label: 'Total' }, { color: C.user, label: 'User' }, { color: C.sys, label: 'Sys' },
  ]);

  for (let slot = 0; slot <= NODE_TOP_N; slot++) {
    nodeSeriesDefs.push({
      values: () => nodeSlotValues(slot),
      color: slot === NODE_TOP_N ? NODE_OTHER_COLOR : NODE_PALETTE[slot % NODE_PALETTE.length],
      label: slot === NODE_TOP_N ? 'Other' : '',
      area: true,
    });
  }
  nodesChart = createChart({
    hostId: 'host-nodes',
    times:  () => nodeTimes,
    yFmt:   v => String(Math.round(+v)),
    series: nodeSeriesDefs,
    stacked: true,
    extras: chartExtras,
  });
  updateNodeLegend();

  for (let slot = 0; slot <= OBJ_TOP_N; slot++) {
    objectSeriesDefs.push({
      values: () => objectSlotValues(slot),
      color: slot === OBJ_TOP_N ? NODE_OTHER_COLOR : NODE_PALETTE[slot % NODE_PALETTE.length],
      label: slot === OBJ_TOP_N ? 'Other' : '',
      area: true,
    });
  }
  objectsChart = createChart({
    hostId: 'host-objects',
    times:  () => objTimes,
    yFmt:   v => String(Math.round(+v)),
    series: objectSeriesDefs,
    stacked: true,
    extras: chartExtras,
  });
  updateObjectLegend();

  texturesChart = createChart({
    hostId: 'host-textures',
    times:  () => texTimes,
    yFmt:   v => `${(+v).toFixed(1)} MB`,
    series: [{ values: () => texUsedMB, color: C.tex, label: 'Used MB', area: true }],
    extraYMax: () => showHelperLines && texMaxMB.length ? texMaxMB[texMaxMB.length - 1] : null,
    extras: (g, xSc, h, ySc, w) => {
      chartExtras(g, xSc, h);
      drawLimitLine(g, w, ySc, texMaxMB.length ? texMaxMB[texMaxMB.length - 1] : null, C.texMax);
    },
  });
  buildLegend('legend-textures', [
    { color: C.tex, label: 'Used' },
  ]);

  navChart = createNavigator('host-nav');

  const ro = new ResizeObserver(() => scheduleRedraw());
  ['host-mem', 'host-cpu', 'host-nodes', 'host-objects', 'host-textures', 'host-nav'].forEach(id => {
    const e = document.getElementById(id);
    if (e) ro.observe(e);
  });
}

function redrawCharts(): void {
  if (visibleCharts.has('memory')) memChart?.redraw();
  if (visibleCharts.has('cpu')) cpuChart?.redraw();
  if (visibleCharts.has('nodes')) nodesChart?.redraw();
  if (visibleCharts.has('objects')) objectsChart?.redraw();
  if (visibleCharts.has('textures')) texturesChart?.redraw();
  navChart?.redraw();
}

// ── Data ingest ───────────────────────────────────────────────────────────────

function ingestMemCpu(pts: SerializedMemCpuPoint[]): void {
  for (const p of pts) {
    mcTimes.push(p.wall);
    mcMem.push(p.memKiB / 1024); mcAnon.push(p.anonKiB / 1024);
    mcFile.push(p.fileKiB / 1024);
    mcShared.push((p.sharedKiB ?? 0) / 1024); mcSwap.push((p.swapKiB ?? 0) / 1024);
    mcCpu.push(p.cpuPct);  mcUser.push(p.cpuUser); mcSys.push(p.cpuSys);
    if (p.limitKiB != null) mcLimitMB = p.limitKiB / 1024;
  }
}

function ingestNodes(pts: SerializedNodePoint[]): void {
  for (const p of pts) {
    nodeTimes.push(p.wall); nodeCounts.push(p.totalCount);
    if (p.types.length > 0) {
      lastNodeTypes = p.types;
      nodeTypeHistory.push({ wall: p.wall, types: new Map(p.types.map(t => [t.type, t.count])) });
    }
  }
  if (pts.some(p => p.types.length > 0) && nodeSeriesDefs.length > 0) updateNodeLegend();
}

function ingestObjects(pts: SerializedObjectPoint[]): void {
  for (const p of pts) {
    objTimes.push(p.wall); objCounts.push(p.totalCount);
    if (p.types.length > 0) {
      lastObjectTypes = p.types;
      lastObjectTotal = p.totalCount;
      // The chart stacks by <type>: roSGNode subtype rows collapse into one bucket.
      const byType = new Map<string, number>();
      for (const t of p.types) byType.set(t.type, (byType.get(t.type) ?? 0) + t.count);
      objTypeHistory.push({ wall: p.wall, types: byType });
    }
  }
  if (pts.some(p => p.types.length > 0) && objectSeriesDefs.length > 0) updateObjectLegend();
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

function ingestTextures(pts: SerializedTexturePoint[]): void {
  for (const p of pts) {
    texTimes.push(p.wall);
    texUsedMB.push((p.usedBytes ?? 0) / (1024 * 1024));
    texMaxMB.push((p.maxBytes ?? 0) / (1024 * 1024));
    if (p.bitmaps.length > 0) lastBitmaps = p.bitmaps;
  }
}

function ingestAppState(pts: SerializedAppStatePoint[]): void {
  for (const p of pts) appStateEvents.push({ wall: p.wall, state: p.state });
  if (pts.length > 0) updateAppStateBadge(pts[pts.length - 1].state);
}

/**
 * Shows the live app-state as a persistent toolbar badge, independent of the
 * chart-background shading — the shading only reads as a signal when there's
 * a state *transition* in view; if the app has been e.g. continuously
 * "background" for the whole session, the entire chart is uniformly tinted
 * and easy to mistake for "nothing is happening". The badge gives an
 * unambiguous, always-visible confirmation that app-state data is flowing.
 */
function updateAppStateBadge(state: AppStatePoint['state']): void {
  const badge = document.getElementById('app-state-badge');
  if (!badge) return;
  badge.textContent = `● ${state}`;
  badge.className = `app-state-badge app-state-${state}`;
  badge.style.display = '';
}

function ingestBeacons(pts: SerializedBeaconPoint[]): void {
  for (const p of pts) beaconEvents.push({ wall: p.wall, name: p.name });
}

function clearData(): void {
  [
    mcTimes, mcMem, mcAnon, mcFile, mcShared, mcSwap, mcCpu, mcUser, mcSys,
    nodeTimes, nodeCounts, objTimes, objCounts, renEvents, texTimes, texUsedMB, texMaxMB,
    appStateEvents, beaconEvents,
  ].forEach(a => a.length = 0);
  nodeTypeHistory.length = 0;
  objTypeHistory.length = 0;
  lastObjectTypes = []; lastObjectTotal = 0; prevObjectRows.clear();
  renGroups.clear(); lastNodeTypes = []; prevNodeTypes.clear(); lastBitmaps = []; mcLimitMB = null;
  xVisible = null; el('btn-reset-zoom').style.display = 'none';
  const badge = document.getElementById('app-state-badge');
  if (badge) badge.style.display = 'none';
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

function renderObjectsTable(): void {
  const tbody = el('tbody-objects');
  const hint  = el('hint-list-objects');
  if (!lastObjectTypes.length) { tbody.innerHTML = ''; hint.style.display = ''; el('obj-badge').textContent = ''; return; }
  hint.style.display = 'none';
  // Rows are keyed by type, or type:subtype for roSGNode entries (one row per SG component type).
  const sorted = [...lastObjectTypes].sort((a, b) => b.count - a.count).slice(0, 50);
  tbody.innerHTML = sorted.map(t => {
    const label = t.subtype ? `${t.type}:${t.subtype}` : t.type;
    const delta = t.count - (prevObjectRows.get(label) ?? t.count);
    const cls   = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : '';
    const dStr  = delta === 0 ? '' : (delta > 0 ? '+' : '') + delta;
    return `<tr><td class="col-type" title="${label}">${label}</td>
      <td class="col-num">${t.count}</td>
      <td class="col-num ${cls}">${dStr}</td>
      <td class="col-num">${t.physicalBytes ? Math.round(t.physicalBytes / 1024) : '—'}</td></tr>`;
  }).join('');
  prevObjectRows = new Map(lastObjectTypes.map(t => [t.subtype ? `${t.type}:${t.subtype}` : t.type, t.count]));
  el('obj-badge').textContent = `${lastObjectTotal} objects · ${lastObjectTypes.length} types`;
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
  const totalMs = renEvents.reduce((sum, e) => sum + e.durationMs, 0);
  el('rdv-badge').textContent = `${renEvents.length} events · ${totalMs.toFixed(0)} ms total`;
  tbody.querySelectorAll<HTMLElement>('.nav-row').forEach(row => {
    row.addEventListener('click', () => {
      vscode.postMessage({ kind: 'open-rendezvous', file: row.dataset.file!, line: Number(row.dataset.line) });
    });
  });
}

function renderTexturesTable(): void {
  const tbody = el('tbody-textures');
  const hint  = el('hint-list-textures');
  if (!lastBitmaps.length) { tbody.innerHTML = ''; hint.style.display = ''; el('tex-badge').textContent = ''; return; }
  hint.style.display = 'none';
  const sorted = [...lastBitmaps].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 50);
  let totalSize = 0;
  for (const b of lastBitmaps) totalSize += b.sizeBytes;
  tbody.innerHTML = sorted.map(b => {
    const name = b.name ? (b.name.split('/').pop() ?? b.name) : '(render target)';
    return `<tr><td class="col-type" title="${b.name}">${name}</td>
      <td class="col-num">${b.width}×${b.height}</td>
      <td class="col-num">${(b.sizeBytes / 1024).toFixed(0)} kB</td></tr>`;
  }).join('');
  el('tex-badge').textContent = `${lastBitmaps.length} bitmaps · ${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
}

// ── State display ─────────────────────────────────────────────────────────────

function applyState(state: WebviewState): void {
  recording = state.recording;
  sessionStartWall = state.sessionStartWall ?? 0;
  bgMemLimitMB = state.backgroundMemLimitMB;
  selectedAppId = state.selectedAppId;
  const appSelect = el<HTMLSelectElement>('app-select');
  if (appSelect.value !== selectedAppId) appSelect.value = selectedAppId;
  appSelect.disabled = panelMode === 'replay';
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

function populateAppSelector(apps: RecordableAppOption[]): void {
  const sel = el<HTMLSelectElement>('app-select');
  const prevValue = sel.value;
  sel.innerHTML = '';
  if (apps.length === 0) {
    // No registry access (e.g. no sideloaded channel) — fall back to the plain "dev" default.
    const opt = document.createElement('option');
    opt.value = 'dev'; opt.textContent = 'dev';
    sel.appendChild(opt);
  } else {
    for (const a of apps) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.id === 'dev' ? `${a.title} (dev)` : a.title;
      sel.appendChild(opt);
    }
  }
  // Preserve the current selection across a refresh if it's still an option.
  if ([...sel.options].some(o => o.value === prevValue)) sel.value = prevValue;
  else if ([...sel.options].some(o => o.value === selectedAppId)) sel.value = selectedAppId;
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

const CHART_DEFS: Array<{ id: ChartId; label: string }> = [
  { id: 'memory', label: 'Memory' }, { id: 'cpu', label: 'CPU' },
  { id: 'nodes', label: 'Nodes' }, { id: 'objects', label: 'Objects' }, { id: 'textures', label: 'Textures' },
];
const TABLE_DEFS: Array<{ id: TableId; label: string }> = [
  { id: 'nodes', label: 'Nodes' }, { id: 'objects', label: 'Objects' },
  { id: 'rendezvous', label: 'Rendezvous' }, { id: 'textures', label: 'Textures' },
];

function visibilityDropdown(domId: string, label: string, items: Array<{ id: string; label: string }>, checkedSet: Set<string>): string {
  const options = items.map(it =>
    `<label class="dropdown-item"><input type="checkbox" class="${domId}-item" value="${it.id}" ${checkedSet.has(it.id) ? 'checked' : ''}> ${it.label}</label>`,
  ).join('');
  return `<details class="dropdown" id="${domId}">
    <summary>${label} ▾</summary>
    <div class="dropdown-menu">${options}</div>
  </details>`;
}

function buildDom(): void {
  document.body.innerHTML = `
<div id="toolbar">
  <div class="status-dot" id="status-dot"></div>
  <span id="device-label">No device</span>
  <select id="app-select" title="Which channel to record (channels sharing the sideloaded dev key)">
    <option value="dev">dev</option>
  </select>
  <span id="app-state-badge" class="app-state-badge" style="display:none" title="Live app foreground/background state (ECP /query/app-state)"></span>
  <select id="session-select" title="Switch sessions">
    <option value="live">● Live</option>
  </select>
  <button id="btn-toggle">Start</button>
  <button id="btn-new-session">New Session</button>
  <span id="elapsed" class="elapsed-badge"></span>
  <button id="btn-reset-zoom" class="secondary" style="display:none">Clear Range</button>
  ${visibilityDropdown('dd-charts', 'Charts', CHART_DEFS, visibleCharts)}
  ${visibilityDropdown('dd-tables', 'Tables', TABLE_DEFS, visibleTables)}
  <label class="toolbar-check"><input type="checkbox" id="chk-rendezvous" checked> Rendezvous</label>
  <label class="toolbar-check"><input type="checkbox" id="chk-beacon" checked> Beacons</label>
  <label class="toolbar-check"><input type="checkbox" id="chk-helper-lines" checked> Helper lines</label>
</div>
<div id="main-area">
  <div id="charts">
    <div class="chart-pane" id="pane-chart-memory"><div class="chart-title">Memory</div>
      <div class="chart-host" id="host-mem"><div class="empty-hint" id="hint-mem">Waiting for data…</div></div>
      <div class="legend-row" id="legend-mem"></div></div>
    <div class="chart-pane" id="pane-chart-cpu"><div class="chart-title">CPU</div>
      <div class="chart-host" id="host-cpu"><div class="empty-hint" id="hint-cpu">Waiting for data…</div></div>
      <div class="legend-row" id="legend-cpu"></div></div>
    <div class="chart-pane" id="pane-chart-nodes"><div class="chart-title">SceneGraph Nodes (by type)</div>
      <div class="chart-host" id="host-nodes"><div class="empty-hint" id="hint-nodes">Waiting for data…</div></div>
      <div class="legend-row" id="legend-nodes"></div></div>
    <div class="chart-pane" id="pane-chart-objects"><div class="chart-title">Objects (by type)</div>
      <div class="chart-host" id="host-objects"><div class="empty-hint" id="hint-objects">Waiting for data…</div></div>
      <div class="legend-row" id="legend-objects"></div></div>
    <div class="chart-pane" id="pane-chart-textures"><div class="chart-title">Texture Memory</div>
      <div class="chart-host" id="host-textures"><div class="empty-hint" id="hint-textures">Waiting for data…</div></div>
      <div class="legend-row" id="legend-textures"></div></div>
    <div class="nav-pane"><div class="nav-chart-host" id="host-nav">
      <div class="empty-hint nav-empty-hint" id="hint-nav">Brush to select a time range</div></div></div>
  </div>
  <div class="resize-handle" id="resize-handle"></div>
  <div id="lists">
    <div class="list-pane" id="pane-table-nodes">
      <div class="list-header"><span class="list-title">Nodes</span><span class="list-badge" id="node-badge"></span></div>
      <div class="list-scroll">
        <table class="data-table" id="table-nodes">
          <thead><tr><th class="col-type">Type</th><th class="col-num">Count</th><th class="col-num">Δ</th><th class="col-num">kB</th></tr></thead>
          <tbody id="tbody-nodes"></tbody>
        </table>
        <div class="empty-hint list-empty" id="hint-list-nodes">Start a session to see node types</div>
      </div>
    </div>
    <div class="list-pane" id="pane-table-objects" style="display:none">
      <div class="list-header"><span class="list-title">Objects</span><span class="list-badge" id="obj-badge"></span></div>
      <div class="list-scroll">
        <table class="data-table" id="table-objects">
          <thead><tr><th class="col-type">Object</th><th class="col-num">Count</th><th class="col-num">Δ</th><th class="col-num">kB</th></tr></thead>
          <tbody id="tbody-objects"></tbody>
        </table>
        <div class="empty-hint list-empty" id="hint-list-objects">No object-count data recorded yet</div>
      </div>
    </div>
    <div class="list-pane" id="pane-table-rendezvous">
      <div class="list-header"><span class="list-title">Rendezvous</span><span class="list-badge" id="rdv-badge"></span><span class="list-hint">click to open file</span></div>
      <div class="list-scroll">
        <table class="data-table" id="table-rendezvous">
          <thead><tr><th class="col-file">Location</th><th class="col-num">Count</th><th class="col-num">Total ms</th><th class="col-num">Avg ms</th></tr></thead>
          <tbody id="tbody-rendezvous"></tbody>
        </table>
        <div class="empty-hint list-empty" id="hint-list-rdv">No rendezvous recorded yet</div>
      </div>
    </div>
    <div class="list-pane" id="pane-table-textures" style="display:none">
      <div class="list-header"><span class="list-title">Textures</span><span class="list-badge" id="tex-badge"></span></div>
      <div class="list-scroll">
        <table class="data-table" id="table-textures">
          <thead><tr><th class="col-type">Name</th><th class="col-num">Dimensions</th><th class="col-num">kB</th></tr></thead>
          <tbody id="tbody-textures"></tbody>
        </table>
        <div class="empty-hint list-empty" id="hint-list-textures">No texture data recorded yet</div>
      </div>
    </div>
  </div>
</div>
<div id="status-banner" style="display:none;padding:6px 10px;background:var(--vscode-inputValidation-warningBackground);border-top:1px solid var(--vscode-inputValidation-warningBorder);font-size:12px;line-height:1.4;flex-shrink:0"></div>
<div id="chart-tooltip" class="chart-tooltip" style="display:none"></div>`;
}

// ── Messages ──────────────────────────────────────────────────────────────────

function renderAllTables(): void {
  renderNodeTable(); renderObjectsTable(); renderRendezvousTable(); renderTexturesTable();
}

function ingestHistory(h: HistoryPayload): void {
  ingestMemCpu(h.memCpu); ingestNodes(h.nodes); ingestObjects(h.objects); ingestRendezvous(h.rendezvous);
  ingestTextures(h.textures); ingestAppState(h.appState); ingestBeacons(h.beacons);
}

window.addEventListener('message', ev => {
  const msg = ev.data as ExtMsg;
  switch (msg.kind) {
    case 'init':
      clearData(); panelMode = 'live';
      ingestHistory(msg.history);
      applyState(msg.state);
      el<HTMLSelectElement>('session-select').value = 'live';
      redrawCharts(); renderAllTables();
      break;
    case 'batch':
      ingestMemCpu(msg.memCpu); ingestNodes(msg.nodes); ingestObjects(msg.objects); ingestRendezvous(msg.rendezvous);
      ingestTextures(msg.textures); ingestAppState(msg.appState); ingestBeacons(msg.beacons);
      scheduleRedraw(); renderAllTables();
      break;
    case 'state':
      applyState(msg.state);
      break;
    case 'sessions':
      populateSessionSelector(msg.sessions);
      break;
    case 'apps':
      populateAppSelector(msg.apps);
      break;
    case 'replay':
      clearData();
      ingestHistory(msg.history);
      applyReplayState(msg.session);
      el<HTMLSelectElement>('session-select').value = msg.session.dir;
      redrawCharts(); renderAllTables();
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
  // Close any open visibility dropdown when clicking outside it.
  document.querySelectorAll<HTMLDetailsElement>('.dropdown[open]').forEach(d => {
    if (!d.contains(e.target as Node)) d.open = false;
  });
});

document.addEventListener('change', e => {
  const target = e.target as HTMLElement;
  if (target.id === 'session-select') {
    const val = (target as HTMLSelectElement).value;
    if (val === 'live') { panelMode = 'live'; vscode.postMessage({ kind: 'load-live' }); }
    else vscode.postMessage({ kind: 'load-session', dir: val });
  } else if (target.id === 'app-select') {
    selectedAppId = (target as HTMLSelectElement).value;
    vscode.postMessage({ kind: 'select-app', appId: selectedAppId });
  } else if (target.id === 'chk-rendezvous') {
    showRendezvousOverlay = (target as HTMLInputElement).checked;
    redrawCharts(); sendVisibility();
  } else if (target.id === 'chk-beacon') {
    showBeaconOverlay = (target as HTMLInputElement).checked;
    redrawCharts(); sendVisibility();
  } else if (target.id === 'chk-helper-lines') {
    showHelperLines = (target as HTMLInputElement).checked;
    redrawCharts();
  } else if (target.classList.contains('dd-charts-item')) {
    const cb = target as HTMLInputElement;
    const id = cb.value as ChartId;
    if (cb.checked) visibleCharts.add(id); else visibleCharts.delete(id);
    applyChartVisibility();
  } else if (target.classList.contains('dd-tables-item')) {
    const cb = target as HTMLInputElement;
    const id = cb.value as TableId;
    if (cb.checked) visibleTables.add(id); else visibleTables.delete(id);
    applyTableVisibility();
  }
});

// ── Chart/table visibility application ───────────────────────────────────────

function updateResizeHandleVisibility(): void {
  const handle = document.getElementById('resize-handle');
  if (handle) handle.style.display = (visibleCharts.size === 0 || visibleTables.size === 0) ? 'none' : '';
}

function applyChartVisibility(): void {
  for (const def of CHART_DEFS) {
    const pane = document.getElementById(`pane-chart-${def.id}`);
    if (pane) pane.style.display = visibleCharts.has(def.id) ? '' : 'none';
  }
  const n = visibleCharts.size;
  const chartsEl = el('charts');
  chartsEl.classList.toggle('collapsed', n === 0);
  if (n > 0) chartsEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  updateResizeHandleVisibility();
  scheduleRedraw();
  sendVisibility();
}

function applyTableVisibility(): void {
  for (const def of TABLE_DEFS) {
    const pane = document.getElementById(`pane-table-${def.id}`);
    if (pane) pane.style.display = visibleTables.has(def.id) ? '' : 'none';
  }
  const n = visibleTables.size;
  const listsEl = el('lists');
  listsEl.classList.toggle('collapsed', n === 0);
  if (n > 0) listsEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  updateResizeHandleVisibility();
  renderAllTables();
  sendVisibility();
}

function sendVisibility(): void {
  vscode.postMessage({
    kind: 'visibility',
    charts: [...visibleCharts],
    tables: [...visibleTables],
    rendezvousOverlay: showRendezvousOverlay,
    beaconOverlay: showBeaconOverlay,
  });
}

// ── Resizable charts/tables split ────────────────────────────────────────────

const MIN_CHARTS_PX = 100;
const MAX_CHARTS_PX = 600;
const MIN_LISTS_PX  = 60;
const MAX_LISTS_PX  = 500;

function initResizeHandle(): void {
  const handle = el('resize-handle');
  const mainArea = el('main-area');
  const chartsEl = el('charts');
  const listsEl  = el('lists');

  handle.addEventListener('mousedown', (downEv) => {
    downEv.preventDefault();
    let chartsPx = chartsEl.getBoundingClientRect().height;
    let listsPx  = listsEl.getBoundingClientRect().height;
    const startY = downEv.clientY;
    const startCharts = chartsPx;
    const startLists  = listsPx;

    function onMove(moveEv: MouseEvent): void {
      const delta = moveEv.clientY - startY;
      // Growing charts (positive delta) is clamped to MAX_CHARTS_PX; beyond that the
      // remainder grows the tables area instead. Shrinking charts (negative delta)
      // first shrinks tables back down before shrinking charts below its minimum.
      chartsPx = Math.max(MIN_CHARTS_PX, Math.min(MAX_CHARTS_PX, startCharts + delta));
      const overflow = (startCharts + delta) - chartsPx;
      listsPx = Math.max(MIN_LISTS_PX, Math.min(MAX_LISTS_PX, startLists + overflow));
      chartsEl.style.flex = `0 0 ${chartsPx}px`;
      listsEl.style.flex = `0 0 ${listsPx}px`;
      scheduleRedraw();
    }
    function onUp(): void {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  void mainArea;
}

buildDom();
initCharts();
applyChartVisibility();
applyTableVisibility();
initResizeHandle();

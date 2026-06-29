/**
 * SG Node Tree Explorer — Icicle (flame chart) + collapsible tree.
 *
 * Icicle: Canvas 2D, D3 partition layout.
 *   - Click a cell → focus that subtree (refill full width, no manual zoom)
 *   - Double-click → go up one level
 *   - Hover → tooltip
 *   - Breadcrumb bar above chart shows current path
 *   - Legend bar below chart shows node type → colour
 *
 * Tree: SVG, D3 collapsible tree (horizontal).
 */

import { hierarchy, partition as d3partition, tree as d3tree } from 'd3-hierarchy';
import { select, type Selection } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import type { HierarchyNode } from 'd3-hierarchy';
import type { ExtMsg, WebMsg } from './protocol';

declare function acquireVsCodeApi(): { postMessage(msg: WebMsg): void };
const vscode = acquireVsCodeApi();

// ── Types ─────────────────────────────────────────────────────────────────────

interface SgNode {
  type:      string;
  name?:     string;
  sn:        string;
  attrs:     Record<string, string>;
  children:  SgNode[];
  size:      number;
  _collapsed?: boolean;
}

interface IcRect {
  x0: number; y0: number; x1: number; y1: number;
  data: SgNode;
  depth: number;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const mainEl        = document.getElementById('main')!;
const breadcrumbBar = document.getElementById('breadcrumb-bar')!;
const legendBar     = document.getElementById('legend-bar')!;
const overlayEl     = document.getElementById('overlay')!;
const tooltipEl     = document.getElementById('tooltip')!;
const nodeCountEl   = document.getElementById('node-count')!;
const channelLabel  = document.getElementById('channel-label')!;
const searchInput   = document.getElementById('search') as HTMLInputElement;
const btnIcicle     = document.getElementById('btn-treemap') as HTMLButtonElement;
const btnTree       = document.getElementById('btn-tree') as HTMLButtonElement;
const btnRefresh    = document.getElementById('btn-refresh') as HTMLButtonElement;

const icCanvas  = document.getElementById('ic-canvas') as HTMLCanvasElement;
const ctx       = icCanvas.getContext('2d')!;
const treeSvgEl = document.getElementById('tree-svg') as unknown as SVGSVGElement;

// ── Sizing ────────────────────────────────────────────────────────────────────

function applySize(): void {
  const W = mainEl.clientWidth  || 800;
  const H = mainEl.clientHeight || 600;
  icCanvas.width  = W; icCanvas.height = H;
  treeSvgEl.setAttribute('width',   W + 'px');
  treeSvgEl.setAttribute('height',  H + 'px');
  treeSvgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
}

new ResizeObserver(() => { applySize(); onResize(); }).observe(mainEl);
window.addEventListener('resize',   () => { applySize(); onResize(); });

function onResize(): void {
  if (!rootNode) return;
  if (mode === 'icicle') {
    // Recompute layout (canvas width changed) but keep focus and pan intact
    icRects = computeIcicle(focusNode ?? rootNode);
    drawIcicle();
    // Rebuild legend in case column count changed — DON'T reset breadcrumb/focus
    updateLegend();
  } else {
    renderTree(rootNode);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

type Mode = 'icicle' | 'tree';
let mode: Mode   = 'icicle';
let rootNode: SgNode | null = null;
let filterText   = '';
let focusNode: SgNode | null = null;
let icRects: IcRect[] = [];
let icPanX   = 0;   // horizontal pan offset in px (drag left/right)
let svgZoom: ZoomBehavior<SVGSVGElement, unknown> | null = null;

// ── Colours ───────────────────────────────────────────────────────────────────

const PALETTE = [
  '#4fc1ff','#4ec9b0','#dcdcaa','#ce9178',
  '#c586c0','#6a9955','#f44747','#9cdcfe',
  '#d7ba7d','#b5cea8','#e8a97e','#7fb3d3',
];
const typeColorMap = new Map<string, string>();
function colorFor(type: string): string {
  if (!typeColorMap.has(type)) typeColorMap.set(type, PALETTE[typeColorMap.size % PALETTE.length]);
  return typeColorMap.get(type)!;
}
function hexRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── XML parser ────────────────────────────────────────────────────────────────

function parseTree(xml: string): SgNode | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parseerror,parsererror')) return null;
  const all = doc.querySelector('All_Nodes');
  if (!all) return null;
  const tops = Array.from(all.children).map(parseEl);
  if (!tops.length) return null;
  if (tops.length === 1) return tops[0];
  const root: SgNode = { type: 'SceneGraph', sn: 'root', attrs: {}, children: tops, size: 0 };
  calcSize(root);
  return root;
}

function parseEl(el: Element): SgNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  const children = Array.from(el.children).map(parseEl);
  const n: SgNode = {
    type: el.tagName, name: attrs['name'],
    sn: attrs['_sn'] ?? el.tagName + Math.random(),
    attrs, children, size: 0,
  };
  calcSize(n);
  return n;
}

function calcSize(n: SgNode): void {
  n.size = 1 + n.children.reduce((s, c) => s + c.size, 0);
}

function nodeLabel(n: SgNode): string {
  return n.name ? `${n.type}  "${n.name}"` : n.type;
}

function defaultCollapse(n: SgNode, depth: number): void {
  if (depth >= 3) { n._collapsed = true; return; }
  n.children.forEach(c => defaultCollapse(c, depth + 1));
}

// ── Overlay / tooltip ─────────────────────────────────────────────────────────

function showOverlay(text: string, spinner = false): void {
  overlayEl.innerHTML = spinner
    ? `<div class="spin"></div><span>${text}</span>`
    : `<span>${text}</span>`;
  overlayEl.classList.add('visible');
}
function hideOverlay(): void { overlayEl.classList.remove('visible'); }

let ttTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTooltip(n: SgNode, mx: number, my: number): void {
  if (ttTimer) clearTimeout(ttTimer);
  ttTimer = setTimeout(() => {
    const attrs = Object.entries(n.attrs)
      .filter(([k]) => !['_sn','osref','bscref','_psn'].includes(k))
      .slice(0, 10)
      .map(([k, v]) => `<span class="tt-attr">${k}:</span> ${v}`)
      .join('<br>');
    tooltipEl.innerHTML = `<div class="tt-type">${nodeLabel(n)}</div>`
      + (attrs ? `<br>${attrs}` : '')
      + `<br><span class="tt-attr">descendants:</span> ${n.size - 1}`;
    tooltipEl.style.display = 'block';
    const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
    tooltipEl.style.left = `${Math.min(mx + 14, window.innerWidth  - tw - 8)}px`;
    tooltipEl.style.top  = `${Math.min(my + 14, window.innerHeight - th - 8)}px`;
  }, 80);
}
function hideTooltip(): void {
  if (ttTimer) clearTimeout(ttTimer);
  tooltipEl.style.display = 'none';
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

function updateBreadcrumb(): void {
  breadcrumbBar.innerHTML = '';
  if (!rootNode) return;

  const path: SgNode[] = [];
  (function find(n: SgNode, target: SgNode | null): boolean {
    path.push(n);
    if (n === target || target === null) return true;
    for (const c of n.children) if (find(c, target)) return true;
    path.pop();
    return false;
  })(rootNode, focusNode);

  path.forEach((n, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep'; sep.textContent = '›';
      breadcrumbBar.appendChild(sep);
    }
    const crumb = document.createElement('span');
    crumb.className = `crumb${i === path.length - 1 ? ' current' : ''}`;
    crumb.textContent = nodeLabel(n);
    if (i < path.length - 1) {
      const captured = n;
      crumb.addEventListener('click', () => {
        focusNode = captured === rootNode ? null : captured;
        renderIcicle();
      });
    }
    breadcrumbBar.appendChild(crumb);
  });
}

// ── Legend ────────────────────────────────────────────────────────────────────

function updateLegend(): void {
  legendBar.innerHTML = '';

  // Collect types visible in current rects, sorted by frequency
  const counts = new Map<string, number>();
  for (const r of icRects) counts.set(r.data.type, (counts.get(r.data.type) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  for (const [type] of sorted) {
    const entry = document.createElement('div');
    entry.className = 'legend-entry';

    const swatch = document.createElement('div');
    swatch.className = 'legend-swatch';
    swatch.style.background = colorFor(type);

    const label = document.createElement('span');
    label.textContent = type;

    entry.appendChild(swatch);
    entry.appendChild(label);
    legendBar.appendChild(entry);
  }
}

// ── ICICLE CHART (Canvas 2D, no zoom/pan — click to focus) ───────────────────

const MAX_ROWS = 6;
const ROW_H    = 26;   // px per row — always fixed, never scaled by tree depth

function computeIcicle(focus: SgNode): IcRect[] {
  const W = icCanvas.width || 800;

  // Give D3 any height — we override y0/y1 ourselves.
  const layout = d3partition<SgNode>()
    .size([W, MAX_ROWS * ROW_H])
    .padding(1)
    .round(true);

  const hier = hierarchy(focus, d => d.children.length ? d.children : null)
    .sum(d => d.children.length === 0 ? 1 : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  layout(hier);

  // Override D3's y positions so every depth level is exactly ROW_H tall.
  // D3 divides the total height by the actual max-depth, producing variable
  // row heights when the tree is shallower than MAX_ROWS.
  hier.each(d => {
    d.y0 = d.depth * ROW_H;
    d.y1 = d.y0 + ROW_H;
  });

  return hier.descendants()
    .filter(d => d.depth < MAX_ROWS && (d.x1 - d.x0) >= 0.5)
    .map(d => ({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, data: d.data, depth: d.depth }));
}

function drawIcicle(): void {
  const W = icCanvas.width, H = icCanvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(icPanX, 0);

  for (const r of icRects) {
    const cw = r.x1 - r.x0, ch = r.y1 - r.y0;

    const color = colorFor(r.data.type);
    const alpha  = Math.max(0.35, 0.8 - r.depth * 0.04);
    ctx.fillStyle = hexRgba(color, alpha);
    ctx.fillRect(r.x0, r.y0, cw, ch);

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth   = 0.5;
    ctx.strokeRect(r.x0, r.y0, cw, ch);

    if (cw < 24) continue;  // too narrow for any label

    const fontSize = Math.min(12, ROW_H * 0.6);
    ctx.font      = `${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor   = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur    = 2;

    const maxChars = Math.floor((cw - 6) / (fontSize * 0.58));
    let text = r.data.type;
    if (r.data.name && maxChars > 8) text += `  "${r.data.name}"`;
    if (text.length > maxChars) text = text.slice(0, Math.max(1, maxChars - 1)) + '…';
    ctx.fillText(text, r.x0 + 4, r.y0 + (ch + fontSize) / 2 - 1);

    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function renderIcicle(keepPan = false): void {
  const focus = focusNode ?? rootNode!;
  icRects = computeIcicle(focus);
  if (!keepPan) icPanX = 0;
  drawIcicle();
  updateBreadcrumb();
  // typeColorMap is now populated by drawIcicle → updateLegend can read colours
  updateLegend();
}

// Icicle interaction — drag to pan, click to focus, double-click to go up

let icDragStart: { ex: number; panX0: number } | null = null;
let icDragMoved = false;

function hitTest(offsetX: number, offsetY: number): SgNode | null {
  const lx = offsetX - icPanX;   // compensate for pan
  const ly = offsetY;
  for (let i = icRects.length - 1; i >= 0; i--) {
    const r = icRects[i];
    if (lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1) return r.data;
  }
  return null;
}

icCanvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  icDragStart = { ex: e.clientX, panX0: icPanX };
  icDragMoved = false;
  e.preventDefault();
});

icCanvas.addEventListener('mousemove', e => {
  if (icDragStart) {
    const dx = e.clientX - icDragStart.ex;
    if (Math.abs(dx) > 3) icDragMoved = true;
    if (icDragMoved) {
      icPanX = icDragStart.panX0 + dx;
      // Clamp: don't pan past the left edge or more than W past the right
      const W = icCanvas.width;
      icPanX = Math.max(-W, Math.min(W, icPanX));
      drawIcicle();
      hideTooltip();
      icCanvas.style.cursor = 'grabbing';
    }
    return;
  }

  const found = hitTest(e.offsetX, e.offsetY);
  if (found) {
    scheduleTooltip(found, e.clientX, e.clientY);
    icCanvas.style.cursor = found.children.length > 0 ? 'pointer' : 'default';
  } else {
    hideTooltip();
    icCanvas.style.cursor = 'default';
  }
});

icCanvas.addEventListener('mouseup', e => {
  const wasDrag = icDragMoved;
  icDragStart = null; icDragMoved = false;
  icCanvas.style.cursor = 'default';

  if (!wasDrag && e.button === 0 && rootNode) {
    const found = hitTest(e.offsetX, e.offsetY);
    if (found && found.children.length > 0 && found !== (focusNode ?? rootNode)) {
      focusNode = found;
      renderIcicle();   // resets pan to 0 for the new focus
    }
  }
});

icCanvas.addEventListener('dblclick', () => {
  if (!rootNode || !focusNode || focusNode === rootNode) return;
  const parent = findParent(rootNode, focusNode);
  focusNode = parent === rootNode ? null : parent;
  renderIcicle();
});

icCanvas.addEventListener('mouseleave', () => {
  hideTooltip();
  icDragStart = null; icDragMoved = false;
  icCanvas.style.cursor = 'default';
});

function findParent(root: SgNode, target: SgNode): SgNode | null {
  for (const c of root.children) {
    if (c === target) return root;
    const r = findParent(c, target);
    if (r) return r;
  }
  return null;
}

// ── TREE (SVG) ────────────────────────────────────────────────────────────────

function renderTree(root: SgNode): void {
  const svg = select(treeSvgEl as Element);
  svg.selectAll('*').remove();
  breadcrumbBar.innerHTML = '';
  legendBar.innerHTML = '';

  const W = mainEl.clientWidth  || 800;
  const H = mainEl.clientHeight || 600;

  const zoomG = svg.append('g');
  if (svgZoom) svg.on('.zoom', null);
  svgZoom = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.04, 4])
    .on('zoom', ev => zoomG.attr('transform', ev.transform));
  (svg as unknown as Selection<SVGSVGElement, unknown, null, undefined>).call(svgZoom as never);

  const q = filterText.toLowerCase();
  function visChildren(n: SgNode): SgNode[] | undefined {
    return n._collapsed || !n.children.length ? undefined : n.children;
  }
  function matches(n: SgNode): boolean {
    return !q || n.type.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q);
  }

  function update(): void {
    zoomG.selectAll('*').remove();
    const layout = d3tree<SgNode>().nodeSize([26, 240]);
    const hier   = hierarchy<SgNode>(root, visChildren);
    layout(hier);

    let minX = Infinity, maxX = -Infinity;
    hier.each(d => { minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x); });
    const oy = H / 2 - (minX + maxX) / 2, ox = 50;

    zoomG.selectAll('path.link')
      .data(hier.links())
      .join('path').attr('class', 'link')
      .attr('d', d => {
        const sx = d.source.y + ox, sy = d.source.x + oy;
        const tx = d.target.y + ox, ty = d.target.x + oy;
        const mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      });

    const nodeG = zoomG.selectAll<SVGGElement, HierarchyNode<SgNode>>('g.node')
      .data(hier.descendants())
      .join('g').attr('class', 'node')
      .attr('transform', d => `translate(${d.y + ox},${d.x + oy})`);

    const R = 6;
    nodeG.append('circle')
      .attr('r', R)
      .attr('fill', d => {
        if (!matches(d.data)) return 'transparent';
        const n = d.data;
        if (n._collapsed && n.children.length) return colorFor(n.type);
        return hexRgba(colorFor(n.type), n.children.length ? 0.2 : 0.25);
      })
      .attr('stroke', d => colorFor(d.data.type))
      .attr('stroke-width', d => d.data.children.length ? 1.5 : 1)
      .style('cursor', d => d.data.children.length ? 'pointer' : 'default')
      .on('click', (_e, d) => { if (!d.data.children.length) return; d.data._collapsed = !d.data._collapsed; update(); })
      .on('mousemove', (e, d) => scheduleTooltip(d.data, e.clientX, e.clientY))
      .on('mouseleave', hideTooltip);

    nodeG.filter(d => d.data.children.length > 0)
      .append('text')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', 7).attr('fill', d => colorFor(d.data.type))
      .style('pointer-events', 'none')
      .text(d => d.data._collapsed ? '▶' : '▾');

    nodeG.append('text')
      .attr('x', d => R + (d.data.children.length ? 11 : 7))
      .attr('dominant-baseline', 'central').attr('font-size', 12)
      .attr('fill', d => matches(d.data) ? 'var(--vscode-editor-foreground,#ccc)' : 'rgba(200,200,200,0.2)')
      .style('pointer-events', 'none')
      .text(d => {
        const n = d.data;
        return n._collapsed && n.children.length ? `${nodeLabel(n)}  [${n.size - 1}]` : nodeLabel(n);
      });
  }

  update();
  (svg as unknown as Selection<SVGSVGElement, unknown, null, undefined>)
    .call((svgZoom as never), zoomIdentity.translate(60, H / 2));
}

// ── Render dispatcher ─────────────────────────────────────────────────────────

function render(): void {
  if (!rootNode) return;
  hideOverlay();
  applySize();
  if (mode === 'icicle') {
    icCanvas.style.display  = 'block';
    treeSvgEl.style.display = 'none';
    focusNode = null;
    renderIcicle();
  } else {
    icCanvas.style.display  = 'none';
    treeSvgEl.style.display = 'block';
    renderTree(rootNode);
  }
  nodeCountEl.textContent = `${rootNode.size - 1} nodes`;
}

// ── Messages ──────────────────────────────────────────────────────────────────

window.addEventListener('message', e => {
  const msg = e.data as ExtMsg;
  switch (msg.kind) {
    case 'loading': showOverlay('Fetching node tree…', true); break;
    case 'tree': {
      channelLabel.textContent = msg.channelTitle
        ? `${msg.channelTitle} @ ${msg.device}` : msg.device;
      const parsed = parseTree(msg.xml);
      if (!parsed) { showOverlay('Could not parse node tree.'); return; }
      defaultCollapse(parsed, 0);
      rootNode = parsed;
      typeColorMap.clear();
      focusNode = null;
      render();
      break;
    }
    case 'error': showOverlay(`Error: ${msg.message}`); break;
  }
});

// ── Controls ──────────────────────────────────────────────────────────────────

btnIcicle.addEventListener('click', () => {
  mode = 'icicle';
  btnIcicle.classList.add('active'); btnTree.classList.remove('active');
  render();
});

btnTree.addEventListener('click', () => {
  mode = 'tree';
  btnTree.classList.add('active'); btnIcicle.classList.remove('active');
  render();
});

btnRefresh.addEventListener('click', () => {
  showOverlay('Fetching…', true);
  vscode.postMessage({ kind: 'refresh' });
});

searchInput.addEventListener('input', () => {
  filterText = searchInput.value.trim();
  if (rootNode && mode === 'tree') renderTree(rootNode);
});

// ── Init ──────────────────────────────────────────────────────────────────────

btnIcicle.classList.add('active');
applySize();
showOverlay('Run  Kopytko: Open Node Tree Explorer  to load from the active device.');

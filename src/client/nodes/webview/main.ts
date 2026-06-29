/**
 * SG Node Tree Explorer — Canvas treemap + SVG collapsible tree.
 *
 * Treemap uses Canvas 2D so it can handle hundreds of nodes without lag:
 * zero SVG DOM elements, rectangles drawn directly, hit-tested on click/hover.
 *
 * Tree uses SVG (D3 tree layout) with aggressive default-collapse so the
 * initial render is always readable regardless of tree size.
 */

import {
  hierarchy,
  treemap as d3treemap,
  treemapSquarify,
  tree as d3tree,
  type HierarchyNode,
} from 'd3-hierarchy';
import { select, type Selection } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import type { ExtMsg, WebMsg } from './protocol';

declare function acquireVsCodeApi(): { postMessage(msg: WebMsg): void };
const vscode = acquireVsCodeApi();

// ── Types ─────────────────────────────────────────────────────────────────────

interface SgNode {
  type:      string;
  name?:     string;
  extends?:  string;
  sn:        string;
  attrs:     Record<string, string>;
  children:  SgNode[];
  size:      number;
  _collapsed?: boolean;
}

// Precomputed layout rect (used for canvas hit-testing)
interface TmRect {
  x0: number; y0: number; x1: number; y1: number;
  data: SgNode;
  depth: number;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const mainEl       = document.getElementById('main')!;
const breadcrumb   = document.getElementById('breadcrumb')!;
const overlayEl    = document.getElementById('overlay')!;
const tooltipEl    = document.getElementById('tooltip')!;
const nodeCountEl  = document.getElementById('node-count')!;
const channelLabel = document.getElementById('channel-label')!;
const searchInput  = document.getElementById('search') as HTMLInputElement;
const btnTreemap   = document.getElementById('btn-treemap') as HTMLButtonElement;
const btnTree      = document.getElementById('btn-tree') as HTMLButtonElement;
const btnRefresh   = document.getElementById('btn-refresh') as HTMLButtonElement;

// ── Canvas (treemap) + SVG (tree) —  toggled by mode ─────────────────────────

const tmCanvas = document.createElement('canvas');
tmCanvas.style.cssText = 'position:absolute;inset:0;display:block;cursor:default';
mainEl.appendChild(tmCanvas);
const ctx = tmCanvas.getContext('2d')!;

const treeSvgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
treeSvgEl.style.cssText = 'position:absolute;inset:0;display:none;overflow:visible';
mainEl.appendChild(treeSvgEl);

// ── Sizing ────────────────────────────────────────────────────────────────────

function applySize(): void {
  const W = mainEl.clientWidth  || 800;
  const H = mainEl.clientHeight || 600;
  tmCanvas.width  = W; tmCanvas.height = H;
  treeSvgEl.setAttribute('width',   W + 'px');
  treeSvgEl.setAttribute('height',  H + 'px');
  treeSvgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
}

new ResizeObserver(() => { applySize(); if (rootNode) render(); }).observe(mainEl);
window.addEventListener('resize',  () => { applySize(); if (rootNode) render(); });

// ── State ─────────────────────────────────────────────────────────────────────

type Mode = 'treemap' | 'tree';
let mode: Mode     = 'treemap';
let rootNode: SgNode | null = null;
let filterText     = '';
let tmStack: SgNode[] = [];
let tmRects: TmRect[] = [];       // current layout for hit-testing

// Canvas zoom/pan state
let tmOffX = 0, tmOffY = 0, tmScale = 1;
let tmDrag: { sx: number; sy: number; ox: number; oy: number } | null = null;

// SVG tree zoom behaviour
let svgZoom: ZoomBehavior<SVGSVGElement, unknown> | null = null;

// ── Colour palette — bright, dark-background optimised ────────────────────────

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

/** Parse '#rrggbb' → 'rgba(r,g,b,a)' */
function hexRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── XML parser ────────────────────────────────────────────────────────────────

function parseTree(xml: string): SgNode | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return null;
  const allNodes = doc.querySelector('All_Nodes');
  if (!allNodes) return null;
  const topChildren = Array.from(allNodes.children).map(parseEl);
  if (!topChildren.length) return null;
  if (topChildren.length === 1) return topChildren[0];
  const root: SgNode = { type: 'SceneGraph', sn: 'root', attrs: {}, children: topChildren, size: 0 };
  computeSize(root);
  return root;
}

function parseEl(el: Element): SgNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  const children = Array.from(el.children).map(parseEl);
  const node: SgNode = {
    type: el.tagName, name: attrs['name'], extends: attrs['extends'],
    sn: attrs['_sn'] ?? el.tagName + Math.random(),
    attrs, children, size: 0,
  };
  computeSize(node);
  return node;
}

function computeSize(n: SgNode): void {
  n.size = 1 + n.children.reduce((s, c) => s + c.size, 0);
}

function nodeLabel(n: SgNode): string {
  return n.name ? `${n.type} "${n.name}"` : n.type;
}

/** Collapse starting from depth 3. Depth 0/1/2 always visible on first render. */
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

function showTooltip(n: SgNode, mx: number, my: number): void {
  const shown = Object.entries(n.attrs)
    .filter(([k]) => !['_sn','osref','bscref','_psn'].includes(k))
    .slice(0, 10)
    .map(([k, v]) => `<span class="tt-attr">${k}:</span> ${v}`)
    .join('<br>');
  tooltipEl.innerHTML = `<div class="tt-type">${nodeLabel(n)}</div>${shown ? `<br>${shown}` : ''}`
    + `<br><span class="tt-attr">descendants:</span> ${n.size - 1}`;
  tooltipEl.style.display = 'block';
  const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
  tooltipEl.style.left = `${Math.min(mx + 14, window.innerWidth  - tw - 8)}px`;
  tooltipEl.style.top  = `${Math.min(my + 14, window.innerHeight - th - 8)}px`;
}
function hideTooltip(): void { tooltipEl.style.display = 'none'; }

// ── TREEMAP (Canvas 2D) ───────────────────────────────────────────────────────

function computeTreemapLayout(current: SgNode): TmRect[] {
  const W = tmCanvas.width, H = tmCanvas.height;
  const layout = d3treemap<SgNode>()
    .tile(treemapSquarify)
    .size([W, H])
    .paddingTop(22).paddingInner(2).paddingOuter(3)
    .round(true);

  const hier = hierarchy(current, d => d.children.length ? d.children : null)
    .sum(d => d.children.length === 0 ? 1 : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  layout(hier);

  const rects: TmRect[] = [];
  for (const d of hier.descendants()) {
    if (d.depth === 0) continue;
    const w = d.x1 - d.x0, h = d.y1 - d.y0;
    if (w < 1 || h < 1) continue;   // skip sub-pixel cells entirely
    rects.push({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, data: d.data, depth: d.depth });
  }
  return rects;
}

function drawCanvas(): void {
  const W = tmCanvas.width, H = tmCanvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(tmOffX, tmOffY);
  ctx.scale(tmScale, tmScale);

  for (const r of tmRects) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    // Skip cells that are invisible at current zoom
    if (w * tmScale < 0.5 || h * tmScale < 0.5) continue;

    const color = colorFor(r.data.type);
    const alpha = r.depth === 1 ? 0.85 : 0.6;

    ctx.fillStyle = hexRgba(color, alpha);
    ctx.fillRect(r.x0, r.y0, w, h);

    // Border
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth   = 1 / tmScale;
    ctx.strokeRect(r.x0, r.y0, w, h);

    // Labels — only when the cell is large enough in screen pixels
    const screenW = w * tmScale, screenH = h * tmScale;
    if (screenW < 40 || screenH < 14) continue;

    const fontSize = Math.min(13, Math.max(9, Math.floor(screenH / 4))) / tmScale;
    ctx.font      = `${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor   = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur    = 3 / tmScale;
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

    const maxChars = Math.floor((w - 8) / (fontSize * 0.6));
    const typeStr  = r.data.type.length > maxChars
      ? r.data.type.slice(0, maxChars - 1) + '…'
      : r.data.type;
    ctx.fillText(typeStr, r.x0 + 4, r.y0 + fontSize + 3);

    if (r.data.name && screenH > 28) {
      ctx.font      = `${Math.max(8, fontSize * 0.85)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const name = `"${r.data.name}"`;
      const maxN  = Math.floor((w - 8) / (fontSize * 0.55));
      ctx.fillText(name.length > maxN ? name.slice(0, maxN - 1) + '…"' : name, r.x0 + 4, r.y0 + fontSize * 2 + 5);
    }

    // Children count badge
    if (r.data.children.length > 0 && screenW > 40 && screenH > 22) {
      ctx.font      = `${Math.max(7, fontSize * 0.75)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'right';
      ctx.fillText(`+${r.data.children.length}`, r.x1 - 4, r.y1 - 4);
      ctx.textAlign = 'left';
    }

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
  }

  ctx.restore();
}

function renderTreemap(root: SgNode): void {
  if (tmStack.length === 0) tmStack = [root];
  const current = tmStack[tmStack.length - 1];

  // Reset pan/zoom when drilling down
  tmOffX = 0; tmOffY = 0; tmScale = 1;

  tmRects = computeTreemapLayout(current);
  drawCanvas();
  buildBreadcrumb(root);
}

function buildBreadcrumb(root: SgNode): void {
  breadcrumb.innerHTML = '';
  tmStack.forEach((n, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep'; sep.textContent = '›';
      breadcrumb.appendChild(sep);
    }
    const crumb = document.createElement('span');
    crumb.className = `crumb${i === tmStack.length - 1 ? ' current' : ''}`;
    crumb.textContent = nodeLabel(n);
    if (i < tmStack.length - 1) {
      crumb.addEventListener('click', () => { tmStack = tmStack.slice(0, i + 1); renderTreemap(root); });
    }
    breadcrumb.appendChild(crumb);
  });
}

// Canvas interaction ── pan (drag) + zoom (wheel)

tmCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const mx = e.offsetX, my = e.offsetY;
  tmOffX = mx - (mx - tmOffX) * factor;
  tmOffY = my - (my - tmOffY) * factor;
  tmScale *= factor;
  tmScale  = Math.max(0.2, Math.min(20, tmScale));
  drawCanvas();
}, { passive: false });

tmCanvas.addEventListener('mousedown', e => {
  tmDrag = { sx: e.offsetX, sy: e.offsetY, ox: tmOffX, oy: tmOffY };
  tmCanvas.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!tmDrag) return;
  tmOffX = tmDrag.ox + (e.offsetX - tmDrag.sx);
  tmOffY = tmDrag.oy + (e.offsetY - tmDrag.sy);
  drawCanvas();
});
window.addEventListener('mouseup', () => {
  tmDrag = null;
  tmCanvas.style.cursor = 'default';
});

// Click: hit-test, drill into node
tmCanvas.addEventListener('click', e => {
  if (!rootNode) return;
  const lx = (e.offsetX - tmOffX) / tmScale;
  const ly = (e.offsetY - tmOffY) / tmScale;
  // Iterate in reverse so topmost (visually) cell wins
  for (let i = tmRects.length - 1; i >= 0; i--) {
    const r = tmRects[i];
    if (lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1) {
      if (r.data.children.length > 0) {
        tmStack.push(r.data);
        renderTreemap(rootNode);
      }
      break;
    }
  }
});

// Double-click: go back one level
tmCanvas.addEventListener('dblclick', () => {
  if (!rootNode || tmStack.length <= 1) return;
  tmStack.pop();
  renderTreemap(rootNode);
});

// Hover tooltip
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
tmCanvas.addEventListener('mousemove', e => {
  if (tmDrag) return;
  const lx = (e.offsetX - tmOffX) / tmScale;
  const ly = (e.offsetY - tmOffY) / tmScale;
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    for (let i = tmRects.length - 1; i >= 0; i--) {
      const r = tmRects[i];
      if (lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1) {
        showTooltip(r.data, e.clientX, e.clientY);
        return;
      }
    }
    hideTooltip();
  }, 80);
});
tmCanvas.addEventListener('mouseleave', () => {
  if (hoverTimer) clearTimeout(hoverTimer);
  hideTooltip();
});

// ── TREE / DENDROGRAM (SVG) ───────────────────────────────────────────────────

function renderTree(root: SgNode): void {
  const svg = select(treeSvgEl as Element);
  svg.selectAll('*').remove();
  breadcrumb.innerHTML = '';

  const W = mainEl.clientWidth  || 800;
  const H = mainEl.clientHeight || 600;

  const zoomG = svg.append('g').attr('class', 'zoom-root');

  if (svgZoom) svg.on('.zoom', null);
  svgZoom = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.04, 4])
    .on('zoom', ev => zoomG.attr('transform', ev.transform));
  (svg as unknown as Selection<SVGSVGElement, unknown, null, undefined>).call(svgZoom as never);

  const q = filterText.toLowerCase();

  function visChildren(n: SgNode): SgNode[] | undefined {
    return n._collapsed || !n.children.length ? undefined : n.children;
  }

  function update(): void {
    zoomG.selectAll('*').remove();

    const layout = d3tree<SgNode>().nodeSize([26, 240]);
    const hier   = hierarchy<SgNode>(root, visChildren);
    layout(hier);

    let minX = Infinity, maxX = -Infinity;
    hier.each(d => { minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x); });
    const oy = H / 2 - (minX + maxX) / 2;
    const ox = 50;

    // Links
    zoomG.selectAll('path.link')
      .data(hier.links())
      .join('path')
      .attr('class', 'link')
      .attr('d', d => {
        const sx = d.source.y + ox, sy = d.source.x + oy;
        const tx = d.target.y + ox, ty = d.target.x + oy;
        const mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      });

    // Nodes
    const nodeG = zoomG.selectAll<SVGGElement, HierarchyNode<SgNode>>('g.node')
      .data(hier.descendants())
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.y + ox},${d.x + oy})`);

    const R = 6;
    const matches = (n: SgNode) =>
      !q || n.type.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q);

    nodeG.append('circle')
      .attr('r', R)
      .attr('fill', d => {
        const n = d.data;
        if (!matches(n)) return 'transparent';
        if (n._collapsed && n.children.length > 0) return colorFor(n.type);
        return n.children.length === 0
          ? hexRgba(colorFor(n.type), 0.25)
          : hexRgba(colorFor(n.type), 0.2);
      })
      .attr('stroke', d => colorFor(d.data.type))
      .attr('stroke-width', d => d.data.children.length > 0 ? 1.5 : 1)
      .style('cursor', d => d.data.children.length ? 'pointer' : 'default')
      .on('click', (_e, d) => {
        if (!d.data.children.length) return;
        d.data._collapsed = !d.data._collapsed;
        update();
      })
      .on('mousemove', (e, d) => showTooltip(d.data, e.clientX, e.clientY))
      .on('mouseleave', hideTooltip);

    // Expand indicator
    nodeG.filter(d => d.data.children.length > 0)
      .append('text')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', 7).attr('fill', d => colorFor(d.data.type))
      .style('pointer-events', 'none')
      .text(d => d.data._collapsed ? '▶' : '▾');

    // Label
    nodeG.append('text')
      .attr('x', d => d.data.children.length ? R + 11 : R + 7)
      .attr('dominant-baseline', 'central')
      .attr('font-size', 12)
      .attr('fill', d => matches(d.data) ? 'var(--vscode-editor-foreground, #cccccc)' : 'rgba(200,200,200,0.25)')
      .style('pointer-events', 'none')
      .text(d => {
        const n = d.data;
        const base = nodeLabel(n);
        return n._collapsed && n.children.length ? `${base}  [${n.size - 1}]` : base;
      });
  }

  update();

  // Initial pan: show the root near the left edge, vertically centred
  const initT = zoomIdentity.translate(60, H / 2);
  (svg as unknown as Selection<SVGSVGElement, unknown, null, undefined>)
    .call((svgZoom as never), initT);
}

// ── Render dispatcher ─────────────────────────────────────────────────────────

function render(): void {
  if (!rootNode) return;
  hideOverlay();
  applySize();

  if (mode === 'treemap') {
    tmCanvas.style.display    = 'block';
    treeSvgEl.style.display   = 'none';
    tmStack = [];
    renderTreemap(rootNode);
  } else {
    tmCanvas.style.display    = 'none';
    treeSvgEl.style.display   = 'block';
    renderTree(rootNode);
  }

  nodeCountEl.textContent = `${rootNode.size - 1} nodes`;
}

// ── Messages ──────────────────────────────────────────────────────────────────

window.addEventListener('message', e => {
  const msg = e.data as ExtMsg;
  switch (msg.kind) {
    case 'loading':
      showOverlay('Fetching node tree…', true);
      break;

    case 'tree': {
      channelLabel.textContent = msg.channelTitle
        ? `${msg.channelTitle} @ ${msg.device}` : msg.device;
      const parsed = parseTree(msg.xml);
      if (!parsed) { showOverlay('Could not parse node tree.'); return; }
      defaultCollapse(parsed, 0);
      rootNode = parsed;
      typeColorMap.clear();
      render();
      break;
    }

    case 'error':
      showOverlay(`Error: ${msg.message}`);
      break;
  }
});

// ── Controls ──────────────────────────────────────────────────────────────────

btnTreemap.addEventListener('click', () => {
  mode = 'treemap';
  btnTreemap.classList.add('active');
  btnTree.classList.remove('active');
  render();
});

btnTree.addEventListener('click', () => {
  mode = 'tree';
  btnTree.classList.add('active');
  btnTreemap.classList.remove('active');
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

btnTreemap.classList.add('active');
applySize();
showOverlay('Run  Kopytko: Open Node Tree Explorer  to load the SG tree from the active device.');

/**
 * SG Node Tree Explorer — Icicle (partition flame chart) + collapsible tree.
 *
 * Icicle chart: Canvas 2D, D3 partition layout.  Each row = one depth level,
 * cell width ∝ subtree size.  Click to focus a subtree, scroll/drag to pan+zoom.
 * This replaces the treemap — icicle is the right model for tree-shaped data.
 *
 * Tree: SVG, D3 tree layout, collapse/expand per node.
 */

import { hierarchy, partition as d3partition } from 'd3-hierarchy';
import { tree as d3tree, type HierarchyNode } from 'd3-hierarchy';
import { select, type Selection } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
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
  size:      number;           // 1 + all descendants
  _collapsed?: boolean;
}

interface IcRect {
  x0: number; y0: number; x1: number; y1: number;
  data: SgNode;
  depth: number;
}

// ── DOM ───────────────────────────────────────────────────────────────────────

const mainEl       = document.getElementById('main')!;
const breadcrumb   = document.getElementById('breadcrumb')!;
const overlayEl    = document.getElementById('overlay')!;
const tooltipEl    = document.getElementById('tooltip')!;
const nodeCountEl  = document.getElementById('node-count')!;
const channelLabel = document.getElementById('channel-label')!;
const searchInput  = document.getElementById('search') as HTMLInputElement;
const btnIcicle    = document.getElementById('btn-treemap') as HTMLButtonElement; // reused id
const btnTree      = document.getElementById('btn-tree') as HTMLButtonElement;
const btnRefresh   = document.getElementById('btn-refresh') as HTMLButtonElement;

// ── Canvas + SVG — referenced from HTML template (not created dynamically) ────
// Dynamic position:absolute children can bleed past overflow:hidden in some
// VS Code webview builds. The elements live in the HTML and are laid out by
// CSS Grid, which is always contained.

const icCanvas  = document.getElementById('ic-canvas') as HTMLCanvasElement;
const ctx       = icCanvas.getContext('2d')!;
const treeSvgEl = document.getElementById('tree-svg') as unknown as SVGSVGElement;

// ── Sizing — explicit JS (reliable in VS Code webviews) ───────────────────────

function canvasW(): number { return mainEl.clientWidth  || 800; }
function canvasH(): number { return mainEl.clientHeight || 600; }

function applySize(): void {
  const W = canvasW(), H = canvasH();
  icCanvas.width  = W; icCanvas.height = H;
  icCanvas.style.width  = W + 'px';
  icCanvas.style.height = H + 'px';
  treeSvgEl.setAttribute('width',   W + 'px');
  treeSvgEl.setAttribute('height',  H + 'px');
  treeSvgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
}

new ResizeObserver(() => { applySize(); onResize(); }).observe(mainEl);
window.addEventListener('resize', () => { applySize(); onResize(); });

/** On resize: recompute layout (width changed) but KEEP pan/zoom state. */
function onResize(): void {
  if (!rootNode) return;
  if (mode === 'icicle') {
    // Recompute layout with new canvas width, but don't reset icOffX/Y/Scale.
    const focus = focusNode ?? rootNode;
    icRects = computeIcicle(focus);
    drawIcicle();
  } else {
    // Tree: SVG fills via CSS; just redraw without resetting the stored zoom.
    renderTree(rootNode);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

type Mode = 'icicle' | 'tree';
let mode: Mode  = 'icicle';
let rootNode: SgNode | null = null;
let filterText  = '';
let focusNode: SgNode | null = null;   // icicle focused subtree
let icRects: IcRect[] = [];

// Icicle pan/zoom
let icOffX = 0, icOffY = 0, icScaleX = 1, icScaleY = 1;
let icDragStart: { ex: number; ey: number; ox: number; oy: number } | null = null;
let icDragMoved = false;

// SVG tree
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
  const n: SgNode = { type: el.tagName, name: attrs['name'], sn: attrs['_sn'] ?? el.tagName, attrs, children, size: 0 };
  calcSize(n);
  return n;
}

function calcSize(n: SgNode): void {
  n.size = 1 + n.children.reduce((s, c) => s + c.size, 0);
}

function nodeLabel(n: SgNode): string {
  return n.name ? `${n.type}  "${n.name}"` : n.type;
}

// Collapse tree starting at depth 3 (depths 0/1/2 always open)
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
    const shown = Object.entries(n.attrs)
      .filter(([k]) => !['_sn','osref','bscref','_psn'].includes(k))
      .slice(0, 10).map(([k, v]) => `<span class="tt-attr">${k}:</span> ${v}`).join('<br>');
    tooltipEl.innerHTML = `<div class="tt-type">${nodeLabel(n)}</div>${shown ? `<br>${shown}` : ''}`
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

// ── ICICLE CHART (Canvas 2D, D3 partition) ────────────────────────────────────

const ROW_H = 22;   // pixels per depth level

function computeIcicle(focus: SgNode): IcRect[] {
  const W = canvasW();
  const maxDepth = 60;  // generous ceiling

  const layout = d3partition<SgNode>()
    .size([W, (maxDepth + 1) * ROW_H])
    .padding(1)
    .round(true);

  const hier = hierarchy(focus, d => d.children.length ? d.children : null)
    .sum(d => d.children.length === 0 ? 1 : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  layout(hier);

  const rects: IcRect[] = [];
  for (const d of hier.descendants()) {
    const w = d.x1 - d.x0;
    if (w < 0.5) continue;   // skip sub-pixel cells
    rects.push({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, data: d.data, depth: d.depth });
  }
  return rects;
}

function drawIcicle(): void {
  const W = canvasW(), H = canvasH();
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(icOffX, icOffY);
  ctx.scale(icScaleX, icScaleY);

  for (const r of icRects) {
    const cw = r.x1 - r.x0, ch = r.y1 - r.y0;
    if (cw * icScaleX < 0.3) continue;

    const color = colorFor(r.data.type);
    const alpha  = r.depth === 0 ? 0.4 : 0.75 - r.depth * 0.02;
    ctx.fillStyle = hexRgba(color, Math.max(0.3, alpha));
    ctx.fillRect(r.x0, r.y0, cw, ch);

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth   = 1 / icScaleX;
    ctx.strokeRect(r.x0, r.y0, cw, ch);

    // Labels only when cell is wide enough on screen
    const screenW = cw * icScaleX;
    if (screenW < 28) continue;

    const fontSize = Math.min(12, ROW_H * 0.58) / icScaleY;
    ctx.font      = `${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor   = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur    = 2 / icScaleX;
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

    const maxChars = Math.floor((cw - 6) / (fontSize * 0.58));
    let text = r.data.type;
    if (r.data.name && maxChars > 8) text += `  "${r.data.name}"`;
    if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…';

    ctx.fillText(text, r.x0 + 4, r.y0 + fontSize + (ch - fontSize) / 2);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function renderIcicle(resetView = true): void {
  const focus = focusNode ?? rootNode!;
  icRects = computeIcicle(focus);
  if (resetView) { icOffX = 0; icOffY = 0; icScaleX = 1; icScaleY = 1; }
  drawIcicle();
  buildBreadcrumb();
}

function buildBreadcrumb(): void {
  breadcrumb.innerHTML = '';
  if (!rootNode) return;

  // Build path from root to focusNode
  const path: SgNode[] = [];
  function findPath(n: SgNode, target: SgNode | null): boolean {
    path.push(n);
    if (n === target || target === null) return true;
    for (const c of n.children) { if (findPath(c, target)) return true; }
    path.pop();
    return false;
  }
  findPath(rootNode, focusNode);

  path.forEach((n, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep'; sep.textContent = '›';
      breadcrumb.appendChild(sep);
    }
    const crumb = document.createElement('span');
    crumb.className = `crumb${i === path.length - 1 ? ' current' : ''}`;
    crumb.textContent = nodeLabel(n);
    if (i < path.length - 1) {
      const captured = n;
      crumb.addEventListener('click', () => { focusNode = captured; renderIcicle(); });
    }
    breadcrumb.appendChild(crumb);
  });
}

// ── Icicle interaction (drag + scroll to pan/zoom, click to focus) ─────────────

icCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  // Zoom horizontally only (vertical row heights stay fixed)
  const mx = e.offsetX;
  icOffX = mx - (mx - icOffX) * factor;
  icScaleX = Math.max(0.1, Math.min(50, icScaleX * factor));
  drawIcicle();
}, { passive: false });

icCanvas.addEventListener('mousedown', e => {
  // Only start drag on left button
  if (e.button !== 0) return;
  icDragStart = { ex: e.clientX, ey: e.clientY, ox: icOffX, oy: icOffY };
  icDragMoved = false;
  icCanvas.style.cursor = 'grabbing';
  // Prevent text selection while dragging
  e.preventDefault();
});

// Use the canvas element for move/up to avoid interfering with toolbar clicks
icCanvas.addEventListener('mousemove', e => {
  if (!icDragStart) {
    // Hover tooltip
    const lx = (e.offsetX - icOffX) / icScaleX;
    const ly = (e.offsetY - icOffY) / icScaleY;
    let found: SgNode | null = null;
    for (let i = icRects.length - 1; i >= 0; i--) {
      const r = icRects[i];
      if (lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1) { found = r.data; break; }
    }
    if (found) scheduleTooltip(found, e.clientX, e.clientY);
    else hideTooltip();
    return;
  }
  const dx = e.clientX - icDragStart.ex;
  const dy = e.clientY - icDragStart.ey;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) icDragMoved = true;
  icOffX = icDragStart.ox + dx;
  icOffY = icDragStart.oy + dy;
  drawIcicle();
});

icCanvas.addEventListener('mouseup', e => {
  const wasDrag = icDragMoved;
  icDragStart = null; icDragMoved = false;
  icCanvas.style.cursor = 'default';
  if (!wasDrag && e.button === 0 && rootNode) {
    // Click: focus the clicked node
    const lx = (e.offsetX - icOffX) / icScaleX;
    const ly = (e.offsetY - icOffY) / icScaleY;
    for (let i = icRects.length - 1; i >= 0; i--) {
      const r = icRects[i];
      if (lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1) {
        if (r.data.children.length > 0) {
          focusNode = r.data;
          renderIcicle();
        }
        break;
      }
    }
  }
});

icCanvas.addEventListener('mouseleave', () => {
  hideTooltip();
  // Don't reset drag — user might re-enter
});

// Double-click: go up one level
icCanvas.addEventListener('dblclick', () => {
  if (!rootNode) return;
  if (!focusNode || focusNode === rootNode) return;
  // Find parent of focusNode
  function findParent(n: SgNode, target: SgNode): SgNode | null {
    for (const c of n.children) {
      if (c === target) return n;
      const r = findParent(c, target);
      if (r) return r;
    }
    return null;
  }
  focusNode = findParent(rootNode, focusNode) ?? null;
  renderIcicle();
});

// ── TREE (SVG) ────────────────────────────────────────────────────────────────

function renderTree(root: SgNode): void {
  const svg = select(treeSvgEl as Element);
  svg.selectAll('*').remove();
  breadcrumb.innerHTML = '';

  const W = canvasW(), H = canvasH();

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
    const matches = (n: SgNode) => !q || n.type.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q);

    nodeG.append('circle')
      .attr('r', R)
      .attr('fill', d => {
        const n = d.data;
        if (!matches(n)) return 'transparent';
        if (n._collapsed && n.children.length) return colorFor(n.type);
        return hexRgba(colorFor(n.type), n.children.length ? 0.2 : 0.25);
      })
      .attr('stroke', d => colorFor(d.data.type))
      .attr('stroke-width', d => d.data.children.length ? 1.5 : 1)
      .style('cursor', d => d.data.children.length ? 'pointer' : 'default')
      .on('click', (_e, d) => {
        if (!d.data.children.length) return;
        d.data._collapsed = !d.data._collapsed;
        update();
      })
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
      .attr('fill', d => matches(d.data) ? 'var(--vscode-editor-foreground,#ccc)' : 'rgba(200,200,200,0.25)')
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
    case 'loading':
      showOverlay('Fetching node tree…', true);
      break;
    case 'tree': {
      channelLabel.textContent = msg.channelTitle ? `${msg.channelTitle} @ ${msg.device}` : msg.device;
      const parsed = parseTree(msg.xml);
      if (!parsed) { showOverlay('Could not parse node tree.'); return; }
      defaultCollapse(parsed, 0);
      rootNode = parsed;
      typeColorMap.clear();
      focusNode = null;
      render();
      break;
    }
    case 'error':
      showOverlay(`Error: ${msg.message}`);
      break;
  }
});

// ── Controls ──────────────────────────────────────────────────────────────────

btnIcicle.addEventListener('click', () => {
  mode = 'icicle';
  btnIcicle.classList.add('active');
  btnTree.classList.remove('active');
  render();
});

btnTree.addEventListener('click', () => {
  mode = 'tree';
  btnTree.classList.add('active');
  btnIcicle.classList.remove('active');
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

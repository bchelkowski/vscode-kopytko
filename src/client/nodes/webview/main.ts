/**
 * SG Node Tree Explorer — treemap + collapsible dendrogram.
 * D3-based, fills the full editor tab, zoomable/pannable in both modes.
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
  type:     string;
  name?:    string;
  extends?: string;
  sn:       string;
  attrs:    Record<string, string>;
  children: SgNode[];
  size:     number;          // 1 + descendant count
  _collapsed?: boolean;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const mainEl       = document.getElementById('main')!;
const canvasEl     = document.getElementById('canvas') as unknown as SVGSVGElement;
const breadcrumb   = document.getElementById('breadcrumb')!;
const overlayEl    = document.getElementById('overlay')!;
const tooltipEl    = document.getElementById('tooltip')!;
const nodeCountEl  = document.getElementById('node-count')!;
const channelLabel = document.getElementById('channel-label')!;
const searchInput  = document.getElementById('search') as HTMLInputElement;
const btnTreemap   = document.getElementById('btn-treemap') as HTMLButtonElement;
const btnTree      = document.getElementById('btn-tree') as HTMLButtonElement;
const btnRefresh   = document.getElementById('btn-refresh') as HTMLButtonElement;

// ── Canvas sizing (explicit JS — reliable across VS Code webview hosts) ───────

function canvasSize(): { W: number; H: number } {
  return { W: mainEl.clientWidth || 800, H: mainEl.clientHeight || 600 };
}

function applySize(): void {
  const { W, H } = canvasSize();
  canvasEl.setAttribute('width',   W + 'px');
  canvasEl.setAttribute('height',  H + 'px');
  canvasEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
}

new ResizeObserver(() => { applySize(); if (rootNode) render(); }).observe(mainEl);
window.addEventListener('resize', () => { applySize(); if (rootNode) render(); });

// ── State ─────────────────────────────────────────────────────────────────────

type Mode = 'treemap' | 'tree';
let mode: Mode   = 'treemap';
let rootNode: SgNode | null = null;
let filterText   = '';
let tmStack: SgNode[] = [];   // treemap drill-down path

// D3 zoom handles (one per mode, reset when mode changes)
let zoomBeh: ZoomBehavior<SVGSVGElement, unknown> | null = null;

// ── Colour palette — bright, readable on dark backgrounds ─────────────────────

const PALETTE = [
  '#4fc1ff', // VS Code blue highlight
  '#4ec9b0', // teal
  '#dcdcaa', // yellow
  '#ce9178', // orange
  '#c586c0', // purple
  '#6a9955', // green
  '#f44747', // red
  '#9cdcfe', // light blue
  '#d7ba7d', // gold
  '#b5cea8', // light green
  '#e8a97e', // salmon
  '#7fb3d3', // steel blue
];

const typeColorMap = new Map<string, string>();
function colorFor(type: string): string {
  if (!typeColorMap.has(type)) {
    typeColorMap.set(type, PALETTE[typeColorMap.size % PALETTE.length]);
  }
  return typeColorMap.get(type)!;
}

// ── XML parser (DOMParser in webview context) ─────────────────────────────────

function parseTree(xml: string): SgNode | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return null;
  const allNodes = doc.querySelector('All_Nodes');
  if (!allNodes) return null;

  const topChildren = Array.from(allNodes.children).map(parseElement);
  if (!topChildren.length) return null;

  // If there is exactly one top-level child, use it as root; otherwise wrap.
  if (topChildren.length === 1) return topChildren[0];

  const root: SgNode = { type: 'SceneGraph', sn: 'root', attrs: {}, children: topChildren, size: 0 };
  computeSize(root);
  return root;
}

function parseElement(el: Element): SgNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  const children = Array.from(el.children).map(parseElement);
  const node: SgNode = {
    type:     el.tagName,
    name:     attrs['name'],
    extends:  attrs['extends'],
    sn:       attrs['_sn'] ?? el.tagName + Math.random(),
    attrs,
    children,
    size: 0,
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

// ── Overlay ───────────────────────────────────────────────────────────────────

function showOverlay(text: string, spinner = false): void {
  overlayEl.innerHTML = spinner
    ? `<div class="spin"></div><span>${text}</span>`
    : `<span>${text}</span>`;
  overlayEl.classList.add('visible');
}
function hideOverlay(): void { overlayEl.classList.remove('visible'); }

// ── Tooltip ───────────────────────────────────────────────────────────────────

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

// ── TREEMAP ───────────────────────────────────────────────────────────────────

function renderTreemap(root: SgNode): void {
  if (tmStack.length === 0) tmStack = [root];
  const current = tmStack[tmStack.length - 1];

  const svg = select(canvasEl as Element);
  svg.selectAll('*').remove();
  breadcrumb.innerHTML = '';

  const { W, H } = canvasSize();
  if (W < 10 || H < 10) return;

  // Zoom group — the whole treemap is inside this so zoom/pan works
  const zoomG = svg.append('g').attr('class', 'zoom-root');

  // Setup zoom
  if (zoomBeh) { (svg as Selection<SVGSVGElement, unknown, null, undefined>).on('.zoom', null); }
  zoomBeh = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 8])
    .on('zoom', e => zoomG.attr('transform', e.transform));
  (svg as Selection<SVGSVGElement, unknown, null, undefined>).call(zoomBeh);
  // Reset on double-click
  (svg as Selection<SVGSVGElement, unknown, null, undefined>).on('dblclick.zoom', () => {
    (svg as Selection<SVGSVGElement, unknown, null, undefined>)
      .transition().duration(400)
      .call(zoomBeh!.transform, zoomIdentity);
  });

  const layout = d3treemap<SgNode>()
    .tile(treemapSquarify)
    .size([W, H])
    .paddingTop(22)
    .paddingInner(2)
    .paddingOuter(3)
    .round(true);

  const hier = hierarchy(current, d => d.children.length ? d.children : null)
    .sum(d => d.children.length === 0 ? 1 : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  layout(hier);

  const cell = zoomG.selectAll<SVGGElement, HierarchyNode<SgNode>>('g.cell')
    .data(hier.descendants())
    .join('g')
    .attr('class', 'cell')
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  cell.append('rect')
    .attr('width',  d => Math.max(0, d.x1 - d.x0))
    .attr('height', d => Math.max(0, d.y1 - d.y0))
    .attr('fill', d => colorFor(d.data.type))
    .attr('fill-opacity', d => d.depth === 0 ? 0.08 : d.depth === 1 ? 0.85 : 0.65)
    .attr('stroke', d => d.depth === 0 ? 'none' : 'rgba(0,0,0,0.4)')
    .attr('stroke-width', 1)
    .style('cursor', d => (d.depth > 0 && d.data.children.length > 0) ? 'pointer' : 'default')
    .on('click', (_e, d) => {
      if (d.depth === 0 || !d.data.children.length) return;
      tmStack.push(d.data);
      renderTreemap(root);
    })
    .on('mousemove', (e, d) => { if (d.depth > 0) showTooltip(d.data, e.clientX, e.clientY); })
    .on('mouseleave', hideTooltip);

  // Labels — show only when cell is large enough
  cell.each(function(d) {
    if (d.depth === 0) return;
    const w = d.x1 - d.x0, h = d.y1 - d.y0;
    if (w < 40 || h < 18) return;

    const g = select(this as SVGGElement);
    const typeText = w > 100 && d.data.name
      ? d.data.type
      : (d.data.type.length * 7 > w - 8 ? d.data.type.slice(0, Math.floor((w - 12) / 7)) + '…' : d.data.type);

    g.append('text')
      .attr('x', 4).attr('y', 4)
      .attr('dominant-baseline', 'hanging')
      .attr('fill', '#fff')
      .attr('font-size', Math.min(12, Math.max(9, Math.floor(h / 4))))
      .attr('font-weight', '500')
      .style('text-shadow', '0 1px 2px rgba(0,0,0,0.8)')
      .style('pointer-events', 'none')
      .text(typeText);

    if (d.data.name && h >= 30 && w >= 60) {
      const nameText = `"${d.data.name}"`;
      g.append('text')
        .attr('x', 4).attr('y', 18)
        .attr('dominant-baseline', 'hanging')
        .attr('fill', 'rgba(255,255,255,0.65)')
        .attr('font-size', 9)
        .style('text-shadow', '0 1px 2px rgba(0,0,0,0.8)')
        .style('pointer-events', 'none')
        .text(nameText.length * 5.5 > w - 8 ? nameText.slice(0, Math.floor((w - 12) / 5.5)) + '…"' : nameText);
    }

    // Children count badge in bottom-right for containers
    if (d.data.children.length > 0 && w >= 50 && h >= 28) {
      g.append('text')
        .attr('x', w - 4).attr('y', h - 4)
        .attr('text-anchor', 'end')
        .attr('fill', 'rgba(255,255,255,0.45)')
        .attr('font-size', 9)
        .style('pointer-events', 'none')
        .text(`+${d.data.children.length}`);
    }
  });

  // Breadcrumb
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

// ── TREE (collapsible dendrogram) ─────────────────────────────────────────────

function defaultCollapse(n: SgNode, depth: number): void {
  // Collapse nodes with many children or beyond depth 3 by default
  if (depth >= 3 || n.children.length > 8) n._collapsed = true;
  n.children.forEach(c => defaultCollapse(c, depth + 1));
}

function renderTree(root: SgNode): void {
  const svg = select(canvasEl as Element);
  svg.selectAll('*').remove();
  breadcrumb.innerHTML = '';

  const { W, H } = canvasSize();
  if (W < 10 || H < 10) return;

  const zoomG = svg.append('g').attr('class', 'zoom-root');

  if (zoomBeh) { (svg as Selection<SVGSVGElement, unknown, null, undefined>).on('.zoom', null); }
  zoomBeh = d3zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.05, 4])
    .on('zoom', e => zoomG.attr('transform', e.transform));
  (svg as Selection<SVGSVGElement, unknown, null, undefined>).call(zoomBeh)
    .on('dblclick.zoom', () => {
      (svg as Selection<SVGSVGElement, unknown, null, undefined>)
        .transition().duration(400)
        .call(zoomBeh!.transform, zoomIdentity.translate(60, H / 2));
    });

  const q = filterText.toLowerCase();

  function getVisibleChildren(n: SgNode): SgNode[] | undefined {
    return n._collapsed || n.children.length === 0 ? undefined : n.children;
  }

  function update(): void {
    zoomG.selectAll('*').remove();

    const layout = d3tree<SgNode>().nodeSize([28, 260]);
    const hier   = hierarchy<SgNode>(root, getVisibleChildren);
    layout(hier);

    // Center tree vertically on initial render
    let minX = Infinity, maxX = -Infinity;
    hier.each(d => { minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x); });
    const offsetY = H / 2 - (minX + maxX) / 2;
    const offsetX = 40;

    // Links (cubic bezier, horizontal tree)
    zoomG.selectAll('path.link')
      .data(hier.links())
      .join('path')
      .attr('class', 'link')
      .attr('d', d => {
        const sx = d.source.y + offsetX, sy = d.source.x + offsetY;
        const tx = d.target.y + offsetX, ty = d.target.x + offsetY;
        const mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      });

    // Nodes
    const nodeG = zoomG.selectAll<SVGGElement, HierarchyNode<SgNode>>('g.node')
      .data(hier.descendants())
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.y + offsetX},${d.x + offsetY})`);

    const R = 6;

    // Circle
    nodeG.append('circle')
      .attr('r', R)
      .attr('fill', d => {
        const n = d.data;
        const matched = !q || n.type.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q);
        return matched ? colorFor(n.data.type) : 'transparent';
      })
      .attr('stroke', d => colorFor(d.data.type))
      .attr('stroke-width', d => d.data.children.length > 0 ? 1.5 : 1)
      .attr('fill-opacity', d => {
        const n = d.data;
        if (n._collapsed && n.children.length > 0) return 1;
        return n.children.length === 0 ? 0.3 : 0.2;
      })
      .style('cursor', d => d.data.children.length > 0 ? 'pointer' : 'default')
      .on('click', (_e, d) => {
        if (!d.data.children.length) return;
        d.data._collapsed = !d.data._collapsed;
        update();
      })
      .on('mousemove', (e, d) => showTooltip(d.data, e.clientX, e.clientY))
      .on('mouseleave', hideTooltip);

    // Expand/collapse arrow for non-leaf nodes
    nodeG.filter(d => d.data.children.length > 0)
      .append('text')
      .attr('x', 0).attr('y', 0)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', 8)
      .attr('fill', d => colorFor(d.data.type))
      .attr('fill-opacity', 0.9)
      .style('cursor', 'pointer')
      .style('pointer-events', 'none')
      .text(d => d.data._collapsed ? '▶' : '▾');

    // Label
    nodeG.append('text')
      .attr('x', d => d.data.children.length > 0 ? R + 10 : R + 7)
      .attr('y', 0)
      .attr('dominant-baseline', 'central')
      .attr('fill', d => {
        const n = d.data;
        if (!q) return 'var(--vscode-editor-foreground, #cccccc)';
        const matched = n.type.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q);
        return matched ? '#fff' : 'rgba(200,200,200,0.3)';
      })
      .attr('font-size', 12)
      .text(d => {
        const n = d.data;
        const base = nodeLabel(n);
        return n._collapsed && n.children.length > 0 ? `${base}  [${n.size - 1}]` : base;
      });
  }

  update();

  // Initial transform: pan so root is visible
  const initTransform = zoomIdentity.translate(60, H / 2);
  (svg as Selection<SVGSVGElement, unknown, null, undefined>)
    .call(zoomBeh.transform, initTransform);
}

// ── Render dispatcher ─────────────────────────────────────────────────────────

function render(): void {
  if (!rootNode) return;
  hideOverlay();
  applySize();
  if (mode === 'treemap') {
    tmStack = [];
    renderTreemap(rootNode);
  } else {
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
      // Apply default collapse to tree mode (treemap shows everything)
      defaultCollapse(parsed, 0);
      rootNode = parsed;
      typeColorMap.clear();  // reset colours for fresh data
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
showOverlay('Run  Kopytko: Open Node Tree Explorer  to load the SG tree from the connected device.');

/**
 * SG Node Tree Explorer — Icicle (flame chart) visualisation.
 *
 * Canvas 2D, D3 partition layout.
 * - Each row = one depth level, always exactly ROW_H px tall.
 * - Click a cell → focus that subtree (refill full width).
 * - Double-click → go up one level.
 * - Breadcrumb bar shows current path; legend bar shows type colours.
 */

import { hierarchy, partition as d3partition } from 'd3-hierarchy';
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
const btnRefresh    = document.getElementById('btn-refresh') as HTMLButtonElement;
const icCanvas      = document.getElementById('ic-canvas') as HTMLCanvasElement;
const ctx           = icCanvas.getContext('2d')!;

// ── Sizing ────────────────────────────────────────────────────────────────────

function applySize(): void {
  const W = mainEl.clientWidth  || 800;
  const H = mainEl.clientHeight || 600;
  icCanvas.width  = W;
  icCanvas.height = H;
}

new ResizeObserver(() => { applySize(); onResize(); }).observe(mainEl);
window.addEventListener('resize', () => { applySize(); onResize(); });

function onResize(): void {
  if (!rootNode) return;
  icRects = computeIcicle(focusNode ?? rootNode);
  scheduleRedraw();
}

// ── State ─────────────────────────────────────────────────────────────────────

let rootNode:  SgNode | null = null;
let focusNode: SgNode | null = null;
let icRects:   IcRect[]      = [];

let rafPending = false;
function scheduleRedraw(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; drawIcicle(); });
}

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
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
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
        focusNode = (captured === rootNode) ? null : captured;
        renderIcicle();
      });
    }
    breadcrumbBar.appendChild(crumb);
  });
}

// ── Legend ────────────────────────────────────────────────────────────────────

function updateLegend(): void {
  legendBar.innerHTML = '';
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
    entry.appendChild(swatch); entry.appendChild(label);
    legendBar.appendChild(entry);
  }
}

// ── ICICLE CHART (Canvas 2D) ──────────────────────────────────────────────────

const MAX_ROWS = 6;
const ROW_H    = 26;

function computeIcicle(focus: SgNode): IcRect[] {
  const W = icCanvas.width || 800;
  if (!W) return [];

  const layout = d3partition<SgNode>()
    .size([W, MAX_ROWS * ROW_H])
    .padding(1)
    .round(true);

  const hier = hierarchy(focus, d => d.children.length ? d.children : null)
    .sum(d => d.children.length === 0 ? 1 : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  layout(hier);

  // Override D3's y values so every depth level is always exactly ROW_H tall.
  hier.each(d => { d.y0 = d.depth * ROW_H; d.y1 = d.y0 + ROW_H; });

  return hier.descendants()
    .filter(d => d.depth < MAX_ROWS && (d.x1 - d.x0) >= 0.5)
    .map(d => ({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, data: d.data, depth: d.depth }));
}

function drawIcicle(): void {
  const W = icCanvas.width, H = icCanvas.height;
  if (!W || !H) return;

  try { ctx.clearRect(0, 0, W, H); } catch { return; }

  for (const r of icRects) {
    const cw = r.x1 - r.x0, ch = r.y1 - r.y0;

    const color = colorFor(r.data.type);
    const alpha  = Math.max(0.35, 0.82 - r.depth * 0.05);
    ctx.fillStyle = hexRgba(color, alpha);
    ctx.fillRect(r.x0, r.y0, cw, ch);

    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth   = 0.5;
    ctx.strokeRect(r.x0, r.y0, cw, ch);

    if (cw < 24) continue;

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
}

function renderIcicle(): void {
  if (!rootNode) return;
  icRects = computeIcicle(focusNode ?? rootNode);
  drawIcicle();
  updateBreadcrumb();
  updateLegend();
}

// ── Interaction ───────────────────────────────────────────────────────────────

function hitTest(offsetX: number, offsetY: number): SgNode | null {
  for (let i = icRects.length - 1; i >= 0; i--) {
    const r = icRects[i];
    if (offsetX >= r.x0 && offsetX <= r.x1 && offsetY >= r.y0 && offsetY <= r.y1) return r.data;
  }
  return null;
}

function findParent(root: SgNode, target: SgNode): SgNode | null {
  for (const c of root.children) {
    if (c === target) return root;
    const r = findParent(c, target);
    if (r) return r;
  }
  return null;
}

let lastHovered: SgNode | null = null;

icCanvas.addEventListener('click', e => {
  if (!rootNode) return;
  const found = hitTest(e.offsetX, e.offsetY);
  if (!found || !found.children.length || found === (focusNode ?? rootNode)) return;
  focusNode = found;
  lastHovered = null;
  renderIcicle();
});

icCanvas.addEventListener('dblclick', () => {
  if (!rootNode || !focusNode || focusNode === rootNode) return;
  const parent = findParent(rootNode, focusNode);
  focusNode = (parent === rootNode) ? null : parent;
  lastHovered = null;
  renderIcicle();
});

icCanvas.addEventListener('mousemove', e => {
  const found = hitTest(e.offsetX, e.offsetY);
  icCanvas.style.cursor = (found && found.children.length > 0) ? 'pointer' : 'default';
  if (found !== lastHovered) {
    lastHovered = found;
    if (found) scheduleTooltip(found, e.clientX, e.clientY);
    else hideTooltip();
  }
});

icCanvas.addEventListener('mouseleave', () => {
  hideTooltip(); lastHovered = null; icCanvas.style.cursor = 'default';
});

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
      rootNode = parsed;
      focusNode = null;
      typeColorMap.clear();
      applySize();
      hideOverlay();
      renderIcicle();
      nodeCountEl.textContent = `${rootNode.size - 1} nodes`;
      break;
    }
    case 'error': showOverlay(`Error: ${msg.message}`); break;
  }
});

// ── Controls ──────────────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', () => {
  showOverlay('Fetching…', true);
  vscode.postMessage({ kind: 'refresh' });
});

// ── Init ──────────────────────────────────────────────────────────────────────

applySize();
showOverlay('Run  Kopytko: Open Node Tree Explorer  to load from the active device.');

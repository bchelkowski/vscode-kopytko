/**
 * SG Node Tree Explorer — Icicle (flame chart).
 *
 * Canvas 2D + D3 partition. Fixed ROW_H per depth level.
 * Click → focus subtree.  Double-click → go up.
 */

import './styles.css';
import { hierarchy, partition as d3partition } from 'd3-hierarchy';
import type { ExtMsg, WebMsg } from './protocol';

declare function acquireVsCodeApi(): { postMessage(msg: WebMsg): void };
const vscode = acquireVsCodeApi();

// ── Types ─────────────────────────────────────────────────────────────────────

interface SgNode {
  type:     string;
  name?:    string;
  sn:       string;
  attrs:    Record<string, string>;
  children: SgNode[];
  size:     number;
}

interface Rect {
  x0: number; y0: number; x1: number; y1: number;
  node: SgNode;
  depth: number;
}

// ── DOM ───────────────────────────────────────────────────────────────────────

const mainEl        = document.getElementById('main')!;
const breadcrumbBar = document.getElementById('breadcrumb-bar')!;
const legendBar     = document.getElementById('legend-bar')!;
const overlayEl     = document.getElementById('overlay')!;
const tooltipEl     = document.getElementById('tooltip')!;
const nodeCountEl   = document.getElementById('node-count')!;
const channelLabel  = document.getElementById('channel-label')!;
const statusDot     = document.getElementById('status-dot')!;
const btnRefresh    = document.getElementById('btn-refresh') as HTMLButtonElement;
const ic            = document.getElementById('ic-canvas') as HTMLCanvasElement;
const ctx           = ic.getContext('2d')!;

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ROWS = 6;
const ROW_H    = 26;

// ── State ─────────────────────────────────────────────────────────────────────

let root:      SgNode | null = null;
let focus:     SgNode | null = null;
let rects:     Rect[]        = [];
let rafId:     number | null = null;

// ── Colours ───────────────────────────────────────────────────────────────────

const PALETTE = [
  '#4fc1ff','#4ec9b0','#dcdcaa','#ce9178',
  '#c586c0','#6a9955','#f44747','#9cdcfe',
  '#d7ba7d','#b5cea8','#e8a97e','#7fb3d3',
];
const colorMap = new Map<string, string>();
function colorFor(t: string): string {
  if (!colorMap.has(t)) colorMap.set(t, PALETTE[colorMap.size % PALETTE.length]);
  return colorMap.get(t)!;
}
function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────

// Logical (CSS-pixel) canvas size — what layout math, hit-testing, and drawing
// all operate in. The canvas's actual backing store (ic.width/height) is sized
// to logical * devicePixelRatio and the context is scaled to match, so
// rendering is sharp on HiDPI displays / non-100% VS Code zoom instead of the
// browser stretching a 1x-resolution bitmap up to fill the physical pixels.
let logicalW = 0, logicalH = 0;

function resize(): void {
  // Use the canvas's own clientWidth/Height — most accurate after CSS layout.
  const W = ic.clientWidth  || mainEl.clientWidth  || 800;
  const H = ic.clientHeight || mainEl.clientHeight || 400;
  const dpr = window.devicePixelRatio || 1;
  const pixelW = Math.round(W * dpr);
  const pixelH = Math.round(H * dpr);
  if (ic.width !== pixelW || ic.height !== pixelH) {
    ic.width  = pixelW;
    ic.height = pixelH;
  }
  logicalW = W;
  logicalH = H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function showOverlay(msg: string, spin = false): void {
  overlayEl.innerHTML = spin
    ? `<div class="spin"></div><span>${msg}</span>`
    : `<span>${msg}</span>`;
  overlayEl.style.display = 'flex';
}
function hideOverlay(): void {
  overlayEl.style.display = 'none';
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

let ttId: ReturnType<typeof setTimeout> | null = null;
let lastHover: SgNode | null = null;

function showTip(n: SgNode, mx: number, my: number): void {
  if (ttId) clearTimeout(ttId);
  ttId = setTimeout(() => {
    const attrs = Object.entries(n.attrs)
      .filter(([k]) => !['_sn','osref','bscref','_psn'].includes(k))
      .slice(0, 10)
      .map(([k, v]) => `<span class="tt-attr">${k}:</span> ${v}`)
      .join('<br>');
    tooltipEl.innerHTML =
      `<div class="tt-type">${nodeLabel(n)}</div>` +
      (attrs ? `<br>${attrs}` : '') +
      `<br><span class="tt-attr">descendants:</span> ${n.size - 1}`;
    tooltipEl.style.display = 'block';
    const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
    tooltipEl.style.left = `${Math.min(mx + 14, window.innerWidth  - tw - 8)}px`;
    tooltipEl.style.top  = `${Math.min(my + 14, window.innerHeight - th - 8)}px`;
  }, 80);
}
function hideTip(): void {
  if (ttId) clearTimeout(ttId);
  tooltipEl.style.display = 'none';
}

// ── XML → SgNode ──────────────────────────────────────────────────────────────

function nodeLabel(n: SgNode): string {
  return n.name ? `${n.type}  "${n.name}"` : n.type;
}

function parseXml(xml: string): SgNode | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parseerror,parsererror')) return null;
    const all = doc.querySelector('All_Nodes');
    if (!all) return null;
    const tops = Array.from(all.children).map(buildNode);
    if (!tops.length) return null;
    if (tops.length === 1) return tops[0];
    const r: SgNode = { type: 'SceneGraph', sn: 'root', attrs: {}, children: tops, size: 0 };
    r.size = 1 + tops.reduce((s, c) => s + c.size, 0);
    return r;
  } catch (e) {
    console.error('[NodeTree] parseXml error', e);
    return null;
  }
}

function buildNode(el: Element): SgNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  const children = Array.from(el.children).map(buildNode);
  const n: SgNode = {
    type: el.tagName,
    name: attrs['name'],
    sn:   attrs['_sn'] ?? (el.tagName + Math.random()),
    attrs, children,
    size: 1 + children.reduce((s, c) => s + c.size, 0),
  };
  return n;
}

// ── Layout ────────────────────────────────────────────────────────────────────

function computeRects(node: SgNode): Rect[] {
  const W = logicalW;
  if (!W || W < 2) return [];

  try {
    const layout = d3partition<SgNode>()
      .size([W, MAX_ROWS * ROW_H])
      .padding(1)
      .round(true);

    const hier = hierarchy(node, d => d.children.length ? d.children : null)
      .sum(d => d.children.length === 0 ? 1 : 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    layout(hier);

    // Override y: every depth always exactly ROW_H px regardless of tree depth.
    hier.each(d => { d.y0 = d.depth * ROW_H; d.y1 = d.y0 + ROW_H; });

    return hier.descendants()
      .filter(d => d.depth < MAX_ROWS && (d.x1 - d.x0) >= 1)
      .map(d => ({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, node: d.data, depth: d.depth }));
  } catch (e) {
    console.error('[NodeTree] layout error', e);
    return [];
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function draw(): void {
  rafId = null;
  const W = logicalW, H = logicalH;
  if (!W || !H || !ctx) return;

  try {
    ctx.clearRect(0, 0, W, H);

    for (const r of rects) {
      const cw = r.x1 - r.x0, ch = r.y1 - r.y0;
      const alpha = Math.max(0.35, 0.82 - r.depth * 0.05);
      ctx.fillStyle = rgba(colorFor(r.node.type), alpha);
      ctx.fillRect(r.x0, r.y0, cw, ch);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(r.x0, r.y0, cw, ch);

      if (cw < 24) continue;

      const fs = Math.min(12, ROW_H * 0.58);
      ctx.font      = `${fs}px system-ui,sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.shadowColor   = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur    = 2;
      const maxCh = Math.floor((cw - 6) / (fs * 0.58));
      let txt = r.node.type;
      if (r.node.name && maxCh > 8) txt += `  "${r.node.name}"`;
      if (txt.length > maxCh) txt = txt.slice(0, Math.max(1, maxCh - 1)) + '…';
      ctx.fillText(txt, r.x0 + 4, r.y0 + (ch + fs) / 2 - 1);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    }
  } catch (e) {
    console.error('[NodeTree] draw error', e);
  }
}

function scheduleDraw(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(draw);
}

// ── Breadcrumb + Legend ───────────────────────────────────────────────────────

function updateBreadcrumb(): void {
  breadcrumbBar.innerHTML = '';
  if (!root) return;

  const path: SgNode[] = [];
  (function walk(n: SgNode, target: SgNode | null): boolean {
    path.push(n);
    if (n === target || target === null) return true;
    for (const c of n.children) if (walk(c, target)) return true;
    path.pop();
    return false;
  })(root, focus);

  path.forEach((n, i) => {
    if (i > 0) {
      const s = document.createElement('span');
      s.className = 'crumb-sep'; s.textContent = '›';
      breadcrumbBar.appendChild(s);
    }
    const c = document.createElement('span');
    c.className = `crumb${i === path.length - 1 ? ' current' : ''}`;
    c.textContent = nodeLabel(n);
    if (i < path.length - 1) {
      const captured = n;
      c.addEventListener('click', () => {
        focus = (captured === root) ? null : captured;
        render();
      });
    }
    breadcrumbBar.appendChild(c);
  });
}

function updateLegend(): void {
  legendBar.innerHTML = '';
  const counts = new Map<string, number>();
  for (const r of rects) counts.set(r.node.type, (counts.get(r.node.type) ?? 0) + 1);
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([type]) => {
      const e = document.createElement('div');
      e.className = 'legend-entry';
      const sw = document.createElement('div');
      sw.className = 'legend-swatch';
      sw.style.background = colorFor(type);
      const lb = document.createElement('span');
      lb.textContent = type;
      e.appendChild(sw); e.appendChild(lb);
      legendBar.appendChild(e);
    });
}

// ── Main render ───────────────────────────────────────────────────────────────

function render(): void {
  if (!root) return;
  resize();
  rects = computeRects(focus ?? root);
  scheduleDraw();
  updateBreadcrumb();
  updateLegend();
}

// ── Resize observer ───────────────────────────────────────────────────────────

new ResizeObserver(() => {
  if (!root) return;
  resize();
  rects = computeRects(focus ?? root);
  scheduleDraw();
}).observe(mainEl);

// ── Hit test ──────────────────────────────────────────────────────────────────

function hitTest(x: number, y: number): SgNode | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r.node;
  }
  return null;
}

function findParent(from: SgNode, target: SgNode): SgNode | null {
  for (const c of from.children) {
    if (c === target) return from;
    const p = findParent(c, target);
    if (p) return p;
  }
  return null;
}

// ── Canvas events ─────────────────────────────────────────────────────────────

ic.addEventListener('click', e => {
  if (!root) return;
  const n = hitTest(e.offsetX, e.offsetY);
  if (!n || !n.children.length || n === (focus ?? root)) return;
  focus = n;
  lastHover = null;
  render();
});

ic.addEventListener('dblclick', () => {
  if (!root || !focus || focus === root) return;
  const p = findParent(root, focus);
  focus = (p === root) ? null : p;
  lastHover = null;
  render();
});

ic.addEventListener('mousemove', e => {
  const n = hitTest(e.offsetX, e.offsetY);
  ic.style.cursor = (n && n.children.length > 0) ? 'pointer' : 'default';
  if (n !== lastHover) {
    lastHover = n;
    if (n) showTip(n, e.clientX, e.clientY);
    else hideTip();
  }
});

ic.addEventListener('mouseleave', () => {
  hideTip(); lastHover = null; ic.style.cursor = 'default';
});

// ── Messages ──────────────────────────────────────────────────────────────────

window.addEventListener('message', e => {
  const msg = e.data as ExtMsg;
  switch (msg.kind) {
    case 'loading':
      statusDot.className = 'status-dot loading';
      showOverlay('Fetching node tree…', true);
      break;

    case 'tree': {
      showOverlay('Parsing…');
      // Defer heavy work to next tick so overlay renders first.
      setTimeout(() => {
        const parsed = parseXml(msg.xml);
        if (!parsed) {
          statusDot.className = 'status-dot error';
          showOverlay('Could not parse node tree — check the Output channel.');
          return;
        }
        root = parsed;
        focus = null;
        colorMap.clear();
        lastHover = null;
        statusDot.className = 'status-dot ok';
        channelLabel.textContent = msg.channelTitle
          ? `${msg.channelTitle} @ ${msg.device}` : msg.device;
        nodeCountEl.textContent = `${root.size - 1} nodes`;
        resize();
        rects = computeRects(root);
        hideOverlay();
        scheduleDraw();
        updateBreadcrumb();
        updateLegend();
      }, 0);
      break;
    }

    case 'error':
      statusDot.className = 'status-dot error';
      showOverlay(`⚠ ${msg.message}`);
      break;
  }
});

// ── Refresh button ────────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', () => {
  showOverlay('Fetching…', true);
  vscode.postMessage({ kind: 'refresh' });
});

// ── Init ──────────────────────────────────────────────────────────────────────

resize();
showOverlay('Open via Command Palette:  Kopytko: Open Node Tree Explorer');

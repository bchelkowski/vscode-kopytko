/**
 * SceneGraph Tree — formatted XML view + icicle (flame chart).
 *
 * Three node collections (All /query/sgnodes/all, Roots /query/sgnodes/roots,
 * UI /query/app-ui) × two visual representations. XML is the default view;
 * the chosen view is shared across collection switches.
 *
 * XML view: formatted + syntax-coloured, with a right-click Copy XML / Copy
 * Selection menu and a Ctrl/Cmd+F find widget (CSS Custom Highlight API).
 * Chart: Canvas 2D + D3 partition, fixed ROW_H per depth level.
 * Click → focus subtree.  Double-click → go up.
 */

import './styles.css';
import { hierarchy, partition as d3partition } from 'd3-hierarchy';
import { tryFormatXml } from '../../webview/bodyFormat';
import { diffTrees, domToLite, type FieldEdit, type LiteEl } from './xmlDiff';
import type { ExtMsg, NodeCollection, WebMsg } from './protocol';

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

type ViewMode = 'xml' | 'chart';

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
const btnEdit       = document.getElementById('btn-edit') as HTMLButtonElement;
const btnApply      = document.getElementById('btn-apply') as HTMLButtonElement;
const editChip      = document.getElementById('edit-chip')!;
const xmlEditor     = document.getElementById('xml-editor') as HTMLTextAreaElement;
const xmlView       = document.getElementById('xml-view')!;
const ic            = document.getElementById('ic-canvas') as HTMLCanvasElement;
const ctx           = ic.getContext('2d')!;
const collectionButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('#collection-group button'),
);
const viewButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('#view-group button'),
);

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ROWS = 6;
const ROW_H    = 26;

// ── State ─────────────────────────────────────────────────────────────────────

let collection: NodeCollection = 'all';
let viewMode:  ViewMode        = 'xml';
let lastXml:   string | null   = null;
let xmlRendered = false;
let renderedXmlText = '';   // the formatted text currently shown in the XML view

let root:      SgNode | null = null;
let focus:     SgNode | null = null;
let rects:     Rect[]        = [];
let rafId:     number | null = null;

// Edit mode (RALE TrackerTask) — see the "Edit mode" section below.
let editMode        = false;
let editConnecting  = false;
let editBaseline: LiteEl | null = null;
let pendingEdits: FieldEdit[] | null = null;
let keepEditorOnRefresh = false;
let exitArmed = false;   // Exit-while-dirty needs a second click

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
    // Container element per collection: <All_Nodes> (sgnodes/all),
    // <Root_Nodes> (sgnodes/roots), <screen> inside <topscreen> (app-ui).
    const container = doc.querySelector('All_Nodes, Root_Nodes, screen');
    if (!container) return null;
    const tops = Array.from(container.children).map(buildNode);
    if (!tops.length) return null;
    if (tops.length === 1) return tops[0];
    const r: SgNode = { type: 'SceneGraph', sn: 'root', attrs: {}, children: tops, size: 0 };
    r.size = 1 + tops.reduce((s, c) => s + c.size, 0);
    return r;
  } catch (e) {
    console.error('[SceneGraphTree] parseXml error', e);
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

// ── XML view rendering ────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Lightweight XML syntax colorization. Tokenizes tags/declarations with one
 * regex pass and emits spans; everything between tags renders as plain text.
 * Not a validator — unparseable input just comes out less colorful.
 */
function highlightXml(src: string): string {
  const tagRe = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src)) !== null) {
    if (m.index > last) out += `<span class="x-text">${escapeHtml(src.slice(last, m.index))}</span>`;
    if (m[2] === undefined) {
      // <?xml …?> declaration or <!-- comment -->
      out += `<span class="x-punct">${escapeHtml(m[0])}</span>`;
    } else {
      const [, close, name, attrs, selfClose] = m;
      const attrHtml = escapeHtml(attrs).replace(
        /([\w:.-]+)=(&quot;.*?&quot;)/g,
        '<span class="x-attr">$1</span><span class="x-punct">=</span><span class="x-value">$2</span>',
      );
      out += `<span class="x-punct">&lt;${close}</span><span class="x-tag">${name}</span>` +
             attrHtml +
             `<span class="x-punct">${selfClose}&gt;</span>`;
    }
    last = tagRe.lastIndex;
  }
  if (last < src.length) out += `<span class="x-text">${escapeHtml(src.slice(last))}</span>`;
  return out;
}

function renderXml(): void {
  if (!lastXml) return;
  if (!xmlRendered) {
    renderedXmlText = tryFormatXml(lastXml) ?? lastXml;
    xmlView.innerHTML = highlightXml(renderedXmlText);
    xmlRendered = true;
    resetSearchIndex();
  }
  hideOverlay();
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
    console.error('[SceneGraphTree] layout error', e);
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
    console.error('[SceneGraphTree] draw error', e);
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

// ── View mode ─────────────────────────────────────────────────────────────────

function applyViewMode(): void {
  const xml = viewMode === 'xml';
  ic.style.display            = xml ? 'none' : '';
  xmlView.style.display       = xml ? 'block' : 'none';
  breadcrumbBar.style.display = xml ? 'none' : '';
  legendBar.style.display     = xml ? 'none' : '';
  hideTip();
  hideCtxMenu();
  viewButtons.forEach(b => b.classList.toggle('active', b.dataset.view === viewMode));
  updateEditButton();

  if (xml) {
    renderXml();
    if (findOpen) runSearch();
  } else {
    closeFind();
    if (root) render();
    else if (lastXml) showOverlay('Could not parse the node tree — check the Output channel.');
  }
}

// ── Resize observer ───────────────────────────────────────────────────────────

new ResizeObserver(() => {
  if (!root || viewMode !== 'chart') return;
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
      showOverlay('Fetching nodes…', true);
      break;

    case 'tree': {
      // A response for a collection the user has already switched away from.
      if (msg.collection !== collection) return;
      showOverlay('Parsing…');
      // Defer heavy work to next tick so overlay renders first.
      setTimeout(() => {
        if (msg.collection !== collection) return;
        lastXml = msg.xml;
        xmlRendered = false;
        root = parseXml(msg.xml);
        focus = null;
        colorMap.clear();
        lastHover = null;

        if (!root && viewMode === 'chart') {
          statusDot.className = 'status-dot error';
          showOverlay('Could not parse the node tree — check the Output channel.');
          return;
        }

        statusDot.className = 'status-dot ok';
        channelLabel.textContent = msg.channelTitle
          ? `${msg.channelTitle} @ ${msg.device}` : msg.device;
        nodeCountEl.textContent = root ? `${root.size - 1} nodes` : '';
        hideOverlay();
        if (editMode) onTreeWhileEditing();
        else applyViewMode();
        updateEditButton();
      }, 0);
      break;
    }

    case 'error':
      statusDot.className = 'status-dot error';
      showOverlay(`⚠ ${msg.message}`);
      if (editConnecting) {
        editConnecting = false;
        updateEditButton();
      }
      break;

    case 'edit-state':
      onEditState(msg.active, msg.raleVersion, msg.error);
      break;

    case 'apply-result':
      onApplyResult(msg.ok, msg.applied, msg.failures, msg.warnings ?? []);
      break;
  }
});

// ── Toolbar controls ──────────────────────────────────────────────────────────

function requestFetch(): void {
  showOverlay('Fetching…', true);
  vscode.postMessage({ kind: 'refresh', collection });
}

collectionButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (editMode) return; // navigation is blocked while editing
    const next = btn.dataset.collection as NodeCollection;
    if (next === collection) return;
    collection = next;
    collectionButtons.forEach(b => b.classList.toggle('active', b === btn));
    updateEditButton();
    requestFetch();
  });
});

viewButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (editMode) return; // navigation is blocked while editing
    const next = btn.dataset.view as ViewMode;
    if (next === viewMode) return;
    viewMode = next;
    applyViewMode();
  });
});

btnRefresh.addEventListener('click', () => {
  if (editMode) return; // navigation is blocked while editing
  requestFetch();
});

// ── Clipboard ─────────────────────────────────────────────────────────────────

// Routed through the extension host (vscode.env.clipboard) rather than
// navigator.clipboard so it works regardless of webview focus/permission state.
function copyText(text: string): void {
  if (text) vscode.postMessage({ kind: 'copy', text });
}

function selectionText(): string {
  return window.getSelection()?.toString() ?? '';
}

// ── Context menu (XML view) ───────────────────────────────────────────────────

const ctxMenu = document.createElement('div');
ctxMenu.className = 'ctx-menu';
ctxMenu.innerHTML =
  '<div class="ctx-item" data-action="copy-xml">Copy XML</div>' +
  '<div class="ctx-item" data-action="copy-selection">Copy Selection</div>';
document.body.appendChild(ctxMenu);
let ctxVisible = false;

function hideCtxMenu(): void {
  if (!ctxVisible) return;
  ctxMenu.style.display = 'none';
  ctxVisible = false;
}

function showCtxMenu(x: number, y: number): void {
  const selItem = ctxMenu.querySelector<HTMLElement>('[data-action="copy-selection"]')!;
  selItem.classList.toggle('disabled', !selectionText());
  ctxMenu.style.display = 'block';
  ctxVisible = true;
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = `${Math.min(x, window.innerWidth  - mw - 4)}px`;
  ctxMenu.style.top  = `${Math.min(y, window.innerHeight - mh - 4)}px`;
}

xmlView.addEventListener('contextmenu', e => {
  e.preventDefault();
  showCtxMenu(e.clientX, e.clientY);
});

// preventDefault on mousedown so clicking the menu doesn't clear the selection
// (Copy Selection needs it to survive the click).
ctxMenu.addEventListener('mousedown', e => e.preventDefault());
ctxMenu.addEventListener('click', e => {
  const item = (e.target as HTMLElement).closest<HTMLElement>('.ctx-item');
  if (!item || item.classList.contains('disabled')) return;
  if (item.dataset.action === 'copy-xml')            copyText(renderedXmlText || lastXml || '');
  else if (item.dataset.action === 'copy-selection') copyText(selectionText());
  hideCtxMenu();
});

document.addEventListener('mousedown', e => {
  if (ctxVisible && !ctxMenu.contains(e.target as Node)) hideCtxMenu();
});

// ── Find widget (XML view) ────────────────────────────────────────────────────

// Uses the CSS Custom Highlight API so matches highlight without disturbing the
// syntax-coloured spans; matches may span span boundaries (which DOM-wrapping
// can't do). Available in the Chromium that hosts VS Code webviews.
interface DomHighlight { add(r: Range): void; clear(): void; priority: number }
type HighlightCtor = new (...ranges: Range[]) => DomHighlight;
const hlWin = window as unknown as {
  Highlight?: HighlightCtor;
  CSS?: { highlights?: Map<string, DomHighlight> };
};
const findSupported = !!(hlWin.Highlight && hlWin.CSS?.highlights);
const hlAll     = findSupported ? new hlWin.Highlight!() : null;
const hlCurrent = findSupported ? new hlWin.Highlight!() : null;
if (findSupported) {
  hlCurrent!.priority = 1;   // paint the active match over the others
  hlWin.CSS!.highlights!.set('sg-find', hlAll!);
  hlWin.CSS!.highlights!.set('sg-find-current', hlCurrent!);
}

const findBar = document.createElement('div');
findBar.className = 'find-bar';
findBar.innerHTML =
  '<input id="find-input" type="text" placeholder="Find" spellcheck="false" autocomplete="off" />' +
  '<span id="find-count" class="find-count"></span>' +
  '<button class="find-btn" data-find="prev" title="Previous match (Shift+Enter)">▲</button>' +
  '<button class="find-btn" data-find="next" title="Next match (Enter)">▼</button>' +
  '<button class="find-btn" data-find="close" title="Close (Escape)">✕</button>';
mainEl.appendChild(findBar);
const findInput = findBar.querySelector<HTMLInputElement>('#find-input')!;
const findCount = findBar.querySelector<HTMLElement>('#find-count')!;

// Flat text index of the rendered XML → maps global offsets back to text nodes.
let idxNodes: { node: Text; start: number }[] = [];
let idxText  = '';
let idxDirty = true;
let matches: { start: number; end: number }[] = [];
let matchCur = -1;
let findOpen = false;

function resetSearchIndex(): void { idxDirty = true; }

function buildIndex(): void {
  idxNodes = [];
  let text = '';
  const walker = document.createTreeWalker(xmlView, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    idxNodes.push({ node: t, start: text.length });
    text += t.data;
  }
  idxText = text;
  idxDirty = false;
}

function locate(offset: number): { node: Text; offset: number } {
  let lo = 0, hi = idxNodes.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idxNodes[mid].start <= offset) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return { node: idxNodes[ans].node, offset: offset - idxNodes[ans].start };
}

function rangeFor(start: number, end: number): Range {
  const s = locate(start), e = locate(end);
  const r = document.createRange();
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

function runSearch(): void {
  if (!findSupported) return;
  if (idxDirty) buildIndex();
  hlAll!.clear();
  matches = [];
  const q = findInput.value;
  if (q) {
    const hay = idxText.toLowerCase();
    const needle = q.toLowerCase();
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
      matches.push({ start: i, end: i + needle.length });
    }
    for (const m of matches) hlAll!.add(rangeFor(m.start, m.end));
  }
  matchCur = matches.length ? 0 : -1;
  findInput.classList.toggle('no-match', !!q && matches.length === 0);
  showCurrentMatch();
  updateFindCount();
}

function showCurrentMatch(): void {
  if (!findSupported) return;
  hlCurrent!.clear();
  if (matchCur < 0) return;
  const m = matches[matchCur];
  const r = rangeFor(m.start, m.end);
  hlCurrent!.add(r);
  const rect = r.getBoundingClientRect();
  const cont = xmlView.getBoundingClientRect();
  if (rect.height && (rect.top < cont.top + 24 || rect.bottom > cont.bottom - 24)) {
    xmlView.scrollTop += (rect.top - cont.top) - cont.height / 2 + rect.height / 2;
  }
}

function updateFindCount(): void {
  findCount.textContent = matches.length
    ? `${matchCur + 1} of ${matches.length}`
    : (findInput.value ? 'No results' : '');
}

function stepMatch(delta: number): void {
  if (!matches.length) return;
  matchCur = (matchCur + delta + matches.length) % matches.length;
  showCurrentMatch();
  updateFindCount();
}

function openFind(): void {
  if (viewMode !== 'xml') return;
  findOpen = true;
  findBar.style.display = 'flex';
  findInput.focus();
  findInput.select();
  runSearch();
}

function closeFind(): void {
  if (!findOpen) return;
  findOpen = false;
  findBar.style.display = 'none';
  if (findSupported) { hlAll!.clear(); hlCurrent!.clear(); }
  matches = [];
  matchCur = -1;
}

findInput.addEventListener('input', runSearch);
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')       { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
findBar.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.find-btn');
  if (!btn) return;
  if (btn.dataset.find === 'prev')       stepMatch(-1);
  else if (btn.dataset.find === 'next')  stepMatch(1);
  else if (btn.dataset.find === 'close') closeFind();
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    if (viewMode === 'xml' && findSupported && !editMode) { e.preventDefault(); openFind(); }
  } else if (e.key === 'Escape' && ctxVisible) {
    hideCtxMenu();
  }
});

xmlView.addEventListener('scroll', hideCtxMenu);

// ── Edit mode (RALE TrackerTask) ──────────────────────────────────────────────
//
// Available on the UI collection + XML view only. While active, navigation
// (collections, views, refresh) is blocked; the read-only <pre> becomes the
// highlight layer under a transparent <textarea>. Edits are validated with
// DOMParser + diffTrees on a debounce; Apply posts the field edits to the
// extension host, which drives the TrackerTask connection.

function updateEditButton(): void {
  const available = collection === 'ui' && viewMode === 'xml' && !!lastXml;
  btnEdit.disabled = !editMode && (!available || editConnecting);
}

function setChip(text: string | null, cls: '' | 'dirty' | 'invalid' | 'ok' = ''): void {
  if (text === null) {
    editChip.classList.add('hidden');
    return;
  }
  editChip.classList.remove('hidden', 'dirty', 'invalid', 'ok');
  if (cls) editChip.classList.add(cls);
  editChip.textContent = text;
  editChip.title = text;
}

/** Parse XML text into the LiteEl tree rooted at the app-ui <screen>. */
function liteFromText(text: string): LiteEl | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parseerror,parsererror')) return null;
    const container = doc.querySelector('screen');
    if (!container) return null;
    return domToLite(container);
  } catch {
    return null;
  }
}

btnEdit.addEventListener('click', () => {
  if (editMode) requestExitEdit();
  else requestEnterEdit();
});

function requestEnterEdit(): void {
  if (editConnecting) return;
  editConnecting = true;
  updateEditButton();
  showOverlay('Connecting to TrackerTask…', true);
  vscode.postMessage({ kind: 'edit-enter' });
}

function requestExitEdit(): void {
  if (pendingEdits?.length && !exitArmed) {
    exitArmed = true;
    setChip('Unapplied changes — click Exit again to discard', 'invalid');
    return;
  }
  vscode.postMessage({ kind: 'edit-exit' });
  leaveEditUi(null);
}

function onEditState(active: boolean, raleVersion?: string, error?: string): void {
  editConnecting = false;
  if (active) {
    enterEditUi(raleVersion);
  } else if (editMode) {
    // Connection lost (or host-side exit) while editing.
    leaveEditUi(error ?? null);
  } else {
    // Failed to connect.
    hideOverlay();
    setChip(error ? `⚠ ${error}` : null, 'invalid');
    updateEditButton();
  }
}

function enterEditUi(raleVersion?: string): void {
  editMode = true;
  exitArmed = false;
  keepEditorOnRefresh = false;
  pendingEdits = null;
  closeFind();
  hideCtxMenu();
  hideOverlay();

  renderXml(); // make sure renderedXmlText/pre match the baseline
  editBaseline = liteFromText(renderedXmlText);
  xmlEditor.value = renderedXmlText;
  xmlEditor.scrollTop = xmlView.scrollTop;
  xmlEditor.scrollLeft = xmlView.scrollLeft;

  mainEl.classList.add('editing');
  collectionButtons.forEach(b => { b.disabled = true; });
  viewButtons.forEach(b => { b.disabled = true; });
  btnRefresh.disabled = true;
  btnEdit.textContent = 'Exit Edit';
  btnEdit.classList.add('active');
  btnEdit.title = 'Exit Edit mode (discards unapplied changes)';
  btnApply.classList.remove('hidden');
  btnApply.disabled = true;
  setChip(raleVersion ? `RALE ${raleVersion} — no changes` : 'no changes');
  updateEditButton();
  xmlEditor.focus();

  if (!editBaseline) {
    setChip('⚠ Could not parse the current tree — refresh and retry', 'invalid');
  }
}

function leaveEditUi(error: string | null): void {
  editMode = false;
  exitArmed = false;
  pendingEdits = null;
  editBaseline = null;
  keepEditorOnRefresh = false;
  if (editDebounce !== null) { clearTimeout(editDebounce); editDebounce = null; }

  mainEl.classList.remove('editing');
  collectionButtons.forEach(b => { b.disabled = false; });
  viewButtons.forEach(b => { b.disabled = false; });
  btnRefresh.disabled = false;
  btnEdit.textContent = 'Edit';
  btnEdit.classList.remove('active');
  btnEdit.title = 'Edit node fields on the running app via RALE TrackerTask (UI collection, XML view only)';
  btnApply.classList.add('hidden');
  setChip(error ? `⚠ ${error}` : null, error ? 'invalid' : '');

  // Restore the read-only render of the baseline.
  xmlRendered = false;
  renderXml();
  updateEditButton();
}

// ── validation (debounced on input) ──────────────────────────────────────────

let editDebounce: ReturnType<typeof setTimeout> | null = null;
let highlightScheduled = false;

/**
 * The textarea's own text is transparent — the <pre> underneath paints the
 * glyphs — so it must repaint on every keystroke, not on the validation
 * debounce. rAF-throttled; very large documents drop syntax colors for a
 * plain-text layer to keep typing responsive.
 */
function scheduleHighlight(): void {
  if (highlightScheduled) return;
  highlightScheduled = true;
  requestAnimationFrame(() => {
    highlightScheduled = false;
    if (!editMode) return;
    repaintHighlightLayer(xmlEditor.value);
  });
}

const PLAIN_TEXT_THRESHOLD = 300_000;

function repaintHighlightLayer(text: string): void {
  if (text.length > PLAIN_TEXT_THRESHOLD) xmlView.textContent = text;
  else xmlView.innerHTML = highlightXml(text);
  resetSearchIndex();
  xmlView.scrollTop = xmlEditor.scrollTop;
  xmlView.scrollLeft = xmlEditor.scrollLeft;
}

xmlEditor.addEventListener('input', () => {
  exitArmed = false;
  scheduleHighlight();
  if (editDebounce !== null) clearTimeout(editDebounce);
  editDebounce = setTimeout(validateEdits, 300);
});

xmlEditor.addEventListener('scroll', () => {
  xmlView.scrollTop = xmlEditor.scrollTop;
  xmlView.scrollLeft = xmlEditor.scrollLeft;
});

xmlEditor.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    applyEdits();
  }
});

function validateEdits(): void {
  editDebounce = null;
  if (!editMode) return;

  const text = xmlEditor.value;
  pendingEdits = null;
  btnApply.disabled = true;

  if (!editBaseline) {
    setChip('⚠ No baseline to diff against — refresh and retry', 'invalid');
    return;
  }
  const edited = liteFromText(text);
  if (!edited) {
    setChip('invalid XML', 'invalid');
    return;
  }
  const result = diffTrees(editBaseline, edited);
  if (!result.ok) {
    setChip(result.error, 'invalid');
    return;
  }
  if (result.edits.length === 0) {
    setChip('no changes');
    return;
  }
  pendingEdits = result.edits;
  btnApply.disabled = false;
  setChip(`${result.edits.length} field change(s) — Apply to push`, 'dirty');
}

// ── apply ─────────────────────────────────────────────────────────────────────

btnApply.addEventListener('click', applyEdits);

function applyEdits(): void {
  if (!editMode || !pendingEdits?.length) return;
  const edits = pendingEdits;
  pendingEdits = null;
  btnApply.disabled = true;
  setChip(`Applying ${edits.length} change(s)…`);
  vscode.postMessage({ kind: 'apply-edits', edits });
}

function onApplyResult(
  ok: boolean,
  applied: number,
  failures: { field: string; path: number[]; message: string }[],
  warnings: string[],
): void {
  if (!editMode) return;
  if (ok) {
    keepEditorOnRefresh = false;
    if (warnings.length > 0) {
      setChip(`Applied ${applied} change(s) — ⚠ ${warnings[0]}`, 'dirty');
    } else {
      setChip(`Applied ${applied} change(s)`, 'ok');
    }
  } else {
    // Keep the user's text through the post-apply refresh so failed edits
    // re-diff against the device's new state instead of being wiped.
    keepEditorOnRefresh = true;
    const first = failures[0];
    setChip(
      `Applied ${applied}, ${failures.length} failed — ${first.field}: ${first.message}`,
      'invalid',
    );
  }
}

/** A post-apply refresh arrived while editing: rebase the editor on it. */
function onTreeWhileEditing(): void {
  if (!lastXml) return;
  renderedXmlText = tryFormatXml(lastXml) ?? lastXml;
  editBaseline = liteFromText(renderedXmlText);

  if (keepEditorOnRefresh) {
    keepEditorOnRefresh = false;
    repaintHighlightLayer(xmlEditor.value);
    validateEdits(); // re-diff the kept text against the new baseline
  } else {
    xmlEditor.value = renderedXmlText;
    repaintHighlightLayer(renderedXmlText);
    xmlRendered = true;
    if (!editChip.classList.contains('ok')) setChip('no changes');
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

resize();
applyViewMode();
showOverlay('Open via Command Palette:  Kopytko: Open SceneGraph Tree');

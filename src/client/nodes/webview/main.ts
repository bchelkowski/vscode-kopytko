import { hierarchy, treemap, treemapSquarify, tree as d3tree } from 'd3-hierarchy';
import { select, type Selection } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import type { ExtMsg, WebMsg } from './protocol';

declare function acquireVsCodeApi(): { postMessage(msg: WebMsg): void };
const vscode = acquireVsCodeApi();

// ── Types ─────────────────────────────────────────────────────────────────────

interface SgNode {
  type: string;
  name?: string;
  extends?: string;
  sn: string;
  attrs: Record<string, string>;
  children: SgNode[];
  /** Count of all descendants + 1 (self). Used by treemap sizing. */
  size: number;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas       = document.getElementById('canvas') as unknown as SVGSVGElement;
const overlay      = document.getElementById('overlay')!;
const tooltip      = document.getElementById('tooltip')!;
const breadcrumb   = document.getElementById('breadcrumb')!;
const nodeCountEl  = document.getElementById('node-count')!;
const channelLabel = document.getElementById('channel-label')!;
const searchInput  = document.getElementById('search') as HTMLInputElement;
const btnTreemap   = document.getElementById('btn-treemap') as HTMLButtonElement;
const btnTree      = document.getElementById('btn-tree') as HTMLButtonElement;
const btnRefresh   = document.getElementById('btn-refresh') as HTMLButtonElement;

// ── State ─────────────────────────────────────────────────────────────────────

type Mode = 'treemap' | 'tree';
let mode: Mode      = 'treemap';
let rootNode: SgNode | null = null;
let filterText      = '';
let tmZoomStack: SgNode[] = [];   // zoom path for treemap drill-down

// ── Color palette ─────────────────────────────────────────────────────────────

const PALETTE = [
  '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
  '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
];
const typeColor = new Map<string, string>();
function colorFor(type: string): string {
  if (!typeColor.has(type)) {
    typeColor.set(type, PALETTE[typeColor.size % PALETTE.length]);
  }
  return typeColor.get(type)!;
}

// ── XML parser (runs in webview, DOMParser available) ─────────────────────────

function parseTree(xml: string): SgNode | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return null;

  const allNodes = doc.querySelector('All_Nodes');
  if (!allNodes) return null;

  // The first element child is the tree root (Default node or MainScene).
  // Wrap in a synthetic root if there are multiple top-level children.
  const topChildren = Array.from(allNodes.children);
  if (topChildren.length === 0) return null;

  const syntheticRoot: SgNode = {
    type: 'SceneGraph',
    sn: 'root',
    attrs: {},
    children: topChildren.map(parseElement),
    size: 0,
  };
  fillSize(syntheticRoot);
  return syntheticRoot;
}

function parseElement(el: Element): SgNode {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    attrs[attr.name] = attr.value;
  }
  const children = Array.from(el.children).map(parseElement);
  const node: SgNode = {
    type: el.tagName,
    name: attrs['name'],
    extends: attrs['extends'],
    sn: attrs['_sn'] ?? el.tagName,
    attrs,
    children,
    size: 0,
  };
  fillSize(node);
  return node;
}

function fillSize(node: SgNode): void {
  node.size = 1 + node.children.reduce((s, c) => s + c.size, 0);
}

function totalNodes(node: SgNode): number { return node.size; }

// ── Filter helpers ────────────────────────────────────────────────────────────

function nodeLabel(n: SgNode): string {
  return n.name ? `${n.type} "${n.name}"` : n.type;
}

function matchesFilter(n: SgNode, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  return (
    n.type.toLowerCase().includes(lq) ||
    (n.name ?? '').toLowerCase().includes(lq) ||
    (n.extends ?? '').toLowerCase().includes(lq)
  );
}

// ── Overlay helpers ───────────────────────────────────────────────────────────

function showOverlay(text: string, spinner = false): void {
  overlay.innerHTML = spinner
    ? `<div class="spin"></div><span>${text}</span>`
    : `<span>${text}</span>`;
  overlay.classList.add('visible');
}

function hideOverlay(): void { overlay.classList.remove('visible'); }

// ── Tooltip ───────────────────────────────────────────────────────────────────

function showTooltip(n: SgNode, mx: number, my: number): void {
  const attrs = Object.entries(n.attrs)
    .filter(([k]) => !['_sn','osref','bscref','_psn'].includes(k))
    .slice(0, 8)
    .map(([k, v]) => `<span class="tt-attr">${k}:</span> ${v}`)
    .join('<br>');
  tooltip.innerHTML = `<div class="tt-type">${nodeLabel(n)}</div>${attrs ? `<br>${attrs}` : ''}` +
    `<br><span class="tt-attr">descendants:</span> ${n.size - 1}`;
  tooltip.style.display = 'block';
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  tooltip.style.left = `${Math.min(mx + 12, window.innerWidth  - tw - 8)}px`;
  tooltip.style.top  = `${Math.min(my + 12, window.innerHeight - th - 8)}px`;
}

function hideTooltip(): void { tooltip.style.display = 'none'; }

// ── TREEMAP ───────────────────────────────────────────────────────────────────

function renderTreemap(root: SgNode): void {
  if (tmZoomStack.length === 0) tmZoomStack = [root];
  const current = tmZoomStack[tmZoomStack.length - 1];

  const svg = select(canvas as Element);
  svg.selectAll('*').remove();
  breadcrumb.innerHTML = '';

  const W = canvas.clientWidth || 800;
  const H = canvas.clientHeight || 600;

  const layout = treemap<SgNode>()
    .tile(treemapSquarify)
    .size([W, H])
    .paddingTop(20)
    .paddingInner(1)
    .paddingOuter(2);

  const hier = hierarchy(current, (d) => d.children.length ? d.children : null)
    .sum((d) => d.children.length === 0 ? 1 : 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  layout(hier);

  const g = svg.append('g');

  const cell = g.selectAll<SVGGElement, typeof hier>('g.cell')
    .data(hier.descendants())
    .join('g')
    .attr('class', 'cell')
    .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

  cell.append('rect')
    .attr('class', 'tm-rect')
    .attr('width',  (d) => Math.max(0, d.x1 - d.x0))
    .attr('height', (d) => Math.max(0, d.y1 - d.y0))
    .attr('fill', (d) => colorFor(d.data.type))
    .attr('fill-opacity', (d) => d.depth === 0 ? 0.05 : d.depth === 1 ? 0.9 : 0.7)
    .attr('stroke-width', (d) => d.depth === 0 ? 0 : 1)
    .on('click', (_e, d) => {
      if (d.depth === 0) return;
      if (d.data.children.length === 0) return;
      tmZoomStack.push(d.data);
      renderTreemap(root);
    })
    .on('mousemove', (e, d) => d.depth > 0 && showTooltip(d.data, e.clientX, e.clientY))
    .on('mouseleave', hideTooltip);

  // Labels for cells with enough space
  cell.each(function(d) {
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    if (d.depth === 0 || w < 30 || h < 16) return;
    const label = d.data.name
      ? `${d.data.type}\n"${d.data.name}"`
      : d.data.type;
    const lines = label.split('\n');
    const g2 = select(this as SVGGElement);
    lines.forEach((line, i) => {
      g2.append('text')
        .attr('class', i === 0 ? 'tm-label' : 'tm-sub')
        .attr('x', 3)
        .attr('y', 3 + i * 13)
        .attr('clip-path', `inset(0 0 0 0)`)
        .text(line.length * 6 > w - 6 ? line.slice(0, Math.floor((w - 12) / 6)) + '…' : line);
    });
  });

  // Breadcrumb
  tmZoomStack.forEach((n, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      breadcrumb.appendChild(sep);
    }
    const crumb = document.createElement('span');
    crumb.className = `crumb${i === tmZoomStack.length - 1 ? ' current' : ''}`;
    crumb.textContent = nodeLabel(n);
    if (i < tmZoomStack.length - 1) {
      crumb.addEventListener('click', () => {
        tmZoomStack = tmZoomStack.slice(0, i + 1);
        renderTreemap(root);
      });
    }
    breadcrumb.appendChild(crumb);
  });
}

// ── TREE / DENDROGRAM ─────────────────────────────────────────────────────────

interface TreeD3Node extends SgNode {
  _collapsed?: boolean;
}

let treeZoom: ReturnType<typeof zoom> | null = null;

function renderTree(root: SgNode): void {
  const svg = select(canvas as Element);
  svg.selectAll('*').remove();
  breadcrumb.innerHTML = '';

  const W = canvas.clientWidth  || 800;
  const H = canvas.clientHeight || 600;
  const NODE_R = 5;
  const DX = 200;   // horizontal spacing per level

  // Collapse nodes with many children by default (> 10 direct children).
  function defaultCollapse(n: TreeD3Node): void {
    if (n.children.length > 10) (n as TreeD3Node)._collapsed = true;
    n.children.forEach((c) => defaultCollapse(c as TreeD3Node));
  }
  defaultCollapse(root as TreeD3Node);

  function visibleChildren(n: TreeD3Node): TreeD3Node[] | undefined {
    return n._collapsed || n.children.length === 0
      ? undefined
      : (n.children as TreeD3Node[]);
  }

  const g = svg.append('g').attr('class', 'tree-g');

  // Setup zoom/pan
  treeZoom = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (e) => g.attr('transform', e.transform));
  (svg as unknown as Selection<SVGSVGElement, unknown, null, undefined>)
    .call(treeZoom as never)
    .on('dblclick.zoom', null);

  function update(): void {
    const layout = d3tree<TreeD3Node>()
      .nodeSize([22, DX]);

    const hier = hierarchy<TreeD3Node>(root as TreeD3Node, visibleChildren);
    layout(hier);

    // Center vertically
    let minY = Infinity, maxY = -Infinity;
    hier.each((d) => { minY = Math.min(minY, d.x); maxY = Math.max(maxY, d.x); });
    const initX = (H / 2) - (minY + maxY) / 2;
    const initY = 60;

    g.selectAll('*').remove();

    // Links
    g.selectAll('path.link')
      .data(hier.links())
      .join('path')
      .attr('class', 'link')
      .attr('d', (d) => {
        const sx = d.source.y + initY, sy = d.source.x + initX;
        const tx = d.target.y + initY, ty = d.target.x + initX;
        const mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      });

    // Nodes
    const node = g.selectAll('g.node')
      .data(hier.descendants())
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d) => `translate(${d.y + initY},${d.x + initX})`);

    node.append('circle')
      .attr('r', NODE_R)
      .attr('fill', (d) => {
        const n = d.data;
        return n._collapsed && n.children.length > 0
          ? colorFor(n.type)
          : 'transparent';
      })
      .attr('stroke', (d) => colorFor(d.data.type))
      .on('click', (_e, d) => {
        const n = d.data;
        if (n.children.length === 0) return;
        n._collapsed = !n._collapsed;
        update();
      })
      .on('mousemove', (e, d) => showTooltip(d.data, e.clientX, e.clientY))
      .on('mouseleave', hideTooltip);

    // Expand/collapse triangle indicator
    node.filter((d) => d.data.children.length > 0)
      .append('text')
      .attr('x', NODE_R + 2)
      .attr('dy', '0.35em')
      .attr('fill', (d) => colorFor(d.data.type))
      .attr('font-size', 9)
      .text((d) => d.data._collapsed ? '▶' : '▼')
      .style('cursor', 'pointer')
      .on('click', (_e, d) => { d.data._collapsed = !d.data._collapsed; update(); });

    // Labels
    node.append('text')
      .attr('dy', '0.35em')
      .attr('x', (d) => d.data.children.length > 0 ? NODE_R + 14 : NODE_R + 8)
      .text((d) => {
        const n = d.data;
        const q = filterText.toLowerCase();
        const base = n.name ? `${n.type} "${n.name}"` : n.type;
        return n.children.length > 0 && n._collapsed
          ? `${base} [${n.children.length}]`
          : base;
      })
      .classed('dimmed', (d) => {
        if (!filterText) return false;
        return !matchesFilter(d.data, filterText);
      });
  }

  update();

  // Initial centering
  const transform = zoomIdentity.translate(W * 0.05, H / 2);
  (svg as unknown as Selection<SVGSVGElement, unknown, null, undefined>)
    .call((treeZoom as never), transform);
}

// ── Dispatch render ───────────────────────────────────────────────────────────

function render(): void {
  if (!rootNode) return;
  hideOverlay();
  if (mode === 'treemap') {
    tmZoomStack = [];
    renderTreemap(rootNode);
  } else {
    renderTree(rootNode);
  }
  const total = totalNodes(rootNode) - 1; // exclude synthetic root
  nodeCountEl.textContent = `${total} nodes`;
}

// ── Resize ────────────────────────────────────────────────────────────────────

const resizeObserver = new ResizeObserver(() => { if (rootNode) render(); });
resizeObserver.observe(document.getElementById('main')!);

// ── Extension messages ────────────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  const msg = e.data as ExtMsg;
  switch (msg.kind) {
    case 'loading':
      showOverlay('Fetching node tree…', true);
      break;

    case 'tree': {
      channelLabel.textContent = msg.channelTitle
        ? `${msg.channelTitle} @ ${msg.device}`
        : msg.device;
      const parsed = parseTree(msg.xml);
      if (!parsed) {
        showOverlay('Could not parse node tree.');
        return;
      }
      rootNode = parsed;
      render();
      break;
    }

    case 'error':
      showOverlay(`Error: ${msg.message}`);
      break;
  }
});

// ── Button handlers ───────────────────────────────────────────────────────────

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
  showOverlay('Fetching node tree…', true);
  vscode.postMessage({ kind: 'refresh' });
});

searchInput.addEventListener('input', () => {
  filterText = searchInput.value.trim();
  if (rootNode && mode === 'tree') renderTree(rootNode);
});

// ── Init ──────────────────────────────────────────────────────────────────────

btnTreemap.classList.add('active');
showOverlay('Open from Command Palette: Kopytko: Open Node Tree Explorer');

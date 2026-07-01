/**
 * Kopytko Tools — sidebar quick-nav webview. Three buttons that open the
 * Diagnostics panel, the Perfetto tracing tab, and the SceneGraph Node Tree
 * tab. No data flows in — each button just posts an 'open' message and the
 * extension host executes the corresponding reveal command.
 */

import './styles.css';
import type { WebMsg, NavTarget } from './protocol';

interface VsCodeApi { postMessage(msg: WebMsg): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const ICONS: Record<NavTarget, string> = {
  diagnostics: `<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1.5 12.5h2l2-8 3 11 2-7 1.5 4h2.5"/>
  </svg>`,
  perfetto: `<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1.5 8h3l1.5-4 2.5 8 2-6 1 2h3"/>
    <circle cx="8" cy="8" r="6.25"/>
  </svg>`,
  nodes: `<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="4" cy="3.5" r="1.6"/>
    <circle cx="4" cy="12.5" r="1.6"/>
    <circle cx="12" cy="8" r="1.6"/>
    <path d="M5.4 4.1 10.7 7.2M5.4 11.9 10.7 8.8"/>
  </svg>`,
};

const ITEMS: Array<{ target: NavTarget; title: string; desc: string }> = [
  { target: 'diagnostics', title: 'Diagnostics', desc: 'Live charts — memory, CPU, nodes, textures' },
  { target: 'perfetto', title: 'Perfetto', desc: 'App tracing timeline' },
  { target: 'nodes', title: 'Node Tree', desc: 'SceneGraph node chart' },
];

function buildDom(): void {
  document.body.innerHTML = `
<div id="nav-list">
  ${ITEMS.map(item => `
    <button class="nav-item" data-target="${item.target}">
      <span class="nav-icon">${ICONS[item.target]}</span>
      <span class="nav-text">
        <span class="nav-title">${item.title}</span>
        <span class="nav-desc">${item.desc}</span>
      </span>
    </button>
  `).join('')}
</div>`;
}

document.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.nav-item');
  if (!btn) return;
  const target = btn.dataset.target as NavTarget;
  vscode.postMessage({ kind: 'open', target });
});

buildDom();

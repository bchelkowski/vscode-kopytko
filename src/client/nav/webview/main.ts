/**
 * Kopytko Tools — sidebar quick-nav webview. Three buttons that open the
 * Diagnostics panel, the Perfetto tracing tab, and the SceneGraph Tree
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
  deepLinking: `<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6.5 9.5 9.5 6.5"/>
    <path d="M7.5 4.5 9 3a2.47 2.47 0 0 1 3.5 0L13 3.5A2.47 2.47 0 0 1 13 7l-1.5 1.5"/>
    <path d="M8.5 11.5 7 13a2.47 2.47 0 0 1-3.5 0L3 12.5A2.47 2.47 0 0 1 3 9l1.5-1.5"/>
  </svg>`,
  deviceManager: `<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4.25" y="0.75" width="7.5" height="14.5" rx="2.6"/>
    <circle cx="6.1" cy="3.1" r="0.15" fill="currentColor" stroke="none"/>
    <circle cx="9.9" cy="3.1" r="0.15" fill="currentColor" stroke="none"/>
    <circle cx="8" cy="7.3" r="2.15"/>
    <circle cx="8" cy="7.3" r="0.15" fill="currentColor" stroke="none"/>
    <path d="M5.6 11.65h1.9M8.5 11.65h1.9"/>
    <path d="M6.3 13.5h3.4"/>
  </svg>`,
  rokuPay: `<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1.5" y="3" width="13" height="10" rx="1.5"/>
    <path d="M1.5 6h13"/>
    <path d="M4 10.5h3"/>
  </svg>`,
  network: `<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8" cy="8" r="6.2"/>
    <ellipse cx="8" cy="8" rx="2.6" ry="6.2"/>
    <path d="M2.1 6h11.8M2.1 10h11.8"/>
  </svg>`,
};

const ITEMS: Array<{ target: NavTarget; title: string; desc: string }> = [
  { target: 'deviceManager', title: 'Device Manager', desc: 'Remote control, scripts, web admin' },
  { target: 'diagnostics', title: 'Diagnostics', desc: 'Live charts — memory, CPU, nodes, textures' },
  { target: 'network', title: 'Network Inspector', desc: 'Capture HTTP requests, responses & metrics' },
  { target: 'deepLinking', title: 'Deep Linking', desc: 'Launch channels with contentId params' },
  { target: 'nodes', title: 'SceneGraph Tree', desc: 'SceneGraph nodes as XML or chart' },
  { target: 'perfetto', title: 'Perfetto', desc: 'App tracing timeline' },
  { target: 'rokuPay', title: 'Roku Pay Web Services', desc: 'Validate, cancel, refund — cloud API' },
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

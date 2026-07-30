/**
 * Kopytko Console webview.
 *
 * Owns the authoritative line buffer and renders it into an xterm.js terminal.
 * The terminal's own scrollback is treated as a *view* of that buffer, which is
 * what makes filtering possible: changing the filter clears the terminal and
 * replays the lines that match.
 */

import '@xterm/xterm/css/xterm.css';
import './styles.css';

import { ConsoleTerminal } from './terminal';
import { LineEditor } from './lineEditor';
import { CompletionPopup } from './completion';
import { classifyLine, type Severity } from '../lineClassifier';
import type { CompletionItem, ConsoleState, ExtMsg, WebMsg } from './protocol';
import { el } from '../../webview/domUtils';

declare function acquireVsCodeApi(): { postMessage(msg: WebMsg): void };
const vscode = acquireVsCodeApi();

const PROMPT = '❯ ';
/** Severities offered as filter chips, in display order. */
const FILTERABLE: Severity[] = ['error', 'warning', 'beacon', 'debugger'];

interface ViewState {
  lines: string[];
  filterText: string;
  filterRegex: RegExp | null;
  severities: Set<Severity>;
  state: ConsoleState | null;
  catalog: Record<string, CompletionItem[]>;
}

const view: ViewState = {
  lines: [],
  filterText: '',
  filterRegex: null,
  severities: new Set(),
  state: null,
  catalog: {},
};

let terminal: ConsoleTerminal;
let editor: LineEditor;
let popup: CompletionPopup;

// ── DOM ─────────────────────────────────────────────────────────────────────

function buildDom(): void {
  document.body.innerHTML = `
    <div class="console-root">
      <div class="toolbar">
        <select id="port" class="control" title="Debug console port"></select>
        <button id="connect"></button>
        <span id="device" class="device" title="Active device — change it in the Roku Devices sidebar"></span>
        <span class="spacer"></span>
        <input id="filter" class="filter" type="text" placeholder="Filter (text or /regex/)" />
        <span id="chips" class="chips"></span>
        <button id="clear" class="secondary" title="Clear the buffer">Clear</button>
        <button id="save" class="secondary" title="Save the buffer to a file">Save</button>
      </div>
      <div id="banner" class="banner" hidden></div>
      <div id="terminal" class="terminal"></div>
      <div id="footer" class="footer"></div>
    </div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── rendering ───────────────────────────────────────────────────────────────

function matchesFilter(line: string): boolean {
  if (view.severities.size > 0 && !view.severities.has(classifyLine(line).severity)) return false;
  if (view.filterRegex) return view.filterRegex.test(line);
  if (view.filterText) return line.toLowerCase().includes(view.filterText);
  return true;
}

/** Erase the input row so output lands above it, then repaint it underneath. */
function withInputRow(write: () => void): void {
  terminal.write('\r\x1b[2K');
  write();
  repaintInput();
}

function repaintInput(): void {
  const value = editor.value;
  const cursor = editor.cursorIndex;
  terminal.write(`\r\x1b[2K\x1b[1m${PROMPT}\x1b[0m${value}`);
  const back = value.length - cursor;
  if (back > 0) terminal.write(`\x1b[${back}D`);
}

function appendLines(lines: string[]): void {
  view.lines.push(...lines);
  const max = view.state?.maxLines ?? 20000;
  const overflow = view.lines.length - max;
  if (overflow > 0) view.lines.splice(0, overflow);

  const visible = lines.filter(matchesFilter);
  if (visible.length === 0) {
    updateFooter();
    return;
  }
  withInputRow(() => {
    for (const line of visible) terminal.writeLine(line);
  });
  updateFooter();
}

/** Re-render the whole buffer — used when the filter or the port changes. */
function rerender(): void {
  terminal.clear();
  withInputRow(() => {
    for (const line of view.lines) {
      if (matchesFilter(line)) terminal.writeLine(line);
    }
  });
  updateFooter();
}

function updateFooter(): void {
  const shown = view.lines.filter(matchesFilter).length;
  const total = view.lines.length;
  const state = view.state;
  const parts = [
    total === shown ? `${total} lines` : `${shown} of ${total} lines`,
    state?.logFile ? `logging to ${state.logFile}` : '',
    state?.connected ? '' : state?.pending ? 'connecting…' : 'disconnected',
  ].filter(Boolean);
  el('footer').textContent = parts.join('  ·  ');
}

function renderToolbar(state: ConsoleState): void {
  const portSelect = el<HTMLSelectElement>('port');
  portSelect.innerHTML = state.ports
    .map((p) => `<option value="${p.port}">${p.port} — ${p.label}</option>`)
    .join('');
  portSelect.value = String(state.selectedPort);

  // The dot reports the *console connection*, not device liveness — that is the
  // thing this panel can actually speak to.
  const status = state.connected ? 'connected' : state.pending ? 'pending' : 'idle';
  const device = el('device');
  device.innerHTML = state.device
    ? `<span class="dot ${status}"></span>${escapeHtml(state.device.label)}`
      + `<span class="device-ip">${escapeHtml(state.device.ip)}</span>`
    : '<span class="dot idle"></span><span class="device-none">No active device — select one in the sidebar</span>';

  const connect = el<HTMLButtonElement>('connect');
  connect.textContent = state.connected ? 'Disconnect' : state.pending ? 'Connecting…' : 'Connect';
  // Disconnect is the stop action, matching Diagnostics' red Stop Session.
  connect.classList.toggle('stop', state.connected);
  connect.disabled = !state.device;

  const chips = el('chips');
  chips.innerHTML = FILTERABLE.map(
    (severity) =>
      `<button class="chip sev-${severity}${view.severities.has(severity) ? ' on' : ''}" data-sev="${severity}">${severity}</button>`,
  ).join('');
}

function showBanner(message: string | null, tone: 'info' | 'warning' | 'error' = 'info'): void {
  const banner = el('banner');
  if (!message) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.hidden = false;
  banner.className = `banner ${tone}`;
  banner.textContent = message;
}

// ── events ──────────────────────────────────────────────────────────────────

function wireToolbar(): void {
  el<HTMLSelectElement>('port').addEventListener('change', (event) => {
    const port = Number((event.target as HTMLSelectElement).value) as 8085 | 8080;
    vscode.postMessage({ kind: 'select-port', port });
  });

  el('connect').addEventListener('click', () => {
    vscode.postMessage({ kind: view.state?.connected ? 'disconnect' : 'connect' });
  });

  el('clear').addEventListener('click', () => vscode.postMessage({ kind: 'clear' }));
  el('save').addEventListener('click', () => vscode.postMessage({ kind: 'save' }));

  el('filter').addEventListener('input', (event) => {
    const raw = (event.target as HTMLInputElement).value;
    // A /…/ value is treated as a regex; an invalid one falls back to substring
    // matching rather than throwing away every line while it is half-typed.
    const asRegex = /^\/(.*)\/([gimsu]*)$/.exec(raw);
    view.filterRegex = null;
    view.filterText = '';
    if (asRegex) {
      try {
        view.filterRegex = new RegExp(asRegex[1], asRegex[2].replace('g', ''));
      } catch {
        view.filterText = raw.toLowerCase();
      }
    } else {
      view.filterText = raw.toLowerCase();
    }
    rerender();
  });

  el('chips').addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-sev]');
    if (!target) return;
    const severity = target.getAttribute('data-sev') as Severity;
    if (view.severities.has(severity)) view.severities.delete(severity);
    else view.severities.add(severity);
    target.classList.toggle('on');
    rerender();
  });
}

function handleMessage(msg: ExtMsg): void {
  switch (msg.kind) {
    case 'init': {
      // `init` also arrives when the panel becomes visible again, so only drop
      // a half-typed command when the target actually changed — the command
      // set and the device it would run against are different then.
      const targetChanged =
        view.state !== null
        && (view.state.selectedPort !== msg.state.selectedPort
          || view.state.device?.serial !== msg.state.device?.serial);

      view.state = msg.state;
      view.catalog = msg.catalog;
      view.lines = [...msg.lines];
      popup.setCatalog(msg.catalog);
      popup.hide();
      editor.setHistory(msg.history);
      if (targetChanged) editor.reset();
      terminal.setColorize(msg.state.colorize);
      renderToolbar(msg.state);
      rerender();
      break;
    }
    case 'state':
      view.state = msg.state;
      terminal.setColorize(msg.state.colorize);
      renderToolbar(msg.state);
      updateFooter();
      break;
    case 'lines':
      if (msg.port === view.state?.selectedPort) appendLines(msg.lines);
      break;
    case 'echo':
      withInputRow(() => terminal.writeSystemLine(`${PROMPT}${msg.text}`, '\x1b[1;90m'));
      break;
    case 'history':
      editor.setHistory(msg.history);
      break;
    case 'cleared':
      view.lines = [];
      rerender();
      break;
    case 'status':
      showBanner(msg.message, msg.tone);
      break;
  }
}

// ── bootstrap ───────────────────────────────────────────────────────────────

function start(): void {
  buildDom();
  wireToolbar();

  const container = el('terminal');

  terminal = new ConsoleTerminal({
    container,
    onSourceClick: (pkgPath, line) => vscode.postMessage({ kind: 'open-source', pkgPath, line }),
    onData: (data) => editor.handle(data),
  });

  popup = new CompletionPopup({
    // Anchored to the flex root, which is the positioned ancestor the popup's
    // `bottom` offset is measured against.
    container: document.querySelector<HTMLElement>('.console-root') ?? document.body,
    onAccept: (item) => editor.applyCompletion(item.value),
  });

  editor = new LineEditor(PROMPT, {
    repaint: () => repaintInput(),
    submit: (value) => vscode.postMessage({ kind: 'input', text: value }),
    interrupt: () => vscode.postMessage({ kind: 'interrupt' }),
    clearScreen: () => vscode.postMessage({ kind: 'clear' }),
    change: (value, cursor) => openCompletionAt(value, cursor),
    acceptCompletion: () => popup.accept(),
    openCompletion: () => openCompletionAt(editor.value, editor.cursorIndex),
    moveCompletion: (delta) => popup.move(delta),
    dismissCompletion: () => popup.hide(),
  });

  // Show the full command list as soon as the terminal is focused with nothing
  // typed, so the available commands are discoverable without guessing a letter.
  terminal.term.textarea?.addEventListener('focus', () => {
    if (editor.value.length === 0) openCompletionAt('', 0);
  });

  window.addEventListener('message', (event: MessageEvent<ExtMsg>) => handleMessage(event.data));

  requestAnimationFrame(() => {
    popup.setCellWidth(measureCellWidth(container));
    repaintInput();
    terminal.focus();
  });

  vscode.postMessage({ kind: 'ready' });
}

function openCompletionAt(value: string, cursor: number): void {
  popup.update(view.state?.selectedPort ?? 8085, value, cursor, PROMPT.length);
}

/** Width of one terminal cell, for anchoring the completion popup to the caret. */
function measureCellWidth(container: HTMLElement): number {
  const rows = container.querySelector('.xterm-rows');
  if (!rows) return 8;
  const width = rows.getBoundingClientRect().width / terminal.cols;
  return Number.isFinite(width) && width > 0 ? width : 8;
}

start();

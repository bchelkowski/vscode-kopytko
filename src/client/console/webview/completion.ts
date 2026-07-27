/**
 * Completion popup for the console input row.
 *
 * Rendered as an HTML overlay rather than inside the terminal grid: xterm has
 * no widget layer, and drawing a list into the buffer would fight the scrollback.
 * The popup anchors to the bottom of the terminal (the input row is always the
 * last row) offset by the caret column, measured once from a real cell.
 */

import type { CompletionItem, ConsolePort } from './protocol';

export interface CompletionHost {
  /** Root the popup is positioned against. */
  container: HTMLElement;
  /** Called when the user accepts an item. */
  onAccept: (item: CompletionItem) => void;
}

export class CompletionPopup {
  private readonly element: HTMLElement;
  private readonly host: CompletionHost;
  private catalog: Record<string, CompletionItem[]> = {};
  private items: CompletionItem[] = [];
  private index = 0;
  private open = false;
  private cellWidth = 8;
  /** The token the popup is currently completing, for the no-op check. */
  private token = '';

  constructor(host: CompletionHost) {
    this.host = host;
    this.element = document.createElement('div');
    this.element.className = 'completion-popup';
    this.element.style.display = 'none';
    this.element.setAttribute('role', 'listbox');
    host.container.appendChild(this.element);

    this.element.addEventListener('mousedown', (event) => {
      // mousedown, not click: the terminal steals focus on mouseup and the
      // popup would be dismissed before a click ever landed.
      event.preventDefault();
      const target = (event.target as HTMLElement).closest('[data-index]');
      if (!target) return;
      this.index = Number(target.getAttribute('data-index'));
      this.accept();
    });
  }

  setCatalog(catalog: Record<string, CompletionItem[]>): void {
    this.catalog = catalog;
  }

  setCellWidth(width: number): void {
    if (width > 0) this.cellWidth = width;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Recompute candidates for the current input.
   *
   * Mirrors `completeCommand()` in kopytko-roku-device: the catalog is shipped
   * to the webview at init so keystrokes never round-trip to the host.
   */
  update(port: ConsolePort, line: string, cursor: number, promptWidth: number): void {
    const items = this.resolve(port, line.slice(0, cursor));
    this.token = line.slice(this.tokenStart(line, cursor), cursor);
    if (items.length === 0) {
      this.hide();
      return;
    }

    // Keep the highlighted entry if it survived the edit, else start at the top.
    const previous = this.items[this.index]?.value;
    this.items = items;
    const carried = items.findIndex((item) => item.value === previous);
    this.index = carried === -1 ? 0 : carried;

    this.render();
    this.position(promptWidth + this.tokenStart(line, cursor));
    this.element.style.display = 'block';
    this.open = true;
  }

  move(delta: number): boolean {
    if (!this.open) return false;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.render();
    return true;
  }

  /**
   * Accept the highlighted item.
   *
   * Returns false when nothing is open, or when the highlighted value is
   * already exactly what the user typed — accepting then would leave the line
   * unchanged, and callers use the return value to decide whether Enter should
   * submit instead.
   */
  accept(): boolean {
    if (!this.open) return false;
    const item = this.items[this.index];
    if (!item || item.value === this.token) {
      this.hide();
      return false;
    }
    this.hide();
    this.host.onAccept(item);
    return true;
  }

  hide(): boolean {
    if (!this.open) return false;
    this.element.style.display = 'none';
    // Drop the rendered rows too, so a hidden popup never holds stale entries.
    this.element.innerHTML = '';
    this.open = false;
    this.items = [];
    this.index = 0;
    this.token = '';
    return true;
  }

  dispose(): void {
    this.element.remove();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private resolve(port: ConsolePort, text: string): CompletionItem[] {
    const commands = this.catalog[String(port)] ?? [];
    const trimmed = text.replace(/^\s+/, '');
    // An empty line lists every command for the port — the whole point is to
    // discover what this console accepts without knowing a first letter.
    if (trimmed.length === 0) return commands;

    const firstSpace = trimmed.indexOf(' ');
    if (firstSpace === -1) {
      const prefix = trimmed.toLowerCase();
      return commands.filter((cmd) => cmd.value.startsWith(prefix));
    }

    const name = trimmed.slice(0, firstSpace).toLowerCase();
    const rest = trimmed.slice(firstSpace + 1);
    if (rest.includes(' ')) return [];

    const subcommands = commands.find((cmd) => cmd.value === name)?.subcommands;
    if (!subcommands) return [];
    const prefix = rest.toLowerCase();
    return subcommands
      .filter((sub) => sub.value.startsWith(prefix))
      .map((sub) => ({ ...sub, source: 'docs' as const }));
  }

  private tokenStart(line: string, cursor: number): number {
    const before = line.slice(0, cursor);
    const lastSpace = before.lastIndexOf(' ');
    return lastSpace === -1 ? 0 : lastSpace + 1;
  }

  private position(column: number): void {
    this.element.style.left = `${Math.round(column * this.cellWidth)}px`;
    // Anchored to the container's bottom edge, which sits just under the input
    // row, so the list grows upward into the scrollback.
    this.element.style.bottom = '1.6em';
  }

  private render(): void {
    this.element.innerHTML = this.items
      .map((item, i) => {
        const selected = i === this.index;
        const badges = [
          item.destructive ? '<span class="badge badge-danger">destructive</span>' : '',
          item.source === 'device' ? '<span class="badge">undocumented</span>' : '',
        ].join('');
        return `<div class="completion-item${selected ? ' selected' : ''}" data-index="${i}" role="option" aria-selected="${selected}">`
          + `<span class="completion-name">${escapeHtml(item.value)}</span>`
          + (item.args ? `<span class="completion-args">${escapeHtml(item.args)}</span>` : '')
          + `<span class="completion-desc">${escapeHtml(item.description)}</span>`
          + badges
          + '</div>';
      })
      .join('');

    this.element.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

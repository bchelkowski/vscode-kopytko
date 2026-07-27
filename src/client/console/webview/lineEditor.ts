/**
 * A minimal readline for the console input row.
 *
 * xterm.js is a display, not a shell: it forwards keystrokes and draws whatever
 * you write back. Neither Roku console echoes what you type, so this class owns
 * the input buffer, repaints it, and turns key sequences into intent.
 *
 * The buffer is kept pure (no terminal writes inside the key handlers) so the
 * editing logic can be reasoned about — and tested — independently of xterm.
 */

export interface LineEditorHandlers {
  /** Repaint the prompt and current buffer. */
  repaint(prompt: string, value: string, cursor: number): void;
  /** User pressed Enter. */
  submit(value: string): void;
  /** User pressed Ctrl+C. */
  interrupt(): void;
  /** User pressed Ctrl+L. */
  clearScreen(): void;
  /** Buffer or cursor changed — drives the completion popup. */
  change(value: string, cursor: number): void;
  /**
   * Accept the highlighted completion. Returns false when the popup is closed
   * *or* when the highlighted entry is already fully typed — so Enter submits
   * `bt` rather than "accepting" it into an unchanged line.
   */
  acceptCompletion(): boolean;
  /** Open the popup for the token under the cursor. */
  openCompletion(): void;
  /** Arrow keys while the completion popup is open. */
  moveCompletion(delta: number): boolean;
  /** Escape pressed. */
  dismissCompletion(): boolean;
}

export class LineEditor {
  private buffer = '';
  private cursor = 0;
  private history: string[] = [];
  /** Index into `history`; equal to `history.length` when editing a fresh line. */
  private historyIndex = 0;
  /** The in-progress line stashed when the user starts browsing history. */
  private draft = '';

  constructor(
    private prompt: string,
    private readonly handlers: LineEditorHandlers,
  ) {}

  get value(): string {
    return this.buffer;
  }

  get cursorIndex(): number {
    return this.cursor;
  }

  setPrompt(prompt: string): void {
    this.prompt = prompt;
    this.repaint();
  }

  setHistory(history: string[]): void {
    this.history = [...history];
    this.historyIndex = this.history.length;
  }

  reset(): void {
    this.buffer = '';
    this.cursor = 0;
    this.historyIndex = this.history.length;
    this.draft = '';
    this.repaint();
  }

  /**
   * Replace the token under the cursor with `value` — used by completion.
   *
   * Deliberately does not fire `change`: that would re-open the popup on the
   * text just accepted, and Enter would then accept forever instead of ever
   * submitting the line.
   */
  applyCompletion(value: string): void {
    const start = this.tokenStart();
    this.buffer = this.buffer.slice(0, start) + value + this.buffer.slice(this.cursor);
    this.cursor = start + value.length;
    this.repaint();
  }

  /** Feed one chunk from `Terminal.onData`. */
  handle(data: string): void {
    // A paste arrives as one chunk; treat any multi-character run without
    // escape sequences as literal text rather than parsing it key by key.
    if (data.length > 1 && !data.startsWith('\x1b') && !/[\x00-\x1f]/.test(data)) {
      this.insert(data);
      return;
    }

    switch (data) {
      case '\r':
      case '\n':
        this.onEnter();
        return;
      case '\x7f':
      case '\b':
        this.backspace();
        return;
      case '\x03': // Ctrl+C
        this.handlers.interrupt();
        this.buffer = '';
        this.cursor = 0;
        this.repaint();
        this.handlers.change(this.buffer, this.cursor);
        return;
      case '\x0c': // Ctrl+L
        this.handlers.clearScreen();
        this.repaint();
        return;
      case '\x15': // Ctrl+U — kill to line start
        this.buffer = this.buffer.slice(this.cursor);
        this.cursor = 0;
        this.repaint();
        this.handlers.change(this.buffer, this.cursor);
        return;
      case '\x0b': // Ctrl+K — kill to line end
        this.buffer = this.buffer.slice(0, this.cursor);
        this.repaint();
        this.handlers.change(this.buffer, this.cursor);
        return;
      case '\t':
        // Accept what is highlighted, else offer completions for this token.
        // Never insert a literal tab — it is meaningless to both consoles.
        if (!this.handlers.acceptCompletion()) this.handlers.openCompletion();
        return;
      case '\x1b':
        this.handlers.dismissCompletion();
        return;
      case '\x1b[A': // Up
        if (this.handlers.moveCompletion(-1)) return;
        this.recallHistory(-1);
        return;
      case '\x1b[B': // Down
        if (this.handlers.moveCompletion(1)) return;
        this.recallHistory(1);
        return;
      case '\x1b[C': // Right
        if (this.cursor < this.buffer.length) {
          this.cursor += 1;
          this.repaint();
          this.handlers.change(this.buffer, this.cursor);
        }
        return;
      case '\x1b[D': // Left
        if (this.cursor > 0) {
          this.cursor -= 1;
          this.repaint();
          this.handlers.change(this.buffer, this.cursor);
        }
        return;
      case '\x1b[H': // Home
      case '\x1bOH':
        this.cursor = 0;
        this.repaint();
        return;
      case '\x1b[F': // End
      case '\x1bOF':
        this.cursor = this.buffer.length;
        this.repaint();
        return;
      case '\x1b[3~': // Delete
        if (this.cursor < this.buffer.length) {
          this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
          this.repaint();
          this.handlers.change(this.buffer, this.cursor);
        }
        return;
      default:
        break;
    }

    // Ignore anything else in the control range; insert real characters.
    if (/^[\x00-\x1f]$/.test(data)) return;
    this.insert(data);
  }

  // ── editing ───────────────────────────────────────────────────────────────

  private insert(text: string): void {
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
    this.cursor += text.length;
    this.repaint();
    this.handlers.change(this.buffer, this.cursor);
  }

  private backspace(): void {
    if (this.cursor === 0) return;
    this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
    this.cursor -= 1;
    this.repaint();
    this.handlers.change(this.buffer, this.cursor);
  }

  private onEnter(): void {
    // Enter accepts the completion when it would actually change the line;
    // otherwise it submits.
    if (this.handlers.acceptCompletion()) return;

    const value = this.buffer;
    this.buffer = '';
    this.cursor = 0;
    this.draft = '';
    this.handlers.dismissCompletion();
    this.handlers.submit(value);
    this.repaint();
  }

  private recallHistory(delta: number): void {
    if (this.history.length === 0) return;

    // Stash the live draft the first time the user steps off it.
    if (this.historyIndex === this.history.length) this.draft = this.buffer;

    const next = this.historyIndex + delta;
    if (next < 0 || next > this.history.length) return;

    this.historyIndex = next;
    this.buffer = next === this.history.length ? this.draft : this.history[next];
    this.cursor = this.buffer.length;
    this.repaint();
    this.handlers.change(this.buffer, this.cursor);
  }

  /** Start index of the whitespace-delimited token the cursor sits in. */
  private tokenStart(): number {
    const before = this.buffer.slice(0, this.cursor);
    const lastSpace = before.lastIndexOf(' ');
    return lastSpace === -1 ? 0 : lastSpace + 1;
  }

  private repaint(): void {
    this.handlers.repaint(this.prompt, this.buffer, this.cursor);
  }
}

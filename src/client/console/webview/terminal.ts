/**
 * xterm.js bootstrap: theme mapping, sizing, and severity-coloured rendering.
 *
 * Colours come from the workbench's own terminal palette
 * (`--vscode-terminal-ansi*`), so the console inherits whatever theme the user
 * has active instead of shipping hardcoded hexes. VS Code rewrites those CSS
 * variables in place on a theme switch, hence the MutationObserver.
 *
 * The WebGL renderer is deliberately not used — it is unreliable inside VS Code
 * webviews. The default DOM renderer is fast enough for a log tail at the line
 * rates these ports produce.
 */

import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { classifyLine, type ClassifiedLine, type Severity, type SpanKind } from '../lineClassifier';

const RESET = '\x1b[0m';

/** Below this, the container is mid-layout or collapsed — not a real size. */
const MIN_CONTAINER_PX = 40;
/** ~2s of frames; long enough for a slow first layout, short enough to give up. */
const FIT_RETRY_LIMIT = 120;

/** SGR codes per severity, using the 16-colour palette so themes drive the hue. */
const SEVERITY_SGR: Record<Severity, string> = {
  error: '\x1b[91m',    // bright red
  warning: '\x1b[93m',  // bright yellow
  beacon: '\x1b[96m',   // bright cyan
  debugger: '\x1b[92m', // bright green
  xml: '\x1b[37m',      // white
  plain: '',
};

/** SGR codes for sub-line tokens; `''` means "inherit the severity colour". */
const SPAN_SGR: Record<SpanKind, string> = {
  text: '',
  timestamp: '\x1b[90m',  // bright black — present but out of the way
  thread: '\x1b[94m',     // bright blue
  source: '\x1b[4;96m',   // underlined bright cyan — signals "clickable"
  metric: '\x1b[93m',     // bright yellow
  tag: '\x1b[90m',
  prompt: '\x1b[1;92m',   // bold bright green
};

export interface ConsoleTerminalOptions {
  container: HTMLElement;
  /** Invoked when a `pkg:/…(line)` reference is clicked. */
  onSourceClick: (pkgPath: string, line: number) => void;
  /** Every keystroke the terminal receives, for the line editor. */
  onData: (data: string) => void;
}

export class ConsoleTerminal {
  readonly term: Terminal;
  private readonly fit = new FitAddon();
  private readonly container: HTMLElement;
  private readonly onSourceClick: (pkgPath: string, line: number) => void;
  private themeObserver: MutationObserver | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private colorize = true;

  constructor(opts: ConsoleTerminalOptions) {
    this.container = opts.container;
    this.onSourceClick = opts.onSourceClick;

    this.term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 20000,
      fontFamily: readVar('--vscode-editor-font-family') || 'monospace',
      fontSize: Number(readVar('--vscode-editor-font-size')) || 12,
      theme: buildTheme(),
      // The device is the source of truth for wrapping; let xterm wrap visually.
      allowProposedApi: false,
    });

    this.term.loadAddon(this.fit);
    this.term.onData(opts.onData);
    this.registerSourceLinks();
    this.term.open(this.container);

    this.scheduleFit();
    this.watchResize();
    this.watchTheme();
  }

  setColorize(enabled: boolean): void {
    this.colorize = enabled;
  }

  /** Append one line of device output, coloured by classification. */
  writeLine(raw: string): void {
    this.term.writeln(this.colorize ? render(classifyLine(raw)) : stripControl(raw));
  }

  /** Append a locally generated line (echo, status) without classification. */
  writeSystemLine(text: string, sgr = '\x1b[90m'): void {
    this.term.writeln(`${sgr}${stripControl(text)}${RESET}`);
  }

  /** Write raw text with no newline — used to repaint the input line. */
  write(text: string): void {
    this.term.write(text);
  }

  clear(): void {
    // `clear()` keeps the current row; reset() would also drop scroll position
    // and re-trigger the cursor, which reads as a flicker.
    this.term.clear();
  }

  focus(): void {
    this.term.focus();
  }

  get cols(): number {
    return this.term.cols;
  }

  /**
   * Resize the grid to the container.
   *
   * Guarded against a degenerate container: at first paint — and whenever the
   * VS Code panel is collapsed — the element measures a few pixels, and
   * FitAddon will happily resize the terminal to a 2×1 grid that it never grows
   * back out of. Skipping those measurements is what keeps the scrollback
   * usable; `scheduleFit()` covers the case where no resize notification
   * follows the layout settling.
   */
  fitToContainer(): void {
    if (!this.hasUsableSize()) return;
    try {
      this.fit.fit();
    } catch { /* renderer not measured yet; the next attempt will catch it */ }
  }

  private hasUsableSize(): boolean {
    return this.container.clientWidth >= MIN_CONTAINER_PX
      && this.container.clientHeight >= MIN_CONTAINER_PX;
  }

  /**
   * Keep trying to fit until the container has real dimensions.
   *
   * A ResizeObserver notification is not guaranteed for the initial
   * zero-to-laid-out transition, so the terminal would otherwise stay at
   * whatever grid it was constructed with.
   */
  private scheduleFit(attempt = 0): void {
    if (attempt > FIT_RETRY_LIMIT) return;
    requestAnimationFrame(() => {
      if (this.hasUsableSize()) {
        this.fitToContainer();
        return;
      }
      this.scheduleFit(attempt + 1);
    });
  }

  dispose(): void {
    this.themeObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.term.dispose();
  }

  private registerSourceLinks(): void {
    this.term.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const line = this.term.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) {
          callback(undefined);
          return;
        }
        const text = line.translateToString(true);
        const ref = classifyLine(text).sourceRef;
        if (!ref) {
          callback(undefined);
          return;
        }
        // Locate the reference in the rendered row so the underline lands on it.
        const needle = `${ref.pkgPath}(${ref.line})`;
        const index = text.indexOf(needle);
        if (index === -1) {
          callback(undefined);
          return;
        }
        callback([
          {
            range: {
              start: { x: index + 1, y: bufferLineNumber },
              end: { x: index + needle.length, y: bufferLineNumber },
            },
            text: needle,
            activate: () => this.onSourceClick(ref.pkgPath, ref.line),
          },
        ]);
      },
    });
  }

  private watchResize(): void {
    this.resizeObserver = new ResizeObserver(() => this.fitToContainer());
    this.resizeObserver.observe(this.container);
  }

  private watchTheme(): void {
    // VS Code swaps the theme by rewriting the CSS variables and the body's
    // theme-kind attribute; there is no dedicated event inside a webview.
    this.themeObserver = new MutationObserver(() => {
      this.term.options.theme = buildTheme();
    });
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-vscode-theme-kind', 'data-vscode-theme-id'],
    });
  }
}

/** Turn a classified line into an SGR-escaped string. */
export function render(line: ClassifiedLine): string {
  const base = SEVERITY_SGR[line.severity];
  if (line.spans.length === 0) return '';

  const body = line.spans
    .map((span) => {
      const text = stripControl(span.text);
      const sgr = SPAN_SGR[span.kind];
      // Re-assert the base colour after a span so the rest of the line keeps
      // its severity hue rather than falling back to the default foreground.
      return sgr ? `${sgr}${text}${RESET}${base}` : text;
    })
    .join('');

  return `${base}${body}${RESET}`;
}

/**
 * Remove escape sequences the device may have emitted.
 *
 * Device output is untrusted input rendered into a terminal: a stray CSI
 * sequence in a `print` statement could otherwise repaint the screen, move the
 * cursor, or corrupt the input line we draw ourselves. Tabs and printable text
 * survive; everything else in the C0 range is dropped.
 */
export function stripControl(text: string): string {
  return text
    // OSC (window title and friends), terminated by BEL or ST.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI — colours, cursor movement, erase.
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // Two-character escapes.
    .replace(/\x1b[@-Z\\-_]/g, '')
    // Remaining C0 controls and DEL; tab (\x09) is kept deliberately.
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

function buildTheme(): ITheme {
  return {
    background: readVar('--vscode-panel-background') || readVar('--vscode-terminal-background'),
    foreground: readVar('--vscode-terminal-foreground') || readVar('--vscode-editor-foreground'),
    cursor: readVar('--vscode-terminalCursor-foreground') || readVar('--vscode-editor-foreground'),
    selectionBackground: readVar('--vscode-terminal-selectionBackground'),
    black: readVar('--vscode-terminal-ansiBlack'),
    red: readVar('--vscode-terminal-ansiRed'),
    green: readVar('--vscode-terminal-ansiGreen'),
    yellow: readVar('--vscode-terminal-ansiYellow'),
    blue: readVar('--vscode-terminal-ansiBlue'),
    magenta: readVar('--vscode-terminal-ansiMagenta'),
    cyan: readVar('--vscode-terminal-ansiCyan'),
    white: readVar('--vscode-terminal-ansiWhite'),
    brightBlack: readVar('--vscode-terminal-ansiBrightBlack'),
    brightRed: readVar('--vscode-terminal-ansiBrightRed'),
    brightGreen: readVar('--vscode-terminal-ansiBrightGreen'),
    brightYellow: readVar('--vscode-terminal-ansiBrightYellow'),
    brightBlue: readVar('--vscode-terminal-ansiBrightBlue'),
    brightMagenta: readVar('--vscode-terminal-ansiBrightMagenta'),
    brightCyan: readVar('--vscode-terminal-ansiBrightCyan'),
    brightWhite: readVar('--vscode-terminal-ansiBrightWhite'),
  };
}

function readVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

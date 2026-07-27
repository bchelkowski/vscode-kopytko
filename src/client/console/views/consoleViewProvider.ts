import * as vscode from 'vscode';
import {
  CONSOLE_COMMANDS,
  CONSOLE_PORTS,
  type ConsolePort,
} from 'kopytko-roku-device';
import { ConsoleController } from '../consoleController';
import { resolveRendezvousFile } from '../../roku/util/resolveSourceFile';
import type {
  CompletionItem,
  ConsoleState,
  ExtMsg,
  SerializedCatalog,
  WebMsg,
} from '../webview/protocol';

const VIEW_ID = 'kopytko.console';
/** Outbound line batching — 8085 under load is the busiest stream we carry. */
const BATCH_INTERVAL_MS = 100;
const HISTORY_KEY_PREFIX = 'kopytko.console.history';

/**
 * Bridges the console webview to the controller.
 *
 * Keeps the terminal responsive under load by batching line deliveries and
 * dropping posts while the panel is hidden (the controller keeps buffering, so
 * nothing is lost — the webview re-syncs from `init` when it comes back).
 */
export class ConsoleViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = VIEW_ID;

  private webviewView: vscode.WebviewView | undefined;
  private batchTimer: ReturnType<typeof setInterval> | undefined;
  private pending = new Map<ConsolePort, string[]>();
  private autoConnectAttempted = false;
  private lastSerial: string | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: ConsoleController,
  ) {
    this.controller.on('lines', (port: ConsolePort, lines: string[]) => {
      const queue = this.pending.get(port) ?? [];
      queue.push(...lines);
      this.pending.set(port, queue);
    });
    this.controller.on('state', () => {
      // A device change swaps which buffer is current, so the webview needs a
      // full re-sync rather than a state patch over stale lines.
      const serial = this.controller.serial;
      if (serial !== this.lastSerial) {
        this.lastSerial = serial;
        this.pending.clear();
        this.sendInit();
        return;
      }
      this.sendState();
    });
    this.controller.on('status', (message: string | null, tone?: 'info' | 'warning' | 'error') => {
      this.post({ kind: 'status', message, tone });
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'console-webview'),
      ],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((msg: WebMsg) => void this.handleMessage(msg)),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) this.sendInit();
      }),
    );

    this.startBatching();
  }

  notifyStateChange(): void {
    this.sendState();
  }

  dispose(): void {
    this.stopBatching();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  // ── inbound ───────────────────────────────────────────────────────────────

  private async handleMessage(msg: WebMsg): Promise<void> {
    switch (msg.kind) {
      case 'ready':
        this.sendInit();
        // Only on the first ready of a session: a webview reload should not
        // silently reconnect a port the user deliberately disconnected.
        if (!this.autoConnectAttempted && readSettings().autoConnect) {
          this.autoConnectAttempted = true;
          await this.controller.connect();
        }
        break;
      case 'connect':
        await this.controller.connect();
        break;
      case 'disconnect':
        this.controller.disconnect();
        break;
      case 'input':
        await this.submit(msg.text);
        break;
      case 'interrupt':
        this.controller.interrupt();
        break;
      case 'select-port':
        this.controller.selectPort(msg.port);
        this.sendInit();
        break;
      case 'clear':
        this.controller.clear();
        this.pending.delete(this.controller.port);
        this.post({ kind: 'cleared', port: this.controller.port });
        break;
      case 'save':
        await this.saveBuffer();
        break;
      case 'open-source':
        await this.openSource(msg.pkgPath, msg.line);
        break;
    }
  }

  private async submit(text: string): Promise<void> {
    const trimmed = text.trim();
    // Echo before sending so the command appears above its own output even if
    // the device replies instantly.
    this.post({ kind: 'echo', port: this.controller.port, text });

    if (trimmed.length === 0) return;

    let result = this.controller.send(text);
    if (result === 'needs-confirmation') {
      const choice = await vscode.window.showWarningMessage(
        `Send "${trimmed}" to the device? This command is destructive and cannot be undone.`,
        { modal: true },
        'Send',
      );
      if (choice !== 'Send') {
        this.post({ kind: 'status', message: 'Command cancelled.', tone: 'info' });
        return;
      }
      result = this.controller.send(text, true);
    }

    if (result === 'not-connected') {
      this.post({ kind: 'status', message: 'Not connected — press Connect first.', tone: 'warning' });
      return;
    }

    await this.pushHistory(trimmed);
  }

  private async saveBuffer(): Promise<void> {
    try {
      const file = await this.controller.saveBuffer();
      if (!file) {
        this.post({ kind: 'status', message: 'Nothing to save yet.', tone: 'info' });
        return;
      }
      const choice = await vscode.window.showInformationMessage(
        `Kopytko Console: saved to ${file}`,
        'Open',
      );
      if (choice === 'Open') {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        await vscode.window.showTextDocument(doc);
      }
    } catch (err) {
      this.post({
        kind: 'status',
        message: `Could not save output — ${(err as Error).message}`,
        tone: 'error',
      });
    }
  }

  private async openSource(pkgPath: string, line: number): Promise<void> {
    const uri = await resolveRendezvousFile('', pkgPath);
    if (!uri) {
      this.post({ kind: 'status', message: `Could not find ${pkgPath} in the workspace.`, tone: 'warning' });
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    // Device line numbers are 1-based; VS Code positions are 0-based.
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  // ── outbound ──────────────────────────────────────────────────────────────

  private sendInit(): void {
    this.post({
      kind: 'init',
      state: this.buildState(),
      catalog: buildCatalog(),
      history: this.readHistory(this.controller.port),
      lines: this.controller.bufferedLines(),
    });
  }

  private sendState(): void {
    this.post({ kind: 'state', state: this.buildState() });
  }

  private buildState(): ConsoleState {
    const device = this.controller.device;
    const settings = readSettings();
    return {
      device: device
        ? {
            serial: device.serialNumber,
            label: device.friendlyName || device.modelName || device.ip,
            ip: device.ip,
          }
        : null,
      ports: this.controller.listPorts(),
      selectedPort: this.controller.port,
      connected: this.controller.isConnected,
      pending: this.controller.isPending,
      logFile: this.controller.logFile,
      maxLines: settings.maxLines,
      colorize: settings.colorize,
    };
  }

  private startBatching(): void {
    if (this.batchTimer) return;
    this.batchTimer = setInterval(() => this.flush(), BATCH_INTERVAL_MS);
  }

  private stopBatching(): void {
    if (!this.batchTimer) return;
    clearInterval(this.batchTimer);
    this.batchTimer = undefined;
  }

  private flush(): void {
    if (this.pending.size === 0) return;
    // Only the visible port's lines need delivering; the controller retains the
    // rest, and switching ports re-inits from its buffer.
    const port = this.controller.port;
    const lines = this.pending.get(port);
    this.pending.clear();
    if (!lines?.length) return;
    this.post({ kind: 'lines', port, lines });
  }

  private post(msg: ExtMsg): void {
    if (this.webviewView?.visible) {
      void this.webviewView.webview.postMessage(msg);
    }
  }

  // ── history ───────────────────────────────────────────────────────────────

  private historyKey(port: ConsolePort): string {
    return `${HISTORY_KEY_PREFIX}.${port}`;
  }

  private readHistory(port: ConsolePort): string[] {
    return this.context.globalState.get<string[]>(this.historyKey(port), []);
  }

  private async pushHistory(command: string): Promise<void> {
    const port = this.controller.port;
    const { historySize } = readSettings();
    // De-duplicate so holding ↑ walks distinct commands, most recent last.
    const history = this.readHistory(port).filter((entry) => entry !== command);
    history.push(command);
    const trimmed = history.slice(-historySize);
    await this.context.globalState.update(this.historyKey(port), trimmed);
    this.post({ kind: 'history', history: trimmed });
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private buildHtml(webview: vscode.Webview): string {
    const outDir = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'console-webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.css'));
    const csp = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp}; img-src ${csp} data:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Kopytko Console</title>
</head>
<body>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** Flatten the device package's catalog into the webview's completion shape. */
function buildCatalog(): SerializedCatalog {
  const catalog: SerializedCatalog = {};
  for (const port of CONSOLE_PORTS) {
    catalog[String(port)] = CONSOLE_COMMANDS[port].map<CompletionItem>((cmd) => ({
      value: cmd.name,
      args: cmd.args,
      description: cmd.description,
      source: cmd.source,
      destructive: cmd.destructive,
      subcommands: cmd.subcommands?.map((sub) => ({
        value: sub.name,
        description: sub.description,
      })),
    }));
  }
  return catalog;
}

export function readSettings() {
  const cfg = vscode.workspace.getConfiguration('kopytko');
  return {
    defaultPort: cfg.get<number>('console.defaultPort', 8085) as ConsolePort,
    autoConnect: cfg.get<boolean>('console.autoConnect', false),
    maxLines: cfg.get<number>('console.maxLines', 20000),
    reconnect: cfg.get<boolean>('console.reconnect', true),
    colorize: cfg.get<boolean>('console.colorize', true),
    logToFile: cfg.get<boolean>('console.logToFile', false),
    outputDir: cfg.get<string>('console.outputDir', 'debug'),
    historySize: cfg.get<number>('console.historySize', 200),
  };
}

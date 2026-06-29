import * as vscode from 'vscode';
import { diagnosticsLock, type DiagnosticsLockOwner } from '../../diagnostics/diagnosticsLock';
import type { PerfettoController } from '../perfettoController';
import type { ExtMsg, WebMsg, WebviewState, SerializedPerfettoSession } from '../webview/protocol';

const VIEW_ID = 'kopytko.perfetto';

/** Copies a Node Buffer into a plain ArrayBuffer safe to transfer to a webview. */
function bufToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * VS Code WebviewViewProvider for the Kopytko Perfetto bottom panel.
 *
 * Responsibilities:
 * - Forwards binary chunks from the controller to the webview as ArrayBuffer
 *   transferables so the webview can accumulate them and push to the Perfetto iframe.
 * - Subscribes to DiagnosticsLock and notifies the webview when the lock owner changes.
 * - Populates the session list from the controller.
 * - Handles replay: reads the trace file and sends the full buffer to the webview.
 * - Delegates start/stop/heap-snapshot to the controller.
 */
export class PerfettoViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = VIEW_ID;

  private webviewView: vscode.WebviewView | undefined;
  private chunkListener: ((chunk: Buffer) => void) | undefined;
  private stopListener: (() => void) | undefined;
  private lockChangeListener: ((owner: DiagnosticsLockOwner | null) => void) | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: PerfettoController,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'perfetto-webview'),
      ],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebMsg) => {
      switch (msg.kind) {
        case 'start':
          void this.handleStart();
          break;
        case 'stop':
          void this.controller.stopSession().then(() => {
            this.sendState();
            this.sendSessions();
          });
          break;
        case 'new-session':
          void this.handleNewSession();
          break;
        case 'heap-snapshot':
          void this.controller.captureHeapSnapshot();
          break;
        case 'load-session':
          void this.loadReplay(msg.dir);
          break;
        case 'load-live':
          this.sendState();
          this.sendLiveBuffer();
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendLock();
        this.sendState();
        this.sendSessions();
        if (this.controller.isRecording) this.sendLiveBuffer();
      }
    });

    // Subscribe to lock changes so we can notify the webview immediately.
    this.lockChangeListener = (owner) => {
      this.post({ kind: 'lock', owner } satisfies ExtMsg);
    };
    diagnosticsLock.on('change', this.lockChangeListener);

    this.attachControllerListeners();

    this.sendLock();
    this.sendState();
    this.sendSessions();
    if (this.controller.isRecording) this.sendLiveBuffer();
  }

  /** Call after a session starts outside the webview (e.g. via command). */
  notifyStateChange(): void {
    this.sendState();
    this.sendSessions();
    this.attachControllerListeners();
  }

  dispose(): void {
    this.detachControllerListeners();
    if (this.lockChangeListener) {
      diagnosticsLock.removeListener('change', this.lockChangeListener);
      this.lockChangeListener = undefined;
    }
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private async handleStart(): Promise<void> {
    try {
      const session = await this.controller.startSession();
      if (session) {
        this.attachControllerListeners();
        this.sendState();
        this.sendSessions();
      } else {
        // startSession returned undefined (warning already shown) — reset state.
        this.sendState();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ kind: 'error', message } satisfies ExtMsg);
    }
  }

  private async handleNewSession(): Promise<void> {
    if (this.controller.isRecording) {
      await this.controller.stopSession();
    }
    await this.handleStart();
  }

  private async loadReplay(dir: string): Promise<void> {
    try {
      const trace = this.controller.readSessionTrace(dir);
      const sessions = this.controller.listSessions();
      const meta = sessions.find((s) => s.dir === dir);
      if (!meta) {
        void vscode.window.showWarningMessage(`Cannot find Perfetto session: ${dir}`);
        return;
      }
      const session: SerializedPerfettoSession = {
        dir: meta.dir,
        id: meta.id,
        startedWall: meta.startedWall,
        endedWall: meta.endedWall,
        appTitle: meta.appTitle,
        deviceIp: meta.deviceIp,
        traceBytes: meta.traceBytes,
      };
      // Transfer the ArrayBuffer for zero-copy delivery to the webview.
      const ab = bufToArrayBuffer(trace);
      this.post({ kind: 'replay', session, data: ab } satisfies ExtMsg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ kind: 'error', message } satisfies ExtMsg);
    }
  }

  private attachControllerListeners(): void {
    this.detachControllerListeners();

    this.chunkListener = (chunk: Buffer) => {
      this.post({ kind: 'chunk', data: bufToArrayBuffer(chunk) } satisfies ExtMsg);
    };
    this.controller.on('data', this.chunkListener);

    this.stopListener = () => {
      this.sendState();
      this.sendSessions();
    };
    this.controller.once('stop', this.stopListener);
  }

  private detachControllerListeners(): void {
    if (this.chunkListener) {
      this.controller.removeListener('data', this.chunkListener);
      this.chunkListener = undefined;
    }
    if (this.stopListener) {
      this.controller.removeListener('stop', this.stopListener);
      this.stopListener = undefined;
    }
  }

  private sendLock(): void {
    this.post({ kind: 'lock', owner: diagnosticsLock.owner } satisfies ExtMsg);
  }

  private sendState(): void {
    const session = this.controller.activeSession;
    const device = this.controller.getActiveDevice();
    const webviewState: WebviewState = this.controller.isRecording ? 'recording' : 'idle';
    this.post({
      kind: 'state',
      state: webviewState,
      sessionId: session?.id,
      sessionStartWall: session?.startedWall,
      device: device
        ? {
            name: device.friendlyName ?? device.modelName,
            ip: device.ip,
            appTitle: session?.app.title,
          }
        : undefined,
    } satisfies ExtMsg);
  }

  private sendSessions(): void {
    const raw = this.controller.listSessions();
    const sessions: SerializedPerfettoSession[] = raw.map((s) => ({
      dir: s.dir,
      id: s.id,
      startedWall: s.startedWall,
      endedWall: s.endedWall,
      appTitle: s.appTitle,
      deviceIp: s.deviceIp,
      traceBytes: s.traceBytes,
    }));
    this.post({ kind: 'sessions', sessions } satisfies ExtMsg);
  }

  private sendLiveBuffer(): void {
    const buf = this.controller.getActiveBuffer();
    if (!buf || buf.byteLength === 0) return;
    this.post({ kind: 'chunk', data: bufToArrayBuffer(buf) } satisfies ExtMsg);
  }

  private post(msg: ExtMsg): void {
    if (this.webviewView?.visible) {
      void this.webviewView.webview.postMessage(msg);
    }
  }

  // ── HTML ──────────────────────────────────────────────────────────────────────

  private buildHtml(webview: vscode.Webview): string {
    const outDir = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'perfetto-webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.js'));
    const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.css'));
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${csp} 'unsafe-inline';
                 script-src ${csp};
                 img-src ${csp} data:;
                 frame-src https://ui.perfetto.dev;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Kopytko Perfetto</title>
</head>
<body>
  <div id="toolbar">
    <button id="btn-start" class="btn btn-primary">$(debug-start) Start</button>
    <button id="btn-stop" class="btn btn-secondary" disabled>$(debug-stop) Stop</button>
    <button id="btn-new-session" class="btn btn-secondary" disabled>$(refresh) New Session</button>
    <button id="btn-heap" class="btn btn-secondary" disabled title="Capture heap snapshot">$(database) Heap</button>
    <span id="live-badge">● LIVE</span>
    <span id="buffer-size"></span>
    <span id="device-info"></span>
    <span class="sep"></span>
    <select id="session-select">
      <option value="">— past sessions —</option>
    </select>
  </div>
  <div id="lock-banner">
    Diagnostics panel is currently recording. Stop it to use Kopytko Perfetto.
  </div>
  <div id="status-bar"></div>
  <iframe
    id="perfetto-frame"
    src="https://ui.perfetto.dev/#!/?mode=embedded&hideSidebar=true"
    style="display:none"
    allow="clipboard-read; clipboard-write">
  </iframe>
  <div id="placeholder">
    <p>Click <strong>Start</strong> to deploy your app with Perfetto tracing enabled and begin a live trace session.</p>
    <p style="font-size:11px">Requires Roku firmware 15.2+. On first use, Perfetto will ask you to trust this origin — click <em>Always trust</em>.</p>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

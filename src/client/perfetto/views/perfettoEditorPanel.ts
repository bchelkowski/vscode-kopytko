import * as vscode from 'vscode';
import { diagnosticsLock, type DiagnosticsLockOwner } from '../../diagnostics/diagnosticsLock';
import type { PerfettoController } from '../perfettoController';
import type { ExtMsg, WebMsg, WebviewState, SerializedPerfettoSession } from '../webview/protocol';

const VIEW_TYPE = 'kopytkoPercetto';
const TITLE     = 'Kopytko Perfetto';

/** Copies a Node Buffer into a plain ArrayBuffer safe to transfer to a webview. */
function bufToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * Singleton editor-tab panel for Kopytko Perfetto.
 *
 * Call `PerfettoEditorPanel.createOrReveal(context, controller)` to open or
 * focus the tab. The panel manages its own lifecycle — disposing when the
 * user closes the tab.
 */
export class PerfettoEditorPanel {
  private static _instance: PerfettoEditorPanel | undefined;

  static createOrReveal(
    context: vscode.ExtensionContext,
    controller: PerfettoController,
  ): PerfettoEditorPanel {
    if (PerfettoEditorPanel._instance) {
      PerfettoEditorPanel._instance._panel.reveal(vscode.ViewColumn.One);
      return PerfettoEditorPanel._instance;
    }
    return new PerfettoEditorPanel(context, controller);
  }

  static get instance(): PerfettoEditorPanel | undefined {
    return PerfettoEditorPanel._instance;
  }

  // ── instance ──────────────────────────────────────────────────────────────

  private readonly _panel: vscode.WebviewPanel;
  private _chunkListener: ((chunk: Buffer) => void) | undefined;
  private _stopListener: (() => void) | undefined;
  private _lockListener: ((owner: DiagnosticsLockOwner | null) => void) | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: PerfettoController,
  ) {
    this._panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'out', 'perfetto-webview'),
        ],
      },
    );

    this._panel.webview.html = this._buildHtml(this._panel.webview);

    this._panel.webview.onDidReceiveMessage((msg: WebMsg) => this._onMsg(msg));

    this._panel.onDidDispose(() => {
      // If a session is running when the user closes the tab, stop it.
      if (this.controller.isRecording) {
        void this.controller.stopSession();
      }
      this._teardown();
      PerfettoEditorPanel._instance = undefined;
    });

    this._panel.onDidChangeViewState(() => {
      if (this._panel.visible) {
        this._sendLock();
        this._sendState();
        this._sendSessions();
        if (this.controller.isRecording) this._sendLiveBuffer();
      }
    });

    // Subscribe to lock changes.
    this._lockListener = (owner) => this._post({ kind: 'lock', owner } satisfies ExtMsg);
    diagnosticsLock.on('change', this._lockListener);

    this._attachControllerListeners();

    this._sendLock();
    this._sendState();
    this._sendSessions();
    if (this.controller.isRecording) this._sendLiveBuffer();

    PerfettoEditorPanel._instance = this;
  }

  // ── public ────────────────────────────────────────────────────────────────

  notifyStateChange(): void {
    this._sendState();
    this._sendSessions();
    this._attachControllerListeners();
  }

  dispose(): void {
    this._panel.dispose();
  }

  // ── message handler ───────────────────────────────────────────────────────

  private _onMsg(msg: WebMsg): void {
    switch (msg.kind) {
      case 'start':
        void this._handleStart();
        break;
      case 'stop':
        void this.controller.stopSession().then(() => {
          this._sendState();
          this._sendSessions();
        });
        break;
      case 'new-session':
        void this._handleNewSession();
        break;
      case 'heap-snapshot':
        void this.controller.captureHeapSnapshot();
        break;
      case 'load-session':
        void this._loadReplay(msg.dir);
        break;
      case 'load-live':
        this._sendState();
        this._sendLiveBuffer();
        break;
    }
  }

  private async _handleStart(): Promise<void> {
    try {
      const session = await this.controller.startSession();
      if (session) {
        this._attachControllerListeners();
        this._sendState();
        this._sendSessions();
      } else {
        this._sendState();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._post({ kind: 'error', message } satisfies ExtMsg);
    }
  }

  private async _handleNewSession(): Promise<void> {
    if (this.controller.isRecording) await this.controller.stopSession();
    await this._handleStart();
  }

  private async _loadReplay(dir: string): Promise<void> {
    try {
      const trace = this.controller.readSessionTrace(dir);
      const sessions = this.controller.listSessions();
      const meta = sessions.find((s) => s.dir === dir);
      if (!meta) {
        void vscode.window.showWarningMessage(`Cannot find Perfetto session: ${dir}`);
        return;
      }
      const session: SerializedPerfettoSession = {
        dir: meta.dir, id: meta.id,
        startedWall: meta.startedWall, endedWall: meta.endedWall,
        appTitle: meta.appTitle, deviceIp: meta.deviceIp, traceBytes: meta.traceBytes,
      };
      const ab = bufToArrayBuffer(trace);
      this._post({ kind: 'replay', session, data: ab } satisfies ExtMsg);
    } catch (err) {
      this._post({ kind: 'error', message: (err as Error).message } satisfies ExtMsg);
    }
  }

  // ── controller listeners ──────────────────────────────────────────────────

  private _attachControllerListeners(): void {
    this._detachControllerListeners();

    this._chunkListener = (chunk: Buffer) => {
      this._post({ kind: 'chunk', data: bufToArrayBuffer(chunk) } satisfies ExtMsg);
    };
    this.controller.on('data', this._chunkListener);

    this._stopListener = () => {
      this._sendState();
      this._sendSessions();
    };
    this.controller.once('stop', this._stopListener);

    this.controller.once('deploying', () => {
      this._post({ kind: 'state', state: 'deploying' } satisfies ExtMsg);
    });
  }

  private _detachControllerListeners(): void {
    if (this._chunkListener) {
      this.controller.removeListener('data', this._chunkListener);
      this._chunkListener = undefined;
    }
    if (this._stopListener) {
      this.controller.removeListener('stop', this._stopListener);
      this._stopListener = undefined;
    }
  }

  private _teardown(): void {
    this._detachControllerListeners();
    if (this._lockListener) {
      diagnosticsLock.removeListener('change', this._lockListener);
      this._lockListener = undefined;
    }
  }

  // ── state helpers ─────────────────────────────────────────────────────────

  private _sendLock(): void {
    this._post({ kind: 'lock', owner: diagnosticsLock.owner } satisfies ExtMsg);
  }

  private _sendState(): void {
    const session = this.controller.activeSession;
    const device = this.controller.getActiveDevice();
    const webviewState: WebviewState = this.controller.isRecording ? 'recording' : 'idle';
    this._post({
      kind: 'state',
      state: webviewState,
      sessionId: session?.id,
      sessionStartWall: session?.startedWall,
      device: device
        ? { name: device.friendlyName ?? device.modelName, ip: device.ip, appTitle: session?.app.title }
        : undefined,
    } satisfies ExtMsg);
  }

  private _sendSessions(): void {
    const raw = this.controller.listSessions();
    const sessions: SerializedPerfettoSession[] = raw.map((s) => ({
      dir: s.dir, id: s.id,
      startedWall: s.startedWall, endedWall: s.endedWall,
      appTitle: s.appTitle, deviceIp: s.deviceIp, traceBytes: s.traceBytes,
    }));
    this._post({ kind: 'sessions', sessions } satisfies ExtMsg);
  }

  private _sendLiveBuffer(): void {
    const buf = this.controller.getActiveBuffer();
    if (!buf || buf.byteLength === 0) return;
    this._post({ kind: 'chunk', data: bufToArrayBuffer(buf) } satisfies ExtMsg);
  }

  private _post(msg: ExtMsg): void {
    if (this._panel.visible) {
      void this._panel.webview.postMessage(msg);
    }
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(webview: vscode.Webview): string {
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
  <div id="top-bar">
    <div id="toolbar">
      <div class="status-dot" id="status-dot"></div>
      <span id="device-label">No device</span>
      <select id="session-select" title="Switch between live view and recorded sessions">
        <option value="">Kopytko Perfetto</option>
      </select>
      <button id="btn-toggle">Start</button>
      <button id="btn-new-session" class="secondary" title="Stop current session and start a fresh one">New Session</button>
      <button id="btn-sync" class="secondary" disabled title="Push latest trace data to the Perfetto viewer">Sync</button>
      <button id="btn-heap" class="secondary" disabled title="Capture heap snapshot">Heap</button>
      <span id="sync-badge" style="display:none"></span>
      <span id="buffer-size"></span>
      <span id="elapsed"></span>
    </div>
    <div id="lock-banner">
      Diagnostics panel is currently recording — stop it to use Kopytko Perfetto.
    </div>
    <div id="status-bar"></div>
  </div>
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

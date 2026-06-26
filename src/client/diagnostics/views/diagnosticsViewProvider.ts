import * as vscode from 'vscode';
import type { DiagnosticsController } from '../diagnosticsController';
import type { DiagnosticsSession } from '../session/diagnosticsSession';
import type {
  DiagnosticEvent,
  MemCpuEvent,
  NodeCountsEvent,
  RendezvousEvent,
} from '../session/eventModel';
import type {
  ExtMsg,
  WebMsg,
  WebviewState,
  SerializedMemCpuPoint,
  SerializedNodePoint,
  SerializedRendezvousPoint,
} from '../webview/protocol';
const VIEW_ID = 'kopytko.diagnostics';
const BATCH_INTERVAL_MS = 250;

/**
 * VS Code WebviewViewProvider for the Kopytko Diagnostics bottom panel.
 *
 * Bridges between {@link DiagnosticsController} and the webview bundle:
 * - Sends an `init` message (current state + ring-buffer history) when the
 *   panel opens or becomes visible again.
 * - Throttles incoming session events into 250ms `batch` messages so the
 *   webview canvas isn't redrawn more than ~4× per second.
 * - Handles `start`/`stop` webview messages by delegating to the controller.
 */
export class DiagnosticsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = VIEW_ID;

  private webviewView: vscode.WebviewView | undefined;
  private batchTimer: ReturnType<typeof setInterval> | undefined;
  private pendingMemCpu: SerializedMemCpuPoint[] = [];
  private pendingNodes: SerializedNodePoint[] = [];
  private pendingRendezvous: SerializedRendezvousPoint[] = [];
  private sessionListener: ((event: DiagnosticEvent) => void) | undefined;
  private trackedSession: DiagnosticsSession | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: DiagnosticsController,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'diagnostics-webview'),
      ],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebMsg) => {
      switch (msg.kind) {
        case 'start':
          void this.controller.startSession().then(() => this.syncSession());
          break;
        case 'stop':
          void this.controller.stopSession().then(() => this.onSessionStopped());
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.sendInit();
    });

    this.sendInit();
    this.syncSession();
  }

  /** Call after a session starts/stops outside the webview (e.g. via command). */
  notifyStateChange(): void {
    this.syncSession();
    this.sendState();
  }

  dispose(): void {
    this.stopBatchTimer();
    this.detachSession();
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private sendInit(): void {
    const session = this.controller.activeSession;
    const history = this.buildHistory(session);
    const msg: ExtMsg = {
      kind: 'init',
      state: this.buildState(),
      history,
    };
    this.post(msg);
  }

  private sendState(): void {
    this.post({ kind: 'state', state: this.buildState() } satisfies ExtMsg);
  }

  private onSessionStopped(): void {
    this.stopBatchTimer();
    this.detachSession();
    this.sendState();
  }

  private syncSession(): void {
    const session = this.controller.activeSession;
    if (session === this.trackedSession) return;

    this.detachSession();

    if (session && session.isRunning) {
      this.trackedSession = session;
      this.sessionListener = (event) => this.onEvent(event);
      session.on('event', this.sessionListener);
      session.once('stopped', () => this.onSessionStopped());
      this.startBatchTimer();
    }

    this.sendState();
  }

  private onEvent(event: DiagnosticEvent): void {
    switch (event.type) {
      case 'mem-cpu': {
        const e = event as MemCpuEvent;
        this.pendingMemCpu.push({
          wall: e.wall,
          memKiB: e.memKiB,
          anonKiB: e.anonKiB,
          fileKiB: e.fileKiB,
          cpuPct: e.cpuPct,
          cpuUser: e.cpuUser,
          cpuSys: e.cpuSys,
        });
        break;
      }
      case 'node-counts': {
        const e = event as NodeCountsEvent;
        this.pendingNodes.push({ wall: e.wall, totalCount: e.totalCount });
        break;
      }
      case 'rendezvous': {
        const e = event as RendezvousEvent;
        this.pendingRendezvous.push({
          wall: e.wall,
          durationMs: e.durationMs,
          file: e.file,
          line: e.line,
        });
        break;
      }
    }
  }

  private flushBatch(): void {
    if (
      this.pendingMemCpu.length === 0 &&
      this.pendingNodes.length === 0 &&
      this.pendingRendezvous.length === 0
    ) {
      return;
    }
    const msg: ExtMsg = {
      kind: 'batch',
      memCpu: this.pendingMemCpu.splice(0),
      nodes: this.pendingNodes.splice(0),
      rendezvous: this.pendingRendezvous.splice(0),
    };
    this.post(msg);
  }

  private startBatchTimer(): void {
    if (this.batchTimer) return;
    this.batchTimer = setInterval(() => this.flushBatch(), BATCH_INTERVAL_MS);
    this.batchTimer.unref?.();
  }

  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
    this.pendingMemCpu = [];
    this.pendingNodes = [];
    this.pendingRendezvous = [];
  }

  private detachSession(): void {
    if (this.trackedSession && this.sessionListener) {
      this.trackedSession.removeListener('event', this.sessionListener);
    }
    this.trackedSession = undefined;
    this.sessionListener = undefined;
  }

  private buildState(): WebviewState {
    const session = this.controller.activeSession;
    const device = this.controller.getActiveDevice();
    return {
      recording: this.controller.isRecording,
      sessionStartWall: session?.manifest.startedWall,
      device: device
        ? {
            name: device.friendlyName ?? device.modelName,
            ip: device.ip,
            appTitle: session?.manifest.app.title,
            appVersion: session?.manifest.app.version,
          }
        : undefined,
    };
  }

  private buildHistory(session: DiagnosticsSession | undefined) {
    if (!session) {
      return { memCpu: [], nodes: [], rendezvous: [] };
    }
    const memCpu: SerializedMemCpuPoint[] = (session.getRing('mem-cpu') as MemCpuEvent[]).map(
      (e) => ({
        wall: e.wall,
        memKiB: e.memKiB,
        anonKiB: e.anonKiB,
        fileKiB: e.fileKiB,
        cpuPct: e.cpuPct,
        cpuUser: e.cpuUser,
        cpuSys: e.cpuSys,
      }),
    );
    const nodes: SerializedNodePoint[] = (session.getRing('node-counts') as NodeCountsEvent[]).map(
      (e) => ({ wall: e.wall, totalCount: e.totalCount }),
    );
    const rendezvous: SerializedRendezvousPoint[] = (
      session.getRing('rendezvous') as RendezvousEvent[]
    ).map((e) => ({ wall: e.wall, durationMs: e.durationMs, file: e.file, line: e.line }));
    return { memCpu, nodes, rendezvous };
  }

  private post(msg: ExtMsg): void {
    if (this.webviewView?.visible) {
      void this.webviewView.webview.postMessage(msg);
    }
  }

  // ── HTML ──────────────────────────────────────────────────────────────────────

  private buildHtml(webview: vscode.Webview): string {
    const outDir = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'diagnostics-webview');
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
  <title>Kopytko Diagnostics</title>
</head>
<body>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

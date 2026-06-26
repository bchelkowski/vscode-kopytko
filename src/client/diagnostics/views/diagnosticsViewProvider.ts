import * as path from 'path';
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
  SerializedSessionInfo,
} from '../webview/protocol';
import { SessionReader } from '../storage/sessionReader';
import { readManifest } from '../storage/sessionStore';
import { nodeSink } from '../storage/sink';
import { resolveRendezvousFile } from '../../roku/util/resolveSourceFile';

const VIEW_ID = 'kopytko.diagnostics';
const BATCH_INTERVAL_MS = 250;

/** Converts the manifest `streams` map to a plain `{ type -> count }` record. */
function streamCounts(
  streams: Partial<Record<string, { file: string; count: number }>> | undefined,
): Partial<Record<string, number>> {
  if (!streams) return {};
  return Object.fromEntries(
    Object.entries(streams)
      .filter((entry): entry is [string, { file: string; count: number }] => entry[1] != null)
      .map(([k, v]) => [k, v.count]),
  );
}

/**
 * VS Code WebviewViewProvider for the Kopytko Diagnostics bottom panel.
 *
 * Responsibilities:
 * - Sends an `init` message (current state + ring-buffer history) when the panel opens.
 * - Throttles live session events into 250 ms `batch` messages.
 * - Sends a `sessions` message (list of recorded sessions) so the webview can
 *   populate its session selector.
 * - Handles `load-session` by reading the NDJSON files from disk via SessionReader
 *   and sending a `replay` message (read-only, no new data written).
 * - Handles `load-live` by re-sending `init` to restore the live view.
 * - Handles `open-node` / `open-rendezvous` by navigating the editor to the source file.
 * - Handles `start` / `stop` by delegating to the controller.
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
        case 'open-rendezvous':
          void this.openRendezvousFile(msg.file, msg.line);
          break;
        case 'load-session':
          void this.loadSessionReplay(msg.dir);
          break;
        case 'load-live':
          this.sendInit();
          break;
        case 'new-session':
          void this.handleNewSession();
          break;
        case 'clear-view':
          this.post({
            kind: 'init',
            state: this.buildState(),
            history: { memCpu: [], nodes: [], rendezvous: [] },
          } satisfies ExtMsg);
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendInit();
        void this.sendSessions();
      }
    });

    this.sendInit();
    void this.sendSessions();
    this.syncSession();
  }

  /** Call after a session starts/stops outside the webview (e.g. via command). */
  notifyStateChange(): void {
    this.syncSession();
    this.sendState();
    void this.sendSessions();
  }

  dispose(): void {
    this.stopBatchTimer();
    this.detachSession();
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private sendInit(): void {
    const session = this.controller.activeSession;
    const msg: ExtMsg = {
      kind: 'init',
      state: this.buildState(),
      history: this.buildHistory(session),
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
    void this.sendSessions();
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
        this.pendingNodes.push({ wall: e.wall, totalCount: e.totalCount, types: e.types });
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
    this.post({
      kind: 'batch',
      memCpu: this.pendingMemCpu.splice(0),
      nodes: this.pendingNodes.splice(0),
      rendezvous: this.pendingRendezvous.splice(0),
    } satisfies ExtMsg);
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

  // ── Session replay ────────────────────────────────────────────────────────────

  private async sendSessions(): Promise<void> {
    const root = this.resolveOutputRoot();
    if (!root) return;

    const reader = new SessionReader(nodeSink);
    let discovered;
    try {
      discovered = await reader.listSessions(root);
    } catch {
      return; // root may not exist yet (no sessions recorded)
    }

    const sessions: SerializedSessionInfo[] = discovered.map(({ dir, manifest }) => ({
      dir,
      id: manifest.id,
      startedWall: manifest.startedWall,
      endedWall: manifest.endedWall,
      appTitle: manifest.app.title,
      deviceIp: manifest.device.ip,
      sampleCounts: streamCounts(manifest.streams),
    }));

    this.post({ kind: 'sessions', sessions } satisfies ExtMsg);
  }

  private async loadSessionReplay(dir: string): Promise<void> {
    const reader = new SessionReader(nodeSink);
    const cfg = vscode.workspace.getConfiguration('kopytko');
    const maxPoints = cfg.get<number>('diagnostics.maxLivePoints', 3600);

    // Read mem-cpu stream
    const mcRaw = await reader.readStream<MemCpuEvent>(dir, 'mem-cpu');
    const mcCapped = mcRaw.slice(-maxPoints);
    const memCpu: SerializedMemCpuPoint[] = mcCapped.map((e) => ({
      wall: e.wall,
      memKiB: e.memKiB,
      anonKiB: e.anonKiB,
      fileKiB: e.fileKiB,
      cpuPct: e.cpuPct,
      cpuUser: e.cpuUser,
      cpuSys: e.cpuSys,
    }));

    // Read node-counts stream — types only for first+last to keep message small
    const ncRaw = await reader.readStream<NodeCountsEvent>(dir, 'node-counts');
    const ncCapped = ncRaw.slice(-maxPoints);
    const nodes: SerializedNodePoint[] = ncCapped.map((e, i) => ({
      wall: e.wall,
      totalCount: e.totalCount,
      // Include full type breakdown only at the endpoints so the list view works
      // without inflating every intermediate sample.
      types: (i === 0 || i === ncCapped.length - 1) ? e.types : [],
    }));

    // Read rendezvous stream
    const renRaw = await reader.readStream<RendezvousEvent>(dir, 'rendezvous');
    const renCapped = renRaw.slice(-maxPoints);
    const rendezvous: SerializedRendezvousPoint[] = renCapped.map((e) => ({
      wall: e.wall,
      durationMs: e.durationMs,
      file: e.file,
      line: e.line,
    }));

    // Build session info from the manifest
    const manifest = await readManifest(nodeSink, dir);
    if (!manifest) {
      void vscode.window.showWarningMessage(`Cannot read session manifest: ${dir}`);
      return;
    }

    const session: SerializedSessionInfo = {
      dir,
      id: manifest.id,
      startedWall: manifest.startedWall,
      endedWall: manifest.endedWall,
      appTitle: manifest.app.title,
      deviceIp: manifest.device.ip,
      sampleCounts: streamCounts(manifest.streams),
    };

    this.post({ kind: 'replay', session, history: { memCpu, nodes, rendezvous } } satisfies ExtMsg);
  }

  private resolveOutputRoot(): string | undefined {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return undefined;
    const outputDir = vscode.workspace
      .getConfiguration('kopytko')
      .get<string>('diagnostics.outputDir', 'debug');
    return path.isAbsolute(outputDir) ? outputDir : path.join(workspaceRoot, outputDir);
  }

  // ── New session ───────────────────────────────────────────────────────────────

  private async handleNewSession(): Promise<void> {
    if (!this.controller.isRecording) return;
    await this.controller.stopSession();
    // onSessionStopped() fires via the 'stopped' event during stopSession(),
    // which detaches the old session, calls sendState(), and calls sendSessions().
    const session = await this.controller.startSession();
    if (session) {
      this.syncSession();
      // Send init with empty history — the new session has no data yet.
      this.sendInit();
    }
  }

  // ── File navigation ───────────────────────────────────────────────────────────

  private async openRendezvousFile(pkgPath: string, line: number): Promise<void> {
    const uri = await resolveRendezvousFile('', pkgPath);
    if (!uri) {
      void vscode.window.showInformationMessage(`Cannot find file: ${pkgPath}`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter,
    );
  }

  // ── State helpers ─────────────────────────────────────────────────────────────

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
    if (!session) return { memCpu: [], nodes: [], rendezvous: [] };
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
      (e) => ({ wall: e.wall, totalCount: e.totalCount, types: e.types }),
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
    const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.css'));
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

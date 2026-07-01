import * as path from 'path';
import * as vscode from 'vscode';
import type { DiagnosticsController } from '../diagnosticsController';
import type { DiagnosticsSession } from '../session/diagnosticsSession';
import type {
  DiagnosticEvent,
  DiagnosticEventType,
  MemCpuEvent,
  NodeCountsEvent,
  RendezvousEvent,
  TexturesEvent,
  AppStateEvent,
  FwBeaconEvent,
} from '../session/eventModel';
import type {
  ExtMsg,
  WebMsg,
  WebviewState,
  SerializedMemCpuPoint,
  SerializedNodePoint,
  SerializedRendezvousPoint,
  SerializedTexturePoint,
  SerializedAppStatePoint,
  SerializedBeaconPoint,
  SerializedSessionInfo,
  ChartId,
  TableId,
} from '../webview/protocol';
import type { RecordableApp } from '../diagnosticsController';
import { SessionReader } from '../storage/sessionReader';
import { readManifest } from '../storage/sessionStore';
import { nodeSink } from '../storage/sink';
import { resolveRendezvousFile } from '../../roku/util/resolveSourceFile';

const VIEW_ID = 'kopytko.diagnostics';
const BATCH_INTERVAL_MS = 250;

interface VisibilityState {
  charts: ChartId[];
  tables: TableId[];
  rendezvousOverlay: boolean;
  beaconOverlay: boolean;
}

/** Collector event types whose lifecycle is driven by webview visibility (excludes system-mem/app-state, which are session-wide). */
const VISIBILITY_DRIVEN_TYPES: DiagnosticEventType[] = ['mem-cpu', 'node-counts', 'rendezvous', 'textures', 'fw-beacon'];

function neededTypesFor(vis: VisibilityState): Set<DiagnosticEventType> {
  const needed = new Set<DiagnosticEventType>();
  if (vis.charts.includes('memory') || vis.charts.includes('cpu')) needed.add('mem-cpu');
  if (vis.charts.includes('nodes')) needed.add('node-counts');
  if (vis.charts.includes('textures')) needed.add('textures');
  if (vis.tables.includes('nodes')) needed.add('node-counts');
  if (vis.tables.includes('rendezvous')) needed.add('rendezvous');
  if (vis.tables.includes('textures')) needed.add('textures');
  if (vis.rendezvousOverlay && vis.charts.length > 0) needed.add('rendezvous');
  if (vis.beaconOverlay && vis.charts.length > 0) needed.add('fw-beacon');
  return needed;
}

function emptyHistory() {
  return { memCpu: [], nodes: [], rendezvous: [], textures: [], appState: [], beacons: [] };
}

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
  private noDataTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingMemCpu: SerializedMemCpuPoint[] = [];
  private pendingNodes: SerializedNodePoint[] = [];
  private pendingRendezvous: SerializedRendezvousPoint[] = [];
  private pendingTextures: SerializedTexturePoint[] = [];
  private pendingAppState: SerializedAppStatePoint[] = [];
  private pendingBeacons: SerializedBeaconPoint[] = [];
  private sessionListener: ((event: DiagnosticEvent) => void) | undefined;
  private trackedSession: DiagnosticsSession | undefined;
  private visibility: VisibilityState;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: DiagnosticsController,
  ) {
    const cfg = vscode.workspace.getConfiguration('kopytko');
    this.visibility = {
      charts: cfg.get<ChartId[]>('diagnostics.defaultVisibleCharts', ['memory', 'cpu', 'nodes']),
      tables: cfg.get<TableId[]>('diagnostics.defaultVisibleTables', ['nodes', 'rendezvous']),
      rendezvousOverlay: true,
      beaconOverlay: false,
    };
  }

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
          void this.controller.startSession().then((session) => {
            this.syncSession();
            // If startSession returned undefined (e.g. lock blocked it), still
            // update state so the webview reflects the current recording status.
            if (!session) this.sendState();
            else this.applyVisibility();
          });
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
            history: emptyHistory(),
          } satisfies ExtMsg);
          break;
        case 'visibility':
          this.visibility = {
            charts: msg.charts,
            tables: msg.tables,
            rendezvousOverlay: msg.rendezvousOverlay,
            beaconOverlay: msg.beaconOverlay,
          };
          this.applyVisibility();
          break;
        case 'select-app': {
          // setSelectedApp() sets the controller's selectedAppId synchronously
          // (before its internal `await stopSession()`, if any), so calling it
          // first means the immediate reset below already reflects the new
          // selection instead of flashing the old one first.
          const applied = this.controller.setSelectedApp(msg.appId);
          // Reset the view immediately, synchronously — the previously
          // displayed data belongs to a different channel now, and
          // setSelectedApp() may await stopSession() (a real device round
          // trip), so it shouldn't linger on screen for however long that
          // takes. The next Start always builds a brand new session (new
          // timestamped folder/manifest), so nothing here risks writing into
          // the old channel's files.
          this.post({
            kind: 'init',
            state: this.buildState(),
            history: emptyHistory(),
          } satisfies ExtMsg);
          void applied.then(() => {
            // A stop triggered by the app change fires 'stopped' on the session,
            // which already calls onSessionStopped() (detaches listeners, sends
            // state/sessions) via the listener registered in syncSession().
            // Send state again here too in case no stop actually occurred.
            this.sendState();
          });
          break;
        }
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendInit();
        void this.sendSessions();
        void this.sendApps();
      }
    });

    this.sendInit();
    void this.sendSessions();
    void this.sendApps();
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
    this.clearNoDataTimer();
    this.detachSession();
    this.sendState();
    void this.sendSessions();
  }

  /**
   * Starts/stops collectors on the active session to match the webview's current
   * chart/table/overlay selection — so we never poll a metric nothing displays.
   */
  private applyVisibility(): void {
    if (!this.controller.isRecording) return;
    const needed = neededTypesFor(this.visibility);
    for (const type of VISIBILITY_DRIVEN_TYPES) {
      this.controller.setCollectorActive(type, needed.has(type));
    }
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
      this.startNoDataTimer();
      this.applyVisibility();
    }

    this.sendState();
  }

  private onEvent(event: DiagnosticEvent): void {
    this.clearNoDataTimer(); // first event clears the "no data" warning
    switch (event.type) {
      case 'mem-cpu': {
        const e = event as MemCpuEvent;
        this.pendingMemCpu.push({
          wall: e.wall,
          memKiB: e.memKiB,
          anonKiB: e.anonKiB,
          fileKiB: e.fileKiB,
          sharedKiB: e.sharedKiB,
          swapKiB: e.swapKiB,
          limitKiB: e.limitKiB,
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
      case 'textures': {
        const e = event as TexturesEvent;
        this.pendingTextures.push({
          wall: e.wall,
          usedBytes: e.usedBytes,
          maxBytes: e.maxBytes,
          availableBytes: e.availableBytes,
          count: e.count,
          totalSizeBytes: e.totalSizeBytes,
          bitmaps: e.bitmaps.map((b) => ({ width: b.width, height: b.height, sizeBytes: b.sizeBytes, name: b.name })),
        });
        break;
      }
      case 'app-state': {
        const e = event as AppStateEvent;
        this.pendingAppState.push({ wall: e.wall, state: e.state });
        break;
      }
      case 'fw-beacon': {
        const e = event as FwBeaconEvent;
        this.pendingBeacons.push({ wall: e.wall, name: e.name, timeBaseMs: e.timeBaseMs });
        break;
      }
    }
  }

  private flushBatch(): void {
    if (
      this.pendingMemCpu.length === 0 &&
      this.pendingNodes.length === 0 &&
      this.pendingRendezvous.length === 0 &&
      this.pendingTextures.length === 0 &&
      this.pendingAppState.length === 0 &&
      this.pendingBeacons.length === 0
    ) {
      return;
    }
    this.post({
      kind: 'batch',
      memCpu: this.pendingMemCpu.splice(0),
      nodes: this.pendingNodes.splice(0),
      rendezvous: this.pendingRendezvous.splice(0),
      textures: this.pendingTextures.splice(0),
      appState: this.pendingAppState.splice(0),
      beacons: this.pendingBeacons.splice(0),
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
    this.pendingTextures = [];
    this.pendingAppState = [];
    this.pendingBeacons = [];
  }

  private startNoDataTimer(): void {
    this.clearNoDataTimer();
    this.noDataTimer = setTimeout(() => {
      this.noDataTimer = undefined;
      this.post({
        kind: 'status',
        message:
          '⚠ No data from port 8080 (SceneGraph debug console) after 15 s. ' +
          'Ensure a developer (sideloaded) channel is actively running on the device. ' +
          'Check the "Kopytko Diagnostics" output channel (View → Output) for connection details.',
      } satisfies ExtMsg);
    }, 15_000);
  }

  private clearNoDataTimer(): void {
    if (this.noDataTimer) {
      clearTimeout(this.noDataTimer);
      this.noDataTimer = undefined;
      // First data arrived — clear any previous warning.
      this.post({ kind: 'status', message: null } satisfies ExtMsg);
    }
  }

  private detachSession(): void {
    if (this.trackedSession && this.sessionListener) {
      this.trackedSession.removeListener('event', this.sessionListener);
    }
    this.trackedSession = undefined;
    this.sessionListener = undefined;
  }

  // ── App selection ────────────────────────────────────────────────────────────

  private async sendApps(): Promise<void> {
    const apps: RecordableApp[] = await this.controller.listAvailableApps();
    this.post({ kind: 'apps', apps } satisfies ExtMsg);
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
      sharedKiB: e.sharedKiB,
      swapKiB: e.swapKiB,
      limitKiB: e.limitKiB,
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

    // Read textures stream — bitmaps only for first+last to keep the message small
    const texRaw = await reader.readStream<TexturesEvent>(dir, 'textures');
    const texCapped = texRaw.slice(-maxPoints);
    const textures: SerializedTexturePoint[] = texCapped.map((e, i) => ({
      wall: e.wall,
      usedBytes: e.usedBytes,
      maxBytes: e.maxBytes,
      availableBytes: e.availableBytes,
      count: e.count,
      totalSizeBytes: e.totalSizeBytes,
      bitmaps: (i === 0 || i === texCapped.length - 1)
        ? e.bitmaps.map((b) => ({ width: b.width, height: b.height, sizeBytes: b.sizeBytes, name: b.name }))
        : [],
    }));

    // Read app-state stream
    const stateRaw = await reader.readStream<AppStateEvent>(dir, 'app-state');
    const appState: SerializedAppStatePoint[] = stateRaw.slice(-maxPoints).map((e) => ({ wall: e.wall, state: e.state }));

    // Read fw-beacon stream
    const beaconRaw = await reader.readStream<FwBeaconEvent>(dir, 'fw-beacon');
    const beacons: SerializedBeaconPoint[] = beaconRaw.slice(-maxPoints).map((e) => ({ wall: e.wall, name: e.name, timeBaseMs: e.timeBaseMs }));

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

    this.post({
      kind: 'replay',
      session,
      history: { memCpu, nodes, rendezvous, textures, appState, beacons },
    } satisfies ExtMsg);
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
    // Reset the view immediately, synchronously, before any of the async
    // stop/start work below — that involves real network calls to the device
    // and can take a noticeable moment, during which the old session's charts
    // would otherwise keep showing stale data on screen.
    this.post({
      kind: 'init',
      state: this.buildState(),
      history: emptyHistory(),
    } satisfies ExtMsg);

    if (this.controller.isRecording) {
      await this.controller.stopSession();
      // onSessionStopped() fires via the 'stopped' event during stopSession(),
      // which detaches the old session, calls sendState(), and calls sendSessions().
      const session = await this.controller.startSession();
      if (session) {
        this.syncSession();
        this.sendInit();
      }
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
    const backgroundMemLimitMB = vscode.workspace
      .getConfiguration('kopytko')
      .get<number>('diagnostics.memoryLimits.backgroundMB', 100);
    return {
      recording: this.controller.isRecording,
      sessionStartWall: session?.manifest.startedWall,
      backgroundMemLimitMB,
      selectedAppId: this.controller.selectedApp,
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
    if (!session) return emptyHistory();
    const memCpu: SerializedMemCpuPoint[] = (session.getRing('mem-cpu') as MemCpuEvent[]).map(
      (e) => ({
        wall: e.wall,
        memKiB: e.memKiB,
        anonKiB: e.anonKiB,
        fileKiB: e.fileKiB,
        sharedKiB: e.sharedKiB,
        swapKiB: e.swapKiB,
        limitKiB: e.limitKiB,
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
    const textures: SerializedTexturePoint[] = (session.getRing('textures') as TexturesEvent[]).map(
      (e) => ({
        wall: e.wall,
        usedBytes: e.usedBytes,
        maxBytes: e.maxBytes,
        availableBytes: e.availableBytes,
        count: e.count,
        totalSizeBytes: e.totalSizeBytes,
        bitmaps: e.bitmaps.map((b) => ({ width: b.width, height: b.height, sizeBytes: b.sizeBytes, name: b.name })),
      }),
    );
    const appState: SerializedAppStatePoint[] = (session.getRing('app-state') as AppStateEvent[]).map(
      (e) => ({ wall: e.wall, state: e.state }),
    );
    const beacons: SerializedBeaconPoint[] = (session.getRing('fw-beacon') as FwBeaconEvent[]).map(
      (e) => ({ wall: e.wall, name: e.name, timeBaseMs: e.timeBaseMs }),
    );
    return { memCpu, nodes, rendezvous, textures, appState, beacons };
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
  <div id="status-banner" style="display:none;padding:6px 10px;background:var(--vscode-inputValidation-warningBackground);border-bottom:1px solid var(--vscode-inputValidation-warningBorder);font-size:12px;line-height:1.4"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

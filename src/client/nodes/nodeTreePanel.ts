import * as vscode from 'vscode';
import type { EcpClient } from 'kopytko-roku-device';
import type { DeviceManager } from 'kopytko-roku-device';
import { RaleTrackerClient, type RaleItemList } from 'kopytko-roku-device';
import { resolveRalePath, subtypeCompatible, type ItemListFetcher } from './ralePathResolver';
import type { ExtMsg, NodeCollection, WebMsg } from './webview/protocol';
import type { FieldEdit } from './webview/xmlDiff';

const VIEW_TYPE = 'kopytkoNodeTree';
const TITLE     = 'SceneGraph Tree';

export interface NodeTreeDeps {
  deviceManager: DeviceManager;
  ecp: EcpClient;
}

/**
 * Singleton editor-tab panel that fetches a SceneGraph node collection from
 * the active Roku device — all nodes (`/query/sgnodes/all`), root nodes
 * (`/query/sgnodes/roots`), or the rendered UI tree (`/query/app-ui`) — and
 * renders it as formatted XML or an icicle chart.
 */
export class NodeTreePanel {
  private static _instance: NodeTreePanel | undefined;

  static createOrReveal(context: vscode.ExtensionContext, deps: NodeTreeDeps): NodeTreePanel {
    if (NodeTreePanel._instance) {
      NodeTreePanel._instance.panel.reveal(vscode.ViewColumn.One);
      return NodeTreePanel._instance;
    }
    return new NodeTreePanel(context, deps);
  }

  static get instance(): NodeTreePanel | undefined { return NodeTreePanel._instance; }

  // ── instance ──────────────────────────────────────────────────────────────

  readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: NodeTreeDeps,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'out', 'node-tree-webview'),
        ],
      },
    );

    this.panel.webview.html = this._buildHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((msg: WebMsg) => {
      if (msg.kind === 'refresh') void this._fetch(msg.collection);
      else if (msg.kind === 'copy') void vscode.env.clipboard.writeText(msg.text);
      else if (msg.kind === 'edit-enter') void this._enterEdit();
      else if (msg.kind === 'edit-exit') this._exitEdit();
      else if (msg.kind === 'apply-edits') void this._applyEdits(msg.edits);
    });

    this.panel.onDidDispose(() => {
      this._rale?.close();
      this._rale = null;
      NodeTreePanel._instance = undefined;
    });

    NodeTreePanel._instance = this;
    void this._fetch('all');
  }

  // ── fetch ─────────────────────────────────────────────────────────────────

  private async _fetch(collection: NodeCollection): Promise<void> {
    this._post({ kind: 'loading' });

    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      this._post({ kind: 'error', message: 'No active Roku device. Select a device first.' });
      return;
    }

    try {
      const xml = collection === 'ui'
        ? await this.deps.ecp.queryAppUi(device.ip, device.port)
        : await this.deps.ecp.querySgNodes(device.ip, device.port, collection);

      // sgnodes responses carry <channel-title>; app-ui carries <plugin name="…">.
      const channelTitle =
        xml.match(/<channel-title>([^<]*)<\/channel-title>/)?.[1]
        ?? xml.match(/<plugin\b[^>]*\bname="([^"]*)"/)?.[1]
        ?? '';

      this._post({ kind: 'tree', xml, device: device.ip, channelTitle, collection });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._post({ kind: 'error', message: msg });
    }
  }

  private _post(msg: ExtMsg): void {
    if (this.panel.visible) {
      void this.panel.webview.postMessage(msg);
    }
  }

  // ── Edit mode (RALE TrackerTask) ──────────────────────────────────────────

  private _rale: RaleTrackerClient | null = null;

  /** Activate the injected TrackerTask and open the edit connection. */
  private async _enterEdit(): Promise<void> {
    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      this._post({ kind: 'edit-state', active: false, error: 'No active Roku device. Select a device first.' });
      return;
    }

    this._rale?.close();
    // Newer TrackerTasks (3.4.0+) keep serving on their original port forever
    // and ignore re-activation, so the last session's port — persisted across
    // panel and VS Code restarts — is tried first (see RaleTrackerOptions).
    const portKey = `kopytko.rale.port.${device.ip}`;
    const rale = new RaleTrackerClient({
      host: device.ip,
      ecpPort: device.port,
      ecp: this.deps.ecp,
      reusePort: this.context.globalState.get<number>(portKey),
    });
    this._rale = rale;

    try {
      const info = await rale.connect();
      void this.context.globalState.update(portKey, rale.port);
      // Best effort — without this the task draws a red selector rectangle
      // on the TV for every node we select while applying edits.
      await rale.hideSelectorView().catch(() => undefined);

      rale.on('close', () => {
        if (this._rale !== rale) return;
        this._rale = null;
        this._post({ kind: 'edit-state', active: false, error: 'Connection to TrackerTask lost.' });
      });

      this._post({ kind: 'edit-state', active: true, raleVersion: info.raleVersion });
    } catch (err) {
      if (this._rale === rale) this._rale = null;
      rale.close();
      void this.context.globalState.update(portKey, undefined); // stale port
      const message = err instanceof Error ? err.message : String(err);
      this._post({ kind: 'edit-state', active: false, error: message });
    }
  }

  private _exitEdit(): void {
    this._rale?.close();
    this._rale = null;
    this._post({ kind: 'edit-state', active: false });
  }

  /**
   * Apply field edits through the TrackerTask: select each target node by
   * path, verify it is the node the user thinks it is (subtype + id), then
   * set the field. Partial failures are reported per edit.
   */
  private async _applyEdits(edits: FieldEdit[]): Promise<void> {
    const rale = this._rale;
    if (!rale || !rale.connected) {
      this._post({
        kind: 'apply-result',
        ok: false,
        applied: 0,
        failures: edits.map(e => ({ field: e.field, path: e.path, message: 'Not connected to TrackerTask.' })),
      });
      return;
    }

    const failures: { field: string; path: number[]; message: string }[] = [];
    const warnings: string[] = [];
    let applied = 0;

    // getItemList responses cached per apply — edits usually share prefixes.
    const itemListCache = new Map<string, RaleItemList>();
    const fetchItemList: ItemListFetcher = async (path) => {
      const key = path.map(seg => ('child' in seg ? seg.child : `f:${seg.field}`)).join('/');
      const hit = itemListCache.get(key);
      if (hit) return hit;
      const result = await rale.getItemList(path);
      itemListCache.set(key, result);
      return result;
    };

    for (const edit of edits) {
      try {
        const resolved = await resolveRalePath(edit.steps, fetchItemList);
        if (!resolved.ok) {
          failures.push({ field: edit.field, path: edit.path, message: resolved.error });
          continue;
        }
        const selected = await rale.selectNode(resolved.path);
        const item = selected.node?.item;
        if (!subtypeCompatible(edit.subtype, item?.subtype)) {
          failures.push({
            field: edit.field,
            path: edit.path,
            message: `Target mismatch: expected <${edit.subtype}> but the device has `
              + `<${item?.subtype ?? 'unknown'}> at that path. Refresh and retry.`,
          });
          continue;
        }
        if (edit.id && item.id && item.id !== edit.id) {
          failures.push({
            field: edit.field,
            path: edit.path,
            message: `Target mismatch: expected node id "${edit.id}" but found "${item.id}". Refresh and retry.`,
          });
          continue;
        }
        await rale.setField(edit.field, edit.wireValue);
        applied++;

        // A LayoutGroup owns its children's positions — the layout pass
        // overwrites a manual translation almost immediately (verified on
        // device). The set succeeds, so warn rather than fail.
        const parent = edit.steps[edit.steps.length - 2];
        if (edit.field === 'translation' && parent?.subtype === 'LayoutGroup') {
          const label = edit.id ? `"${edit.id}"` : `<${edit.subtype}>`;
          warnings.push(
            `translation of ${label} is managed by its parent LayoutGroup — the layout will overwrite it`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ field: edit.field, path: edit.path, message });
      }
    }

    this._post({ kind: 'apply-result', ok: failures.length === 0, applied, failures, warnings });

    // Show the device's real new state (also resets the webview baseline).
    if (applied > 0) await this._fetch('ui');
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(webview: vscode.Webview): string {
    const outDir    = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'node-tree-webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.js'));
    const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.css'));
    const csp       = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp}; img-src ${csp} data:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>SceneGraph Tree</title>
</head>
<body>
  <div id="toolbar">
    <div class="status-dot" id="status-dot"></div>
    <span id="channel-label">No device</span>
    <div class="seg-group" id="collection-group" title="Node collection to fetch">
      <button data-collection="all" class="active">All</button>
      <button data-collection="roots">Roots</button>
      <button data-collection="ui">UI</button>
    </div>
    <div class="seg-group" id="view-group" title="Visual representation">
      <button data-view="xml" class="active">XML</button>
      <button data-view="chart">Chart</button>
    </div>
    <button id="btn-refresh" title="Fetch the selected node collection from the device">Refresh</button>
    <button id="btn-edit" disabled
            title="Edit node fields on the running app via RALE TrackerTask (UI collection, XML view only)">Edit</button>
    <button id="btn-apply" class="hidden" title="Apply field changes to the running app (Ctrl+Enter)">Apply</button>
    <span id="edit-chip" class="hidden"></span>
    <span id="node-count"></span>
  </div>
  <div id="breadcrumb-bar"></div>
  <div id="main">
    <canvas id="ic-canvas"></canvas>
    <pre id="xml-view" tabindex="0"></pre>
    <textarea id="xml-editor" spellcheck="false" autocomplete="off" wrap="off"></textarea>
    <div id="overlay" class="visible"><span>Loading…</span></div>
    <div id="tooltip"></div>
  </div>
  <div id="legend-bar"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

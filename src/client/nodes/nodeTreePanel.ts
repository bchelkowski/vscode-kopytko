import * as vscode from 'vscode';
import type { EcpClient } from 'kopytko-roku-device';
import type { DeviceManager } from 'kopytko-roku-device';
import type { ExtMsg, NodeCollection, WebMsg } from './webview/protocol';

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
    });

    this.panel.onDidDispose(() => {
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
    <span id="node-count"></span>
  </div>
  <div id="breadcrumb-bar"></div>
  <div id="main">
    <canvas id="ic-canvas"></canvas>
    <pre id="xml-view" tabindex="0"></pre>
    <div id="overlay" class="visible"><span>Loading…</span></div>
    <div id="tooltip"></div>
  </div>
  <div id="legend-bar"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

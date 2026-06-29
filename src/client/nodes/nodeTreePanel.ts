import * as vscode from 'vscode';
import type { EcpClient } from '../roku/discovery/ecpClient';
import type { DeviceManager } from '../roku/discovery/deviceManager';
import type { ExtMsg, WebMsg } from './webview/protocol';

const VIEW_TYPE = 'kopytkoNodeTree';
const TITLE     = 'SG Node Tree';

export interface NodeTreeDeps {
  deviceManager: DeviceManager;
  ecp: EcpClient;
}

/**
 * Singleton editor-tab panel that fetches /query/sgnodes/all from the
 * active Roku device and renders it as a treemap or collapsible dendrogram.
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
      if (msg.kind === 'refresh') void this._fetch();
    });

    this.panel.onDidDispose(() => {
      NodeTreePanel._instance = undefined;
    });

    NodeTreePanel._instance = this;
    void this._fetch();
  }

  // ── fetch ─────────────────────────────────────────────────────────────────

  private async _fetch(): Promise<void> {
    this._post({ kind: 'loading' });

    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      this._post({ kind: 'error', message: 'No active Roku device. Select a device first.' });
      return;
    }

    try {
      const xml = await this.deps.ecp.querySgNodes(device.ip, device.port);

      // Extract channel title from XML
      const titleMatch = xml.match(/<channel-title>([^<]*)<\/channel-title>/);
      const channelTitle = titleMatch?.[1] ?? '';

      this._post({ kind: 'tree', xml, device: device.ip, channelTitle });
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
  <title>SG Node Tree</title>
</head>
<body>
  <div id="toolbar">
    <button id="btn-refresh" title="Fetch latest node tree from device">Refresh</button>
    <span class="mode-group">
      <button id="btn-treemap">Icicle</button>
      <button id="btn-tree">Tree</button>
    </span>
    <span id="channel-label"></span>
    <span id="node-count"></span>
    <span class="sep"></span>
    <input id="search" type="text" placeholder="Filter nodes…" title="Filter visible nodes by type or name (tree mode)">
  </div>
  <div id="breadcrumb-bar"></div>
  <div id="main">
    <canvas id="ic-canvas"></canvas>
    <svg id="tree-svg" style="display:none;overflow:visible"></svg>
    <div id="overlay" class="visible"><span>Loading…</span></div>
    <div id="tooltip"></div>
  </div>
  <div id="legend-bar"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

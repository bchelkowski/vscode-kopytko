import * as vscode from 'vscode';
import type { DeepLinkingController } from '../deepLinkingController';
import type { ExtMsg, SavedSet, WebMsg } from '../webview/protocol';

const VIEW_TYPE = 'kopytkoDeepLinking';
const TITLE     = 'Deep Linking';

/**
 * Singleton editor-tab panel for firing ECP deep links: pick a channel from
 * the active device (icons included), define contentId + free-form params,
 * save named parameter sets, and send them via Launch or Input.
 */
export class DeepLinkingPanel {
  private static _instance: DeepLinkingPanel | undefined;

  static createOrReveal(context: vscode.ExtensionContext, controller: DeepLinkingController): DeepLinkingPanel {
    if (DeepLinkingPanel._instance) {
      DeepLinkingPanel._instance.panel.reveal(vscode.ViewColumn.One);
      return DeepLinkingPanel._instance;
    }
    return new DeepLinkingPanel(context, controller);
  }

  static get instance(): DeepLinkingPanel | undefined { return DeepLinkingPanel._instance; }

  // ── instance ──────────────────────────────────────────────────────────────

  readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: DeepLinkingController,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'out', 'deep-linking-webview'),
        ],
      },
    );

    this.panel.webview.html = this._buildHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((msg: WebMsg) => { void this._onMessage(msg); });

    const onDevicesChanged = (): void => { void this._loadChannels(); };
    this.controller.onDevicesChanged(onDevicesChanged);

    this.panel.onDidDispose(() => {
      this.controller.offDevicesChanged(onDevicesChanged);
      DeepLinkingPanel._instance = undefined;
    });

    DeepLinkingPanel._instance = this;
    void this._loadChannels();
    this._sendSets();
  }

  // ── message handling ──────────────────────────────────────────────────────

  private async _onMessage(msg: WebMsg): Promise<void> {
    switch (msg.kind) {
      case 'refresh':
        await this._loadChannels();
        break;

      case 'send': {
        try {
          if (msg.mode === 'launch') {
            await this.controller.launch(msg.channelId, msg.contentId, msg.params);
          } else {
            await this.controller.input(msg.contentId, msg.params);
          }
          this._post({ kind: 'sendResult', ok: true, mode: msg.mode });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._post({ kind: 'sendResult', ok: false, mode: msg.mode, message });
        }
        break;
      }

      case 'saveSet':
        await this.controller.saveSet(msg.set);
        this._sendSets();
        break;

      case 'deleteSet':
        await this.controller.deleteSet(msg.id);
        this._sendSets();
        break;
    }
  }

  private async _loadChannels(): Promise<void> {
    const device = this.controller.getActiveDevice();
    if (!device) {
      this._post({ kind: 'noDevice' });
      return;
    }

    this._post({ kind: 'loading' });
    try {
      const channels = await this.controller.loadChannels();
      this._post({
        kind: 'channels',
        device: device.ip,
        deviceName: device.friendlyName || device.modelName || device.ip,
        channels,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._post({ kind: 'error', message });
    }
  }

  private _sendSets(): void {
    const sets: SavedSet[] = this.controller.getSets().map((s) => ({
      id: s.id,
      name: s.name,
      channelId: s.channelId,
      channelName: s.channelName,
      contentId: s.contentId,
      params: s.params,
      labels: s.labels,
      updatedAt: s.updatedAt,
    }));
    this._post({ kind: 'sets', sets });
  }

  // Unlike NodeTreePanel, post unconditionally: with retainContextWhenHidden
  // the webview keeps running while hidden, and dropping sendResult/sets
  // messages there would silently lose state updates.
  private _post(msg: ExtMsg): void {
    void this.panel.webview.postMessage(msg);
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(webview: vscode.Webview): string {
    const outDir    = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'deep-linking-webview');
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
  <title>Deep Linking</title>
</head>
<body>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

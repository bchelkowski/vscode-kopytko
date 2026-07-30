import * as vscode from 'vscode';
import { PAY_ENDPOINTS } from '../endpoints';
import type { RokuPayController } from '../rokuPayController';
import type { ExtMsg, WebMsg } from '../webview/protocol';
import { buildWebviewHtml } from '../../webview/htmlShell';

const VIEW_TYPE = 'kopytkoRokuPay';
const TITLE = 'Roku Pay Web Services';

/**
 * Singleton editor-tab panel for the Roku Pay Web Services tool: manage
 * credential profiles, call any Roku Pay endpoint (including the
 * subscription-recovery test transitions), inspect responses, and browse
 * the persisted request/response history. Needs no Roku device — requests
 * go to Roku's cloud API from the extension host.
 */
export class RokuPayPanel {
  private static _instance: RokuPayPanel | undefined;

  static createOrReveal(context: vscode.ExtensionContext, controller: RokuPayController): RokuPayPanel {
    if (RokuPayPanel._instance) {
      RokuPayPanel._instance.panel.reveal(vscode.ViewColumn.One);
      return RokuPayPanel._instance;
    }
    return new RokuPayPanel(context, controller);
  }

  static get instance(): RokuPayPanel | undefined { return RokuPayPanel._instance; }

  // ── instance ──────────────────────────────────────────────────────────────

  readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: RokuPayController,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'out', 'roku-pay-webview'),
        ],
      },
    );

    this.panel.webview.html = this._buildHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((msg: WebMsg) => { void this._onMessage(msg); });

    const subscriptions = [
      this.controller.onProfilesChanged(() => {
        this._post({ kind: 'profiles', profiles: this.controller.getProfiles() });
      }),
      this.controller.onLogsChanged(() => {
        this._post({ kind: 'logs', entries: this.controller.getLogs() });
      }),
    ];

    this.panel.onDidDispose(() => {
      for (const subscription of subscriptions) subscription.dispose();
      RokuPayPanel._instance = undefined;
    });

    RokuPayPanel._instance = this;
  }

  // ── message handling ──────────────────────────────────────────────────────

  private async _onMessage(msg: WebMsg): Promise<void> {
    switch (msg.kind) {
      case 'ready':
        this._post({
          kind: 'init',
          endpoints: PAY_ENDPOINTS,
          profiles: this.controller.getProfiles(),
          uiState: this.controller.getUiState(),
          logs: this.controller.getLogs(),
        });
        break;

      case 'saveProfile':
        try {
          await this.controller.saveProfile({
            id: msg.id,
            name: msg.name,
            partnerAPIKey: msg.partnerAPIKey,
            partnerReferenceId: msg.partnerReferenceId,
          });
        } catch (err) {
          this._post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        break;

      case 'deleteProfile':
        await this.controller.deleteProfile(msg.id);
        break;

      case 'send': {
        this._post({ kind: 'sending' });
        try {
          const entry = await this.controller.send(msg.profileId, msg.endpointId, msg.values, msg.accept);
          this._post({ kind: 'sendResult', entry });
        } catch (err) {
          this._post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        break;
      }

      case 'deleteLog':
        await this.controller.deleteLog(msg.id);
        break;

      case 'clearLogs':
        await this.controller.clearLogs();
        break;

      case 'uiState':
        await this.controller.setUiState(msg.state);
        break;
    }
  }

  // Unlike NodeTreePanel, post unconditionally: with retainContextWhenHidden
  // the webview keeps running while hidden, and dropping sendResult/logs
  // messages there would silently lose state updates.
  private _post(msg: ExtMsg): void {
    void this.panel.webview.postMessage(msg);
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(this.context, webview, { outDir: 'roku-pay-webview', title: TITLE });
  }
}

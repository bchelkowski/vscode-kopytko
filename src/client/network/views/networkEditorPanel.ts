import * as vscode from 'vscode';
import * as fs from 'fs';
import type { NetworkController } from '../networkController';
import { buildCurl, buildUrl } from '../capture/curl';
import type { ExtMsg, InterceptPayload, RuleSet, SerializedFlow, WebMsg, WebviewState } from '../webview/protocol';

const VIEW_TYPE = 'kopytkoNetwork';
const TITLE = 'Kopytko Network Inspector';

/**
 * Singleton editor-tab panel for the Network Inspector. Bridges the
 * {@link NetworkController} to the webview and drives the master enable/disable
 * toggle. Reverts capture when the tab closes.
 */
export class NetworkEditorPanel {
  private static _instance: NetworkEditorPanel | undefined;

  static createOrReveal(
    context: vscode.ExtensionContext,
    controller: NetworkController,
  ): NetworkEditorPanel {
    if (NetworkEditorPanel._instance) {
      NetworkEditorPanel._instance._panel.reveal(vscode.ViewColumn.One);
      return NetworkEditorPanel._instance;
    }
    return new NetworkEditorPanel(context, controller);
  }

  static get instance(): NetworkEditorPanel | undefined {
    return NetworkEditorPanel._instance;
  }

  private readonly _panel: vscode.WebviewPanel;
  private _detachController: (() => void) | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: NetworkController,
  ) {
    this._panel = vscode.window.createWebviewPanel(VIEW_TYPE, TITLE, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'network-webview')],
    });

    this._panel.webview.html = this._buildHtml(this._panel.webview);
    this._panel.webview.onDidReceiveMessage((msg: WebMsg) => this._onMsg(msg));

    this._panel.onDidDispose(() => {
      this._detach();
      if (this.controller.isEnabled) void this.controller.disable();
      NetworkEditorPanel._instance = undefined;
    });

    this._panel.onDidChangeViewState(() => {
      if (this._panel.visible) this._sendInit();
    });

    this._attach();
    NetworkEditorPanel._instance = this;
  }

  dispose(): void {
    this._panel.dispose();
  }

  // ── controller subscription ─────────────────────────────────────────────────

  private _attach(): void {
    const onFlow = (entry: SerializedFlow) => this._post({ kind: 'flow', entry });
    const onTrimmed = (ids: string[]) => this._post({ kind: 'trim', ids });
    const onState = (state: WebviewState) => this._post({ kind: 'state', state });
    const onRules = (rules: RuleSet) => this._post({ kind: 'rules', rules });
    const onCleared = () => this._post({ kind: 'cleared' });
    const onIntercept = (intercept: InterceptPayload) => this._post({ kind: 'intercept', intercept });
    const onInterceptResolved = (id: string) => this._post({ kind: 'intercept-resolved', id });

    this.controller.on('flow', onFlow);
    this.controller.on('trimmed', onTrimmed);
    this.controller.on('state', onState);
    this.controller.on('rules', onRules);
    this.controller.on('cleared', onCleared);
    this.controller.on('intercept', onIntercept);
    this.controller.on('interceptResolved', onInterceptResolved);

    this._detachController = () => {
      this.controller.removeListener('flow', onFlow);
      this.controller.removeListener('trimmed', onTrimmed);
      this.controller.removeListener('state', onState);
      this.controller.removeListener('rules', onRules);
      this.controller.removeListener('cleared', onCleared);
      this.controller.removeListener('intercept', onIntercept);
      this.controller.removeListener('interceptResolved', onInterceptResolved);
    };
  }

  private _detach(): void {
    this._detachController?.();
    this._detachController = undefined;
  }

  // ── message handler ─────────────────────────────────────────────────────────

  private _onMsg(msg: WebMsg): void {
    switch (msg.kind) {
      case 'ready':
        this._sendInit();
        break;
      case 'set-enabled':
        void this._handleToggle(msg.enabled);
        break;
      case 'set-paused':
        this.controller.setPaused(msg.paused);
        break;
      case 'clear':
        this.controller.clear();
        break;
      case 'export-har':
        void this._handleExportHar();
        break;
      case 'select-flow': {
        const detail = this.controller.getDetail(msg.id);
        if (detail) this._post({ kind: 'flow-detail', detail });
        break;
      }
      case 'copy-flow':
        void this._handleCopyFlow(msg.id, msg.what);
        break;
      case 'replay-flow':
        void this._handleReplay(msg.id);
        break;
      case 'search':
        this._post({ kind: 'search-results', query: msg.query, hits: this.controller.search(msg.query) });
        break;
      case 'resolve-intercept':
        this.controller.resolveIntercept(msg.id, msg.result);
        break;
      case 'set-rules':
        this.controller.setRules(msg.rules as RuleSet);
        break;
    }
  }

  private async _handleToggle(enabled: boolean): Promise<void> {
    try {
      if (enabled) await this.controller.enable();
      else await this.controller.disable();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Extension-host console.error surfaces in the Debug Console during F5.
      // eslint-disable-next-line no-console
      console.error('[Kopytko Network Inspector] capture toggle failed:', err);
      this._post({ kind: 'error', message });
      // The controller already rolled back; push the true state so the toggle
      // snaps back to OFF instead of getting stuck "on".
      this._post({ kind: 'state', state: this.controller.getState() });
    }
  }

  private async _handleCopyFlow(id: string, what: 'url' | 'curl' | 'request-body' | 'response-body'): Promise<void> {
    const rec = this.controller.getRecord(id);
    if (!rec) {
      this._post({ kind: 'error', message: 'Request is no longer in the capture buffer.' });
      return;
    }
    const text =
      what === 'url'
        ? buildUrl(rec)
        : what === 'curl'
          ? buildCurl(rec)
          : what === 'request-body'
            ? rec.requestBody?.toString('utf8') ?? ''
            : rec.responseBody?.toString('utf8') ?? '';
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`Copied ${what === 'curl' ? 'cURL command' : what.replace('-', ' ')}`, 2000);
  }

  private async _handleReplay(id: string): Promise<void> {
    const rec = this.controller.getRecord(id);
    if (!rec) {
      this._post({ kind: 'error', message: 'Request is no longer in the capture buffer.' });
      return;
    }
    // Replaying a state-changing request hits the real backend again — make
    // that a deliberate choice. GET/HEAD/OPTIONS replays are assumed safe.
    const needsConfirm = !['GET', 'HEAD', 'OPTIONS'].includes(rec.method);
    const truncNote = rec.requestBodyTruncated
      ? ' The stored request body was truncated at capture time, so the replay will send only the retained prefix.'
      : '';
    if (needsConfirm || rec.requestBodyTruncated) {
      const verb = needsConfirm
        ? `Re-send ${rec.method} ${rec.path} to ${rec.host}? This repeats a state-changing request against the real server.`
        : `Re-send ${rec.method} ${rec.path} to ${rec.host}?`;
      const pick = await vscode.window.showWarningMessage(`${verb}${truncNote}`, { modal: true }, 'Replay');
      if (pick !== 'Replay') return;
    }
    try {
      this.controller.replay(id);
    } catch (err) {
      this._post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async _handleExportHar(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      filters: { 'HAR files': ['har'] },
      saveLabel: 'Export HAR',
    });
    if (!uri) return;
    try {
      fs.writeFileSync(uri.fsPath, JSON.stringify(this.controller.buildHar(), null, 2));
      void vscode.window.showInformationMessage(`Network capture exported to ${uri.fsPath}`);
    } catch (err) {
      void vscode.window.showErrorMessage(`Failed to export HAR — ${(err as Error).message}`);
    }
  }

  // ── send helpers ─────────────────────────────────────────────────────────────

  private _sendInit(): void {
    this._post({
      kind: 'init',
      state: this.controller.getState(),
      history: this.controller.getHistory(),
      rules: this.controller.getRules(),
      maxEntries: this.controller.maxEntries,
      intercepts: this.controller.getPendingIntercepts(),
    });
  }

  private _post(msg: ExtMsg): void {
    if (this._panel.visible) void this._panel.webview.postMessage(msg);
  }

  // ── HTML ──────────────────────────────────────────────────────────────────────

  private _buildHtml(webview: vscode.Webview): string {
    const outDir = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'network-webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.css'));
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
                 img-src ${csp} data:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>${TITLE}</title>
</head>
<body>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

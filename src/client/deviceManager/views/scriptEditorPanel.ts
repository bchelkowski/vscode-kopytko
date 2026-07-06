import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ecpKeyToRaspKey, raspQuote } from '../rasp/raspParser';
import type { ScriptRunnerService } from '../scriptRunnerService';
import type { DeviceScript, ScriptStore } from '../scriptStore';
import type { DeviceManagerController } from '../deviceManagerController';
import type { ExtMsg, WebMsg } from '../editorWebview/protocol';

const VIEW_TYPE = 'kopytkoDeviceScript';

/**
 * Editor-tab panel for authoring device automation scripts. v1 edits RASP
 * (Roku Automation Script Protocol, YAML) with live validation in the
 * webview; the format switcher already exists in the UI with `kopytko`
 * (the future custom format) disabled, and the store/protocol carry a
 * `format` field so the second mode slots in without schema changes.
 *
 * One panel per script id; unsaved "new" scripts get a temp key until the
 * first save assigns a real store id.
 */
export class ScriptEditorPanel {
  private static readonly panels = new Map<string, ScriptEditorPanel>();

  /** Opens (or reveals) the editor for an existing script, a new one, or an import. */
  static open(
    context: vscode.ExtensionContext,
    deps: ScriptEditorDeps,
    script?: DeviceScript,
    imported?: { title: string; source: string },
  ): ScriptEditorPanel {
    const key = script?.id ?? `new:${crypto.randomUUID()}`;

    const existing = script ? ScriptEditorPanel.panels.get(script.id) : undefined;
    if (existing) {
      existing.panel.reveal();
      return existing;
    }
    return new ScriptEditorPanel(context, deps, key, script, imported);
  }

  static disposeAll(): void {
    for (const panel of [...ScriptEditorPanel.panels.values()]) {
      panel.panel.dispose();
    }
  }

  // ── remote-to-script recording ────────────────────────────────────────────

  /** The panel remote actions record into: the most recently active editor. */
  private static lastActive: ScriptEditorPanel | undefined;

  /**
   * Records a remote-control key press as a `- press:` step in the most
   * recently active script editor (its webview ignores the message while its
   * "Record remote" toggle is off). `Lit_*` character presses are skipped —
   * free typing is recorded as whole `- text:` steps instead, keeping scripts
   * readable and Roku-Remote-Tool-shaped.
   */
  static recordRemotePress(ecpKey: string): void {
    if (ecpKey.startsWith('Lit_')) return;
    const raspKey = ecpKeyToRaspKey(ecpKey);
    if (raspKey === undefined) return;
    ScriptEditorPanel.lastActive?.post({ kind: 'recordStep', line: `- press: ${raspKey}` });
  }

  /** Records a sent text as a `- text:` step in the most recently active editor. */
  static recordRemoteText(text: string): void {
    if (text === '') return;
    ScriptEditorPanel.lastActive?.post({ kind: 'recordStep', line: `- text: ${raspQuote(text)}` });
  }

  // ── instance ──────────────────────────────────────────────────────────────

  readonly panel: vscode.WebviewPanel;
  private scriptId: string | undefined;
  private key: string;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: ScriptEditorDeps,
    key: string,
    script: DeviceScript | undefined,
    imported: { title: string; source: string } | undefined,
  ) {
    this.key = key;
    this.scriptId = script?.id;

    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      script?.title || imported?.title || 'New Device Script',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'out', 'script-editor-webview'),
        ],
      },
    );

    this.panel.webview.html = this.buildHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg: WebMsg) => { void this.onMessage(msg, script, imported); });

    const onDevicesChanged = (): void => this.sendDevice();
    this.deps.controller.onDevicesChanged(onDevicesChanged);
    const progressSub = this.deps.runner.onProgress((progress) => {
      if (progress.scriptId === this.runId) {
        this.post({ kind: 'runProgress', progress });
      }
    });

    const viewStateSub = this.panel.onDidChangeViewState(() => {
      if (this.panel.active) ScriptEditorPanel.lastActive = this;
    });

    this.panel.onDidDispose(() => {
      this.deps.controller.offDevicesChanged(onDevicesChanged);
      progressSub.dispose();
      viewStateSub.dispose();
      ScriptEditorPanel.panels.delete(this.key);
      if (ScriptEditorPanel.lastActive === this) {
        ScriptEditorPanel.lastActive = undefined;
      }
    });

    ScriptEditorPanel.panels.set(this.key, this);
    ScriptEditorPanel.lastActive = this;
  }

  /** Runner scriptId of this panel's runs: the store id, or a synthetic editor id. */
  private get runId(): string {
    return this.scriptId ?? `editor:${this.key}`;
  }

  private async onMessage(
    msg: WebMsg,
    script: DeviceScript | undefined,
    imported: { title: string; source: string } | undefined,
  ): Promise<void> {
    switch (msg.kind) {
      case 'ready':
        this.post({
          kind: 'load',
          script: script
            ? { id: script.id, title: script.title, format: script.format, source: script.source }
            : { title: imported?.title ?? '', format: 'rasp', source: imported?.source ?? NEW_SCRIPT_TEMPLATE },
        });
        this.sendDevice();
        return;

      case 'save': {
        const saved = await this.deps.scripts.save({
          id: this.scriptId,
          title: msg.title.trim() || 'Untitled script',
          format: msg.format,
          source: msg.source,
        });
        // First save of a new panel: adopt the real store id as the panel key.
        if (this.scriptId === undefined) {
          ScriptEditorPanel.panels.delete(this.key);
          this.key = saved.id;
          ScriptEditorPanel.panels.set(this.key, this);
          this.scriptId = saved.id;
        }
        this.panel.title = saved.title;
        this.post({ kind: 'saved', id: saved.id, title: saved.title });
        return;
      }

      case 'run':
        void this.deps.runner.run(this.runId, msg.title.trim() || 'Untitled script', msg.format, msg.source);
        return;

      case 'cancelRun':
        this.deps.runner.cancel(this.runId);
        return;

      case 'export': {
        const safeName = (msg.title.trim() || 'script').replace(/[^\w.-]+/g, '-');
        const dest = await vscode.window.showSaveDialog({
          title: 'Export script',
          defaultUri: vscode.Uri.file(`${safeName}.rasp`),
          filters: { 'RASP script': ['rasp'] },
        });
        if (!dest) return;
        await vscode.workspace.fs.writeFile(dest, Buffer.from(msg.source, 'utf8'));
        void vscode.window.showInformationMessage(`Script exported: ${dest.fsPath}`);
        return;
      }

      case 'dirty':
        // Mirror the unsaved state in the tab title, like a text editor would.
        this.panel.title = `${msg.isDirty ? '● ' : ''}${this.panel.title.replace(/^● /, '')}`;
        return;
    }
  }

  private sendDevice(): void {
    const device = this.deps.controller.getActiveDevice();
    this.post({ kind: 'device', name: device ? (device.friendlyName || device.modelName || device.ip) : undefined });
  }

  private post(msg: ExtMsg): void {
    void this.panel.webview.postMessage(msg);
  }

  private buildHtml(webview: vscode.Webview): string {
    const outDir = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'script-editor-webview');
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
  <title>Device Script</title>
</head>
<body>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export interface ScriptEditorDeps {
  controller: DeviceManagerController;
  scripts: ScriptStore;
  runner: ScriptRunnerService;
}

const NEW_SCRIPT_TEMPLATE = `params:
    rasp_version: 1
    default_keypress_wait: 2
channels:
    'My Channel': dev
steps:
    - press: home
    - pause: 2
`;

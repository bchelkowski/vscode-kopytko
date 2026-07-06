import * as vscode from 'vscode';
import type { AbilitiesController } from '../abilitiesController';
import type { DeviceManagerController } from '../deviceManagerController';
import type { RemoteModeService } from '../remoteModeService';
import type { ScriptRunnerService } from '../scriptRunnerService';
import type { DeviceScript, ScriptStore } from '../scriptStore';
import { runAbilityAction } from './abilityActions';
import type { ExtMsg, ScriptListItem, TextEntryView, WebMsg } from '../webview/protocol';

/** Which of the four Device Manager sidebar views an instance backs. */
export type DeviceManagerViewKind = 'remote' | 'entries' | 'scripts' | 'abilities';

export interface DeviceManagerViewDeps {
  controller: DeviceManagerController;
  abilities: AbilitiesController;
  scripts: ScriptStore;
  runner: ScriptRunnerService;
  remoteMode: RemoteModeService;
  /** Opens the script editor tab: existing script by id, or a new/imported one. */
  openScriptEditor: (script?: DeviceScript, imported?: { title: string; source: string }) => void;
}

const HINT_SHOWN_KEY = 'kopytko.deviceManager.sidebarHintShown';

/**
 * One WebviewViewProvider class backing all four Device Manager sidebar views
 * (Remote Control / Saved Text / Scripts / Device) — a single webview bundle
 * dispatches on `<body data-view="…">`.
 *
 * Sidebar webview views do NOT retain context when hidden, so all state is
 * re-pushed on `ready` and on every visibility change; anything long-running
 * (script runs, held-key safety) lives host-side.
 */
export class DeviceManagerViewProvider implements vscode.WebviewViewProvider {
  static viewId(kind: DeviceManagerViewKind): string {
    switch (kind) {
      case 'remote': return 'kopytko.deviceManager.remote';
      case 'entries': return 'kopytko.deviceManager.savedText';
      case 'scripts': return 'kopytko.deviceManager.scripts';
      case 'abilities': return 'kopytko.deviceManager.abilities';
    }
  }

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly kind: DeviceManagerViewKind,
    private readonly context: vscode.ExtensionContext,
    private readonly deps: DeviceManagerViewDeps,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'device-manager-webview'),
      ],
    };
    view.webview.html = this.buildHtml(view.webview);

    view.webview.onDidReceiveMessage((msg: WebMsg) => { void this.onMessage(msg); }, undefined, this.disposables);

    const onDevicesChanged = (): void => this.sendDevice();
    this.deps.controller.onDevicesChanged(onDevicesChanged);

    const subscriptions: vscode.Disposable[] = [
      view.onDidChangeVisibility(() => {
        if (view.visible) this.sendAll();
      }),
    ];
    if (this.kind === 'remote') {
      subscriptions.push(this.deps.remoteMode.onDidChange((on) => this.post({ kind: 'remoteMode', on })));
    }
    if (this.kind === 'scripts') {
      subscriptions.push(
        this.deps.scripts.onDidChange(() => this.sendScripts()),
        this.deps.runner.onProgress((progress) => this.post({ kind: 'runProgress', progress })),
      );
    }

    view.onDidDispose(() => {
      this.deps.controller.offDevicesChanged(onDevicesChanged);
      for (const sub of subscriptions) sub.dispose();
      if (this.kind === 'remote') {
        // Never leave the device with a stuck key when the view goes away mid-hold.
        void this.deps.controller.releaseAllHeldKeys();
      }
      this.view = undefined;
    });

    if (this.kind === 'remote') {
      this.maybeShowSidebarHint();
    }
  }

  // ── messages from the webview ─────────────────────────────────────────────

  private async onMessage(msg: WebMsg): Promise<void> {
    switch (msg.kind) {
      case 'ready':
        this.sendAll();
        return;

      case 'keyPress':
        await this.relayKey(() => this.deps.controller.pressKey(msg.key), `keypress ${msg.key}`);
        return;
      case 'keyHoldStart':
        await this.relayKey(() => this.deps.controller.holdKey(msg.key), `keydown ${msg.key}`);
        return;
      case 'keyHoldEnd':
        await this.relayKey(() => this.deps.controller.releaseKey(msg.key), `keyup ${msg.key}`);
        return;

      case 'sendText':
        try {
          await this.deps.controller.sendText(msg.text);
          this.post({ kind: 'sendTextResult', ok: true });
        } catch (err) {
          this.post({ kind: 'sendTextResult', ok: false, message: errorMessage(err) });
        }
        return;

      case 'toggleRemoteMode':
        await this.deps.remoteMode.toggle();
        return;

      case 'saveEntry':
        try {
          await this.deps.controller.saveEntry(msg.entry.type === 'text'
            ? { id: msg.entry.id, type: 'text', title: msg.entry.title, text: msg.entry.text ?? '' }
            : { id: msg.entry.id, type: 'credentials', title: msg.entry.title, login: msg.entry.login ?? '', password: msg.entry.password });
          this.post({ kind: 'entryResult', ok: true });
        } catch (err) {
          this.post({ kind: 'entryResult', ok: false, message: errorMessage(err) });
        }
        await this.sendEntries();
        return;

      case 'deleteEntry':
        await this.deps.controller.deleteEntry(msg.id);
        await this.sendEntries();
        return;

      case 'sendEntryField':
        try {
          await this.deps.controller.sendEntryField(msg.id, msg.field);
          this.post({ kind: 'entryResult', ok: true, id: msg.id });
        } catch (err) {
          this.post({ kind: 'entryResult', ok: false, id: msg.id, message: errorMessage(err) });
        }
        return;

      case 'newScript':
        this.deps.openScriptEditor();
        return;

      case 'importScript':
        await this.importScript();
        return;

      case 'runScript': {
        const script = this.deps.scripts.get(msg.id);
        if (!script) return;
        void this.deps.runner.run(script.id, script.title || 'Untitled script', script.format, script.source);
        return;
      }

      case 'cancelRun':
        this.deps.runner.cancel(msg.id);
        return;

      case 'editScript': {
        const script = this.deps.scripts.get(msg.id);
        if (script) this.deps.openScriptEditor(script);
        return;
      }

      case 'deleteScript': {
        const script = this.deps.scripts.get(msg.id);
        if (!script) return;
        const confirmed = await vscode.window.showWarningMessage(
          `Delete script "${script.title || 'Untitled script'}"?`, { modal: true }, 'Delete',
        );
        if (confirmed !== 'Delete') return;
        await this.deps.scripts.delete(msg.id);
        return;
      }

      case 'exportScript':
        await this.exportScript(msg.id);
        return;

      case 'ability': {
        this.post({ kind: 'busy', on: true, label: msg.action });
        const result = await runAbilityAction(msg.action, this.deps.abilities, this.context);
        this.post({ kind: 'busy', on: false });
        this.post({ kind: 'actionResult', action: msg.action, ok: result.ok, message: result.message });
        return;
      }
    }
  }

  /**
   * Key relays report failures inline (single status line in the remote view)
   * instead of toasts — a hold gesture can fire several requests per second
   * and toast spam would be worse than the failure itself.
   */
  private async relayKey(send: () => Promise<void>, label: string): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.post({ kind: 'actionResult', action: label, ok: false, message: errorMessage(err) });
    }
  }

  private async importScript(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      title: 'Import RASP script',
      filters: { 'RASP script': ['rasp'], 'All files': ['*'] },
      canSelectMany: false,
    });
    if (!picked?.[0]) return;

    const bytes = await vscode.workspace.fs.readFile(picked[0]);
    const source = Buffer.from(bytes).toString('utf8');
    const title = picked[0].path.split('/').pop()?.replace(/\.rasp$/i, '') ?? 'Imported script';
    this.deps.openScriptEditor(undefined, { title, source });
  }

  private async exportScript(id: string): Promise<void> {
    const script = this.deps.scripts.get(id);
    if (!script) return;

    const safeName = (script.title || 'script').replace(/[^\w.-]+/g, '-');
    const dest = await vscode.window.showSaveDialog({
      title: 'Export script',
      defaultUri: vscode.Uri.file(`${safeName}.rasp`),
      filters: { 'RASP script': ['rasp'] },
    });
    if (!dest) return;

    await vscode.workspace.fs.writeFile(dest, Buffer.from(script.source, 'utf8'));
    void vscode.window.showInformationMessage(`Script exported: ${dest.fsPath}`);
  }

  // ── state pushes ──────────────────────────────────────────────────────────

  private sendAll(): void {
    this.sendDevice();
    if (this.kind === 'remote') {
      const holdThresholdMs = vscode.workspace.getConfiguration('kopytko').get<number>('deviceManager.holdThresholdMs', 1000);
      this.post({ kind: 'config', holdThresholdMs });
      this.post({ kind: 'remoteMode', on: this.deps.remoteMode.isOn });
    }
    if (this.kind === 'entries') void this.sendEntries();
    if (this.kind === 'scripts') this.sendScripts();
  }

  private sendDevice(): void {
    const device = this.deps.controller.getActiveDevice();
    this.post({
      kind: 'device',
      device: device
        ? { ip: device.ip, name: device.friendlyName || device.modelName || device.ip, isTV: device.isTV === true }
        : undefined,
    });
  }

  private async sendEntries(): Promise<void> {
    const entries: TextEntryView[] = [];
    for (const entry of this.deps.controller.getEntries()) {
      if (entry.type === 'text') {
        entries.push({ id: entry.id, type: 'text', title: entry.title, text: entry.text, updatedAt: entry.updatedAt });
      } else {
        entries.push({
          id: entry.id, type: 'credentials', title: entry.title, login: entry.login,
          hasPassword: await this.deps.controller.hasEntryPassword(entry.id),
          updatedAt: entry.updatedAt,
        });
      }
    }
    this.post({ kind: 'entries', entries });
  }

  private sendScripts(): void {
    const scripts: ScriptListItem[] = this.deps.scripts.getAll().map((s) => ({
      id: s.id, title: s.title || 'Untitled script', format: s.format, updatedAt: s.updatedAt,
    }));
    this.post({ kind: 'scripts', scripts });
  }

  private post(msg: ExtMsg): void {
    void this.view?.webview.postMessage(msg);
  }

  // ── first-run hint ────────────────────────────────────────────────────────

  private maybeShowSidebarHint(): void {
    if (this.context.globalState.get<boolean>(HINT_SHOWN_KEY) === true) return;
    void this.context.globalState.update(HINT_SHOWN_KEY, true);
    void vscode.window.showInformationMessage(
      'Tip: drag the Kopytko Device Manager icon from the Activity Bar onto the right-hand Secondary Side Bar to keep the remote next to your code — VS Code remembers the position.',
    );
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private buildHtml(webview: vscode.Webview): string {
    const outDir = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'device-manager-webview');
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
  <title>Device Manager</title>
</head>
<body data-view="${this.kind}">
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

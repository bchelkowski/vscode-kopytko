import * as vscode from 'vscode';

const CONTEXT_KEY = 'kopytko.deviceManager.remoteMode';

/**
 * Owns the keyboard remote-control mode: a `setContext` flag that arms the
 * package.json keybindings (arrows/Enter/Escape/… → device keys), a status-bar
 * indicator (click to exit), and a change event so the remote webview can
 * highlight its toggle.
 *
 * While the mode is on, the bound keys are stolen from the editor by design
 * (matching Roku's remote tool / rokucommunity behavior) — the status-bar item
 * plus the toggle keybinding are the escape hatches.
 */
export class RemoteModeService {
  private readonly changeEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly statusBarItem: vscode.StatusBarItem;
  private _on = false;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    this.statusBarItem.text = '$(broadcast) Roku Remote';
    this.statusBarItem.tooltip = 'Keyboard remote-control mode is ON — keystrokes drive the Roku device. Click to turn off.';
    this.statusBarItem.command = 'kopytko.deviceManager.toggleRemoteMode';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  get isOn(): boolean {
    return this._on;
  }

  async toggle(): Promise<void> {
    await this.set(!this._on);
  }

  async set(on: boolean): Promise<void> {
    if (this._on === on) return;
    this._on = on;
    await vscode.commands.executeCommand('setContext', CONTEXT_KEY, on);
    if (on) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
    this.changeEmitter.fire(on);
  }

  dispose(): void {
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, false);
    this.statusBarItem.dispose();
    this.changeEmitter.dispose();
  }
}

import * as vscode from 'vscode';
import type { WebMsg } from '../webview/protocol';
import { buildWebviewHtml } from '../../webview/htmlShell';

/**
 * WebviewViewProvider for the "Kopytko Tools" sidebar panel — buttons that
 * reveal the Diagnostics panel, the Perfetto tab, the SceneGraph Tree tab, the
 * Deep Linking tab, the Device Manager, and the Roku Pay Web Services tab.
 * Purely navigational: no data flows in, it only relays button clicks to
 * the corresponding reveal command.
 */
export class NavViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'kopytko.nav';

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'nav-webview'),
      ],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebMsg) => {
      if (msg.kind !== 'open') return;
      switch (msg.target) {
        case 'diagnostics':
          void vscode.commands.executeCommand('kopytko.diagnostics.focus');
          break;
        case 'console':
          void vscode.commands.executeCommand('kopytko.console.focus');
          break;
        case 'perfetto':
          void vscode.commands.executeCommand('kopytko.perfetto.open');
          break;
        case 'nodes':
          void vscode.commands.executeCommand('kopytko.nodes.open');
          break;
        case 'deepLinking':
          void vscode.commands.executeCommand('kopytko.deepLinking.open');
          break;
        case 'deviceManager':
          void vscode.commands.executeCommand('kopytko.deviceManager.open');
          break;
        case 'rokuPay':
          void vscode.commands.executeCommand('kopytko.rokuPay.open');
          break;
        case 'network':
          void vscode.commands.executeCommand('kopytko.network.open');
          break;
      }
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(this.context, webview, { outDir: 'nav-webview', title: 'Tools', includeImgSrc: false });
  }
}

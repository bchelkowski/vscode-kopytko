import * as vscode from 'vscode';
import type { WebMsg } from '../webview/protocol';

/**
 * WebviewViewProvider for the "Kopytko Tools" sidebar panel — three buttons
 * that reveal the Diagnostics panel, the Perfetto tab, and the Node Tree tab.
 * Purely navigational: no data flows in, it only relays button clicks to the
 * corresponding reveal command.
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
        case 'perfetto':
          void vscode.commands.executeCommand('kopytko.perfetto.open');
          break;
        case 'nodes':
          void vscode.commands.executeCommand('kopytko.nodes.open');
          break;
      }
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const outDir = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'nav-webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.js'));
    const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(outDir, 'main.css'));
    const csp = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Tools</title>
</head>
<body>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

import * as vscode from 'vscode';
import { NavViewProvider } from '../nav/views/navViewProvider';

/** Registers the "Kopytko Tools" sidebar quick-nav webview. */
export function registerNav(context: vscode.ExtensionContext): void {
  const provider = new NavViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NavViewProvider.viewId, provider),
  );
}

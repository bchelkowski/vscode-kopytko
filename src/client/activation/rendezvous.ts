import * as vscode from 'vscode';
import { RendezvousTreeProvider } from '../roku/views/rendezvousTreeProvider';
import { RendezvousToggleItem } from '../roku/views/rendezvousTreeItems';
import { DiscoveryServices } from './discovery';
import { resolveRendezvousFile } from '../roku/util/resolveSourceFile';

export function registerRendezvous(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): void {
  const { rendezvousManager } = services;
  const provider = new RendezvousTreeProvider(rendezvousManager);
  const treeView = vscode.window.createTreeView('kopytko.rendezvous', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    treeView,
    provider,
    treeView.onDidChangeCheckboxState(async (e) => {
      for (const [item, newState] of e.items) {
        if (item instanceof RendezvousToggleItem) {
          const enabled = newState === vscode.TreeItemCheckboxState.Checked;
          await rendezvousManager.setEnabled(enabled);
        }
      }
    }),
    vscode.commands.registerCommand('kopytko.clearRendezvousLog', () => {
      rendezvousManager.clear();
    }),
    vscode.commands.registerCommand('kopytko.toggleRendezvousSort', () => {
      rendezvousManager.setSortMode(
        rendezvousManager.sortMode === 'count' ? 'time' : 'count',
      );
    }),
    vscode.commands.registerCommand(
      'kopytko.navigateToRendezvous',
      async (localPath: string, pkgPath: string, line: number) => {
        const resolved = await resolveRendezvousFile(localPath, pkgPath);
        if (!resolved) {
          vscode.window.showWarningMessage(`Cannot find file: ${pkgPath}`);
          return;
        }
        try {
          const doc = await vscode.workspace.openTextDocument(resolved);
          const editor = await vscode.window.showTextDocument(doc, { preview: false });
          const position = new vscode.Position(Math.max(0, line - 1), 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter,
          );
        } catch {
          vscode.window.showWarningMessage(`Cannot open file: ${pkgPath}`);
        }
      },
    ),
  );
}


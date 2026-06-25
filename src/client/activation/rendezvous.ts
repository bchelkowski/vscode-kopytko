import * as path from 'path';
import * as vscode from 'vscode';
import { RendezvousTreeProvider } from '../roku/views/rendezvousTreeProvider';
import { RendezvousToggleItem } from '../roku/views/rendezvousTreeItems';
import { DiscoveryServices } from './discovery';

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

/**
 * Resolves a rendezvous file reference to a local URI.
 *
 * Strategy:
 * 1. Try the pre-resolved local path directly (works for app source files).
 * 2. Workspace-wide search by full relative path — null excludes bypasses
 *    files.exclude so node_modules (kopytko npm packages) are included.
 * 3. If multiple matches, prefer a path that contains "node_modules".
 * 4. Last resort: search by filename alone.
 */
async function resolveRendezvousFile(
  localPath: string,
  pkgPath: string,
): Promise<vscode.Uri | undefined> {
  // 1. Try the pre-resolved local path.
  if (localPath && !localPath.startsWith('pkg:/')) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(localPath));
      return vscode.Uri.file(localPath);
    } catch { /* not found — fall through */ }
  }

  // 2. Full workspace search including node_modules (null = no excludes).
  const relative = pkgPath.replace(/^\/pkg:\//i, '').replace(/^pkg:\//i, '');
  const matches = await vscode.workspace.findFiles(`**/${relative}`, null, 10);

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return matches.find((u) => u.fsPath.includes('node_modules')) ?? matches[0];
  }

  // 3. Last resort: search by filename alone.
  const filename = path.basename(relative);
  const byName = await vscode.workspace.findFiles(`**/${filename}`, null, 10);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    return byName.find((u) => u.fsPath.includes('node_modules')) ?? byName[0];
  }

  return undefined;
}

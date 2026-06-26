import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Resolves a Roku `pkg:/…` file reference to a VS Code URI.
 *
 * Strategy:
 * 1. Try the pre-resolved local path directly (fast path for app source).
 * 2. Workspace-wide search by full relative path (null excludes so node_modules
 *    kopytko packages are included). Multiple matches prefer node_modules.
 * 3. Last resort: search by filename alone.
 *
 * Used by both the legacy Rendezvous Log tree and the diagnostics panel.
 */
export async function resolveRendezvousFile(
  localPath: string,
  pkgPath: string,
): Promise<vscode.Uri | undefined> {
  if (localPath && !localPath.startsWith('pkg:/')) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(localPath));
      return vscode.Uri.file(localPath);
    } catch { /* not found */ }
  }

  const relative = pkgPath.replace(/^\/pkg:\//i, '').replace(/^pkg:\//i, '');
  const matches = await vscode.workspace.findFiles(`**/${relative}`, null, 10);

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return matches.find((u) => u.fsPath.includes('node_modules')) ?? matches[0];
  }

  const filename = path.basename(relative);
  const byName = await vscode.workspace.findFiles(`**/${filename}`, null, 10);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    return byName.find((u) => u.fsPath.includes('node_modules')) ?? byName[0];
  }

  return undefined;
}


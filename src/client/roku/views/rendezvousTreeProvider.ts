import * as vscode from 'vscode';
import { RendezvousManager } from '../rendezvous/rendezvousManager';
import {
  RendezvousToggleItem,
  RendezvousGroupItem,
  RendezvousEntryItem,
  RendezvousEmptyItem,
} from './rendezvousTreeItems';

export class RendezvousTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _onManagerChanged = () => this._onDidChangeTreeData.fire();

  constructor(private readonly manager: RendezvousManager) {
    manager.on('changed', this._onManagerChanged);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      return this._getRootItems();
    }
    if (element instanceof RendezvousGroupItem) {
      return element.group.entries.map(
        (entry) => new RendezvousEntryItem(entry, element.group.localPath || element.group.file, element.group.line),
      );
    }
    return [];
  }

  dispose(): void {
    this.manager.removeListener('changed', this._onManagerChanged);
    this._onDidChangeTreeData.dispose();
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _getRootItems(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [new RendezvousToggleItem(this.manager.isEnabled)];

    if (this.manager.isEnabled) {
      const groups = this.manager.getGroups();
      if (groups.length === 0) {
        items.push(new RendezvousEmptyItem());
      } else {
        for (const group of groups) {
          items.push(new RendezvousGroupItem(group));
        }
      }
    }

    return items;
  }
}

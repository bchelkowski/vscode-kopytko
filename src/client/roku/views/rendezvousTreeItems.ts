import * as path from 'path';
import * as vscode from 'vscode';
import { RendezvousGroup, RendezvousEntry } from '../rendezvous/rendezvousManager';

/** Top-level checkbox item for toggling rendezvous logging on/off. */
export class RendezvousToggleItem extends vscode.TreeItem {
  constructor(enabled: boolean) {
    super('Rendezvous Logging', vscode.TreeItemCollapsibleState.None);
    this.checkboxState = enabled
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.iconPath = new vscode.ThemeIcon('pulse');
    this.contextValue = 'rendezvousToggle';
    this.tooltip = enabled
      ? 'Rendezvous logging enabled — polling the active device'
      : 'Rendezvous logging disabled — check to start tracking on the active device';
  }
}

/** Collapsible group item representing all rendezvous events at a single file:line. */
export class RendezvousGroupItem extends vscode.TreeItem {
  constructor(public readonly group: RendezvousGroup) {
    const filename = path.basename(group.localPath || group.file);
    super(`${filename}:${group.line}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `(${group.entries.length})`;
    this.tooltip = `${group.file}:${group.line}`;
    this.iconPath = new vscode.ThemeIcon('location');
    this.contextValue = 'rendezvousGroup';
    this.command = {
      title: 'Go to Location',
      command: 'kopytko.navigateToRendezvous',
      arguments: [group.localPath || group.file, group.line],
    };
  }
}

/** Leaf item showing the duration and timestamp of a single rendezvous event. */
export class RendezvousEntryItem extends vscode.TreeItem {
  constructor(
    entry: RendezvousEntry,
    localPath: string,
    line: number,
  ) {
    super(`${entry.duration}ms`, vscode.TreeItemCollapsibleState.None);
    this.description = new Date(entry.timestamp).toLocaleTimeString();
    this.iconPath = new vscode.ThemeIcon('watch');
    this.contextValue = 'rendezvousEntry';
    this.command = {
      title: 'Go to Location',
      command: 'kopytko.navigateToRendezvous',
      arguments: [localPath, line],
    };
  }
}

/** Shown when logging is enabled but no events have been captured yet. */
export class RendezvousEmptyItem extends vscode.TreeItem {
  constructor() {
    super('No rendezvous events captured yet', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
    this.contextValue = 'rendezvousEmpty';
  }
}

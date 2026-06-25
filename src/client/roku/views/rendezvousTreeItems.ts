import * as path from 'path';
import * as vscode from 'vscode';
import { RendezvousGroup, RendezvousEntry } from '../rendezvous/rendezvousManager';

function formatDuration(ms: number): string {
  return ms === 0 ? '<1ms' : `${ms}ms`;
}

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

/** Warning shown when events were dropped due to the device buffer (1000 events) overflowing. */
export class RendezvousDropWarningItem extends vscode.TreeItem {
  constructor(dropCount: number) {
    super(`${dropCount} event${dropCount === 1 ? '' : 's'} dropped`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('warning');
    this.contextValue = 'rendezvousDropWarning';
    this.tooltip = `${dropCount} rendezvous event${dropCount === 1 ? ' was' : 's were'} lost because the device buffer (1000 events) overflowed. Poll more frequently or reduce rendezvous activity.`;
  }
}

/** Collapsible group item representing all rendezvous events at a single file:line. */
export class RendezvousGroupItem extends vscode.TreeItem {
  constructor(public readonly group: RendezvousGroup) {
    const filename = path.basename(group.localPath || group.file);
    super(`${filename}:${group.line}`, vscode.TreeItemCollapsibleState.Collapsed);

    const count = group.entries.length;
    const total = group.entries.reduce((sum, e) => sum + e.duration, 0);
    const max = Math.max(...group.entries.map((e) => e.duration));
    const avg = Math.round(total / count);

    this.description = `${count}×  ${formatDuration(total)} total`;

    this.tooltip = new vscode.MarkdownString(
      `**${group.file}:${group.line}**\n\n` +
      `Occurrences: ${count}\n\n` +
      `Total: ${formatDuration(total)}  ·  Avg: ${formatDuration(avg)}  ·  Max: ${formatDuration(max)}`,
    );

    this.iconPath = new vscode.ThemeIcon('location');
    this.contextValue = 'rendezvousGroup';
    this.command = {
      title: 'Go to Location',
      command: 'kopytko.navigateToRendezvous',
      // Pass both resolved local path AND original pkg:/ path so the handler
      // can fall back to a workspace search when the local path is missing
      // (e.g. the file lives inside an npm package under node_modules).
      arguments: [group.localPath, group.file, group.line],
    };
  }
}

/** Leaf item showing the duration and wall-clock time of a single rendezvous event. */
export class RendezvousEntryItem extends vscode.TreeItem {
  constructor(
    entry: RendezvousEntry,
    localPath: string,
    pkgPath: string,
    line: number,
  ) {
    super(formatDuration(entry.duration), vscode.TreeItemCollapsibleState.None);
    this.description = new Date(entry.timestamp).toLocaleTimeString();
    this.iconPath = new vscode.ThemeIcon('watch');
    this.contextValue = 'rendezvousEntry';
    this.command = {
      title: 'Go to Location',
      command: 'kopytko.navigateToRendezvous',
      arguments: [localPath, pkgPath, line],
    };
  }
}

/** Clickable row showing the active sort mode; clicking it toggles to the other mode. */
export class RendezvousSortItem extends vscode.TreeItem {
  constructor(sortMode: 'count' | 'time') {
    const label = sortMode === 'count' ? 'Sort: by occurrences' : 'Sort: by total time';
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('arrow-swap');
    this.contextValue = 'rendezvousSort';
    this.tooltip = sortMode === 'count'
      ? 'Currently sorted by number of occurrences — click to sort by total time'
      : 'Currently sorted by total duration — click to sort by occurrences';
    this.command = {
      title: 'Toggle Sort',
      command: 'kopytko.toggleRendezvousSort',
      arguments: [],
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

import * as vscode from 'vscode';
import { RokuDevice } from '../types';

/** Root tree item representing a single Roku device. */
export class DeviceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly device: RokuDevice,
    public readonly isActive: boolean,
  ) {
    super(device.friendlyName, vscode.TreeItemCollapsibleState.Collapsed);

    this.description = `(${device.ip})`;
    if (isActive) {
      this.description += '  ✓ active';
    }

    const info = device.deviceInfo ?? {};
    const osLine = device.softwareVersion
      ? (info['software-build']
        ? `OS: ${device.softwareVersion} (${info['software-build']})`
        : `OS: ${device.softwareVersion}`)
      : '';

    this.tooltip = new vscode.MarkdownString(
      `**${device.friendlyName}**\n\n` +
      `IP: \`${device.ip}:${device.port}\`\n\n` +
      `Model: ${device.modelName} (${device.modelNumber})\n\n` +
      `Device ID: ${device.deviceId || 'unknown'}\n\n` +
      (osLine ? `${osLine}\n\n` : ''),
    );

    this.iconPath = DeviceTreeItem.getIcon(device, isActive);
    this.contextValue = DeviceTreeItem.buildContextValue(device, isActive);
  }

  private static getIcon(device: RokuDevice, isActive: boolean): vscode.ThemeIcon {
    if (device.state === 'pending') return new vscode.ThemeIcon('loading~spin');
    if (device.state === 'offline') return new vscode.ThemeIcon('debug-disconnect');
    if (isActive) return new vscode.ThemeIcon('vm-active');
    return new vscode.ThemeIcon('vm');
  }

  private static buildContextValue(device: RokuDevice, isActive: boolean): string {
    let value = 'rokuDevice';
    if (device.isFavorite) value += '-favorite';
    if (device.state === 'online') value += '-online';
    if (isActive) value += '-active';
    return value;
  }
}

/** Child item displaying a single key-value device property. */
export class DeviceInfoItem extends vscode.TreeItem {
  constructor(key: string, value: string) {
    super(key, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.contextValue = 'deviceInfo';
    this.tooltip = `Click to copy ${value}`;
    this.command = {
      title: 'Copy to Clipboard',
      command: 'kopytko.copyToClipboard',
      arguments: [value],
    };
  }
}

/** Child item showing and allowing selection of the device environment. */
export class DeviceEnvironmentItem extends vscode.TreeItem {
  constructor(
    public readonly serialNumber: string,
    environment: string | undefined,
  ) {
    super('Environment', vscode.TreeItemCollapsibleState.None);
    this.description = environment ?? '(not set)';
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    this.contextValue = 'deviceEnvironment';
    this.tooltip = environment
      ? `Environment: ${environment} — click to change`
      : 'No environment set — click to select';
    this.command = {
      title: 'Set Environment',
      command: 'kopytko.setDeviceEnvironment',
      arguments: [serialNumber],
    };
  }
}

/** Child action button (e.g. "Open Web Portal"). */
export class DeviceActionItem extends vscode.TreeItem {
  constructor(label: string, icon: vscode.ThemeIcon, commandId: string, args?: unknown[]) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = icon;
    this.contextValue = 'deviceAction';
    this.command = {
      title: label,
      command: commandId,
      arguments: args,
    };
  }
}

/** Placeholder shown while a network scan is in progress. */
export class ScanningItem extends vscode.TreeItem {
  constructor() {
    super('Scanning network…', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('loading~spin');
  }
}

/** Placeholder shown when no devices have been found. */
export class EmptyItem extends vscode.TreeItem {
  constructor() {
    super('No Roku devices found — click ↺ to scan', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

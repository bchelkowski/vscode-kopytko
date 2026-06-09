import * as vscode from 'vscode';
import { RokuDevice } from './types';
import { discoverDevices } from './deviceDiscovery';

class RokuDeviceItem extends vscode.TreeItem {
  constructor(public readonly device: RokuDevice, isActive: boolean) {
    super(device.friendlyName, vscode.TreeItemCollapsibleState.None);
    this.description = `${device.ip}  ·  ${device.modelName}`;
    this.tooltip = new vscode.MarkdownString(
      `**${device.friendlyName}**\n\n` +
      `IP: \`${device.ip}:${device.port}\`\n\n` +
      `Model: ${device.modelName}\n\nS/N: ${device.serialNumber}\n\nFirmware: ${device.softwareVersion}`
    );
    this.iconPath = new vscode.ThemeIcon(isActive ? 'vm-active' : 'vm');
    this.contextValue = 'rokuDevice';
    if (isActive) {
      this.description += '  ✓ active';
    }
  }
}

export class RokuDeviceProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _devices: RokuDevice[] = [];
  private _activeDevice: RokuDevice | undefined;
  private _scanning = false;

  constructor(private readonly _context: vscode.ExtensionContext) {
    this._activeDevice = _context.workspaceState.get<RokuDevice>('roku.activeDevice');
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    if (this._scanning) {
      const item = new vscode.TreeItem('Scanning network…');
      item.iconPath = new vscode.ThemeIcon('loading~spin');
      return [item];
    }
    if (this._devices.length === 0) {
      const item = new vscode.TreeItem('No Roku devices found — click ↺ to scan');
      item.iconPath = new vscode.ThemeIcon('info');
      return [item];
    }
    return this._devices.map((d) => new RokuDeviceItem(d, d.ip === this._activeDevice?.ip));
  }

  async refresh(): Promise<void> {
    this._scanning = true;
    this._onDidChangeTreeData.fire();
    this._devices = await discoverDevices();
    this._scanning = false;
    this._onDidChangeTreeData.fire();
    if (this._devices.length === 0) {
      vscode.window.showInformationMessage('No Roku devices found on the local network.');
    }
  }

  async selectDevice(item: vscode.TreeItem): Promise<void> {
    if (!(item instanceof RokuDeviceItem)) return;
    this._activeDevice = item.device;
    await this._context.workspaceState.update('roku.activeDevice', item.device);
    this._onDidChangeTreeData.fire();
    vscode.window.showInformationMessage(
      `Active Roku device set to ${item.device.friendlyName} (${item.device.ip})`
    );
  }

  getActiveDevice(): RokuDevice | undefined {
    return this._activeDevice;
  }
}

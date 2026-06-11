import * as vscode from 'vscode';
import { DeviceManager } from '../discovery/deviceManager';
import {
  DeviceTreeItem,
  DeviceInfoItem,
  DeviceActionItem,
  ScanningItem,
  EmptyItem,
} from './deviceTreeItems';

/** Tree data provider that displays discovered Roku devices in the sidebar. */
export class DeviceTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _scanning = false;

  private readonly _onDevicesChanged = () => this._fireChange();
  private readonly _onScanStarted = () => { this._scanning = true; this._fireChange(); };
  private readonly _onScanEnded = () => { this._scanning = false; this._fireChange(); };

  constructor(private readonly manager: DeviceManager) {
    manager.on('devices-changed', this._onDevicesChanged);
    manager.on('scan-started', this._onScanStarted);
    manager.on('scan-ended', this._onScanEnded);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      return this._getRootItems();
    }
    if (element instanceof DeviceTreeItem) {
      return this._getDeviceChildren(element);
    }
    return [];
  }

  /** Force a full tree refresh. */
  refresh(): void {
    this._fireChange();
  }

  /** Remove all DeviceManager listeners. */
  dispose(): void {
    this.manager.removeListener('devices-changed', this._onDevicesChanged);
    this.manager.removeListener('scan-started', this._onScanStarted);
    this.manager.removeListener('scan-ended', this._onScanEnded);
  }

  // ── private ──────────────────────────────────────────────

  private _fireChange(): void {
    this._onDidChangeTreeData.fire();
  }

  private _getRootItems(): vscode.TreeItem[] {
    const devices = this.manager.getDevices();
    const activeSerial = this.manager.getActiveDevice()?.serialNumber;

    if (devices.length === 0) {
      return this._scanning ? [new ScanningItem()] : [new EmptyItem()];
    }

    const items: vscode.TreeItem[] = [];
    if (this._scanning) {
      items.push(new ScanningItem());
    }
    for (const device of devices) {
      items.push(new DeviceTreeItem(device, device.serialNumber === activeSerial));
    }
    return items;
  }

  private _getDeviceChildren(parent: DeviceTreeItem): vscode.TreeItem[] {
    const { device } = parent;
    const children: vscode.TreeItem[] = [];

    children.push(new DeviceInfoItem('IP Address', device.ip));
    if (device.modelName) children.push(new DeviceInfoItem('Model', device.modelName));
    if (device.modelNumber) children.push(new DeviceInfoItem('Model Number', device.modelNumber));
    if (device.serialNumber) children.push(new DeviceInfoItem('Serial Number', device.serialNumber));
    if (device.softwareVersion) children.push(new DeviceInfoItem('Firmware', device.softwareVersion));
    if (device.developerEnabled !== undefined) {
      children.push(new DeviceInfoItem('Developer Mode', device.developerEnabled ? 'Enabled' : 'Disabled'));
    }

    // Visual separator before action buttons
    const separator = new vscode.TreeItem('───', vscode.TreeItemCollapsibleState.None);
    children.push(separator);

    children.push(new DeviceActionItem(
      'Open Web Portal',
      new vscode.ThemeIcon('globe'),
      'kopytko.openDevicePortal',
      [device.serialNumber],
    ));

    return children;
  }
}

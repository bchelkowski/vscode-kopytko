import * as vscode from 'vscode';
import { DeviceManager } from 'kopytko-roku-device';
import {
  DeviceTreeItem,
  DeviceInfoItem,
  DeviceEnvironmentItem,
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

  constructor(
    private readonly manager: DeviceManager,
    private readonly getAvailableEnvironments: () => string[],
  ) {
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
    const info = device.deviceInfo ?? {};
    const children: vscode.TreeItem[] = [];

    children.push(new DeviceActionItem(
      'Open Web Portal',
      new vscode.ThemeIcon('globe'),
      'kopytko.openDevicePortal',
      [device.serialNumber],
    ));

    children.push(new DeviceActionItem(
      'Read Registry',
      new vscode.ThemeIcon('database'),
      'kopytko.readRegistry',
      [device.serialNumber],
    ));

    const availableEnvs = this.getAvailableEnvironments();
    const effectiveEnv = this.manager.getEffectiveEnvironment(device.serialNumber, availableEnvs);
    children.push(new DeviceEnvironmentItem(device.serialNumber, effectiveEnv));

    const vendorName = info['vendor-name'];
    const modelValue = [vendorName, device.modelName].filter(Boolean).join(' ') +
      (device.modelNumber ? ` (${device.modelNumber})` : '');
    children.push(new DeviceInfoItem('Model', modelValue));

    if (device.developerEnabled !== undefined) {
      children.push(new DeviceInfoItem('Developer Mode', device.developerEnabled ? 'Enabled' : 'Disabled'));
    }

    if (info['ecp-setting-mode']) {
      children.push(new DeviceInfoItem('ECP Mode', info['ecp-setting-mode']));
    }

    if (info['keyed-developer-id']) {
      children.push(new DeviceInfoItem('Developer Keyed ID', info['keyed-developer-id']));
    }

    if (device.softwareVersion) {
      const build = info['software-build'];
      const osValue = build ? `${device.softwareVersion} (${build})` : device.softwareVersion;
      children.push(new DeviceInfoItem('Roku OS', osValue));
    }

    if (info['ui-resolution']) {
      children.push(new DeviceInfoItem('Resolution', info['ui-resolution']));
    }

    if (info['country']) {
      children.push(new DeviceInfoItem('Roku Store Region', info['country']));
    }

    if (info['locale']) {
      children.push(new DeviceInfoItem('Locale', info['locale']));
    }

    if (info['time-zone']) {
      const offset = info['time-zone-offset'];
      const tzValue = offset ? `${info['time-zone']} (Offset: ${offset})` : info['time-zone'];
      children.push(new DeviceInfoItem('Time Zone', tzValue));
    }

    return children;
  }
}

import * as path from 'path';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { DeviceManager } from '../discovery/deviceManager';
import { EcpClient } from '../discovery/ecpClient';
import { rokuPathToLocal } from '../../debug/services/pathMapping';

const POLL_INTERVAL_MS = 1000;
const PERSISTENCE_KEY = 'kopytko.rendezvousEnabled';

export type RendezvousSortMode = 'count' | 'time';

export interface RendezvousEntry {
  duration: number;
  timestamp: number;
}

export interface RendezvousGroup {
  key: string;
  file: string;
  localPath: string;
  line: number;
  entries: RendezvousEntry[];
}

export class RendezvousManager extends EventEmitter {
  private _enabled = false;
  private _lastKnownSerial: string | undefined;
  private _groups: RendezvousGroup[] = [];
  private _totalDropCount = 0;
  private _sortMode: RendezvousSortMode = 'count';
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deviceManager: DeviceManager,
    private readonly ecp: EcpClient,
    private readonly workspaceRoot: string,
    private readonly workspaceState: vscode.Memento,
  ) {
    super();
    this.deviceManager.on('devices-changed', this._handleDevicesChanged);
    this._initForCurrentDevice();
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  get totalDropCount(): number {
    return this._totalDropCount;
  }

  get sortMode(): RendezvousSortMode {
    return this._sortMode;
  }

  setSortMode(mode: RendezvousSortMode): void {
    this._sortMode = mode;
    this.emit('changed');
  }

  getGroups(): RendezvousGroup[] {
    const groups = [...this._groups];
    if (this._sortMode === 'count') {
      groups.sort((a, b) => b.entries.length - a.entries.length);
    } else {
      groups.sort((a, b) => {
        const totalA = a.entries.reduce((sum, e) => sum + e.duration, 0);
        const totalB = b.entries.reduce((sum, e) => sum + e.duration, 0);
        return totalB - totalA;
      });
    }
    return groups;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const device = this.deviceManager.getActiveDevice();
    if (!device) return;

    if (enabled) {
      const ok = await this.ecp.enableRendezvousTracking(device.ip, device.port);
      if (!ok) {
        vscode.window.showWarningMessage(
          'Could not enable rendezvous tracking — ensure the device is online and developer mode is enabled.',
        );
        return;
      }
      this._enabled = true;
      this._persistEnabled(device.serialNumber, true);
      this._startPolling(device.ip, device.port);
    } else {
      this._stopPolling();
      await this.ecp.disableRendezvousTracking(device.ip, device.port);
      this._enabled = false;
      this._groups = [];
      this._totalDropCount = 0;
      this._persistEnabled(device.serialNumber, false);
    }

    this.emit('changed');
  }

  clear(): void {
    this._groups = [];
    this._totalDropCount = 0;
    this.emit('changed');
  }

  dispose(): void {
    this._stopPolling();
    this.deviceManager.removeListener('devices-changed', this._handleDevicesChanged);
  }

  // ── private ──────────────────────────────────────────────────────────────

  private readonly _handleDevicesChanged = (): void => {
    const newSerial = this.deviceManager.getActiveDevice()?.serialNumber;
    if (newSerial === this._lastKnownSerial) return;

    // Disable tracking on the old device (fire-and-forget)
    if (this._enabled) {
      const oldDevice = this._lastKnownSerial
        ? this.deviceManager.getDevice(this._lastKnownSerial)
        : undefined;
      if (oldDevice) {
        this.ecp.disableRendezvousTracking(oldDevice.ip, oldDevice.port).catch(() => {});
      }
    }

    this._stopPolling();
    this._groups = [];
    this._totalDropCount = 0;
    this._lastKnownSerial = newSerial;

    if (newSerial) {
      const stored = this.workspaceState.get<Record<string, boolean>>(PERSISTENCE_KEY) ?? {};
      const shouldEnable = stored[newSerial] ?? false;
      this._enabled = false;

      if (shouldEnable) {
        this.setEnabled(true).catch(() => {});
        return;
      }
    } else {
      this._enabled = false;
    }

    this.emit('changed');
  };

  private _initForCurrentDevice(): void {
    const device = this.deviceManager.getActiveDevice();
    this._lastKnownSerial = device?.serialNumber;

    if (device) {
      const stored = this.workspaceState.get<Record<string, boolean>>(PERSISTENCE_KEY) ?? {};
      const shouldEnable = stored[device.serialNumber] ?? false;
      if (shouldEnable) {
        this.setEnabled(true).catch(() => {});
      }
    }
  }

  private _startPolling(ip: string, port: number): void {
    this._stopPolling();
    this._pollTimer = setInterval(() => {
      this._pollOnce(ip, port).catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private async _pollOnce(ip: string, port: number): Promise<void> {
    const { events, dropCount } = await this.ecp.queryRendezvousEvents(ip, port);

    let changed = false;

    if (dropCount > 0) {
      this._totalDropCount += dropCount;
      changed = true;
    }

    if (events.length > 0) {
      const sourceRoot = this._resolveSourceRoot();
      const receivedAt = Date.now();

      for (const event of events) {
        const key = `${event.file}:${event.line}`;
        const localPath = sourceRoot ? rokuPathToLocal(event.file, sourceRoot) : event.file;

        let group = this._groups.find((g) => g.key === key);
        if (!group) {
          group = { key, file: event.file, localPath, line: event.line, entries: [] };
          this._groups.push(group);
        }

        group.entries.push({
          duration: Math.max(0, event.endTimeMs - event.startTimeMs),
          timestamp: receivedAt,
        });
      }
      changed = true;
    }

    if (changed) {
      this.emit('changed');
    }
  }

  private _resolveSourceRoot(): string {
    if (!this.workspaceRoot) return '';
    const sourceDir = vscode.workspace
      .getConfiguration('kopytko')
      .get<string>('imports.sourceDir', 'app');
    return path.join(this.workspaceRoot, sourceDir);
  }

  private _persistEnabled(serialNumber: string, enabled: boolean): void {
    const stored = this.workspaceState.get<Record<string, boolean>>(PERSISTENCE_KEY) ?? {};
    this.workspaceState.update(PERSISTENCE_KEY, { ...stored, [serialNumber]: enabled });
  }
}

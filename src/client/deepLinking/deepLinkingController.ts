import type { DeviceManager, EcpClient, RokuDevice } from 'kopytko-roku-device';
import type { DeepLinkParam, DeepLinkParameterSet, DeepLinkParameterSetInput, ParameterSetStore } from './parameterSetStore';

export interface ChannelInfo {
  id: string;
  name: string;
  version?: string;
  /** `data:` URI ready for an `<img>` src; undefined when the icon fetch failed. */
  iconDataUri?: string;
}

export interface DeepLinkingDeps {
  deviceManager: DeviceManager;
  ecp: EcpClient;
  store: ParameterSetStore;
}

/**
 * Business logic for the Deep Linking panel: loads the active device's
 * channels (with icons), fires ECP launch/input requests, and owns CRUD on
 * the saved parameter sets. No VS Code UI imports — fully testable.
 */
export class DeepLinkingController {
  constructor(private readonly deps: DeepLinkingDeps) {}

  getActiveDevice(): RokuDevice | undefined {
    return this.deps.deviceManager.getActiveDevice();
  }

  onDevicesChanged(listener: () => void): void {
    this.deps.deviceManager.on('devices-changed', listener);
  }

  offDevicesChanged(listener: () => void): void {
    this.deps.deviceManager.off('devices-changed', listener);
  }

  /**
   * Loads installed channels from the active device, fetching each channel's
   * icon in parallel. A failed icon fetch degrades to `iconDataUri:
   * undefined` (placeholder in the UI) rather than failing the load.
   */
  async loadChannels(): Promise<ChannelInfo[]> {
    const device = this.requireDevice();
    const apps = await this.deps.ecp.queryApps(device.ip, device.port);

    const icons = await Promise.allSettled(
      apps.map((app) => this.deps.ecp.queryAppIcon(device.ip, app.id, device.port)),
    );

    return apps.map((app, i) => {
      const icon = icons[i];
      return {
        id: app.id,
        name: app.name,
        version: app.version,
        iconDataUri: icon.status === 'fulfilled'
          ? `data:${icon.value.contentType};base64,${icon.value.data.toString('base64')}`
          : undefined,
      };
    });
  }

  /** Launches (or relaunches) a channel with the given deep-link parameters. */
  async launch(channelId: string, contentId: string, params: DeepLinkParam[]): Promise<void> {
    const device = this.requireDevice();
    await this.deps.ecp.launchApp(device.ip, channelId, this.mergeParams(contentId, params), device.port);
  }

  /** Sends deep-link parameters to the running foreground channel (roInput). */
  async input(contentId: string, params: DeepLinkParam[]): Promise<void> {
    const device = this.requireDevice();
    await this.deps.ecp.sendInput(device.ip, this.mergeParams(contentId, params), device.port);
  }

  getSets(): DeepLinkParameterSet[] {
    return this.deps.store.getAll();
  }

  saveSet(input: DeepLinkParameterSetInput): Promise<DeepLinkParameterSet> {
    return this.deps.store.save(input);
  }

  deleteSet(id: string): Promise<void> {
    return this.deps.store.delete(id);
  }

  /** contentId first (omitted when blank), then extra pairs; blank keys skipped. */
  private mergeParams(contentId: string, params: DeepLinkParam[]): Record<string, string> {
    const merged: Record<string, string> = {};
    if (contentId.trim() !== '') {
      merged['contentId'] = contentId.trim();
    }
    for (const { key, value } of params) {
      if (key.trim() === '') continue;
      merged[key.trim()] = value;
    }
    return merged;
  }

  private requireDevice(): RokuDevice {
    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      throw new Error('No active Roku device. Select a device in the Roku Devices view first.');
    }
    return device;
  }
}

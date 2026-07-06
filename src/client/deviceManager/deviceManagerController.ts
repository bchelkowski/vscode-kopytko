import type { DeviceManager, EcpClient, RokuDevice } from 'kopytko-roku-device';
import type { TextEntry, TextEntryInput, TextEntryStore } from './textEntryStore';

export interface DeviceManagerControllerDeps {
  deviceManager: DeviceManager;
  ecp: EcpClient;
  entries: TextEntryStore;
}

/**
 * Business logic for the Device Manager's remote control and saved text
 * entries: relays key events to the active device, types text sequentially,
 * and owns CRUD on saved entries. No VS Code UI imports — fully testable.
 */
export class DeviceManagerController {
  /**
   * Keys currently held via keydown without a matching keyup yet — used to
   * release them if the webview goes away mid-hold (the device would
   * otherwise keep the key pressed indefinitely).
   */
  private readonly heldKeys = new Set<string>();

  constructor(private readonly deps: DeviceManagerControllerDeps) {}

  getActiveDevice(): RokuDevice | undefined {
    return this.deps.deviceManager.getActiveDevice();
  }

  onDevicesChanged(listener: () => void): void {
    this.deps.deviceManager.on('devices-changed', listener);
  }

  offDevicesChanged(listener: () => void): void {
    this.deps.deviceManager.off('devices-changed', listener);
  }

  /** Press-and-release (POST /keypress/{key}). */
  async pressKey(key: string): Promise<void> {
    const device = this.requireDevice();
    await this.deps.ecp.keypress(device.ip, key, device.port);
  }

  /** Start holding a key (POST /keydown/{key}); pair with {@link releaseKey}. */
  async holdKey(key: string): Promise<void> {
    const device = this.requireDevice();
    await this.deps.ecp.keydown(device.ip, key, device.port);
    this.heldKeys.add(key);
  }

  /** Release a held key (POST /keyup/{key}). */
  async releaseKey(key: string): Promise<void> {
    const device = this.requireDevice();
    this.heldKeys.delete(key);
    await this.deps.ecp.keyup(device.ip, key, device.port);
  }

  /**
   * Releases every key still held — call when the remote view is disposed so
   * a mid-hold teardown can't leave the device with a stuck key. Errors are
   * swallowed: this is best-effort cleanup on a view that no longer exists.
   */
  async releaseAllHeldKeys(): Promise<void> {
    const device = this.deps.deviceManager.getActiveDevice();
    const keys = [...this.heldKeys];
    this.heldKeys.clear();
    if (!device) return;
    await Promise.allSettled(keys.map((key) => this.deps.ecp.keyup(device.ip, key, device.port)));
  }

  /**
   * Types text on the device's on-screen keyboard — strictly sequential
   * keypresses (each awaited) so characters arrive in order.
   */
  async sendText(text: string): Promise<void> {
    const device = this.requireDevice();
    await this.deps.ecp.sendText(device.ip, text, device.port);
  }

  // ── saved text entries ────────────────────────────────────────────────────

  getEntries(): TextEntry[] {
    return this.deps.entries.getAll();
  }

  saveEntry(input: TextEntryInput): Promise<TextEntry> {
    return this.deps.entries.save(input);
  }

  deleteEntry(id: string): Promise<void> {
    return this.deps.entries.delete(id);
  }

  /** Whether a credentials entry has a password stored in SecretStorage. */
  async hasEntryPassword(id: string): Promise<boolean> {
    return (await this.deps.entries.getPassword(id)) !== undefined;
  }

  /**
   * Types one field of a saved entry on the device. The password field is
   * resolved from SecretStorage here, host-side — it never round-trips
   * through the webview.
   */
  async sendEntryField(id: string, field: 'text' | 'login' | 'password'): Promise<void> {
    const entry = this.deps.entries.get(id);
    if (!entry) throw new Error('Entry not found — it may have been deleted.');

    let value: string | undefined;
    if (field === 'text' && entry.type === 'text') {
      value = entry.text;
    } else if (field === 'login' && entry.type === 'credentials') {
      value = entry.login;
    } else if (field === 'password' && entry.type === 'credentials') {
      value = await this.deps.entries.getPassword(id);
      if (value === undefined) throw new Error('No password stored for this entry — edit it to set one.');
    } else {
      throw new Error(`Entry has no ${field} field.`);
    }

    await this.sendText(value);
  }

  private requireDevice(): RokuDevice {
    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      throw new Error('No active Roku device. Select a device in the Roku Devices view first.');
    }
    return device;
  }
}

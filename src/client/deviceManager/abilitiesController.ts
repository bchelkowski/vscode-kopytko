import type { DeviceManager, InstallerClient, RokuDevice } from 'kopytko-roku-device';
import type { CredentialStore } from '../roku/persistence/credentialStore';

export interface AbilitiesControllerDeps {
  deviceManager: DeviceManager;
  installer: InstallerClient;
  credentials: CredentialStore;
  /**
   * Prompts the user for the device's developer password when none is stored.
   * Injected by the activation layer (vscode.window.showInputBox) so this
   * controller stays vscode-free. Returns undefined when the user cancels.
   */
  promptPassword: (device: RokuDevice) => Promise<string | undefined>;
}

/** Thrown when the user cancels the password prompt — callers show no error. */
export class PasswordPromptCancelled extends Error {
  constructor() {
    super('Password prompt cancelled.');
    this.name = 'PasswordPromptCancelled';
  }
}

/**
 * Device abilities surfaced by the Device Manager: web-admin automation
 * (screenshot, install, delete, package, rekey, update check, reboot) via
 * InstallerClient.
 *
 * Web-admin calls need the device's developer password (HTTP digest, user
 * `rokudev`) — resolved from the shared CredentialStore, falling back to the
 * injected prompt (which offers to save).
 */
export class AbilitiesController {
  constructor(private readonly deps: AbilitiesControllerDeps) {}

  getActiveDevice(): RokuDevice | undefined {
    return this.deps.deviceManager.getActiveDevice();
  }

  // ── web-admin (developer password) ────────────────────────────────────────

  async takeScreenshot(destPath: string): Promise<void> {
    const { device, password } = await this.requireDeviceWithPassword();
    await this.deps.installer.takeScreenshot(device.ip, password, destPath);
  }

  async checkForUpdate(): Promise<void> {
    const { device, password } = await this.requireDeviceWithPassword();
    await this.deps.installer.checkForUpdate(device.ip, password);
  }

  async reboot(): Promise<void> {
    const { device, password } = await this.requireDeviceWithPassword();
    await this.deps.installer.reboot(device.ip, password);
  }

  async installChannel(zipPath: string): Promise<void> {
    const { device, password } = await this.requireDeviceWithPassword();
    await this.deps.installer.installChannel(device.ip, password, zipPath);
  }

  async deleteChannel(): Promise<void> {
    const { device, password } = await this.requireDeviceWithPassword();
    await this.deps.installer.deleteChannel(device.ip, password);
  }

  async packageChannel(zipPath: string, appNameVersion: string, signingPassword: string, destPkgPath: string): Promise<void> {
    const { device, password } = await this.requireDeviceWithPassword();
    await this.deps.installer.packageChannel(device.ip, password, zipPath, appNameVersion, signingPassword, destPkgPath);
  }

  async rekey(pkgPath: string, signingPassword: string): Promise<void> {
    const { device, password } = await this.requireDeviceWithPassword();
    await this.deps.installer.rekey(device.ip, password, pkgPath, signingPassword);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private requireDevice(): RokuDevice {
    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      throw new Error('No active Roku device. Select a device in the Roku Devices view first.');
    }
    return device;
  }

  private async requireDeviceWithPassword(): Promise<{ device: RokuDevice; password: string }> {
    const device = this.requireDevice();
    const key = device.deviceId || device.serialNumber;

    let password = await this.deps.credentials.getPassword(key);
    if (password === undefined) {
      password = await this.deps.promptPassword(device);
      if (password === undefined) throw new PasswordPromptCancelled();
    }
    return { device, password };
  }
}

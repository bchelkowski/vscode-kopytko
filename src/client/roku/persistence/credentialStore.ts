import * as vscode from 'vscode';

const KEY_PREFIX = 'kopytko.device.password';

/**
 * Secure credential store for Roku device passwords.
 * Uses VS Code SecretStorage (OS keychain) for persistence.
 * Keyed by device ID (ECP `device-id` field) to survive DHCP IP changes.
 */
export class CredentialStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  /** Retrieve stored password for a device. */
  async getPassword(deviceId: string): Promise<string | undefined> {
    return this.secrets.get(this.key(deviceId));
  }

  /** Create or update a device password. */
  async setPassword(deviceId: string, password: string): Promise<void> {
    await this.secrets.store(this.key(deviceId), password);
  }

  /** Remove a stored device password. */
  async deletePassword(deviceId: string): Promise<void> {
    await this.secrets.delete(this.key(deviceId));
  }

  /** Check if a password exists for a device. */
  async hasPassword(deviceId: string): Promise<boolean> {
    const value = await this.secrets.get(this.key(deviceId));
    return value !== undefined;
  }

  private key(deviceId: string): string {
    return `${KEY_PREFIX}.${deviceId}`;
  }
}

export default CredentialStore;

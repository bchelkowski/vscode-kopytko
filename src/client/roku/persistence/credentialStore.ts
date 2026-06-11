import * as vscode from 'vscode';

const KEY_PREFIX = 'kopytko.device.password';

/**
 * Secure credential store for Roku device passwords.
 * Uses VS Code SecretStorage (OS keychain) for persistence.
 * Keyed by device serial number to survive DHCP IP changes.
 */
export class CredentialStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  /** Retrieve stored password for a device. */
  async getPassword(serialNumber: string): Promise<string | undefined> {
    return this.secrets.get(this.key(serialNumber));
  }

  /** Create or update a device password. */
  async setPassword(serialNumber: string, password: string): Promise<void> {
    await this.secrets.store(this.key(serialNumber), password);
  }

  /** Remove a stored device password. */
  async deletePassword(serialNumber: string): Promise<void> {
    await this.secrets.delete(this.key(serialNumber));
  }

  /** Check if a password exists for a device. */
  async hasPassword(serialNumber: string): Promise<boolean> {
    const value = await this.secrets.get(this.key(serialNumber));
    return value !== undefined;
  }

  private key(serialNumber: string): string {
    return `${KEY_PREFIX}.${serialNumber}`;
  }
}

export default CredentialStore;

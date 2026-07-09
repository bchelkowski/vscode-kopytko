import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { ProfileView } from './webview/protocol';

const KEY = 'kopytko.rokuPay.profiles';
const SECRET_PREFIX = 'kopytko.rokuPay.apiKey';

/**
 * A named Roku Pay credential profile. The partner API key is NOT part of
 * this record — it lives in SecretStorage (OS keychain), keyed by profile id.
 * `transactionId` is deliberately not stored here either: it changes per
 * purchase and stays a plain form field (last value kept in the UI state).
 */
export interface RokuPayProfile {
  id: string;
  name: string;
  partnerReferenceId: string;
  hasApiKey: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Input for {@link RokuPayProfileStore.save} — id optional (created when absent). */
export interface RokuPayProfileInput {
  id?: string;
  name: string;
  partnerReferenceId: string;
  /** Non-empty replaces the stored secret; absent/empty keeps the existing one. */
  partnerAPIKey?: string;
}

/**
 * Persists Roku Pay credential profiles in the GLOBAL Memento (they describe
 * the partner account, not a workspace), with the partner API key in
 * SecretStorage — never in the Memento. Mirrors the TextEntryStore convention:
 * a single `Record<id, RokuPayProfile>` under one key.
 */
export class RokuPayProfileStore {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires after every save/delete so the panel can refresh its profile list. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secrets: vscode.SecretStorage,
  ) {}

  /** Returns all profiles, sorted by name (case-insensitive). */
  getAll(): RokuPayProfile[] {
    const profiles = this.globalState.get<Record<string, RokuPayProfile>>(KEY, {});
    return Object.values(profiles).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /** Retrieves a single profile by id. */
  get(id: string): RokuPayProfile | undefined {
    const profiles = this.globalState.get<Record<string, RokuPayProfile>>(KEY, {});
    return profiles[id];
  }

  /**
   * Upserts a profile. Without an id (or with an unknown id) a new profile is
   * created; an existing one keeps its `createdAt` and gets a fresh
   * `updatedAt`. A non-empty `partnerAPIKey` replaces the stored secret; an
   * absent/empty key keeps the existing secret (so edits don't require
   * retyping it). Returns the stored profile.
   */
  async save(input: RokuPayProfileInput): Promise<RokuPayProfile> {
    const profiles = this.globalState.get<Record<string, RokuPayProfile>>(KEY, {});
    const now = Date.now();
    const existing = input.id ? profiles[input.id] : undefined;
    const id = input.id ?? crypto.randomUUID();

    if (input.partnerAPIKey !== undefined && input.partnerAPIKey !== '') {
      await this.secrets.store(this.secretKey(id), input.partnerAPIKey);
    }

    const profile: RokuPayProfile = {
      id,
      name: input.name,
      partnerReferenceId: input.partnerReferenceId,
      hasApiKey: (existing?.hasApiKey ?? false) || (input.partnerAPIKey !== undefined && input.partnerAPIKey !== ''),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    profiles[id] = profile;
    await this.globalState.update(KEY, profiles);
    this.changeEmitter.fire();
    return profile;
  }

  /** Deletes a profile by id, including its stored secret (no-op when unknown). */
  async delete(id: string): Promise<void> {
    const profiles = this.globalState.get<Record<string, RokuPayProfile>>(KEY, {});
    if (!(id in profiles)) return;
    delete profiles[id];
    await this.globalState.update(KEY, profiles);
    await this.secrets.delete(this.secretKey(id));
    this.changeEmitter.fire();
  }

  /** Resolves a profile's partner API key from SecretStorage. HOST-SIDE ONLY. */
  async getApiKey(id: string): Promise<string | undefined> {
    return this.secrets.get(this.secretKey(id));
  }

  /** Webview-safe projection of all profiles (no secrets). */
  getViews(): ProfileView[] {
    return this.getAll().map(({ id, name, partnerReferenceId, hasApiKey, updatedAt }) =>
      ({ id, name, partnerReferenceId, hasApiKey, updatedAt }));
  }

  private secretKey(id: string): string {
    return `${SECRET_PREFIX}.${id}`;
  }
}

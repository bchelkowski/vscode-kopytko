import * as crypto from 'crypto';
import * as vscode from 'vscode';

const KEY = 'kopytko.deviceManager.textEntries';
const SECRET_PREFIX = 'kopytko.deviceManager.entry';

interface TextEntryBase {
  id: string;
  /** Optional display title; the UI falls back to the value/login. */
  title?: string;
  createdAt: number;
  updatedAt: number;
}

/** Plain text to type on the device with one Send button. */
export type PlainTextEntry = TextEntryBase & { type: 'text'; text: string };

/**
 * Login + password pair with a Send button per field. The password is NOT
 * part of this record — it lives in SecretStorage, keyed by entry id.
 */
export type CredentialsEntry = TextEntryBase & { type: 'credentials'; login: string };

export type TextEntry = PlainTextEntry | CredentialsEntry;

/** Input for {@link TextEntryStore.save} — id optional (created when absent). */
export type TextEntryInput =
  | { id?: string; type: 'text'; title?: string; text: string }
  | { id?: string; type: 'credentials'; title?: string; login: string; password?: string };

/**
 * Persists quick-typing text entries in the GLOBAL Memento (they describe
 * device/app credentials and search terms, not the workspace), with
 * credential passwords in SecretStorage (OS keychain) — never in the Memento.
 *
 * Stored as a single `Record<id, TextEntry>` under one key, mirroring the
 * ParameterSetStore/DeviceStore cache-map convention.
 */
export class TextEntryStore {
  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secrets: vscode.SecretStorage,
  ) {}

  /** Returns all saved entries, sorted by display label (case-insensitive). */
  getAll(): TextEntry[] {
    const entries = this.globalState.get<Record<string, TextEntry>>(KEY, {});
    return Object.values(entries).sort((a, b) =>
      labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: 'base' }));
  }

  /** Retrieves a single entry by id. */
  get(id: string): TextEntry | undefined {
    const entries = this.globalState.get<Record<string, TextEntry>>(KEY, {});
    return entries[id];
  }

  /**
   * Upserts an entry. Without an id (or with an unknown id) a new entry is
   * created; an existing entry keeps its `createdAt` and gets a fresh
   * `updatedAt`. For credentials, a non-empty `password` replaces the stored
   * secret; an absent/empty password keeps the existing secret (so edits
   * don't require retyping it). Returns the stored entry.
   */
  async save(input: TextEntryInput): Promise<TextEntry> {
    const entries = this.globalState.get<Record<string, TextEntry>>(KEY, {});
    const now = Date.now();
    const existing = input.id ? entries[input.id] : undefined;
    const id = input.id ?? crypto.randomUUID();

    // Switching an entry's type drops the fields (and secret) of the old type.
    if (existing && existing.type === 'credentials' && input.type !== 'credentials') {
      await this.secrets.delete(this.secretKey(id));
    }

    let entry: TextEntry;
    if (input.type === 'text') {
      entry = {
        id, type: 'text', title: input.title, text: input.text,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
    } else {
      entry = {
        id, type: 'credentials', title: input.title, login: input.login,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
      if (input.password !== undefined && input.password !== '') {
        await this.secrets.store(this.secretKey(id), input.password);
      }
    }

    entries[id] = entry;
    await this.globalState.update(KEY, entries);
    return entry;
  }

  /** Deletes an entry by id, including its stored secret (no-op when unknown). */
  async delete(id: string): Promise<void> {
    const entries = this.globalState.get<Record<string, TextEntry>>(KEY, {});
    if (!(id in entries)) return;
    const wasCredentials = entries[id].type === 'credentials';
    delete entries[id];
    await this.globalState.update(KEY, entries);
    if (wasCredentials) {
      await this.secrets.delete(this.secretKey(id));
    }
  }

  /** Resolves a credentials entry's password from SecretStorage. */
  async getPassword(id: string): Promise<string | undefined> {
    return this.secrets.get(this.secretKey(id));
  }

  private secretKey(id: string): string {
    return `${SECRET_PREFIX}.${id}`;
  }
}

function labelOf(entry: TextEntry): string {
  return entry.title || (entry.type === 'text' ? entry.text : entry.login);
}

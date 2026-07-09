import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { PayLogEntry, PayUiState } from './webview/protocol';

const LOG_KEY = 'kopytko.rokuPay.log';
const UI_STATE_KEY = 'kopytko.rokuPay.uiState';

/** Oldest entries are trimmed on insert once the log exceeds this count. */
export const MAX_LOG_ENTRIES = 200;
/** Response bodies are truncated to this length BEFORE persisting. */
export const MAX_BODY_LENGTH = 64 * 1024;

const TRUNCATION_MARKER = '… [truncated]';

/**
 * Persists the Roku Pay request/response history in the GLOBAL Memento —
 * requests target the partner's cloud account, not a workspace. Stored as a
 * single `Record<id, PayLogEntry>` under one key (ScriptStore convention),
 * capped at {@link MAX_LOG_ENTRIES} with bodies truncated at
 * {@link MAX_BODY_LENGTH} so the Memento stays bounded.
 *
 * Entries must arrive here already MASKED — the controller replaces the
 * partner API key with `****` before calling {@link add}; this store never
 * sees the raw key.
 */
export class RokuPayLogStore {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires after every add/delete/clear so the panel can refresh the history. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly globalState: vscode.Memento) {}

  /** Returns all entries, newest first. */
  getAll(): PayLogEntry[] {
    const entries = this.globalState.get<Record<string, PayLogEntry>>(LOG_KEY, {});
    return Object.values(entries).sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Appends an entry (truncating the response body), trimming the oldest past the cap. */
  async add(entry: Omit<PayLogEntry, 'id'>): Promise<PayLogEntry> {
    const entries = this.globalState.get<Record<string, PayLogEntry>>(LOG_KEY, {});

    const stored: PayLogEntry = { ...entry, id: crypto.randomUUID() };
    if (stored.responseBody !== undefined && stored.responseBody.length > MAX_BODY_LENGTH) {
      stored.responseBody = stored.responseBody.slice(0, MAX_BODY_LENGTH) + TRUNCATION_MARKER;
    }
    entries[stored.id] = stored;

    const sorted = Object.values(entries).sort((a, b) => b.timestamp - a.timestamp);
    for (const old of sorted.slice(MAX_LOG_ENTRIES)) {
      delete entries[old.id];
    }

    await this.globalState.update(LOG_KEY, entries);
    this.changeEmitter.fire();
    return stored;
  }

  /** Deletes one entry by id (no-op when unknown). */
  async delete(id: string): Promise<void> {
    const entries = this.globalState.get<Record<string, PayLogEntry>>(LOG_KEY, {});
    if (!(id in entries)) return;
    delete entries[id];
    await this.globalState.update(LOG_KEY, entries);
    this.changeEmitter.fire();
  }

  /** Deletes the whole history. */
  async clear(): Promise<void> {
    await this.globalState.update(LOG_KEY, {});
    this.changeEmitter.fire();
  }

  /** Last-used prefill/selection state (transaction id, profile, endpoint). */
  getUiState(): PayUiState {
    return this.globalState.get<PayUiState>(UI_STATE_KEY, {});
  }

  async setUiState(state: PayUiState): Promise<void> {
    await this.globalState.update(UI_STATE_KEY, state);
  }
}

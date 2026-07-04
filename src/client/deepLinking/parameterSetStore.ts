import * as crypto from 'crypto';
import * as vscode from 'vscode';

const KEY = 'kopytko.deepLinking.sets';

export interface DeepLinkParam {
  key: string;
  value: string;
}

export interface DeepLinkParameterSet {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  contentId: string;
  params: DeepLinkParam[];
  createdAt: number;
  updatedAt: number;
}

/** Input for {@link ParameterSetStore.save} — id optional (created when absent). */
export type DeepLinkParameterSetInput =
  Omit<DeepLinkParameterSet, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

/**
 * Persists named deep-link parameter sets in the workspace-scoped Memento,
 * so each project keeps its own library of contentId/param presets.
 *
 * Stored as a single `Record<id, DeepLinkParameterSet>` under one key,
 * mirroring the DeviceStore cache-map convention.
 */
export class ParameterSetStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  /** Returns all saved sets, sorted by name (case-insensitive). */
  getAll(): DeepLinkParameterSet[] {
    const sets = this.workspaceState.get<Record<string, DeepLinkParameterSet>>(KEY, {});
    return Object.values(sets).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /** Retrieves a single set by id. */
  get(id: string): DeepLinkParameterSet | undefined {
    const sets = this.workspaceState.get<Record<string, DeepLinkParameterSet>>(KEY, {});
    return sets[id];
  }

  /**
   * Upserts a set. Without an id (or with an unknown id) a new entry is
   * created; an existing entry keeps its `createdAt` and gets a fresh
   * `updatedAt`. Returns the stored set.
   */
  async save(input: DeepLinkParameterSetInput): Promise<DeepLinkParameterSet> {
    const sets = this.workspaceState.get<Record<string, DeepLinkParameterSet>>(KEY, {});
    const now = Date.now();
    const existing = input.id ? sets[input.id] : undefined;

    const set: DeepLinkParameterSet = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    sets[set.id] = set;
    await this.workspaceState.update(KEY, sets);
    return set;
  }

  /** Deletes a set by id (no-op when the id is unknown). */
  async delete(id: string): Promise<void> {
    const sets = this.workspaceState.get<Record<string, DeepLinkParameterSet>>(KEY, {});
    if (!(id in sets)) return;
    delete sets[id];
    await this.workspaceState.update(KEY, sets);
  }
}

import * as crypto from 'crypto';
import * as vscode from 'vscode';

const KEY = 'kopytko.deviceManager.scripts';

/**
 * Script formats the editor tab can handle. `rasp` is Roku's Automation
 * Script Protocol (the YAML format used by the official Roku Remote Tool);
 * `kopytko` is reserved for the future custom automation format.
 */
export type ScriptFormat = 'rasp' | 'kopytko';

export interface DeviceScript {
  id: string;
  /** Display title; defaults to "Untitled script" in the UI when empty. */
  title: string;
  format: ScriptFormat;
  /**
   * Raw script text, stored verbatim — for RASP this preserves YAML anchors
   * and comments so exported files stay compatible with Roku's own tool.
   */
  source: string;
  createdAt: number;
  updatedAt: number;
}

/** Input for {@link ScriptStore.save} — id optional (created when absent). */
export type DeviceScriptInput =
  Omit<DeviceScript, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

/**
 * Persists automation scripts in the GLOBAL Memento — scripts drive devices
 * and apps, not workspaces, so they follow the user across projects.
 *
 * Stored as a single `Record<id, DeviceScript>` under one key, mirroring the
 * ParameterSetStore/DeviceStore cache-map convention.
 */
export class ScriptStore {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires after every save/delete — lets the sidebar list refresh when the editor panel saves. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly globalState: vscode.Memento) {}

  /** Returns all saved scripts, sorted by title (case-insensitive). */
  getAll(): DeviceScript[] {
    const scripts = this.globalState.get<Record<string, DeviceScript>>(KEY, {});
    return Object.values(scripts).sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }

  /** Retrieves a single script by id. */
  get(id: string): DeviceScript | undefined {
    const scripts = this.globalState.get<Record<string, DeviceScript>>(KEY, {});
    return scripts[id];
  }

  /**
   * Upserts a script. Without an id (or with an unknown id) a new entry is
   * created; an existing entry keeps its `createdAt` and gets a fresh
   * `updatedAt`. Returns the stored script.
   */
  async save(input: DeviceScriptInput): Promise<DeviceScript> {
    const scripts = this.globalState.get<Record<string, DeviceScript>>(KEY, {});
    const now = Date.now();
    const existing = input.id ? scripts[input.id] : undefined;

    const script: DeviceScript = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    scripts[script.id] = script;
    await this.globalState.update(KEY, scripts);
    this.changeEmitter.fire();
    return script;
  }

  /** Deletes a script by id (no-op when the id is unknown). */
  async delete(id: string): Promise<void> {
    const scripts = this.globalState.get<Record<string, DeviceScript>>(KEY, {});
    if (!(id in scripts)) return;
    delete scripts[id];
    await this.globalState.update(KEY, scripts);
    this.changeEmitter.fire();
  }
}

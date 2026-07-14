/**
 * Persists Network Inspector capture sessions to disk, mirroring the
 * Diagnostics/Perfetto session-folder pattern: each capture session gets a
 * timestamped folder under the configured output root holding a manifest,
 * an append-only `flows.ndjson`, and the FULL (uncapped) body bytes per flow.
 * The in-memory ring buffer only ever retains `maxBodyBytes` per body — this
 * store is what makes "open the full body in an editor" possible without
 * growing memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildSessionId } from '../../diagnostics/storage/sessionStore';
import type { FlowBodies } from '../capture/flow';
import type { SerializedFlow } from '../webview/protocol';

/** Minimal async filesystem surface — injectable so tests run entirely in-memory. */
export interface NetworkSessionSink {
  ensureDir(dir: string): Promise<void>;
  appendFile(file: string, data: string): Promise<void>;
  writeFile(file: string, data: string | Buffer): Promise<void>;
  readFile(file: string): Promise<Buffer>;
  exists(target: string): Promise<boolean>;
}

/** Default sink backed by the Node filesystem. */
export const nodeNetworkSink: NetworkSessionSink = {
  async ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  },
  async appendFile(file, data) {
    await fs.promises.appendFile(file, data, 'utf-8');
  },
  async writeFile(file, data) {
    await fs.promises.writeFile(file, data);
  },
  async readFile(file) {
    return fs.promises.readFile(file);
  },
  async exists(target) {
    try {
      await fs.promises.access(target);
      return true;
    } catch {
      return false;
    }
  },
};

export const NETWORK_SESSION_MANIFEST = 'session.json';
export const FLOWS_FILE = 'flows.ndjson';
export const BODIES_DIR = 'bodies';

export interface NetworkSessionManifest {
  schemaVersion: 1;
  /** Folder name, e.g. `2026-07-14_10-30-00__network`. */
  id: string;
  startedWall: number;
  endedWall: number | null;
  device: { ip?: string; label?: string };
  proxyPort: number;
  /** Persisted flow count — finalized when the session ends. */
  flowCount: number;
}

/** On-disk body file suffixes: sent/received bytes plus the pre-rewrite originals. */
export type BodyFileKind = 'req' | 'res' | 'req.orig' | 'res.orig';

export interface NetworkSessionStoreOptions {
  /**
   * Resolves the output root when a session starts (the setting is
   * workspace-relative, so it can't be resolved once at construction).
   * Returning undefined (no workspace) disables persistence for the session.
   */
  resolveRoot: () => string | undefined;
  sink?: NetworkSessionSink;
  /** Overridable for tests — deterministic session folder names. */
  now?: () => number;
}

export class NetworkSessionStore {
  private readonly sink: NetworkSessionSink;
  private readonly now: () => number;
  private dir: string | null = null;
  private manifest: NetworkSessionManifest | null = null;

  constructor(private readonly options: NetworkSessionStoreOptions) {
    this.sink = options.sink ?? nodeNetworkSink;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Current (or, after `endSession`, most recent) session folder. Kept after
   * the session ends so bodies stay readable while their flows are still in
   * the buffer.
   */
  get sessionDir(): string | null {
    return this.dir;
  }

  /**
   * Creates the session folder + manifest. With no resolvable root the store
   * simply stays inactive (every later call is a no-op) rather than failing
   * capture.
   */
  async startSession(info: { device?: { ip?: string; label?: string }; proxyPort: number }): Promise<void> {
    const root = this.options.resolveRoot();
    if (!root) {
      this.dir = null;
      this.manifest = null;
      return;
    }
    const startedWall = this.now();
    const id = buildSessionId(startedWall, 'network');
    const dir = path.join(root, id);
    await this.sink.ensureDir(path.join(dir, BODIES_DIR));
    this.dir = dir;
    this.manifest = {
      schemaVersion: 1,
      id,
      startedWall,
      endedWall: null,
      device: info.device ?? {},
      proxyPort: info.proxyPort,
      flowCount: 0,
    };
    await this.writeManifest();
  }

  /** Finalizes the manifest (endedWall + flowCount). The folder stays readable. */
  async endSession(): Promise<void> {
    if (!this.dir || !this.manifest) return;
    this.manifest.endedWall = this.now();
    await this.writeManifest();
    this.manifest = null;
  }

  /** Appends the flow's metadata line and writes its full body files. */
  async appendFlow(flow: SerializedFlow, bodies?: FlowBodies): Promise<void> {
    if (!this.dir) return;
    if (this.manifest) this.manifest.flowCount += 1;
    const writes: Promise<void>[] = [
      this.sink.appendFile(path.join(this.dir, FLOWS_FILE), JSON.stringify(flow) + '\n'),
    ];
    if (bodies?.request?.length) writes.push(this.writeBody(flow.id, 'req', bodies.request));
    if (bodies?.response?.length) writes.push(this.writeBody(flow.id, 'res', bodies.response));
    if (bodies?.originalRequest?.length) writes.push(this.writeBody(flow.id, 'req.orig', bodies.originalRequest));
    if (bodies?.originalResponse?.length) writes.push(this.writeBody(flow.id, 'res.orig', bodies.originalResponse));
    await Promise.all(writes);
  }

  /** Full body bytes from the session folder, or null when absent/unreadable. */
  async readBody(flowId: string, kind: BodyFileKind): Promise<Buffer | null> {
    if (!this.dir) return null;
    try {
      return await this.sink.readFile(this.bodyPath(flowId, kind));
    } catch {
      return null;
    }
  }

  /** Whether a body file exists — cheap check for "is the full body available?". */
  async hasBody(flowId: string, kind: BodyFileKind): Promise<boolean> {
    if (!this.dir) return false;
    return this.sink.exists(this.bodyPath(flowId, kind));
  }

  private writeBody(flowId: string, kind: BodyFileKind, data: Buffer): Promise<void> {
    return this.sink.writeFile(this.bodyPath(flowId, kind), data);
  }

  private bodyPath(flowId: string, kind: BodyFileKind): string {
    return path.join(this.dir!, BODIES_DIR, `${flowId}.${kind}`);
  }

  private async writeManifest(): Promise<void> {
    if (!this.dir || !this.manifest) return;
    await this.sink.writeFile(path.join(this.dir, NETWORK_SESSION_MANIFEST), JSON.stringify(this.manifest, null, 2));
  }
}

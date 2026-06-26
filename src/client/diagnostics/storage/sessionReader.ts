import type { DiagnosticEvent, DiagnosticEventType } from '../session/eventModel';
import { STREAM_FILE } from '../session/eventModel';
import { type DiagnosticsSink, joinPath } from './sink';
import { type SessionManifest, readManifest } from './sessionStore';

/** A discovered session: its manifest plus the directory it lives in. */
export interface DiscoveredSession {
  dir: string;
  manifest: SessionManifest;
}

/**
 * Reads recorded sessions back from disk for replay/preview.
 *
 * NDJSON parsing is tolerant: blank lines and any unparseable line (e.g. a torn
 * final line from a crash) are skipped rather than failing the whole read.
 */
export class SessionReader {
  constructor(private readonly sink: DiagnosticsSink) {}

  /** Lists sessions under `root`, newest first, that have a valid manifest. */
  async listSessions(root: string): Promise<DiscoveredSession[]> {
    if (!(await this.sink.exists(root))) return [];

    const entries = await this.sink.readdir(root);
    const sessions: DiscoveredSession[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const dir = joinPath(root, entry.name);
      const manifest = await readManifest(this.sink, dir);
      if (manifest) sessions.push({ dir, manifest });
    }

    sessions.sort((a, b) => b.manifest.startedWall - a.manifest.startedWall);
    return sessions;
  }

  /** Reads and parses a single event stream from a session directory. */
  async readStream<T extends DiagnosticEvent = DiagnosticEvent>(
    dir: string,
    type: DiagnosticEventType,
  ): Promise<T[]> {
    let raw: string;
    try {
      raw = await this.sink.readFile(joinPath(dir, STREAM_FILE[type]));
    } catch {
      return []; // stream not recorded
    }

    const events: T[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as T);
      } catch {
        // Skip a torn/partial line (e.g. last line after a crash).
      }
    }
    return events;
  }
}

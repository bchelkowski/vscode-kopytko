import * as fs from 'fs';
import * as path from 'path';

export const PERFETTO_SESSION_SUFFIX = '__perfetto';
export const PERFETTO_MANIFEST_FILE = 'session.json';
export const PERFETTO_TRACE_FILE = 'trace.perfetto-trace';
export const SCHEMA_VERSION = 1;

export interface PerfettoManifest {
  schemaVersion: number;
  id: string;
  startedWall: number;
  endedWall: number | null;
  device: {
    deviceId?: string;
    serialNumber?: string;
    ip: string;
    modelName?: string;
    softwareVersion?: string;
  };
  app: { id?: string; title?: string; version?: string };
}

export interface PerfettoSessionInfo {
  dir: string;
  id: string;
  startedWall: number;
  endedWall: number | null;
  appTitle?: string;
  deviceIp: string;
  traceBytes: number;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Builds a filesystem-safe session id, e.g. `2026-06-28_14-22-01__MyApp__perfetto`. */
export function buildPerfettoSessionId(wall: number, appLabel?: string): string {
  const d = new Date(wall);
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const label = (appLabel ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const base = label ? `${stamp}__${label}` : stamp;
  return `${base}${PERFETTO_SESSION_SUFFIX}`;
}

/** Writes (or overwrites) the session manifest to disk. */
export function writeManifest(dir: string, manifest: PerfettoManifest): void {
  fs.writeFileSync(path.join(dir, PERFETTO_MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');
}

/** Reads and parses a session manifest, or returns null if absent/invalid. */
export function readManifest(dir: string): PerfettoManifest | null {
  try {
    const raw = fs.readFileSync(path.join(dir, PERFETTO_MANIFEST_FILE), 'utf-8');
    return JSON.parse(raw) as PerfettoManifest;
  } catch {
    return null;
  }
}

/**
 * Lists all Perfetto sessions under `root`, newest first.
 * Only directories whose name ends with `__perfetto` and have a valid manifest
 * are included.
 */
export function listSessions(root: string): PerfettoSessionInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: PerfettoSessionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(PERFETTO_SESSION_SUFFIX)) continue;
    const dir = path.join(root, entry.name);
    const manifest = readManifest(dir);
    if (!manifest) continue;

    let traceBytes = 0;
    try {
      const stat = fs.statSync(path.join(dir, PERFETTO_TRACE_FILE));
      traceBytes = stat.size;
    } catch {
      // trace file not yet written or session is live
    }

    sessions.push({
      dir,
      id: manifest.id,
      startedWall: manifest.startedWall,
      endedWall: manifest.endedWall,
      appTitle: manifest.app.title,
      deviceIp: manifest.device.ip,
      traceBytes,
    });
  }

  sessions.sort((a, b) => b.startedWall - a.startedWall);
  return sessions;
}

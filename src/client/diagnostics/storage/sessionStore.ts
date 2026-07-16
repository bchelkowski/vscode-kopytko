import type { DiagnosticEventType } from '../session/eventModel';
import { type DiagnosticsSink, joinPath } from './sink';

export const SESSION_MANIFEST = 'session.json';
export const SCHEMA_VERSION = 1;

/** Metadata describing one recorded (or replayable) diagnostics session. */
export interface SessionManifest {
  schemaVersion: number;
  /** Folder name, e.g. `2026-06-26_07-30-00__Acme`. */
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
  app: {
    id?: string;
    title?: string;
    version?: string;
  };
  collectors: { type: DiagnosticEventType; intervalMs: number }[];
  /** Per-stream file name + persisted sample count. */
  streams: Partial<Record<DiagnosticEventType, { file: string; count: number }>>;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Builds a filesystem-safe session id from a timestamp and optional app label,
 * e.g. `2026-06-26_07-30-00__Acme`.
 */
export function buildSessionId(wall: number, appLabel?: string): string {
  const d = new Date(wall);
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const label = (appLabel ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return label ? `${stamp}__${label}` : stamp;
}

/** Writes (or overwrites) the manifest for a session directory. */
export async function writeManifest(
  sink: DiagnosticsSink,
  dir: string,
  manifest: SessionManifest,
): Promise<void> {
  await sink.writeFile(joinPath(dir, SESSION_MANIFEST), JSON.stringify(manifest, null, 2));
}

/** Reads and parses a session manifest, or returns null if absent/invalid. */
export async function readManifest(
  sink: DiagnosticsSink,
  dir: string,
): Promise<SessionManifest | null> {
  try {
    const raw = await sink.readFile(joinPath(dir, SESSION_MANIFEST));
    return JSON.parse(raw) as SessionManifest;
  } catch {
    return null;
  }
}

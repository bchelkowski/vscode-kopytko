/**
 * Webview message protocol for the Kopytko Perfetto panel.
 *
 * No imports — this file is bundled separately for the webview context.
 */

// ── Extension → Webview ───────────────────────────────────────────────────────

export type WebviewState = 'idle' | 'deploying' | 'recording' | 'stopped';

export interface LockMsg {
  kind: 'lock';
  /** Which panel owns the device, or null if free. */
  owner: 'diagnostics' | 'perfetto' | null;
}

export interface StateMsg {
  kind: 'state';
  state: WebviewState;
  sessionId?: string;
  sessionStartWall?: number;
  device?: { name: string; ip: string; appTitle?: string };
}

export interface ChunkMsg {
  kind: 'chunk';
  /** Raw binary Perfetto data as a transferable ArrayBuffer. */
  data: ArrayBuffer;
}

export interface SessionsMsg {
  kind: 'sessions';
  sessions: SerializedPerfettoSession[];
}

export interface ReplayMsg {
  kind: 'replay';
  session: SerializedPerfettoSession;
  /** Full binary trace as a transferable ArrayBuffer. */
  data: ArrayBuffer;
}

export interface ErrorMsg {
  kind: 'error';
  message: string;
}

export type ExtMsg = LockMsg | StateMsg | ChunkMsg | SessionsMsg | ReplayMsg | ErrorMsg;

// ── Webview → Extension ───────────────────────────────────────────────────────

export interface StartMsg { kind: 'start' }
export interface StopMsg { kind: 'stop' }
export interface NewSessionMsg { kind: 'new-session' }
export interface LoadSessionMsg { kind: 'load-session'; dir: string }
export interface LoadLiveMsg { kind: 'load-live' }
export interface HeapSnapshotMsg { kind: 'heap-snapshot' }

export type WebMsg =
  | StartMsg
  | StopMsg
  | NewSessionMsg
  | LoadSessionMsg
  | LoadLiveMsg
  | HeapSnapshotMsg;

// ── Shared types ──────────────────────────────────────────────────────────────

export interface SerializedPerfettoSession {
  dir: string;
  id: string;
  startedWall: number;
  endedWall: number | null;
  appTitle?: string;
  deviceIp: string;
  traceBytes: number;
}

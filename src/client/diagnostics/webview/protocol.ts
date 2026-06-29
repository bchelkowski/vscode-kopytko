/**
 * Message protocol between the extension host and the diagnostics webview.
 * This file has zero imports so it can be bundled into the webview without
 * pulling in any Node.js or VS Code APIs.
 */

export interface DeviceInfo {
  name: string;
  ip: string;
  appTitle?: string;
  appVersion?: string;
}

export interface WebviewState {
  recording: boolean;
  device?: DeviceInfo;
  /** Wall-clock ms when the session started; undefined when not recording. */
  sessionStartWall?: number;
}

// ── Serialized event shapes ───────────────────────────────────────────────────

export interface SerializedMemCpuPoint {
  wall: number;
  memKiB: number;
  anonKiB: number;
  fileKiB: number;
  cpuPct: number;
  cpuUser: number;
  cpuSys: number;
}

export interface SerializedNodeTypeEntry {
  type: string;
  count: number;
  staticBytes: number;
}

export interface SerializedNodePoint {
  wall: number;
  totalCount: number;
  /** Per-type breakdown for the list view. Present on every snapshot. */
  types: SerializedNodeTypeEntry[];
}

export interface SerializedRendezvousPoint {
  wall: number;
  durationMs: number;
  file: string;
  line: number;
}

export interface HistoryPayload {
  memCpu: SerializedMemCpuPoint[];
  nodes: SerializedNodePoint[];
  rendezvous: SerializedRendezvousPoint[];
}

/** Metadata about a recorded session, sent as part of the session list. */
export interface SerializedSessionInfo {
  /** Absolute path to the session folder on disk. Used as the selector value. */
  dir: string;
  id: string;
  startedWall: number;
  endedWall: number | null;
  appTitle?: string;
  deviceIp?: string;
  /** Per-stream sample counts from the manifest (for display). */
  sampleCounts: Partial<Record<string, number>>;
}

// ── Extension → Webview ───────────────────────────────────────────────────────

export type ExtMsg =
  /** Sent once on panel open; seeds charts with ring-buffer data. */
  | { kind: 'init'; state: WebviewState; history: HistoryPayload }
  /** Periodic live data batch while recording. */
  | { kind: 'batch'; memCpu: SerializedMemCpuPoint[]; nodes: SerializedNodePoint[]; rendezvous: SerializedRendezvousPoint[] }
  /** Recording state or device changed. */
  | { kind: 'state'; state: WebviewState }
  /** Full list of recorded sessions available for replay (newest first). */
  | { kind: 'sessions'; sessions: SerializedSessionInfo[] }
  /** Full data for a past session loaded from disk (read-only replay). */
  | { kind: 'replay'; session: SerializedSessionInfo; history: HistoryPayload }
  /** Advisory status message shown below the toolbar (e.g. debug console not ready). */
  | { kind: 'status'; message: string | null };

// ── Webview → Extension ───────────────────────────────────────────────────────

export type WebMsg =
  | { kind: 'start' }
  | { kind: 'stop' }
  /** Open a source file at the rendezvous location. */
  | { kind: 'open-rendezvous'; file: string; line: number }
  /** Load a past session for replay (read-only). */
  | { kind: 'load-session'; dir: string }
  /** Return to the live view (discard any loaded replay). */
  | { kind: 'load-live' }
  /** Stop current session, save it, and immediately start a fresh one. */
  | { kind: 'new-session' }
  /** Clear in-memory chart data without touching any session files. */
  | { kind: 'clear-view' };

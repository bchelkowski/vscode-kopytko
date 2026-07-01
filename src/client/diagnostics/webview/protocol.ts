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
  /** Roku's published background-app DRAM guidance (kopytko.diagnostics.memoryLimits.backgroundMB). Not device-reported. */
  backgroundMemLimitMB: number;
  /** App id the *next* session will target (always "dev" by default). */
  selectedAppId: string;
}

/** An app recordable via this panel — shares the sideloaded dev channel's developer key. */
export interface RecordableAppOption {
  id: string;
  title: string;
  version?: string;
}

// ── Serialized event shapes ───────────────────────────────────────────────────

export interface SerializedMemCpuPoint {
  wall: number;
  memKiB: number;
  anonKiB: number;
  fileKiB: number;
  sharedKiB: number;
  swapKiB: number;
  /** Device-reported foreground memory limit, KiB — undefined when not reported. */
  limitKiB?: number;
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

export interface SerializedBitmapEntry {
  width: number;
  height: number;
  sizeBytes: number;
  name: string;
}

export interface SerializedTexturePoint {
  wall: number;
  usedBytes: number | null;
  maxBytes: number | null;
  availableBytes: number | null;
  count: number;
  totalSizeBytes: number;
  /** Per-bitmap breakdown for the list view. Present on every snapshot. */
  bitmaps: SerializedBitmapEntry[];
}

export interface SerializedAppStatePoint {
  wall: number;
  state: 'active' | 'background' | 'inactive' | 'unknown';
}

export interface SerializedBeaconPoint {
  wall: number;
  name: string;
  timeBaseMs: number;
}

export interface HistoryPayload {
  memCpu: SerializedMemCpuPoint[];
  nodes: SerializedNodePoint[];
  rendezvous: SerializedRendezvousPoint[];
  textures: SerializedTexturePoint[];
  appState: SerializedAppStatePoint[];
  beacons: SerializedBeaconPoint[];
}

// ── Chart/table visibility ──────────────────────────────────────────────────

export type ChartId = 'memory' | 'cpu' | 'nodes' | 'textures';
export type TableId = 'nodes' | 'rendezvous' | 'textures';

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
  | {
      kind: 'batch';
      memCpu: SerializedMemCpuPoint[];
      nodes: SerializedNodePoint[];
      rendezvous: SerializedRendezvousPoint[];
      textures: SerializedTexturePoint[];
      appState: SerializedAppStatePoint[];
      beacons: SerializedBeaconPoint[];
    }
  /** Recording state or device changed. */
  | { kind: 'state'; state: WebviewState }
  /** Full list of recorded sessions available for replay (newest first). */
  | { kind: 'sessions'; sessions: SerializedSessionInfo[] }
  /** Full data for a past session loaded from disk (read-only replay). */
  | { kind: 'replay'; session: SerializedSessionInfo; history: HistoryPayload }
  /** Advisory status message shown below the toolbar (e.g. debug console not ready). */
  | { kind: 'status'; message: string | null }
  /** Apps recordable via this panel (same developer key as "dev"), for the app selector. */
  | { kind: 'apps'; apps: RecordableAppOption[] };

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
  | { kind: 'clear-view' }
  /**
   * Which charts/tables/overlays are currently visible. The extension host uses
   * this to start/stop individual collectors so nothing is polled that isn't
   * shown (settings remain a hard ceiling — this can only narrow what's enabled).
   */
  | {
      kind: 'visibility';
      charts: ChartId[];
      tables: TableId[];
      rendezvousOverlay: boolean;
      beaconOverlay: boolean;
    }
  /**
   * Change which app the *next* session targets. If a session is currently
   * recording and this differs from the current selection, the extension
   * host stops it immediately.
   */
  | { kind: 'select-app'; appId: string };

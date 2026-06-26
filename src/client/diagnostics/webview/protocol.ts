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

// ── Extension → Webview ───────────────────────────────────────────────────────

export type ExtMsg =
  /** Sent once on panel open; seeds charts with ring-buffer data. */
  | { kind: 'init'; state: WebviewState; history: HistoryPayload }
  /** Periodic live data batch while recording. */
  | { kind: 'batch'; memCpu: SerializedMemCpuPoint[]; nodes: SerializedNodePoint[]; rendezvous: SerializedRendezvousPoint[] }
  /** Recording state or device changed. */
  | { kind: 'state'; state: WebviewState };

// ── Webview → Extension ───────────────────────────────────────────────────────

export type WebMsg =
  | { kind: 'start' }
  | { kind: 'stop' }
  /** Open the .xml definition file for a SceneGraph component type. */
  | { kind: 'open-node'; nodeType: string }
  /** Open a source file at the rendezvous location. */
  | { kind: 'open-rendezvous'; file: string; line: number };

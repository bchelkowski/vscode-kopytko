/**
 * Normalized diagnostic event model.
 *
 * Every collected datum is an event sharing a common envelope (`t`, `wall`,
 * `type`) plus a type-specific payload. This is an *open registry*: adding a new
 * metric means adding a member to {@link DiagnosticEvent}, an entry in
 * {@link STREAM_FILE}, and a collector that emits it — no migrations, and the
 * storage/visualization layers stay generic.
 */

export type DiagnosticEventType =
  | 'mem-cpu'
  | 'node-counts'
  | 'rendezvous'
  | 'system-mem'
  | 'textures'
  | 'app-state'
  | 'fw-beacon';

export interface BaseEvent {
  /** Milliseconds since the session started. */
  t: number;
  /** Wall-clock timestamp (epoch ms) when the sample was taken. */
  wall: number;
  type: DiagnosticEventType;
}

/** Per-channel CPU + memory (from `chanperf`). */
export interface MemCpuEvent extends BaseEvent {
  type: 'mem-cpu';
  memKiB: number;
  anonKiB: number;
  fileKiB: number;
  sharedKiB: number;
  swapKiB: number;
  /** Device-reported foreground memory limit, KiB — undefined when not reported (raw debug-console chanperf). */
  limitKiB?: number;
  cpuPct: number;
  cpuUser: number;
  cpuSys: number;
}

/** SceneGraph node counts by type (from `sgnodes counts`). */
export interface NodeCountsEvent extends BaseEvent {
  type: 'node-counts';
  totalCount: number;
  totalStaticBytes: number;
  types: { type: string; count: number; staticBytes: number }[];
}

/** A single render-thread rendezvous (from ECP `/query/sgrendezvous`). */
export interface RendezvousEvent extends BaseEvent {
  type: 'rendezvous';
  /** Device-assigned rendezvous id. */
  rid: string;
  /** Device-clock start/end (ms) and derived duration. */
  startMs: number;
  endMs: number;
  durationMs: number;
  line: number;
  /** `pkg:/…` source file reported by the device. */
  file: string;
}

/** Device-wide memory (from `free`). */
export interface SystemMemEvent extends BaseEvent {
  type: 'system-mem';
  total: number;
  used: number;
  free: number;
  available: number;
  buffCache: number;
  shared: number;
  swapUsed: number;
}

/** A single loaded bitmap/texture (from `r2d2_bitmaps`). */
export interface TextureBitmapEntry {
  address: string;
  width: number;
  height: number;
  bpp: number;
  sizeBytes: number;
  name: string;
}

/** GPU texture/bitmap memory (from `r2d2_bitmaps`). */
export interface TexturesEvent extends BaseEvent {
  type: 'textures';
  usedBytes: number | null;
  maxBytes: number | null;
  availableBytes: number | null;
  count: number;
  totalSizeBytes: number;
  /** Individual loaded bitmaps for the table view. */
  bitmaps: TextureBitmapEntry[];
}

/** App lifecycle state (from ECP `/query/app-state/<appId>`). */
export interface AppStateEvent extends BaseEvent {
  type: 'app-state';
  state: 'active' | 'background' | 'inactive' | 'unknown';
}

/** A framework beacon marker (from the port-8085 BrightScript log, `[beacon.signal]` lines). */
export interface FwBeaconEvent extends BaseEvent {
  type: 'fw-beacon';
  /** Beacon name, e.g. `AppLaunchInitiate`, `AppLaunchComplete`, `VODStartComplete`. */
  name: string;
  /** Device-reported TimeBase offset (ms) from the log line. */
  timeBaseMs: number;
}

export type DiagnosticEvent =
  | MemCpuEvent
  | NodeCountsEvent
  | RendezvousEvent
  | SystemMemEvent
  | TexturesEvent
  | AppStateEvent
  | FwBeaconEvent;

/** An event before the session stamps the relative timestamp `t`. */
export type DiagnosticSample =
  | Omit<MemCpuEvent, 't'>
  | Omit<NodeCountsEvent, 't'>
  | Omit<RendezvousEvent, 't'>
  | Omit<SystemMemEvent, 't'>
  | Omit<TexturesEvent, 't'>
  | Omit<AppStateEvent, 't'>
  | Omit<FwBeaconEvent, 't'>;

/** Maps each event type to its NDJSON stream file name within a session folder. */
export const STREAM_FILE: Record<DiagnosticEventType, string> = {
  'mem-cpu': 'mem-cpu.ndjson',
  'node-counts': 'node-counts.ndjson',
  rendezvous: 'rendezvous.ndjson',
  'system-mem': 'system-mem.ndjson',
  textures: 'textures.ndjson',
  'app-state': 'app-state.ndjson',
  'fw-beacon': 'fw-beacon.ndjson',
};

export const ALL_EVENT_TYPES = Object.keys(STREAM_FILE) as DiagnosticEventType[];

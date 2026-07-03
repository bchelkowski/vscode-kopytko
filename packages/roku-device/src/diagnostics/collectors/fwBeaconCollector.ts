import { EventEmitter } from 'events';
import type { Collector } from './collector';
import type { DiagnosticSample } from '../eventModel';

/** Raw framework beacon event as returned by `EcpClient.queryFwBeacons`. */
interface RawFwBeaconEvent {
  name: string;
  timestampMs: number;
}

/** The subset of `EcpClient` the beacon collector depends on. */
export interface FwBeaconEcp {
  enableFwBeaconTracking(ip: string, appId: string, port?: number): Promise<boolean>;
  disableFwBeaconTracking(ip: string, appId: string, port?: number): Promise<boolean>;
  queryFwBeacons(
    ip: string,
    port?: number,
  ): Promise<{ events: RawFwBeaconEvent[]; dropCount: number }>;
}

export interface FwBeaconTarget {
  ip: string;
  port: number;
  /** App id to track beacons for, e.g. `dev` for the sideloaded channel. */
  appId: string;
}

/**
 * Collects framework beacon markers via ECP: `POST /fwbeacons/track/<appId>` once,
 * then polls `GET /query/fwbeacons` on an interval (same enable/poll/drain shape
 * as `RendezvousCollector`).
 *
 * Replaces the earlier approach of tailing the port-8085 BrightScript log for
 * `[beacon.signal]` lines — that port only accepts one consumer at a time, so
 * beacons silently stopped appearing whenever a debug session or another tool
 * already held it. ECP has no such exclusivity limit. See
 * `findings/roku-device-api.md` for the verified `/fwbeacons` response shape.
 *
 * Also emits `'enabled'` / `'enable-failed'` after each `enableFwBeaconTracking()`
 * attempt (initial and any re-enable after a failed poll), so callers can
 * surface a persistent failure instead of it silently retrying forever.
 */
export class FwBeaconCollector extends EventEmitter implements Collector {
  readonly type = 'fw-beacon' as const;
  private timer?: ReturnType<typeof setInterval>;
  private enabled = false;
  private dropCount = 0;

  constructor(
    private readonly ecp: FwBeaconEcp,
    private readonly target: FwBeaconTarget,
    private readonly intervalMs: number,
  ) {
    super();
  }

  /** Total beacon events the device dropped due to buffer overflow. */
  get totalDropCount(): number {
    return this.dropCount;
  }

  start(): void {
    if (this.timer) return;
    void this.enable();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.enabled) {
      this.ecp.disableFwBeaconTracking(this.target.ip, this.target.appId, this.target.port).catch(() => {});
      this.enabled = false;
    }
  }

  private async enable(): Promise<void> {
    try {
      this.enabled = await this.ecp.enableFwBeaconTracking(
        this.target.ip, this.target.appId, this.target.port,
      );
      this.emit(this.enabled ? 'enabled' : 'enable-failed');
    } catch {
      this.enabled = false;
      this.emit('enable-failed');
    }
  }

  private async poll(): Promise<void> {
    try {
      if (!this.enabled) {
        await this.enable();
        if (!this.enabled) return;
      }

      const { events, dropCount } = await this.ecp.queryFwBeacons(this.target.ip, this.target.port);
      if (dropCount > 0) this.dropCount += dropCount;

      for (const e of events) {
        const sample: DiagnosticSample = {
          type: 'fw-beacon',
          wall: e.timestampMs,
          name: e.name,
        };
        this.emit('sample', sample);
      }
    } catch {
      // Skip this poll — next interval retries.
    }
  }
}

import { EventEmitter } from 'events';
import type { Collector } from './collector';
import type { DiagnosticSample } from '../session/eventModel';

/** Raw rendezvous event as returned by `EcpClient.queryRendezvousEvents`. */
interface RawRendezvousEvent {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  line: number;
  file: string;
}

/** The subset of `EcpClient` the rendezvous collector depends on. */
export interface RendezvousEcp {
  enableRendezvousTracking(ip: string, port?: number): Promise<boolean>;
  disableRendezvousTracking(ip: string, port?: number): Promise<boolean>;
  queryRendezvousEvents(
    ip: string,
    port?: number,
  ): Promise<{ events: RawRendezvousEvent[]; dropCount: number }>;
}

export interface RendezvousTarget {
  ip: string;
  port: number;
}

/**
 * Collects render-thread rendezvous via ECP. Unlike the console collectors this
 * has an enable/disable lifecycle (`POST /sgrendezvous/track` …) and drains the
 * device's event queue on each poll.
 *
 * NB: the ECP query drains a *shared* device queue, so `RendezvousManager`'s
 * internal coordination poller must be suspended while this runs — the
 * session handles that.
 *
 * Also emits `'enabled'` / `'enable-failed'` after each `enableRendezvousTracking()`
 * attempt (initial and any re-enable after a dropped connection), so callers
 * can surface a persistent failure instead of it silently retrying forever.
 */
export class RendezvousCollector extends EventEmitter implements Collector {
  readonly type = 'rendezvous' as const;
  private timer?: ReturnType<typeof setInterval>;
  private enabled = false;
  private dropCount = 0;

  constructor(
    private readonly ecp: RendezvousEcp,
    private readonly target: RendezvousTarget,
    private readonly intervalMs: number,
  ) {
    super();
  }

  /** Total rendezvous events the device dropped due to buffer overflow. */
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
      this.ecp.disableRendezvousTracking(this.target.ip, this.target.port).catch(() => {});
      this.enabled = false;
    }
  }

  private async enable(): Promise<void> {
    try {
      this.enabled = await this.ecp.enableRendezvousTracking(this.target.ip, this.target.port);
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

      const { events, dropCount } = await this.ecp.queryRendezvousEvents(
        this.target.ip,
        this.target.port,
      );
      if (dropCount > 0) this.dropCount += dropCount;

      const wall = Date.now();
      for (const e of events) {
        const sample: DiagnosticSample = {
          type: 'rendezvous',
          wall,
          rid: e.id,
          startMs: e.startTimeMs,
          endMs: e.endTimeMs,
          durationMs: Math.max(0, e.endTimeMs - e.startTimeMs),
          line: e.line,
          file: e.file,
        };
        this.emit('sample', sample);
      }
    } catch {
      // Skip this poll — next interval retries.
    }
  }
}

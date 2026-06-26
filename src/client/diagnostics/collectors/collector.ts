import { EventEmitter } from 'events';
import type { DiagnosticEventType, DiagnosticSample } from '../session/eventModel';

/**
 * A diagnostic data source. Collectors are independent and self-healing: a
 * collector that errors or whose transport is reconnecting simply emits nothing
 * that tick and tries again — it never throws into the session or affects other
 * collectors.
 *
 * Collectors emit `'sample'` with a {@link DiagnosticSample} (an event without
 * the session-relative `t`, which the session stamps).
 */
export interface Collector extends EventEmitter {
  readonly type: DiagnosticEventType;
  start(): void;
  stop(): void;
}

/**
 * Base class for interval-polled collectors. Subclasses implement {@link collect}
 * to read the device and return zero or more samples.
 */
export abstract class PollingCollector extends EventEmitter implements Collector {
  abstract readonly type: DiagnosticEventType;
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(protected readonly intervalMs: number) {
    super();
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Read the device and produce samples. Implementations must not throw. */
  protected abstract collect(): Promise<DiagnosticSample[]>;

  private async tick(): Promise<void> {
    if (this.ticking) return; // skip if a slow poll overruns its interval
    this.ticking = true;
    try {
      const samples = await this.collect();
      for (const sample of samples) this.emit('sample', sample);
    } catch {
      // Swallow — failed polls are expected during reconnects/offline windows.
    } finally {
      this.ticking = false;
    }
  }
}

import { PollingCollector } from './collector';
import type { DiagnosticSample } from '../session/eventModel';
import type { DebugConsoleClient } from '../transport/debugConsoleClient';
import { parseFree } from '../parsers/free';

/** Polls `free` for device-wide memory (opt-in; complements per-channel mem). */
export class SystemMemCollector extends PollingCollector {
  readonly type = 'system-mem' as const;

  constructor(private readonly console: DebugConsoleClient, intervalMs: number) {
    super(intervalMs);
  }

  protected async collect(): Promise<DiagnosticSample[]> {
    const raw = await this.console.send('free');
    const m = parseFree(raw);
    if (!m) return [];
    return [
      {
        type: 'system-mem',
        wall: Date.now(),
        total: m.total,
        used: m.used,
        free: m.free,
        available: m.available,
        buffCache: m.buffCache,
        shared: m.shared,
        swapUsed: m.swapUsed,
      },
    ];
  }
}

import { PollingCollector } from './collector';
import type { DiagnosticSample } from '../session/eventModel';
import type { DebugConsoleClient } from '../transport/debugConsoleClient';
import { parseChanperf } from '../parsers/chanperf';

/** Polls `chanperf` for per-channel CPU + memory. */
export class ChanperfCollector extends PollingCollector {
  readonly type = 'mem-cpu' as const;

  constructor(private readonly console: DebugConsoleClient, intervalMs: number) {
    super(intervalMs);
  }

  protected async collect(): Promise<DiagnosticSample[]> {
    const raw = await this.console.send('chanperf');
    const sample = parseChanperf(raw);
    if (!sample) return [];
    return [{ type: 'mem-cpu', wall: Date.now(), ...sample }];
  }
}

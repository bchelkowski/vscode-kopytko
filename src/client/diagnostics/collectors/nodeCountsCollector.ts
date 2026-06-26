import { PollingCollector } from './collector';
import type { DiagnosticSample } from '../session/eventModel';
import type { DebugConsoleClient } from '../transport/debugConsoleClient';
import { parseSgNodesCounts } from '../parsers/sgNodesCounts';

/** Polls `sgnodes counts` for per-type SceneGraph node counts. */
export class NodeCountsCollector extends PollingCollector {
  readonly type = 'node-counts' as const;

  constructor(private readonly console: DebugConsoleClient, intervalMs: number) {
    super(intervalMs);
  }

  protected async collect(): Promise<DiagnosticSample[]> {
    const raw = await this.console.send('sgnodes counts');
    const counts = parseSgNodesCounts(raw);
    if (!counts) return [];
    return [
      {
        type: 'node-counts',
        wall: Date.now(),
        totalCount: counts.totalCount,
        totalStaticBytes: counts.totalStaticBytes,
        types: counts.types,
      },
    ];
  }
}

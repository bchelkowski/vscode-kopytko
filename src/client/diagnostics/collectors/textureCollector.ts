import { PollingCollector } from './collector';
import type { DiagnosticSample } from '../session/eventModel';
import type { DebugConsoleClient } from '../transport/debugConsoleClient';
import { parseR2d2Bitmaps } from '../parsers/r2d2Bitmaps';

/** Polls `r2d2_bitmaps` for GPU texture/bitmap memory (opt-in). */
export class TextureCollector extends PollingCollector {
  readonly type = 'textures' as const;

  constructor(private readonly console: DebugConsoleClient, intervalMs: number) {
    super(intervalMs);
  }

  protected async collect(): Promise<DiagnosticSample[]> {
    const raw = await this.console.send('r2d2_bitmaps');
    const t = parseR2d2Bitmaps(raw);
    if (!t) return [];
    return [
      {
        type: 'textures',
        wall: Date.now(),
        usedBytes: t.usedBytes,
        maxBytes: t.maxBytes,
        availableBytes: t.availableBytes,
        count: t.count,
        totalSizeBytes: t.totalSizeBytes,
      },
    ];
  }
}

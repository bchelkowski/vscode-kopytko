import type { DiagnosticEvent, DiagnosticEventType } from '../session/eventModel';
import { STREAM_FILE } from '../session/eventModel';
import { type DiagnosticsSink, joinPath } from './sink';

/**
 * Append-only NDJSON writer — one file per event stream within a session folder.
 *
 * Events are buffered in memory and flushed on a timer so collection is never
 * blocked by disk (or a slow network drive). NDJSON is crash/partial-write safe:
 * a torn final line is simply skipped by the reader. On a flush error the
 * buffered lines are retained and retried on the next flush, so nothing is lost.
 */
export class NdjsonWriter {
  private readonly buffers = new Map<DiagnosticEventType, string[]>();
  private readonly counts = new Map<DiagnosticEventType, number>();
  private timer?: ReturnType<typeof setInterval>;
  private flushing = false;
  private closed = false;

  constructor(
    private readonly sink: DiagnosticsSink,
    private readonly dir: string,
    private readonly flushIntervalMs = 400,
  ) {}

  /** Number of events persisted (flushed + buffered) for a stream. */
  countFor(type: DiagnosticEventType): number {
    return this.counts.get(type) ?? 0;
  }

  /** Queue an event for its stream. */
  append(event: DiagnosticEvent): void {
    if (this.closed) return;
    const line = JSON.stringify(event);
    const buf = this.buffers.get(event.type);
    if (buf) buf.push(line);
    else this.buffers.set(event.type, [line]);
    this.counts.set(event.type, (this.counts.get(event.type) ?? 0) + 1);
    this.ensureTimer();
  }

  /** Flush all buffered lines to disk. Safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const [type, lines] of this.buffers) {
        if (lines.length === 0) continue;
        const batch = lines.splice(0, lines.length);
        const file = joinPath(this.dir, STREAM_FILE[type]);
        try {
          await this.sink.appendFile(file, batch.join('\n') + '\n');
        } catch {
          // Retain the batch for the next flush so nothing is dropped.
          lines.unshift(...batch);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Stop the flush timer and write any remaining buffered lines. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.flush();
  }

  private ensureTimer(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref?.();
  }
}

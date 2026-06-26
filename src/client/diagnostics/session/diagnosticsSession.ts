import { EventEmitter } from 'events';
import type { Collector } from '../collectors/collector';
import {
  type DiagnosticEvent,
  type DiagnosticEventType,
  type DiagnosticSample,
  ALL_EVENT_TYPES,
  STREAM_FILE,
} from './eventModel';
import type { DiagnosticsSink } from '../storage/sink';
import { NdjsonWriter } from '../storage/ndjsonWriter';
import { type SessionManifest, writeManifest } from '../storage/sessionStore';

/** Something with a connection lifecycle the session should drive (e.g. the console client). */
export interface SessionTransport {
  start(): void;
  close(): void;
}

export interface DiagnosticsSessionOptions {
  sink: DiagnosticsSink;
  /** Full session directory (root + id). */
  dir: string;
  /** Initial manifest; `startedWall`/`endedWall`/`streams` are filled by the session. */
  manifest: SessionManifest;
  collectors: Collector[];
  /** Transports started before collectors and closed after them. */
  transports?: SessionTransport[];
  /** Max events retained in memory per stream for the live view (default 3600). */
  ringSize?: number;
  flushIntervalMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Orchestrates one recording session: starts transports + collectors, stamps
 * each emitted sample with a session-relative `t`, persists it to NDJSON, keeps a
 * bounded in-memory ring for the live view, and re-emits it as `'event'`.
 *
 * The session keeps running across transient device/network drops — collectors
 * self-heal and simply leave gaps in the data.
 */
export class DiagnosticsSession extends EventEmitter {
  private readonly writer: NdjsonWriter;
  private readonly rings = new Map<DiagnosticEventType, DiagnosticEvent[]>();
  private readonly ringSize: number;
  private startedWall = 0;
  private running = false;

  constructor(private readonly opts: DiagnosticsSessionOptions) {
    super();
    this.ringSize = opts.ringSize ?? 3600;
    this.writer = new NdjsonWriter(opts.sink, opts.dir, opts.flushIntervalMs);
  }

  get dir(): string {
    return this.opts.dir;
  }

  get manifest(): SessionManifest {
    return this.opts.manifest;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Snapshot of the in-memory ring for a stream (for seeding the live view). */
  getRing(type: DiagnosticEventType): DiagnosticEvent[] {
    return this.rings.get(type) ?? [];
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedWall = this.clock();
    this.opts.manifest.startedWall = this.startedWall;
    this.opts.manifest.endedWall = null;

    await this.opts.sink.ensureDir(this.opts.dir);
    await this.persistManifest();

    for (const c of this.opts.collectors) c.on('sample', this.handleSample);
    for (const t of this.opts.transports ?? []) t.start();
    for (const c of this.opts.collectors) c.start();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    for (const c of this.opts.collectors) {
      c.stop();
      c.removeListener('sample', this.handleSample);
    }
    for (const t of this.opts.transports ?? []) t.close();

    await this.writer.close();
    this.opts.manifest.endedWall = this.clock();
    await this.persistManifest();
    this.emit('stopped');
  }

  private clock(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private readonly handleSample = (sample: DiagnosticSample): void => {
    const event = { ...sample, t: Math.max(0, sample.wall - this.startedWall) } as DiagnosticEvent;
    this.writer.append(event);
    this.pushRing(event);
    this.emit('event', event);
  };

  private pushRing(event: DiagnosticEvent): void {
    let ring = this.rings.get(event.type);
    if (!ring) {
      ring = [];
      this.rings.set(event.type, ring);
    }
    ring.push(event);
    if (ring.length > this.ringSize) ring.shift();
  }

  private async persistManifest(): Promise<void> {
    const enabled = new Set(this.opts.manifest.collectors.map((c) => c.type));
    for (const type of ALL_EVENT_TYPES) {
      const count = this.writer.countFor(type);
      if (count > 0 || enabled.has(type)) {
        this.opts.manifest.streams[type] = { file: STREAM_FILE[type], count };
      }
    }
    await writeManifest(this.opts.sink, this.opts.dir, this.opts.manifest);
  }
}

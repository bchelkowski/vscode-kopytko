import { EventEmitter } from 'events';
import WebSocket from 'ws';

const QUIET_WINDOW_MS = 500;
const HARD_CEILING_MS = 3000;

/**
 * Connects to the Roku device's Perfetto WebSocket endpoint
 * (`ws://host:port/perfetto-session`) and streams binary trace packets.
 *
 * - Emits `'data'` with each `Buffer` chunk as it arrives.
 * - Emits `'close'` when the connection ends.
 * - Emits `'error'` on connection errors.
 * - `getBuffer()` returns a single concatenated `Buffer` of all received data.
 * - `stop()` initiates a graceful close (quiet-window then hard-terminate).
 */
export class PerfettoWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private chunks: Buffer[] = [];
  private totalBytes = 0;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly path = '/perfetto-session',
  ) {
    super();
  }

  start(): void {
    if (this.ws) return;

    const url = `ws://${this.host}:${this.port}${this.path}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
      this.chunks.push(buf);
      this.totalBytes += buf.byteLength;
      this.emit('data', buf);
    });

    ws.on('error', (err: Error) => this.emit('error', err));

    ws.on('close', () => {
      this.ws = null;
      this.emit('close');
    });
  }

  /**
   * Initiates graceful close: waits for a 500 ms quiet window after the last
   * packet, then terminates.  Hard ceiling of 3 s prevents hanging.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      const ws = this.ws;
      if (!ws) {
        resolve();
        return;
      }
      this.ws = null;

      const cleanup = () => {
        clearTimeout(quietTimer);
        clearTimeout(hardTimer);
        resolve();
      };

      ws.once('close', cleanup);

      let lastBytes = this.totalBytes;
      let quietTimer: ReturnType<typeof setTimeout>;

      const hardTimer = setTimeout(() => {
        clearTimeout(quietTimer);
        ws.terminate();
      }, HARD_CEILING_MS);

      const scheduleQuiet = () => {
        quietTimer = setTimeout(() => {
          if (this.totalBytes === lastBytes) {
            ws.close();
          } else {
            lastBytes = this.totalBytes;
            scheduleQuiet();
          }
        }, QUIET_WINDOW_MS);
      };

      scheduleQuiet();
    });
  }

  /** Returns a single Buffer of all received data (zero-copy concat). */
  getBuffer(): Buffer {
    if (this.chunks.length === 0) return Buffer.alloc(0);
    return Buffer.concat(this.chunks, this.totalBytes);
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  dispose(): void {
    this.ws?.terminate();
    this.ws = null;
    this.chunks = [];
    this.totalBytes = 0;
  }
}

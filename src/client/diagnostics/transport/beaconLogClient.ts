/**
 * Read-only streaming client for the Roku BrightScript log (port 8085).
 *
 * Unlike the SceneGraph debug console (port 8080), this port accepts no
 * commands — it continuously streams `print` output plus system events,
 * including `[beacon.signal]` framework beacon markers
 * (`AppLaunchInitiate`/`Complete`, `AppResumeInitiate`/`Complete`,
 * `VODStartInitiate`/`Complete`, etc). See `findings/roku-device-api.md`.
 *
 * The client emits one `'line'` event per complete line and auto-reconnects
 * with exponential backoff; it never throws — consumers simply see a gap in
 * lines during a reconnect.
 */

import * as net from 'net';
import { EventEmitter } from 'events';

/** Minimal socket surface the client needs; `net.Socket` satisfies it. */
export interface LogSocket {
  destroy(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
}

export type LogSocketFactory = (host: string, port: number) => LogSocket;

export interface BeaconLogOptions {
  host: string;
  port?: number;
  /** Maximum reconnect backoff in ms (default 10000). */
  maxBackoffMs?: number;
  /** Injectable for tests; defaults to a real TCP socket. */
  socketFactory?: LogSocketFactory;
}

const DEFAULT_PORT = 8085;

const realSocketFactory: LogSocketFactory = (host, port) => {
  const socket = new net.Socket();
  socket.setEncoding('utf8');
  socket.connect(port, host);
  return socket;
};

export class BeaconLogClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly maxBackoffMs: number;
  private readonly socketFactory: LogSocketFactory;

  private socket: LogSocket | null = null;
  private closing = false;
  private buffer = '';
  private backoffMs = 500;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(opts: BeaconLogOptions) {
    super();
    this.host = opts.host;
    this.port = opts.port ?? DEFAULT_PORT;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10000;
    this.socketFactory = opts.socketFactory ?? realSocketFactory;
  }

  /** Open the connection and keep it alive (auto-reconnecting) until `close()`. */
  start(): void {
    this.closing = false;
    if (!this.socket) this.connect();
  }

  /** Close the connection; no further `'line'` events fire. */
  close(): void {
    this.closing = true;
    this.clearReconnect();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = '';
  }

  private connect(): void {
    this.clearReconnect();
    const socket = this.socketFactory(this.host, this.port);
    this.socket = socket;

    socket.on('connect', () => { this.backoffMs = 500; });
    socket.on('data', (chunk: Buffer | string) => this.onData(chunk.toString()));
    socket.on('error', () => this.onDisconnect());
    socket.on('close', () => this.onDisconnect());
  }

  private onDisconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = '';
    if (!this.closing) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length === 0) continue;

      // The device only allows one consumer of this log stream at a time. A
      // second connection attempt (e.g. while a debug session's IO channel
      // already holds it) succeeds at the TCP level but the device sends this
      // text instead of real output — the socket looks "connected" forever
      // and would otherwise silently never deliver a single real line. Treat
      // it like a disconnect so we back off and retry instead of sitting on
      // a connection that will never work, and let callers surface it.
      if (line.includes('Console connection is already in use')) {
        this.emit('rejected', line);
        this.socket?.destroy();
        return;
      }

      this.emit('line', line);
    }
  }
}

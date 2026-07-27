/**
 * Raw streaming TCP client for the Roku debug consoles (ports 8085 and 8080).
 *
 * This is the *terminal* counterpart to `DebugConsoleClient`. Where that client
 * frames request/response pairs by idle time and strips the banner and `>`
 * prompts so collectors get clean payloads, this one deliberately does none of
 * that: every byte the device sends is forwarded verbatim, including prompts,
 * banners and unsolicited output. A human at a terminal wants to see the
 * `BrightScript Debugger>` prompt; a parser does not.
 *
 * Both consoles are plain line-oriented TCP — write `command\r\n`, read text
 * back — so one transport serves both. Neither echoes what you type, so callers
 * are responsible for local echo.
 *
 * Connection management mirrors `DebugConsoleClient`: single socket, exponential
 * backoff reconnect, injectable socket factory for tests, and no throwing into
 * callers from background failures.
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import type { ConsoleSocket, ConsoleSocketFactory } from './debugConsoleClient';

/** Debug console ports that carry an interactive command surface. */
export const CONSOLE_PORTS = [8085, 8080] as const;
export type ConsolePort = (typeof CONSOLE_PORTS)[number];

export interface ConsoleStreamOptions {
  host: string;
  port: number;
  /** Maximum reconnect backoff in ms (default 10000). */
  maxBackoffMs?: number;
  /** Reconnect automatically after an unexpected drop (default true). */
  autoReconnect?: boolean;
  /** Injectable for tests; defaults to a real TCP socket. */
  socketFactory?: ConsoleSocketFactory;
}

const INITIAL_BACKOFF_MS = 500;

const realSocketFactory: ConsoleSocketFactory = (host, port) => {
  const socket = new net.Socket();
  socket.setEncoding('utf8');
  socket.connect(port, host);
  return socket;
};

export class ConsoleStream extends EventEmitter {
  readonly host: string;
  readonly port: number;

  private readonly maxBackoffMs: number;
  private readonly autoReconnect: boolean;
  private readonly socketFactory: ConsoleSocketFactory;

  private socket: ConsoleSocket | null = null;
  private connected = false;
  private closing = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  /** Consecutive failed connection attempts; resets on a successful connect. */
  private failedAttempts = 0;

  constructor(opts: ConsoleStreamOptions) {
    super();
    this.host = opts.host;
    this.port = opts.port;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10000;
    this.autoReconnect = opts.autoReconnect ?? true;
    this.socketFactory = opts.socketFactory ?? realSocketFactory;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Consecutive failed connection attempts since the last successful connect. */
  get consecutiveFailures(): number {
    return this.failedAttempts;
  }

  /** Open the connection and keep it alive (auto-reconnecting) until `close()`. */
  start(): void {
    this.closing = false;
    if (!this.socket) this.connect();
  }

  /**
   * Write raw bytes to the device. The caller supplies the line terminator —
   * commands need `\r\n`, control characters (e.g. `\x03`) must not get one.
   * Silently drops the write when not connected: a terminal reconnects on its
   * own cadence and replaying stale input would be worse than losing it.
   */
  write(data: string): void {
    if (!this.connected || !this.socket) return;
    this.socket.write(data);
  }

  /** Close the connection and stop reconnecting. */
  close(): void {
    this.closing = true;
    this.clearReconnect();
    this.teardownSocket();
    if (this.connected) {
      this.connected = false;
      this.emit('close');
    }
  }

  // ── connection ────────────────────────────────────────────────────────────

  private connect(): void {
    this.clearReconnect();
    const socket = this.socketFactory(this.host, this.port);
    this.socket = socket;

    socket.on('connect', () => {
      if (this.socket !== socket) return;
      this.connected = true;
      this.failedAttempts = 0;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.emit('connect');
    });
    socket.on('data', (chunk: Buffer | string) => {
      if (this.socket !== socket) return;
      this.emit('data', chunk.toString());
    });
    socket.on('error', (err: Error) => {
      if (this.socket !== socket) return;
      // EventEmitter throws on an unhandled 'error' — only emit when someone
      // is listening, so a transport hiccup can never crash the extension host.
      if (this.listenerCount('error') > 0) this.emit('error', err);
      this.onDisconnect();
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.onDisconnect();
    });
  }

  private onDisconnect(): void {
    const wasConnected = this.connected;
    if (!wasConnected) this.failedAttempts += 1;

    this.teardownSocket();
    this.connected = false;

    if (wasConnected) this.emit('close');
    if (!this.closing && this.autoReconnect) this.scheduleReconnect();
  }

  private teardownSocket(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.destroy();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.emit('reconnecting', delay);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

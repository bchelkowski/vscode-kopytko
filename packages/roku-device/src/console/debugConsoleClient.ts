/**
 * Resilient TCP client for the Roku SceneGraph debug server (port 8080).
 *
 * The debug server is a line-oriented request/response console: you write
 * `command\r\n` and it replies with text/XML, framed by a trailing `>` prompt.
 * Because XML responses contain `>` everywhere, we cannot use the prompt as a
 * delimiter; instead a response is considered complete once the socket goes idle
 * for `idleMs`. The banner and prompts are then stripped by the parser layer.
 *
 * The client keeps a single connection open, serializes commands through a
 * queue, and auto-reconnects with exponential backoff. It never throws into
 * callers from background failures — `send()` rejects fast when not connected so
 * polling collectors simply skip a sample and retry on their next interval.
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { stripConsoleResponse } from '../diagnostics/parsers/consoleResponse';

/** Minimal socket surface the client needs; `net.Socket` satisfies it. */
export interface ConsoleSocket {
  write(data: string): void;
  destroy(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
}

export type ConsoleSocketFactory = (host: string, port: number) => ConsoleSocket;

export interface DebugConsoleOptions {
  host: string;
  port?: number;
  /** Response is complete after this many ms with no new data (default 250). */
  idleMs?: number;
  /** Reject a command if no response completes within this many ms (default 5000). */
  commandTimeoutMs?: number;
  /** Maximum reconnect backoff in ms (default 10000). */
  maxBackoffMs?: number;
  /** Injectable for tests; defaults to a real TCP socket. */
  socketFactory?: ConsoleSocketFactory;
}

const DEFAULT_PORT = 8080;

const realSocketFactory: ConsoleSocketFactory = (host, port) => {
  const socket = new net.Socket();
  socket.setEncoding('utf8');
  socket.connect(port, host);
  return socket;
};

interface QueuedCommand {
  cmd: string;
  timeoutMs: number;
  resolve: (payload: string) => void;
  reject: (err: Error) => void;
}

interface ActiveCommand extends QueuedCommand {
  buffer: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  hardTimer?: ReturnType<typeof setTimeout>;
}

export class DebugConsoleClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly idleMs: number;
  private readonly commandTimeoutMs: number;
  private readonly maxBackoffMs: number;
  private readonly socketFactory: ConsoleSocketFactory;

  private socket: ConsoleSocket | null = null;
  private _ready = false;
  private closing = false;
  private queue: QueuedCommand[] = [];
  private active: ActiveCommand | null = null;

  private draining = false;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private backoffMs = 500;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(opts: DebugConsoleOptions) {
    super();
    this.host = opts.host;
    this.port = opts.port ?? DEFAULT_PORT;
    this.idleMs = opts.idleMs ?? 250;
    this.commandTimeoutMs = opts.commandTimeoutMs ?? 5000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10000;
    this.socketFactory = opts.socketFactory ?? realSocketFactory;
  }

  /** Whether the connection is established and ready to accept commands. */
  get isReady(): boolean {
    return this._ready;
  }

  /** Open the connection and keep it alive (auto-reconnecting) until `close()`. */
  start(): void {
    this.closing = false;
    if (!this.socket) this.connect();
  }

  /**
   * Send a command and resolve with its cleaned payload. Rejects immediately
   * when not connected (so callers retry on their own cadence) and on timeout.
   */
  send(cmd: string, timeoutMs?: number): Promise<string> {
    if (this.closing) return Promise.reject(new Error('Debug console closed'));
    if (!this._ready || !this.socket) return Promise.reject(new Error('Debug console not connected'));

    return new Promise<string>((resolve, reject) => {
      this.queue.push({ cmd, timeoutMs: timeoutMs ?? this.commandTimeoutMs, resolve, reject });
      this.processQueue();
    });
  }

  /** Close the connection and reject everything in flight. */
  close(): void {
    this.closing = true;
    this._ready = false;
    this.clearReconnect();
    this.clearActiveTimers();
    if (this.drainTimer) clearTimeout(this.drainTimer);

    const closedError = new Error('Debug console closed');
    if (this.active) {
      this.active.reject(closedError);
      this.active = null;
    }
    for (const q of this.queue) q.reject(closedError);
    this.queue = [];

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  // ── connection ────────────────────────────────────────────────────────────

  private connect(): void {
    this.clearReconnect();
    const socket = this.socketFactory(this.host, this.port);
    this.socket = socket;
    this.draining = true; // discard the connect banner + first prompt

    socket.on('connect', () => {
      // Start the drain idle timer; banner may or may not arrive.
      this.resetDrainTimer();
    });
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
    this._ready = false;
    this.draining = false;
    if (this.drainTimer) clearTimeout(this.drainTimer);

    // Reject the in-flight command; queued commands are dropped so callers
    // (polling collectors) don't pile up across a reconnect.
    if (this.active) {
      this.clearActiveTimers();
      this.active.reject(new Error('Debug console disconnected'));
      this.active = null;
    }
    for (const q of this.queue) q.reject(new Error('Debug console disconnected'));
    this.queue = [];

    this.emit('disconnected');
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

  // ── data framing ──────────────────────────────────────────────────────────

  private onData(chunk: string): void {
    if (this.draining) {
      this.resetDrainTimer();
      return;
    }
    if (!this.active) return; // unsolicited data between commands — ignore
    this.active.buffer += chunk;
    this.resetIdleTimer();
  }

  private resetDrainTimer(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = setTimeout(() => this.finishDrain(), this.idleMs);
    this.drainTimer.unref?.();
  }

  private finishDrain(): void {
    this.draining = false;
    this._ready = true;
    this.backoffMs = 500; // reset backoff after a healthy connect
    this.emit('ready');
    this.processQueue();
  }

  private resetIdleTimer(): void {
    if (!this.active) return;
    if (this.active.idleTimer) clearTimeout(this.active.idleTimer);
    this.active.idleTimer = setTimeout(() => this.finishActive(), this.idleMs);
    this.active.idleTimer.unref?.();
  }

  private finishActive(): void {
    const active = this.active;
    if (!active) return;
    this.clearActiveTimers();
    this.active = null;
    active.resolve(stripConsoleResponse(active.buffer));
    this.processQueue();
  }

  private clearActiveTimers(): void {
    if (this.active?.idleTimer) clearTimeout(this.active.idleTimer);
    if (this.active?.hardTimer) clearTimeout(this.active.hardTimer);
  }

  // ── command queue ─────────────────────────────────────────────────────────

  private processQueue(): void {
    if (!this._ready || !this.socket || this.active || this.queue.length === 0) return;

    const next = this.queue.shift()!;
    const active: ActiveCommand = { ...next, buffer: '' };
    this.active = active;

    active.hardTimer = setTimeout(() => {
      if (this.active !== active) return;
      this.active = null;
      if (active.idleTimer) clearTimeout(active.idleTimer);
      active.reject(new Error(`Command "${active.cmd}" timed out after ${active.timeoutMs}ms`));
      this.processQueue();
    }, active.timeoutMs);
    active.hardTimer.unref?.();

    this.socket.write(`${active.cmd}\r\n`);
  }
}

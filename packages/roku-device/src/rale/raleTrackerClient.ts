/**
 * Client for Roku's RALE TrackerTask (Roku Advanced Layout Editor).
 *
 * The TrackerTask must already be injected and running in the channel. It sits
 * in a loop waiting for an ECP `roInput` event carrying `rale` + `port`
 * parameters; on receipt it opens a TCP *server* on the device at that port
 * and expects the first command (`init`) within ~3 s, otherwise it closes the
 * socket and returns to waiting — so activation, connect, and init happen as
 * one fast sequence here. Verified against TrackerTask v3.2.0.
 *
 * Commands are JSON `{uuid, command, args}` framed by `[start]`/`[end]`
 * (see ./frame.ts). Errors come back in-band as `{error: {message}}`.
 *
 * Node addressing: paths are arrays of `{child: index}` segments rooted at
 * the scene (`m.top.GetScene()`). `setField` operates on the node selected by
 * the most recent `selectNode` — callers must select first, then set.
 *
 * No auto-reconnect: an edit session is explicit; when the socket drops the
 * owner is told via the `close` event and decides whether to reconnect.
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { FrameDecoder, encodeRequest } from './frame';

/** Minimal socket surface the client needs; `net.Socket` satisfies it. */
export interface RaleSocket {
  write(data: string): void;
  destroy(): void;
  /** Send TCP RST instead of FIN (net.Socket has this since Node 16.17). */
  resetAndDestroy?(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
}

export type RaleSocketFactory = (host: string, port: number) => RaleSocket;

/** The one ECP call activation needs — `EcpClient` satisfies it. */
export interface RaleEcpInput {
  sendInput(ip: string, params: Record<string, string>, port?: number): Promise<void>;
}

export interface RaleTrackerOptions {
  host: string;
  ecp: RaleEcpInput;
  ecpPort?: number;
  /**
   * Port of a previous session to try FIRST, without ECP activation. Newer
   * TrackerTasks (observed on v3.4.0) never leave their serve loop once a
   * client has connected: the listener stays alive on the original port and
   * re-activation on a new port is ignored — direct reconnect is the only
   * way back in. Older tasks (v3.2.0) exit the loop on connection error, so
   * the stale port refuses and connect() falls through to fresh activation.
   */
  reusePort?: number;
  /** Device-side listen port is picked randomly from this range (TrackerTask
   *  config allows 49152–65535). */
  portRange?: [number, number];
  /** Full activation attempts (new port each time) before giving up (default 3). */
  maxAttempts?: number;
  /** TCP connect timeout per attempt in ms (default 1500 — the init window is ~3 s). */
  connectTimeoutMs?: number;
  /** Default per-request timeout in ms (default 8000). */
  requestTimeoutMs?: number;
  /** Injectable for tests; defaults to a real TCP socket. */
  socketFactory?: RaleSocketFactory;
  /** Injectable port picker for tests; defaults to uniform random in range. */
  pickPort?: (min: number, max: number) => number;
}

export interface RaleInitInfo {
  raleVersion: string;
  sessionid: string;
}

export type RalePathSegment = { child: number } | { field: string };

/** `item` block of a node as reported by selectNode/getNodeData. */
export interface RaleNodeItem {
  index?: number;
  id?: string;
  childrenCount?: number;
  subtype?: string;
  type: string;
  value?: string;
}

export interface RaleNodeData {
  item: RaleNodeItem;
  fieldlist?: unknown;
  layout?: unknown;
  childlist?: unknown;
}

export interface RaleSelectNodeResult {
  path: RalePathSegment[];
  node: RaleNodeData;
}

/** getItemList response: the node at `path` plus one level of children.
 *  Child `item.index` values are the device-side child indices — the
 *  authoritative index space for `{child}` path segments (ECP app-ui omits
 *  non-renderable children, so its indices cannot be used directly). */
export interface RaleItemList {
  item: RaleNodeItem;
  childList?: { item: RaleNodeItem }[];
}

const DEFAULT_PORT_RANGE: [number, number] = [49152, 65535];
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_CONNECT_TIMEOUT_MS = 1500;
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

const realSocketFactory: RaleSocketFactory = (host, port) => {
  const socket = new net.Socket();
  socket.setEncoding('utf8');
  socket.connect(port, host);
  return socket;
};

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RaleTrackerClient extends EventEmitter {
  private readonly host: string;
  private readonly ecp: RaleEcpInput;
  private readonly ecpPort: number | undefined;
  private readonly portRange: [number, number];
  private readonly maxAttempts: number;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly socketFactory: RaleSocketFactory;
  private readonly pickPort: (min: number, max: number) => number;

  private readonly reusePort: number | undefined;

  private socket: RaleSocket | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private _connected = false;
  private closing = false;
  private _port: number | undefined;

  constructor(opts: RaleTrackerOptions) {
    super();
    this.host = opts.host;
    this.ecp = opts.ecp;
    this.ecpPort = opts.ecpPort;
    this.portRange = opts.portRange ?? DEFAULT_PORT_RANGE;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.socketFactory = opts.socketFactory ?? realSocketFactory;
    this.reusePort = opts.reusePort;
    this.pickPort = opts.pickPort
      ?? ((min, max) => min + Math.floor(Math.random() * (max - min + 1)));
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Device-side port of the current (or last successful) session — feed it
   *  back as `reusePort` when creating the next client for this device. */
  get port(): number | undefined {
    return this._port;
  }

  /**
   * Connect and init. Tries a direct reconnect to `reusePort` first (newer
   * TrackerTasks keep serving on their original port forever — see the
   * `reusePort` option), then falls back to the activation flow: ECP input →
   * TCP connect → init, retried on a fresh random port up to `maxAttempts`
   * times. Resolves with the TrackerTask's version/session info.
   */
  async connect(): Promise<RaleInitInfo> {
    if (this._connected) throw new Error('RALE client already connected');
    this.closing = false;

    let lastError: Error | undefined;

    if (this.reusePort !== undefined) {
      try {
        return await this.connectAndInit(this.reusePort);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.teardown();
      }
    }

    for (let attempt = 0; attempt < this.maxAttempts && !this.closing; attempt++) {
      const port = this.pickPort(this.portRange[0], this.portRange[1]);
      try {
        await this.ecp.sendInput(this.host, { rale: 'true', port: String(port) }, this.ecpPort);
        return await this.connectAndInit(port);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.teardown();
      }
    }

    throw new Error(
      'TrackerTask not responding — make sure it is injected and running in the app, '
      + 'or relaunch the channel and retry. '
      + `(${lastError?.message ?? 'no attempts made'})`,
    );
  }

  private async connectAndInit(port: number): Promise<RaleInitInfo> {
    await this.connectSocket(port);
    // First command must be `init` within ~3 s of the listener opening.
    // logVerbosity: -1 skips the task's log-level reconfiguration.
    const info = await this.request<RaleInitInfo>('init', { logVerbosity: -1 }, 4000);
    this._port = port;
    return info;
  }

  /** Send a command and resolve with its JSON payload. In-band TrackerTask
   *  errors (`{error:{message}}`) reject. */
  request<T = unknown>(command: string, args: object = {}, timeoutMs?: number): Promise<T> {
    if (!this.socket) return Promise.reject(new Error('RALE client not connected'));

    const uuid = randomUUID();
    const socket = this.socket;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(uuid);
        reject(new Error(`RALE command "${command}" timed out after ${timeoutMs ?? this.requestTimeoutMs}ms`));
      }, timeoutMs ?? this.requestTimeoutMs);
      timer.unref?.();

      this.pending.set(uuid, {
        resolve: (payload) => {
          clearTimeout(timer);
          const error = extractError(payload);
          if (error) reject(new Error(`TrackerTask: ${error}`));
          else resolve(payload as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      socket.write(encodeRequest(uuid, command, args));
    });
  }

  // ── convenience commands ────────────────────────────────────────────────

  /** Select a node by scene-rooted path. Later `setField` calls target it. */
  selectNode(path: RalePathSegment[]): Promise<RaleSelectNodeResult> {
    return this.request<RaleSelectNodeResult>('selectNode', { path });
  }

  /**
   * Set a field on the currently selected node. `value` should carry its
   * JSON-native type (number/boolean/array/string) — with no explicit `type`
   * the task applies it via a plain `setFields`, letting SceneGraph coerce,
   * which avoids the remove/re-add churn an explicit type triggers.
   */
  setField(field: string, value: unknown, type?: string): Promise<unknown> {
    const args: Record<string, unknown> = { field, value };
    if (type !== undefined) args.type = type;
    return this.request('setField', args);
  }

  getNodeData(path?: RalePathSegment[]): Promise<RaleNodeData> {
    return this.request<RaleNodeData>('getNodeData', path ? { path } : {});
  }

  getNodeTree(path: RalePathSegment[], maxLevel = 50): Promise<unknown> {
    return this.request('getNodeTree', { path, maxLevel });
  }

  /** The node at `path` plus one level of children (with device-side indices). */
  async getItemList(path: RalePathSegment[]): Promise<RaleItemList> {
    // BrightScript stores dot-notation-assigned AA keys in lowercase, and the
    // TrackerTask builds this response with `item.childList = …` — so the
    // JSON key arrives as "childlist". Normalize (and tolerate either casing,
    // since key style varies across TrackerTask versions).
    const raw = await this.request<RaleItemList & { childlist?: RaleItemList['childList'] }>(
      'getItemList', { path },
    );
    return { item: raw.item, childList: raw.childList ?? raw.childlist };
  }

  /** Hide the red selector overlay the task draws on selectNode. */
  hideSelectorView(): Promise<unknown> {
    return this.request('hideSelectorView', {});
  }

  /** Close the connection; the TrackerTask returns to waiting for activation. */
  close(): void {
    this.closing = true;
    this.teardown();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private connectSocket(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = this.socketFactory(this.host, port);
      this.socket = socket;

      let settled = false;
      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`TCP connect to ${this.host}:${port} timed out`));
      }, this.connectTimeoutMs);
      connectTimer.unref?.();

      socket.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this._connected = true;
        resolve();
      });
      socket.on('data', (chunk: Buffer | string) => this.onData(chunk.toString()));
      socket.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          reject(err);
          return;
        }
        this.emit('error', err);
        this.onDisconnect();
      });
      socket.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          reject(new Error(`Connection to ${this.host}:${port} closed before ready`));
          return;
        }
        this.onDisconnect();
      });
    });
  }

  private onData(chunk: string): void {
    for (const frame of this.decoder.push(chunk)) {
      const pending = this.pending.get(frame.uuid);
      if (!pending) continue; // response to a timed-out or unknown request
      this.pending.delete(frame.uuid);
      pending.resolve(frame.payload);
    }
  }

  private onDisconnect(): void {
    const wasConnected = this._connected;
    this.teardown();
    if (wasConnected && !this.closing) this.emit('close');
  }

  private teardown(): void {
    this._connected = false;
    this.decoder.reset();
    if (this.socket) {
      this.socket.removeAllListeners();
      // Close with RST, not FIN. The TrackerTask's serve loop only exits when
      // the connection reports an error (`if closed or not connection.eOK()`
      // — and `closed` is never set in v3.2.0): after a graceful FIN it can
      // stay stuck in SocketConnection_StartConnection forever, never
      // returning to the ECP-activation wait, which makes every later Edit
      // session fail to connect until the app restarts.
      try {
        (this.socket.resetAndDestroy ?? this.socket.destroy).call(this.socket);
      } catch {
        this.socket.destroy();
      }
      this.socket = null;
    }
    const err = new Error('RALE connection closed');
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }
}

function extractError(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error: unknown }).error;
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    return 'unknown error';
  }
  return null;
}

/**
 * Roku Socket-Based Debug Protocol — TCP Client
 *
 * Manages the TCP connection to port 8081, performs the binary handshake,
 * frames outgoing requests and incoming responses/updates, and dispatches
 * update events to listeners.
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { BinaryReader, BinaryWriter } from './binaryIO';
import {
  DEBUGGER_PORT,
  DEBUGGER_MAGIC,
  CONNECTION_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  CommandCode,
  ErrorCode,
  UpdateType,
} from './constants';
import type { HandshakeResponse, ProtocolVersion } from './types';

// The handshake response from the device is exactly:
//   8 bytes magic + 4+4+4 version + 4 remaining_length + 8 timestamp = 32 bytes
// But remaining_length was added in protocol 3.0.0 and timestamp in 3.0.0.
// We read the fixed prefix (20 bytes) then use remaining_length for the rest.
const HANDSHAKE_FIXED_PREFIX = 20; // magic(8) + major(4) + minor(4) + patch(4)

/**
 * Smallest well-formed inbound packet: packet_length(4) + request_id(4) +
 * error_code(4). Anything shorter means the stream has desynchronized.
 */
const MIN_PACKET_LENGTH = 12;

/** Keep-alive probes start after this idle period so half-open sockets surface. */
const SOCKET_KEEPALIVE_MS = 10_000;

interface PendingRequest {
  commandCode: number;
  resolve: (data: Buffer) => void;
  reject: (err: Error) => void;
}

/**
 * Rejection raised by {@link ProtocolClient.cancelPendingRequests}. It means the
 * caller abandoned the request on purpose — it is *not* a connection failure and
 * must never be treated as one (in particular it must not tear down a session).
 */
export class RequestCancelledError extends Error {
  readonly isRequestCancelled = true;

  constructor(message = 'Request cancelled: device resuming') {
    super(message);
    this.name = 'RequestCancelledError';
  }
}

/** True when `err` came from {@link ProtocolClient.cancelPendingRequests}. */
export function isRequestCancelled(err: unknown): boolean {
  return typeof err === 'object'
    && err !== null
    && (err as { isRequestCancelled?: boolean }).isRequestCancelled === true;
}

/** Sink for wire-level protocol trace lines. */
export type ProtocolTracer = (message: string) => void;

export interface ProtocolClientEvents {
  update: (updateType: number, errorCode: number, payload: Buffer) => void;
  disconnected: () => void;
  error: (err: Error) => void;
}

function commandName(code: number): string {
  return CommandCode[code] ?? `Command(${code})`;
}

function updateName(type: number): string {
  return UpdateType[type] ?? `Update(${type})`;
}

function errorName(code: number): string {
  return ErrorCode[code] ?? `Error(${code})`;
}

/**
 * Low-level TCP client for the Roku socket-based debug protocol.
 *
 * Usage:
 *   const client = new ProtocolClient();
 *   const handshake = await client.connect('192.168.1.100');
 *   const response = await client.sendRequest(CommandCode.Threads);
 *   client.close();
 *
 * Emits:
 *   'update'       — (updateType, errorCode, payload: Buffer) — device-pushed update
 *   'disconnected' — connection closed
 *   'error'        — socket error
 */
export class ProtocolClient extends EventEmitter {
  private _socket: net.Socket | null = null;
  private _buffer = Buffer.alloc(0);
  private _nextRequestId = 1;
  private _pendingRequests = new Map<number, PendingRequest>();
  /** Requests whose responses are still coming but whose result we no longer want. */
  private _abandonedRequests = new Set<number>();
  private _protocolVersion: ProtocolVersion = { major: 0, minor: 0, patch: 0 };
  private _connected = false;
  private _connectRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private _handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private _connectReject: ((err: Error) => void) | undefined;
  private _closing = false;
  private _tracer: ProtocolTracer | undefined;
  private _traceHex = false;

  get protocolVersion(): ProtocolVersion {
    return this._protocolVersion;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /** Number of requests written to the device that have not been answered yet. */
  get pendingRequestCount(): number {
    return this._pendingRequests.size;
  }

  /**
   * Install a sink for wire-level trace lines. Pass `undefined` to disable.
   * With `includeHex`, every framed packet is dumped as hex — needed to diagnose
   * framing desyncs and out-of-state commands, but very noisy.
   */
  setTracer(tracer: ProtocolTracer | undefined, includeHex = false): void {
    this._tracer = tracer;
    this._traceHex = includeHex;
  }

  /**
   * Connect to the Roku device and perform the binary handshake.
   * Retries the TCP connection for up to CONNECTION_TIMEOUT_MS.
   */
  connect(host: string, port = DEBUGGER_PORT): Promise<HandshakeResponse> {
    this._closing = false;
    // A reconnect on the same instance must not inherit bytes from the last one.
    this._buffer = Buffer.alloc(0);
    this._abandonedRequests.clear();
    return new Promise((resolve, reject) => {
      let settled = false;
      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        this._connectReject = undefined;
        this._clearConnectTimers();
        reject(err);
      };
      const settleResolve = (handshake: HandshakeResponse): void => {
        if (settled) return;
        settled = true;
        this._connectReject = undefined;
        this._clearConnectTimers();
        resolve(handshake);
      };

      this._connectReject = settleReject;
      const deadline = Date.now() + CONNECTION_TIMEOUT_MS;

      const tryConnect = (): void => {
        this._connectRetryTimer = undefined;
        if (this._closing) {
          settleReject(new Error('Connection closed'));
          return;
        }
        if (Date.now() > deadline) {
          settleReject(new Error(`Connection to ${host}:${port} timed out after ${CONNECTION_TIMEOUT_MS}ms`));
          return;
        }

        const socket = new net.Socket();
        socket.once('error', () => {
          socket.destroy();
          if (this._closing) {
            settleReject(new Error('Connection closed'));
            return;
          }
          this._connectRetryTimer = setTimeout(tryConnect, 1000);
          this._connectRetryTimer.unref?.();
        });

        socket.connect(port, host, () => {
          if (this._closing) {
            socket.destroy();
            settleReject(new Error('Connection closed'));
            return;
          }
          this._socket = socket;
          socket.removeAllListeners('error');

          // Nagle would hold back the 12-byte CONTINUE/STEP packets waiting for
          // an ACK, which reads as "the device ignored my resume".
          socket.setNoDelay(true);
          // Without keep-alive a device that drops off the network leaves a
          // half-open socket: no 'close' ever fires and the session hangs.
          socket.setKeepAlive(true, SOCKET_KEEPALIVE_MS);

          this._trace(`connect ${host}:${port} established`);

          this._performHandshake(socket)
            .then((handshake) => {
              this._connected = true;
              this._protocolVersion = handshake.protocolVersion;

              socket.on('data', (data: Buffer) => this._onData(data));
              socket.on('error', (err) => this._onSocketError(err));
              socket.on('close', () => this._onClose());

              // Process any leftover bytes from the handshake that may contain
              // the initial AllThreadsStopped update (remotedebug_connect_early).
              if (this._buffer.length > 0) {
                this._trace(`handshake leftover ${this._buffer.length}B — processing as packets`);
                this._processBuffer();
              }

              settleResolve(handshake);
            })
            .catch(settleReject);
        });
      };

      tryConnect();
    });
  }

  /**
   * Send a command request and wait for the matching response.
   * Returns the raw response payload buffer (after requestId and errorCode).
   * Rejects after `timeoutMs` if no response is received (default: 5 000 ms).
   */
  sendRequest(commandCode: number, data?: Buffer, timeoutMs = 5_000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!this._socket || !this._connected) {
        reject(new Error('Not connected'));
        return;
      }

      const requestId = this._nextRequestId++;
      const writer = new BinaryWriter();

      // Build packet body: requestId + commandCode + optional data
      const bodyWriter = new BinaryWriter();
      bodyWriter.writeUint32(requestId);
      bodyWriter.writeUint32(commandCode);
      if (data) {
        bodyWriter.writeBuffer(data);
      }
      const body = bodyWriter.toBuffer();

      // Write packet_length (includes itself, 4 bytes) + body
      writer.writeUint32(4 + body.length);
      writer.writeBuffer(body);

      const timer = setTimeout(() => {
        if (this._pendingRequests.has(requestId)) {
          this._pendingRequests.delete(requestId);
          this._trace(`send #${requestId} ${commandName(commandCode)} TIMED OUT after ${timeoutMs}ms`);
          reject(new Error(`Request ${commandCode} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this._pendingRequests.set(requestId, {
        commandCode,
        resolve: (buf) => { clearTimeout(timer); resolve(buf); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      const packet = writer.toBuffer();
      this._trace(`send #${requestId} ${commandName(commandCode)} (${packet.length}B)${this._hex(packet)}`);
      this._socket.write(packet);
    });
  }

  /**
   * Abandon all in-flight requests.
   *
   * This only discards results on *our* side — the bytes are already on the wire
   * and the device will still answer them in order. Late responses are recognised
   * and dropped rather than logged as unmatched. Callers get a
   * {@link RequestCancelledError}, which must not be treated as a fatal error.
   */
  cancelPendingRequests(): void {
    for (const [requestId, pending] of this._pendingRequests) {
      this._abandonedRequests.add(requestId);
      pending.reject(new RequestCancelledError(
        `Request ${commandName(pending.commandCode)} cancelled: device resuming`,
      ));
    }
    this._pendingRequests.clear();
  }

  close(): void {
    this._closing = true;
    this._connected = false;
    this._clearConnectTimers();
    this._connectReject?.(new Error('Connection closed'));
    this._connectReject = undefined;
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
    this._buffer = Buffer.alloc(0);
    this._abandonedRequests.clear();
    // Reject all pending requests
    for (const [, pending] of this._pendingRequests) {
      pending.reject(new Error('Connection closed'));
    }
    this._pendingRequests.clear();
  }

  // ---------------------------------------------------------------------------
  // Handshake
  // ---------------------------------------------------------------------------

  private _performHandshake(socket: net.Socket): Promise<HandshakeResponse> {
    return new Promise((resolve, reject) => {
      let handshakeBuffer = Buffer.alloc(0);

      const onData = (chunk: Buffer): void => {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);

        if (handshakeBuffer.length < HANDSHAKE_FIXED_PREFIX) return;

        const reader = new BinaryReader(handshakeBuffer);
        const magic = reader.readUint64();
        const major = reader.readUint32();
        const minor = reader.readUint32();
        const patch = reader.readUint32();

        // Protocol 3.0.0+ includes remaining_packet_length + platform_revision_timestamp
        let platformRevisionTimestamp = 0n;
        let remainingLength = 0;
        if (major >= 3) {
          if (handshakeBuffer.length < HANDSHAKE_FIXED_PREFIX + 4) return; // wait for remaining_length
          remainingLength = reader.readUint32();
          if (handshakeBuffer.length < HANDSHAKE_FIXED_PREFIX + 4 + remainingLength) return;
          if (remainingLength >= 8) {
            platformRevisionTimestamp = reader.readUint64();
          }
          // remaining_length exists precisely so the handshake can grow. Skip any
          // fields this build does not know about, otherwise the surplus bytes
          // would be handed to the packet framer and desync the stream forever.
          const handshakeEnd = HANDSHAKE_FIXED_PREFIX + 4 + remainingLength;
          if (reader.position < handshakeEnd) {
            reader.skip(handshakeEnd - reader.position);
          }
        }

        clearTimeout(timeout);
        if (this._handshakeTimer === timeout) {
          this._handshakeTimer = undefined;
        }
        socket.removeListener('data', onData);

        // Store any leftover bytes for the main data handler
        const consumed = reader.position;
        if (consumed < handshakeBuffer.length) {
          this._buffer = handshakeBuffer.subarray(consumed);
        }

        this._trace(
          `handshake protocol ${major}.${minor}.${patch} `
          + `remainingLength=${remainingLength} consumed=${consumed}B `
          + `leftover=${handshakeBuffer.length - consumed}B`,
        );

        resolve({
          magic,
          protocolVersion: { major, minor, patch },
          platformRevisionTimestamp,
        });
      };

      const timeout = setTimeout(() => {
        // Leaving the listener attached would let a late handshake mutate state
        // after the connect promise already settled.
        socket.removeListener('data', onData);
        this._trace(`handshake TIMED OUT after ${HANDSHAKE_TIMEOUT_MS}ms`);
        reject(new Error('Handshake timed out'));
      }, HANDSHAKE_TIMEOUT_MS);
      timeout.unref?.();
      this._handshakeTimer = timeout;

      // Send magic to device
      const writer = new BinaryWriter();
      writer.writeUint64(DEBUGGER_MAGIC);
      socket.write(writer.toBuffer());

      socket.on('data', onData);
    });
  }

  // ---------------------------------------------------------------------------
  // Data framing
  // ---------------------------------------------------------------------------

  private _onData(chunk: Buffer): void {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    this._processBuffer();
  }

  private _processBuffer(): void {
    // Each packet starts with uint32 packet_length (includes the 4 bytes of packet_length itself)
    while (this._buffer.length >= 4) {
      const packetLength = this._buffer.readUInt32LE(0);
      if (packetLength < MIN_PACKET_LENGTH) {
        // The stream desynchronized. There is no sync marker in a purely
        // length-prefixed protocol, so the buffered bytes are unusable — drop
        // them and realign on whatever the next read delivers.
        //
        // Deliberately *not* closing the connection: a dead socket strands the
        // channel stopped on the device with nothing left to resume it, whereas
        // a live one still carries CONTINUE even if we misread the replies.
        const discarded = this._buffer.length;
        this._buffer = Buffer.alloc(0);
        this._trace(`recv desync packet_length=${packetLength}, discarded ${discarded}B`);
        this.emit('error', new Error(
          `Invalid packet length: ${packetLength} — stream desynchronized, `
          + `discarded ${discarded} buffered byte(s)`,
        ));
        return;
      }
      if (this._buffer.length < packetLength) {
        break; // wait for more data
      }

      const packetData = this._buffer.subarray(4, packetLength);
      this._buffer = this._buffer.subarray(packetLength);

      try {
        this._handlePacket(packetData);
      } catch (err) {
        // A malformed payload — or a listener that threw while handling an
        // update — must not abort the read loop or escape into the socket's
        // 'data' emit. The buffer has already advanced past this packet, so
        // framing is intact and the next packet still gets processed.
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private _handlePacket(data: Buffer): void {
    if (data.length < 8) {
      throw new Error(`Packet too short: ${data.length} bytes`);
    }

    const reader = new BinaryReader(data);
    const requestId = reader.readUint32();
    const secondField = reader.readUint32(); // errorCode (for responses/updates) or could be other

    if (requestId === 0) {
      // Update message from device
      // For updates: secondField = errorCode, next uint32 = updateType
      const errorCode = secondField;
      if (reader.remaining < 4) {
        throw new Error('Update packet missing updateType');
      }
      const updateType = reader.readUint32();
      const payload = reader.remaining > 0 ? reader.readBuffer(reader.remaining) : Buffer.alloc(0);
      this._trace(
        `recv update ${updateName(updateType)} errorCode=${errorName(errorCode)} `
        + `payload=${payload.length}B${this._hex(data)}`,
      );
      this.emit('update', updateType, errorCode, payload);
    } else {
      // Response to a pending request
      const pending = this._pendingRequests.get(requestId);
      if (pending) {
        this._pendingRequests.delete(requestId);
        const errorCode = secondField;
        if (errorCode !== ErrorCode.OK) {
          this._trace(`recv #${requestId} ${commandName(pending.commandCode)} FAILED ${errorName(errorCode)}`);
          pending.reject(new Error(
            `${commandName(pending.commandCode)} rejected by device: ${errorName(errorCode)} (${errorCode})`,
          ));
        } else {
          const payload = reader.remaining > 0 ? reader.readBuffer(reader.remaining) : Buffer.alloc(0);
          this._trace(
            `recv #${requestId} ${commandName(pending.commandCode)} OK payload=${payload.length}B${this._hex(data)}`,
          );
          pending.resolve(payload);
        }
      } else if (this._abandonedRequests.delete(requestId)) {
        this._trace(`recv #${requestId} dropped (request was abandoned)`);
      } else {
        // Timed-out or duplicate response. Worth seeing: it means our idea of
        // the request queue and the device's have diverged.
        this._trace(`recv #${requestId} dropped (no pending request — timed out or duplicate)`);
      }
    }
  }

  private _clearConnectTimers(): void {
    if (this._connectRetryTimer) {
      clearTimeout(this._connectRetryTimer);
      this._connectRetryTimer = undefined;
    }
    if (this._handshakeTimer) {
      clearTimeout(this._handshakeTimer);
      this._handshakeTimer = undefined;
    }
  }

  private _onSocketError(err: Error): void {
    const code = (err as NodeJS.ErrnoException).code;
    this._trace(
      `socket error ${code ?? err.name}: ${err.message} `
      + `(inFlight=${this._describeInFlight()}, buffered=${this._buffer.length}B)`,
    );
    this.emit('error', err);
  }

  private _onClose(): void {
    this._connected = false;
    this._socket = null;
    this._trace(
      `socket closed (inFlight=${this._describeInFlight()}, buffered=${this._buffer.length}B)`,
    );
    for (const [, pending] of this._pendingRequests) {
      pending.reject(new Error('Connection closed'));
    }
    this._pendingRequests.clear();
    this._abandonedRequests.clear();
    this._buffer = Buffer.alloc(0);
    this.emit('disconnected');
  }

  private _describeInFlight(): string {
    if (this._pendingRequests.size === 0) return 'none';
    return [...this._pendingRequests]
      .map(([id, p]) => `#${id} ${commandName(p.commandCode)}`)
      .join(', ');
  }

  private _trace(message: string): void {
    this._tracer?.(message);
  }

  /** Hex dump for verbose tracing; empty string when hex tracing is off. */
  private _hex(buf: Buffer, max = 256): string {
    if (!this._tracer || !this._traceHex) return '';
    const shown = buf.subarray(0, max).toString('hex').replace(/(..)/g, '$1 ').trim();
    const suffix = buf.length > max ? ` …(+${buf.length - max}B)` : '';
    return `\n    ${shown}${suffix}`;
  }
}

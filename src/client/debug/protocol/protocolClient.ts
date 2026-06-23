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
  ErrorCode,
} from './constants';
import type { HandshakeResponse, ProtocolVersion } from './types';

// The handshake response from the device is exactly:
//   8 bytes magic + 4+4+4 version + 4 remaining_length + 8 timestamp = 32 bytes
// But remaining_length was added in protocol 3.0.0 and timestamp in 3.0.0.
// We read the fixed prefix (20 bytes) then use remaining_length for the rest.
const HANDSHAKE_FIXED_PREFIX = 20; // magic(8) + major(4) + minor(4) + patch(4)

interface PendingRequest {
  resolve: (data: Buffer) => void;
  reject: (err: Error) => void;
}

export interface ProtocolClientEvents {
  update: (updateType: number, errorCode: number, payload: Buffer) => void;
  disconnected: () => void;
  error: (err: Error) => void;
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
  private _protocolVersion: ProtocolVersion = { major: 0, minor: 0, patch: 0 };
  private _connected = false;
  private _connectRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private _handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private _connectReject: ((err: Error) => void) | undefined;
  private _closing = false;

  get protocolVersion(): ProtocolVersion {
    return this._protocolVersion;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the Roku device and perform the binary handshake.
   * Retries the TCP connection for up to CONNECTION_TIMEOUT_MS.
   */
  connect(host: string, port = DEBUGGER_PORT): Promise<HandshakeResponse> {
    this._closing = false;
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

          this._performHandshake(socket)
            .then((handshake) => {
              this._connected = true;
              this._protocolVersion = handshake.protocolVersion;

              socket.on('data', (data: Buffer) => this._onData(data));
              socket.on('error', (err) => this.emit('error', err));
              socket.on('close', () => this._onClose());

              // Process any leftover bytes from the handshake that may contain
              // the initial AllThreadsStopped update (remotedebug_connect_early).
              if (this._buffer.length > 0) {
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
          reject(new Error(`Request ${commandCode} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this._pendingRequests.set(requestId, {
        resolve: (buf) => { clearTimeout(timer); resolve(buf); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      this._socket.write(writer.toBuffer());
    });
  }

  /**
   * Reject and discard all pending requests.
   * Call this before sending continue/step so the device processes the
   * resume command immediately rather than finishing queued requests first.
   */
  cancelPendingRequests(): void {
    for (const [, pending] of this._pendingRequests) {
      pending.reject(new Error('Cancelled: device resuming'));
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
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timed out'));
      }, HANDSHAKE_TIMEOUT_MS);
      timeout.unref?.();
      this._handshakeTimer = timeout;

      // Send magic to device
      const writer = new BinaryWriter();
      writer.writeUint64(DEBUGGER_MAGIC);
      socket.write(writer.toBuffer());

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
        if (major >= 3) {
          if (handshakeBuffer.length < HANDSHAKE_FIXED_PREFIX + 4) return; // wait for remaining_length
          const remainingLength = reader.readUint32();
          if (handshakeBuffer.length < HANDSHAKE_FIXED_PREFIX + 4 + remainingLength) return;
          if (remainingLength >= 8) {
            platformRevisionTimestamp = reader.readUint64();
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

        resolve({
          magic,
          protocolVersion: { major, minor, patch },
          platformRevisionTimestamp,
        });
      };

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
      if (packetLength < 4) {
        this.emit('error', new Error(`Invalid packet length: ${packetLength}`));
        this.close();
        return;
      }
      if (this._buffer.length < packetLength) {
        break; // wait for more data
      }

      const packetData = this._buffer.subarray(4, packetLength);
      this._buffer = this._buffer.subarray(packetLength);

      this._handlePacket(packetData);
    }
  }

  private _handlePacket(data: Buffer): void {
    if (data.length < 8) {
      this.emit('error', new Error(`Packet too short: ${data.length} bytes`));
      return;
    }

    const reader = new BinaryReader(data);
    const requestId = reader.readUint32();
    const secondField = reader.readUint32(); // errorCode (for responses/updates) or could be other

    if (requestId === 0) {
      // Update message from device
      // For updates: secondField = errorCode, next uint32 = updateType
      const errorCode = secondField;
      if (reader.remaining < 4) {
        this.emit('error', new Error('Update packet missing updateType'));
        return;
      }
      const updateType = reader.readUint32();
      const payload = reader.remaining > 0 ? reader.readBuffer(reader.remaining) : Buffer.alloc(0);
      this.emit('update', updateType, errorCode, payload);
    } else {
      // Response to a pending request
      const pending = this._pendingRequests.get(requestId);
      if (pending) {
        this._pendingRequests.delete(requestId);
        const errorCode = secondField;
        if (errorCode !== ErrorCode.OK) {
          pending.reject(new Error(`Protocol error: code ${errorCode} for request ${requestId}`));
        } else {
          const payload = reader.remaining > 0 ? reader.readBuffer(reader.remaining) : Buffer.alloc(0);
          pending.resolve(payload);
        }
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

  private _onClose(): void {
    this._connected = false;
    this._socket = null;
    for (const [, pending] of this._pendingRequests) {
      pending.reject(new Error('Connection closed'));
    }
    this._pendingRequests.clear();
    this.emit('disconnected');
  }
}

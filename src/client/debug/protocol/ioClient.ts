/**
 * Roku Socket-Based Debug Protocol — IO Channel Client
 *
 * Connects to the dynamically-assigned IO port (reported via IO_PORT_OPENED
 * update from the device) to receive app stdout/print output.
 */

import * as net from 'net';
import { EventEmitter } from 'events';

/**
 * TCP client for the Roku app IO (print/stdout) channel.
 *
 * Emits:
 *   'output' — (text: string) — a chunk of UTF-8 output from the app
 *   'close'  — connection closed
 *   'error'  — (err: Error) — socket error
 */
export class IOClient extends EventEmitter {
  private _socket: net.Socket | null = null;
  private _connected = false;

  get isConnected(): boolean {
    return this._connected;
  }

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      this._socket = socket;

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`IO connection to ${host}:${port} timed out`));
      }, 10_000);

      socket.once('error', (err) => {
        clearTimeout(timeout);
        socket.destroy();
        reject(err);
      });

      socket.connect(port, host, () => {
        clearTimeout(timeout);
        this._connected = true;
        socket.removeAllListeners('error');

        socket.on('data', (data) => {
          this.emit('output', data.toString('utf-8'));
        });

        socket.on('error', (err) => {
          this.emit('error', err);
        });

        socket.on('close', () => {
          this._connected = false;
          this._socket = null;
          this.emit('close');
        });

        resolve();
      });
    });
  }

  close(): void {
    this._connected = false;
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
  }
}

import * as dgram from 'dgram';
import * as os from 'os';
import { EventEmitter } from 'events';
import { SsdpDeviceFound } from '../types';

const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;
const DEFAULT_SCAN_TIMEOUT = 5000;
const SETTLE_DELAY = 1500;
const ALIVE_DEBOUNCE = 500;

const M_SEARCH =
  'M-SEARCH * HTTP/1.1\r\n' +
  `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}\r\n` +
  'MAN: "ssdp:discover"\r\n' +
  'MX: 3\r\n' +
  'ST: roku:ecp\r\n' +
  '\r\n';

// Typed event signatures
interface SsdpClientEvents {
  found: [device: SsdpDeviceFound];
  lost: [ip: string];
  'scan-started': [];
  'scan-ended': [];
  error: [error: Error];
}

/**
 * Zero-dependency SSDP client for Roku device discovery.
 *
 * Uses raw `dgram` UDP4 sockets to perform both active scanning (M-SEARCH)
 * and passive listening (NOTIFY) on all non-internal IPv4 network interfaces.
 */
export class SsdpClient extends EventEmitter {
  private activeSockets: dgram.Socket[] = [];
  private passiveSockets: dgram.Socket[] = [];
  private scanning = false;
  private running = false;
  private scanTimers: ReturnType<typeof setTimeout>[] = [];
  private aliveDebounce = new Map<string, ReturnType<typeof setTimeout>>();

  // -- Typed EventEmitter overloads ------------------------------------------

  override on<K extends keyof SsdpClientEvents>(
    event: K,
    listener: (...args: SsdpClientEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof SsdpClientEvents>(
    event: K,
    ...args: SsdpClientEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  override off<K extends keyof SsdpClientEvents>(
    event: K,
    listener: (...args: SsdpClientEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  // -- Lifecycle -------------------------------------------------------------

  /** Begin passive listening — joins multicast groups and listens for NOTIFY. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const addresses = this.getInterfaceAddresses();
    await this.bindPassiveSockets(addresses);
  }

  /**
   * Trigger an active M-SEARCH scan.
   * Resolves when the scan timeout expires or the settle window closes,
   * whichever comes first.
   */
  async scan(timeoutMs: number = DEFAULT_SCAN_TIMEOUT): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.emit('scan-started');

    const addresses = this.getInterfaceAddresses();
    const seenIps = new Set<string>();
    const sockets: dgram.Socket[] = [];

    return new Promise<void>((resolve) => {
      let settleTimer: ReturnType<typeof setTimeout> | undefined;

      const endScan = () => {
        if (!this.scanning) return;
        this.scanning = false;
        this.clearTimers();
        for (const s of sockets) this.safeClose(s);
        sockets.length = 0;
        this.emit('scan-ended');
        resolve();
      };

      const resetSettle = () => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(endScan, SETTLE_DELAY);
        this.unrefTimer(settleTimer);
        this.scanTimers.push(settleTimer);
      };

      // Hard timeout
      const hardTimer = setTimeout(endScan, timeoutMs);
      this.unrefTimer(hardTimer);
      this.scanTimers.push(hardTimer);

      // Bind one socket per interface for M-SEARCH
      const bindPromises = addresses.map((addr) =>
        this.createSocket(addr).then((socket) => {
          sockets.push(socket);
          this.trackActiveSocket(socket);

          socket.on('message', (msg) => {
            const text = msg.toString();
            if (!text.startsWith('HTTP/1.1 200')) return;

            const device = this.parseSearchResponse(text);
            if (!device || seenIps.has(device.ip)) return;

            seenIps.add(device.ip);
            this.emit('found', device);
            resetSettle();
          });

          // Send M-SEARCH 3× for UDP reliability
          this.sendMSearch(socket, 0);
          this.sendMSearch(socket, 100);
          this.sendMSearch(socket, 200);
        }),
      );

      // If all binds fail, still end the scan after timeout
      Promise.allSettled(bindPromises);
    });
  }

  /** Close all sockets and clear timers. */
  stop(): void {
    this.running = false;
    this.scanning = false;
    this.clearTimers();
    this.clearDebounce();

    for (const s of [...this.activeSockets, ...this.passiveSockets]) {
      this.safeClose(s);
    }
    this.activeSockets = [];
    this.passiveSockets = [];
  }

  /** Convenience restart — stop + start. Useful on network changes. */
  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  // -- Passive listening (NOTIFY) --------------------------------------------

  private async bindPassiveSockets(addresses: string[]): Promise<void> {
    const results = await Promise.allSettled(
      addresses.map((addr) => this.createPassiveSocket(addr)),
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        this.emit('error', r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
      }
    }
  }

  private createPassiveSocket(interfaceAddr: string): Promise<dgram.Socket> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', (err) => {
        if (this.isNetworkBindError(err)) {
          this.safeClose(socket);
          reject(err);
          return;
        }
        this.emit('error', err);
      });

      socket.on('message', (msg) => this.handleNotify(msg));

      socket.bind(SSDP_PORT, () => {
        try {
          socket.addMembership(SSDP_MULTICAST, interfaceAddr);
        } catch (err) {
          this.safeClose(socket);
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        this.passiveSockets.push(socket);
        resolve(socket);
      });
    });
  }

  private handleNotify(msg: Buffer): void {
    const text = msg.toString();
    if (!text.startsWith('NOTIFY')) return;

    const headers = this.parseHeaders(text);
    const nts = headers.get('nts');
    const st = headers.get('st');

    if (st !== 'roku:ecp') return;

    if (nts === 'ssdp:alive') {
      const device = this.extractDeviceFromHeaders(headers);
      if (!device) return;
      this.debouncedAlive(device);
    } else if (nts === 'ssdp:byebye') {
      const location = headers.get('location');
      if (!location) return;
      const ip = this.extractIpFromLocation(location);
      if (ip) this.emit('lost', ip);
    }
  }

  /** Debounce alive events per IP to suppress multicast bursts. */
  private debouncedAlive(device: SsdpDeviceFound): void {
    const existing = this.aliveDebounce.get(device.ip);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.aliveDebounce.delete(device.ip);
      this.emit('found', device);
    }, ALIVE_DEBOUNCE);
    this.unrefTimer(timer);

    this.aliveDebounce.set(device.ip, timer);
  }

  // -- Socket helpers --------------------------------------------------------

  private createSocket(interfaceAddr: string): Promise<dgram.Socket> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', (err) => {
        if (this.isNetworkBindError(err)) {
          this.safeClose(socket);
          reject(err);
          return;
        }
        this.emit('error', err);
      });

      socket.bind(0, interfaceAddr, () => {
        // Set the multicast outgoing interface so M-SEARCH packets leave through
        // the correct network interface (e.g. the 192.168.2.x interface for a
        // device on that subnet). Without this, the OS may route multicast
        // through the default interface, missing devices on other subnets.
        try {
          socket.setMulticastInterface(interfaceAddr);
        } catch {
          // Not fatal — some virtual interfaces may not support this
        }
        resolve(socket);
      });
    });
  }

  private sendMSearch(socket: dgram.Socket, delayMs: number): void {
    const packet = Buffer.from(M_SEARCH);

    const send = () => {
      try {
        socket.send(packet, 0, packet.length, SSDP_PORT, SSDP_MULTICAST);
      } catch {
        // Socket may have been closed between schedule and execution
      }
    };

    if (delayMs === 0) {
      send();
    } else {
      const timer = setTimeout(send, delayMs);
      this.unrefTimer(timer);
      this.scanTimers.push(timer);
    }
  }

  // -- Response parsing ------------------------------------------------------

  /** Parse an M-SEARCH response (HTTP/1.1 200 OK) into an SsdpDeviceFound. */
  private parseSearchResponse(text: string): SsdpDeviceFound | undefined {
    const headers = this.parseHeaders(text);
    return this.extractDeviceFromHeaders(headers);
  }

  /** Extract device info from parsed headers. */
  private extractDeviceFromHeaders(headers: Map<string, string>): SsdpDeviceFound | undefined {
    const location = headers.get('location');
    const usn = headers.get('usn');
    if (!location || !usn) return undefined;

    const ip = this.extractIpFromLocation(location);
    const port = this.extractPortFromLocation(location);
    const serialNumber = this.extractSerialFromUsn(usn);

    if (!ip || !serialNumber) return undefined;

    return { ip, port, serialNumber };
  }

  /**
   * Parse HTTP-style headers into a Map with lower-cased keys.
   * Per UPnP spec, header names are case-insensitive.
   */
  private parseHeaders(text: string): Map<string, string> {
    const headers = new Map<string, string>();
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx < 1) continue;

      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      headers.set(key, value);
    }

    return headers;
  }

  private extractIpFromLocation(location: string): string | undefined {
    try {
      const url = new URL(location);
      return url.hostname;
    } catch {
      return undefined;
    }
  }

  private extractPortFromLocation(location: string): number {
    try {
      const url = new URL(location);
      return url.port ? parseInt(url.port, 10) : 8060;
    } catch {
      return 8060;
    }
  }

  /** Extract serial number from USN like `uuid:roku:ecp:SERIALNUMBER`. */
  private extractSerialFromUsn(usn: string): string | undefined {
    const match = usn.match(/uuid:roku:ecp:([^\s:]+)/i);
    return match?.[1];
  }

  // -- Network interface enumeration -----------------------------------------

  /**
   * Enumerate all non-internal IPv4 addresses.
   * Falls back to `0.0.0.0` if no suitable interfaces are found.
   */
  private getInterfaceAddresses(): string[] {
    const addresses: string[] = [];
    const interfaces = os.networkInterfaces();

    for (const infos of Object.values(interfaces)) {
      if (!infos) continue;
      for (const info of infos) {
        if (info.family === 'IPv4' && !info.internal) {
          addresses.push(info.address);
        }
      }
    }

    return addresses.length > 0 ? addresses : ['0.0.0.0'];
  }

  // -- Cleanup helpers -------------------------------------------------------

  /** Check if an error is a bind failure on a VPN/virtual NIC. */
  private isNetworkBindError(err: NodeJS.ErrnoException): boolean {
    return err.code === 'ENODEV' || err.code === 'EADDRNOTAVAIL';
  }

  private trackActiveSocket(socket: dgram.Socket): void {
    this.activeSockets.push(socket);
    socket.once('close', () => {
      this.activeSockets = this.activeSockets.filter((s) => s !== socket);
    });
  }

  private safeClose(socket: dgram.Socket): void {
    this.activeSockets = this.activeSockets.filter((s) => s !== socket);
    try {
      socket.close();
    } catch {
      // Already closed — nothing to do
    }
  }

  private unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    timer.unref?.();
  }

  private clearTimers(): void {
    for (const t of this.scanTimers) clearTimeout(t);
    this.scanTimers = [];
  }

  private clearDebounce(): void {
    for (const t of this.aliveDebounce.values()) clearTimeout(t);
    this.aliveDebounce.clear();
  }
}

export default SsdpClient;

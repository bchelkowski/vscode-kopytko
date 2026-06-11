import * as dgram from 'dgram';
import * as http from 'http';
import * as os from 'os';
import { RokuDevice } from './types';

const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;
const SSDP_SEARCH = [
  'M-SEARCH * HTTP/1.1',
  `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  'MX: 5',
  'ST: roku:ecp',
  '',
  '',
].join('\r\n');

/**
 * Returns the IPv4 address of every non-internal network interface.
 * Used to bind one SSDP socket per NIC — the same strategy RokuCommunity
 * uses via `explicitSocketBind` — so that the M-SEARCH goes out on every
 * adapter (Wi-Fi, Ethernet, VPN, …).
 */
function getLocalIPv4Addresses(): string[] {
  const addresses: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        addresses.push(info.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['0.0.0.0'];
}

/**
 * Scans the local network for Roku devices via SSDP, then queries each
 * discovered device's ECP endpoint for model details.
 *
 * Binds one UDP socket per network interface and sends the M-SEARCH three
 * times (UDP is unreliable) to maximise the chance of a response.
 */
export function discoverDevices(timeoutMs = 5000): Promise<RokuDevice[]> {
  return new Promise((resolve) => {
    const found = new Map<string, RokuDevice>();
    const sockets: dgram.Socket[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = () => {
      for (const t of timers) clearTimeout(t);
      for (const s of sockets) { try { s.close(); } catch { /* already closed */ } }
      resolve(Array.from(found.values()));
    };

    timers.push(setTimeout(finish, timeoutMs));

    const handleMessage = async (msg: Buffer) => {
      const text = msg.toString();
      if (!text.includes('roku')) return;

      const locMatch = /LOCATION:\s*(.+)/i.exec(text);
      if (!locMatch) return;

      const url = locMatch[1].trim();
      const urlMatch = /http:\/\/([^:/]+):?(\d*)/.exec(url);
      if (!urlMatch) return;

      const ip = urlMatch[1];
      const port = urlMatch[2] ? parseInt(urlMatch[2], 10) : 8060;
      if (found.has(ip)) return;

      try {
        const device = await queryDeviceInfo(ip, port);
        found.set(ip, device);
      } catch {
        // device didn't respond to ECP — skip
      }
    };

    const searchBuf = Buffer.from(SSDP_SEARCH);
    const addresses = getLocalIPv4Addresses();

    for (const localAddr of addresses) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(socket);

      socket.on('message', handleMessage);
      socket.on('error', () => { /* ignore per-socket errors */ });

      socket.bind({ address: localAddr, port: 0 }, () => {
        try {
          socket.setMulticastTTL(4);
        } catch { /* not critical */ }

        // Send M-SEARCH 3× for UDP reliability (t=0, +100ms, +200ms)
        const send = () => {
          socket.send(searchBuf, 0, searchBuf.length, SSDP_PORT, SSDP_MULTICAST, () => {});
        };
        send();
        timers.push(setTimeout(send, 100));
        timers.push(setTimeout(send, 200));
      });
    }
  });
}

export function queryDeviceInfo(ip: string, port: number): Promise<RokuDevice> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${ip}:${port}/query/device-info`, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ip,
          port,
          friendlyName: extractTag(data, 'friendly-device-name') || `Roku (${ip})`,
          modelName: extractTag(data, 'model-name') || 'Unknown',
          serialNumber: extractTag(data, 'serial-number') || '',
          softwareVersion: extractTag(data, 'software-version') || '',
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('ECP query timed out')));
  });
}

function extractTag(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<]*)<\/${tag}>`).exec(xml);
  return m ? m[1].trim() : '';
}

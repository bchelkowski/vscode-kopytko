import * as dgram from 'dgram';
import * as http from 'http';
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
 * Scans the local network for Roku devices via SSDP, then queries each
 * discovered device's ECP endpoint for model details.
 */
export function discoverDevices(timeoutMs = 5000): Promise<RokuDevice[]> {
  return new Promise((resolve) => {
    const found = new Map<string, RokuDevice>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = () => {
      try { socket.close(); } catch { /* already closed */ }
      resolve(Array.from(found.values()));
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.on('message', async (msg) => {
      const text = msg.toString();
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
    });

    socket.on('error', finish);

    socket.bind(() => {
      socket.send(Buffer.from(SSDP_SEARCH), SSDP_PORT, SSDP_MULTICAST, (err) => {
        if (err) { clearTimeout(timer); finish(); }
      });
    });
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

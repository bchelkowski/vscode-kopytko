/**
 * Finds this machine's own IPv4 on the same subnet as the Roku — i.e. the
 * address the device would use as its gateway (on Windows ICS this is
 * typically 192.168.137.1). Used by the WinDivert companion
 * (`redirect/windows/`) to resolve the ICS-shared adapter's interface index —
 * read-only, no OS changes.
 */

import * as os from 'os';

export function findGatewayIp(
  deviceIp: string,
  ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string | undefined {
  const dev = ipToInt(deviceIp);
  if (dev === null) return undefined;
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const host = ipToInt(addr.address);
      const mask = ipToInt(addr.netmask);
      if (host === null || mask === null) continue;
      if ((host & mask) === (dev & mask)) return addr.address;
    }
  }
  return undefined;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = (n << 8) | b;
  }
  return n >>> 0;
}

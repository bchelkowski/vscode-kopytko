import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Computes a deterministic hash of the host's non-internal
 * network interfaces. Filters out loopback, link-local
 * (169.254.x.x, fe80::), and produces an MD5 hex digest.
 *
 * The result changes when the machine moves between networks
 * (e.g. home → office), so discovered-device lists stay scoped.
 */
export function computeNetworkId(): string {
  const ifaces = os.networkInterfaces();
  const pairs: string[] = [];

  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue;
      if (addr.address.startsWith('fe80:')) continue;
      pairs.push(`${addr.address}:${addr.netmask}`);
    }
  }

  pairs.sort();
  const raw = pairs.join('|');

  return crypto.createHash('md5').update(raw).digest('hex');
}

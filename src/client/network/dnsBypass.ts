/**
 * Shared DNS-bypass helper for the capture proxy's own outbound upstream
 * requests (`capture/captureProxy.ts`'s `forward()`).
 *
 * The proxy bridges a device's plaintext HTTP request to the real backend
 * over HTTPS (see the no-CA bridging model in `docs/network-inspector.md`).
 * That upstream request runs on this same machine, so if the local hosts
 * file happens to have any entry for the target hostname — a corporate VPN
 * split-tunnel override, an unrelated local dev entry, anything — the
 * proxy's own resolution could be redirected somewhere other than the real
 * backend it's supposed to bridge to. `dns.resolve4`/`resolve6` perform an
 * actual DNS protocol query and never consult the local hosts file, unlike
 * `dns.lookup`/`getaddrinfo` (what `http.request` uses by default).
 */

import * as dns from 'dns';
import type * as http from 'http';

export interface HostsBypassResolver {
  resolve4: (hostname: string) => Promise<string[]>;
  resolve6: (hostname: string) => Promise<string[]>;
}

export const realHostsBypassResolver: HostsBypassResolver = {
  resolve4: (h) => dns.promises.resolve4(h),
  resolve6: (h) => dns.promises.resolve6(h),
};

/**
 * Resolves `hostname` to a real IP via an actual DNS protocol query.
 * Prefers IPv4, falls back to IPv6, and returns `undefined` (letting the
 * caller fall back to normal OS resolution) if the hostname genuinely can't
 * be resolved this way — e.g. an internal-only name with no public DNS
 * record, which has no other way to be reached.
 */
export async function resolveBypassingHosts(
  hostname: string,
  resolver: HostsBypassResolver = realHostsBypassResolver,
): Promise<string | undefined> {
  try {
    const v4 = await resolver.resolve4(hostname);
    if (v4.length > 0) return v4[0];
  } catch {
    // fall through to IPv6
  }
  try {
    const v6 = await resolver.resolve6(hostname);
    if (v6.length > 0) return v6[0];
  } catch {
    // fall through to "let the caller use normal OS resolution"
  }
  return undefined;
}

/**
 * Builds an `http.RequestOptions['lookup']` override that pins the
 * connection's IP-resolution step to `resolvedIp`, while leaving the
 * hostname itself untouched for the Host header / TLS SNI. Handles both the
 * classic single-address lookup callback and Node's "all addresses"
 * (Happy-Eyeballs) callback shape — passing the wrong shape for the latter
 * throws deep inside `net.connect` rather than surfacing as a request error.
 */
export function pinnedLookup(resolvedIp: string): http.RequestOptions['lookup'] {
  const family = resolvedIp.includes(':') ? 6 : 4;
  return ((_hostname: string, lookupOpts: unknown, callback: (...args: unknown[]) => void) => {
    const wantsAll = typeof lookupOpts === 'object' && lookupOpts !== null && (lookupOpts as { all?: boolean }).all === true;
    if (wantsAll) callback(null, [{ address: resolvedIp, family }]);
    else callback(null, resolvedIp, family);
  }) as http.RequestOptions['lookup'];
}

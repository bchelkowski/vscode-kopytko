import * as vscode from 'vscode';
import * as os from 'os';
import * as crypto from 'crypto';
import { StoredDevice } from '../types';

const KEY_PREFIX = 'kopytko.devices.';
const KEYS = {
  cache: `${KEY_PREFIX}cache`,
  networks: `${KEY_PREFIX}networks`,
  favorites: `${KEY_PREFIX}favorites`,
  ipToSerial: `${KEY_PREFIX}ipToSerial`,
  activeDevice: `${KEY_PREFIX}activeDevice`,
} as const;

/** Max age (30 days in ms) before cleanup removes stale entries. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface NetworkEntry {
  serials: string[];
  lastSeen: number;
}

interface IpMapping {
  serial: string;
  timestamp: number;
}

/**
 * Persists Roku device data across sessions and workspaces
 * using the VS Code `globalState` Memento API.
 *
 * Data is namespaced under `kopytko.devices.*` keys and
 * scoped per-network where appropriate so that switching
 * between home / office shows only relevant devices.
 */
export class DeviceStore {
  constructor(private readonly globalState: vscode.Memento) {}

  // ── Network-scoped discovered devices ───────────────────────

  /** Returns the serial numbers last seen on a given network. */
  getLastSeenSerials(networkId: string): string[] {
    const networks = this.globalState.get<Record<string, NetworkEntry>>(KEYS.networks, {});
    return networks[networkId]?.serials ?? [];
  }

  /** Replaces the serial list for a network and updates its timestamp. */
  async setLastSeenSerials(networkId: string, serials: string[]): Promise<void> {
    const networks = this.globalState.get<Record<string, NetworkEntry>>(KEYS.networks, {});
    networks[networkId] = { serials, lastSeen: Date.now() };
    await this.globalState.update(KEYS.networks, networks);
  }

  // ── Device cache (cross-network) ───────────────────────────

  /** Retrieves a cached device by serial number. */
  getCachedDevice(serial: string): StoredDevice | undefined {
    const cache = this.globalState.get<Record<string, StoredDevice>>(KEYS.cache, {});
    return cache[serial];
  }

  /** Upserts a device into the cross-network cache. */
  async setCachedDevice(serial: string, device: StoredDevice): Promise<void> {
    const cache = this.globalState.get<Record<string, StoredDevice>>(KEYS.cache, {});
    cache[serial] = device;
    await this.globalState.update(KEYS.cache, cache);
  }

  /** Returns every cached device regardless of network. */
  getAllCachedDevices(): StoredDevice[] {
    const cache = this.globalState.get<Record<string, StoredDevice>>(KEYS.cache, {});
    return Object.values(cache);
  }

  // ── Favorite devices ───────────────────────────────────────

  /** Returns the serial numbers of all favorite devices. */
  getFavoriteSerials(): string[] {
    return this.globalState.get<string[]>(KEYS.favorites, []);
  }

  /** Adds or removes a device from favorites and syncs the flag in the cache. */
  async setFavorite(serial: string, isFavorite: boolean): Promise<void> {
    const favSet = new Set(this.getFavoriteSerials());

    if (isFavorite) {
      favSet.add(serial);
    } else {
      favSet.delete(serial);
    }

    await this.globalState.update(KEYS.favorites, [...favSet]);

    // Keep the cached device in sync
    const cached = this.getCachedDevice(serial);
    if (cached) {
      cached.isFavorite = isFavorite;
      await this.setCachedDevice(serial, cached);
    }
  }

  /** Checks whether a device is marked as favorite. */
  isFavorite(serial: string): boolean {
    return this.getFavoriteSerials().includes(serial);
  }

  // ── IP-to-serial mapping (per network) ─────────────────────

  /**
   * Looks up the serial number previously associated with an IP
   * on the given network. Useful for manual/configured devices
   * that only have an IP address.
   */
  getSerialForIp(networkId: string, ip: string): string | undefined {
    const map = this.globalState.get<Record<string, Record<string, IpMapping>>>(KEYS.ipToSerial, {});
    return map[networkId]?.[ip]?.serial;
  }

  /** Associates an IP address with a serial number on a specific network. */
  async setSerialForIp(networkId: string, ip: string, serial: string): Promise<void> {
    const map = this.globalState.get<Record<string, Record<string, IpMapping>>>(KEYS.ipToSerial, {});
    if (!map[networkId]) {
      map[networkId] = {};
    }
    map[networkId][ip] = { serial, timestamp: Date.now() };
    await this.globalState.update(KEYS.ipToSerial, map);
  }

  // ── Active device ──────────────────────────────────────────

  /** Returns the serial number of the currently selected device. */
  getActiveDeviceSerial(): string | undefined {
    return this.globalState.get<string>(KEYS.activeDevice);
  }

  /** Sets (or clears) the active device used for debug/deploy. */
  async setActiveDeviceSerial(serial: string | undefined): Promise<void> {
    await this.globalState.update(KEYS.activeDevice, serial);
  }

  // ── Cleanup ────────────────────────────────────────────────

  /**
   * Removes stale entries older than 30 days.
   * Should be called once on extension activation.
   */
  async cleanup(): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_MS;

    await Promise.all([
      this.cleanupCache(cutoff),
      this.cleanupNetworks(cutoff),
      this.cleanupIpMappings(cutoff),
    ]);
  }

  private async cleanupCache(cutoff: number): Promise<void> {
    const cache = this.globalState.get<Record<string, StoredDevice>>(KEYS.cache, {});
    const favorites = new Set(this.getFavoriteSerials());
    let changed = false;

    for (const [serial, device] of Object.entries(cache)) {
      if (device.lastSeen < cutoff && !favorites.has(serial)) {
        delete cache[serial];
        changed = true;
      }
    }

    if (changed) {
      await this.globalState.update(KEYS.cache, cache);
    }
  }

  private async cleanupNetworks(cutoff: number): Promise<void> {
    const networks = this.globalState.get<Record<string, NetworkEntry>>(KEYS.networks, {});
    let changed = false;

    for (const [id, entry] of Object.entries(networks)) {
      if (entry.lastSeen < cutoff) {
        delete networks[id];
        changed = true;
      }
    }

    if (changed) {
      await this.globalState.update(KEYS.networks, networks);
    }
  }

  private async cleanupIpMappings(cutoff: number): Promise<void> {
    const map = this.globalState.get<Record<string, Record<string, IpMapping>>>(KEYS.ipToSerial, {});
    let changed = false;

    for (const [networkId, mappings] of Object.entries(map)) {
      for (const [ip, entry] of Object.entries(mappings)) {
        if (entry.timestamp < cutoff) {
          delete mappings[ip];
          changed = true;
        }
      }
      if (Object.keys(mappings).length === 0) {
        delete map[networkId];
        changed = true;
      }
    }

    if (changed) {
      await this.globalState.update(KEYS.ipToSerial, map);
    }
  }

  // ── Network hash ───────────────────────────────────────────

  /**
   * Computes a deterministic hash of the host's non-internal
   * network interfaces. Filters out loopback, link-local
   * (169.254.x.x, fe80::), and produces an MD5 hex digest.
   *
   * The result changes when the machine moves between networks
   * (e.g. home → office), so discovered-device lists stay scoped.
   */
  static computeNetworkId(): string {
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
}

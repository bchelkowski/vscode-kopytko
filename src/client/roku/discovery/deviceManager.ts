import { EventEmitter } from 'events';
import { SsdpClient } from '../ssdp/ssdpClient';
import { EcpClient } from './ecpClient';
import { DeviceStore } from '../persistence/deviceStore';
import { CredentialStore } from '../persistence/credentialStore';
import { NetworkMonitor } from './networkMonitor';
import {
  RokuDevice,
  StoredDevice,
  DeviceState,
  DeviceSource,
  SsdpDeviceFound,
} from '../types';

const HEALTH_CHECK_TIMEOUT_MS = 3000;
const HEALTH_CHECK_CACHE_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 10_000;

interface DeviceManagerEvents {
  'devices-changed': [];
  'scan-started': [];
  'scan-ended': [];
}

/**
 * Central orchestrator for Roku device discovery.
 *
 * Coordinates SSDP discovery, ECP health checks, network monitoring,
 * and device persistence into a unified API. Maintains an in-memory
 * device map keyed by serial number, merging discovered, manual, and
 * cached devices.
 */
export class DeviceManager extends EventEmitter<DeviceManagerEvents> {
  private devices = new Map<string, RokuDevice>();
  private healthCheckTimes = new Map<string, number>();
  private networkId = '';
  private activeSerial: string | undefined;

  constructor(
    private readonly ssdp: SsdpClient,
    private readonly ecp: EcpClient,
    private readonly store: DeviceStore,
    private readonly credentials: CredentialStore,
    private readonly networkMonitor: NetworkMonitor,
  ) {
    super();
    this.wireEvents();
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /** Initialize the manager. Call once on extension activation. */
  async initialize(): Promise<void> {
    this.networkId = DeviceStore.computeNetworkId();

    this.loadCachedDevices();
    this.loadFavorites();
    this.activeSerial = this.store.getActiveDeviceSerial();

    this.networkMonitor.start();
    await this.ssdp.start();
    await this.ssdp.scan();
    this.store.cleanup();
  }

  /** Trigger an active SSDP scan. */
  async scan(): Promise<void> {
    await this.ssdp.scan();
  }

  /** Stop all subsystems and release resources. */
  dispose(): void {
    this.ssdp.stop();
    this.networkMonitor.stop();
    this.removeAllListeners();
  }

  // ── Device CRUD ───────────────────────────────────────────

  /**
   * Manually add a device by IP address.
   * Probes ECP for device info; throws if the IP doesn't respond.
   * The device is automatically marked as a favorite.
   */
  async addManualDevice(ip: string): Promise<RokuDevice> {
    const info = await this.ecp.queryDeviceInfo(ip, 8060, HEALTH_CHECK_TIMEOUT_MS);
    const serial = info['serial-number'];

    if (!serial) {
      throw new Error(`Device at ${ip} did not return a serial number`);
    }

    const device = this.toRokuDevice(info, serial, ip, 8060, 'online', 'manual');
    device.isFavorite = true;

    this.devices.set(serial, device);
    this.healthCheckTimes.set(serial, Date.now());

    await Promise.all([
      this.store.setFavorite(serial, true),
      this.persistDevice(device),
    ]);

    this.emit('devices-changed');

    return device;
  }

  /** Remove a device from the in-memory list. */
  removeDevice(serial: string): void {
    if (!this.devices.has(serial)) return;
    this.devices.delete(serial);
    this.healthCheckTimes.delete(serial);

    if (this.activeSerial === serial) {
      this.activeSerial = undefined;
      this.store.setActiveDeviceSerial(undefined);
    }

    this.emit('devices-changed');
  }

  /** Toggle favorite status for a device. */
  async setFavorite(serial: string, isFavorite: boolean): Promise<void> {
    const device = this.devices.get(serial);
    if (device) {
      device.isFavorite = isFavorite;
    }
    await this.store.setFavorite(serial, isFavorite);
    this.emit('devices-changed');
  }

  /** Set (or clear) the active device for debug/deploy. */
  async setActiveDevice(serial: string | undefined): Promise<void> {
    this.activeSerial = serial;
    await this.store.setActiveDeviceSerial(serial);
    this.emit('devices-changed');
  }

  // ── Queries ───────────────────────────────────────────────

  /** Returns the currently active device, if any. */
  getActiveDevice(): RokuDevice | undefined {
    return this.activeSerial ? this.devices.get(this.activeSerial) : undefined;
  }

  /**
   * Returns all devices sorted: favorites first, then online, then offline.
   * Within each group, alphabetical by friendlyName.
   */
  getDevices(): RokuDevice[] {
    const list = [...this.devices.values()];
    return list.sort((a, b) => {
      const groupA = this.sortGroup(a);
      const groupB = this.sortGroup(b);
      if (groupA !== groupB) return groupA - groupB;
      return a.friendlyName.localeCompare(b.friendlyName);
    });
  }

  /** Look up a single device by serial number. */
  getDevice(serial: string): RokuDevice | undefined {
    return this.devices.get(serial);
  }

  // ── Event wiring ──────────────────────────────────────────

  private wireEvents(): void {
    this.ssdp.on('found', (device: SsdpDeviceFound) => this.onSsdpFound(device));
    this.ssdp.on('lost', (ip: string) => this.onSsdpLost(ip));
    this.ssdp.on('scan-started', () => this.emit('scan-started'));
    this.ssdp.on('scan-ended', () => this.onScanEnded());

    this.networkMonitor.on('network-changed', (id: string) => this.onNetworkChanged(id));
    this.networkMonitor.on('wake', () => this.scan());
  }

  private onSsdpFound(found: SsdpDeviceFound): void {
    const existing = this.devices.get(found.serialNumber);

    if (existing) {
      // DHCP may have changed the IP — update and refresh health
      existing.ip = found.ip;
      existing.port = found.port;
      this.healthCheckDevice(found.serialNumber);
    } else {
      // New device — add in unknown state and trigger health check
      const device: RokuDevice = {
        ip: found.ip,
        port: found.port,
        serialNumber: found.serialNumber,
        friendlyName: `Roku (${found.ip})`,
        modelName: 'Unknown',
        modelNumber: '',
        softwareVersion: '',
        state: 'unknown',
        source: 'discovered',
        isFavorite: this.store.isFavorite(found.serialNumber),
        lastSeen: Date.now(),
      };
      this.devices.set(found.serialNumber, device);
      this.emit('devices-changed');
      this.healthCheckDevice(found.serialNumber);
    }
  }

  private onSsdpLost(ip: string): void {
    for (const [serial, device] of this.devices) {
      if (device.ip !== ip) continue;

      if (device.isFavorite || device.source === 'manual') {
        device.state = 'offline';
      } else {
        this.devices.delete(serial);
        this.healthCheckTimes.delete(serial);
      }

      this.emit('devices-changed');
      return;
    }
  }

  private onScanEnded(): void {
    this.emit('scan-ended');

    const now = Date.now();
    const serials: string[] = [];

    for (const [serial] of this.devices) {
      const lastCheck = this.healthCheckTimes.get(serial) ?? 0;
      if (now - lastCheck > STALE_THRESHOLD_MS) {
        serials.push(serial);
      }
    }

    if (serials.length > 0) {
      this.batchHealthCheck(serials);
    }
  }

  private async onNetworkChanged(newNetworkId: string): Promise<void> {
    // Remove all discovered (non-favorite) devices
    for (const [serial, device] of this.devices) {
      if (!device.isFavorite && device.source !== 'manual') {
        this.devices.delete(serial);
        this.healthCheckTimes.delete(serial);
      }
    }

    this.networkId = newNetworkId;
    this.loadCachedDevices();
    this.emit('devices-changed');

    await this.ssdp.restart();
    await this.ssdp.scan();
  }

  // ── Health checks ─────────────────────────────────────────

  /**
   * Run a health check against a single device.
   * Queries ECP device-info and updates the device record on success.
   * Skips if a recent check (< 5 min) is cached.
   */
  async healthCheckDevice(serial: string): Promise<void> {
    const device = this.devices.get(serial);
    if (!device) return;

    // Skip if recently checked
    const lastCheck = this.healthCheckTimes.get(serial) ?? 0;
    if (Date.now() - lastCheck < HEALTH_CHECK_CACHE_MS) return;

    device.state = 'pending';
    this.emit('devices-changed');

    try {
      const info = await this.ecp.queryDeviceInfo(
        device.ip, device.port, HEALTH_CHECK_TIMEOUT_MS,
      );

      const updated = this.toRokuDevice(
        info, serial, device.ip, device.port, 'online', device.source,
      );
      this.devices.set(serial, updated);
      this.healthCheckTimes.set(serial, Date.now());

      await this.persistDevice(updated);
    } catch {
      device.state = 'offline';
      this.healthCheckTimes.set(serial, Date.now());
    }

    this.emit('devices-changed');
  }

  /** Run health checks for multiple devices in parallel. */
  private async batchHealthCheck(serials: string[]): Promise<void> {
    await Promise.allSettled(
      serials.map((serial) => this.healthCheckDevice(serial)),
    );
  }

  // ── Persistence helpers ───────────────────────────────────

  private loadCachedDevices(): void {
    const serials = this.store.getLastSeenSerials(this.networkId);

    for (const serial of serials) {
      if (this.devices.has(serial)) continue;

      const cached = this.store.getCachedDevice(serial);
      if (!cached) continue;

      this.devices.set(serial, this.storedToRokuDevice(cached));
    }
  }

  private loadFavorites(): void {
    const favorites = this.store.getFavoriteSerials();

    for (const serial of favorites) {
      if (this.devices.has(serial)) {
        this.devices.get(serial)!.isFavorite = true;
        continue;
      }

      const cached = this.store.getCachedDevice(serial);
      if (!cached) continue;

      const device = this.storedToRokuDevice(cached);
      device.isFavorite = true;
      this.devices.set(serial, device);
    }
  }

  private async persistDevice(device: RokuDevice): Promise<void> {
    const stored: StoredDevice = {
      serialNumber: device.serialNumber,
      ip: device.ip,
      port: device.port,
      friendlyName: device.friendlyName,
      modelName: device.modelName,
      modelNumber: device.modelNumber,
      isFavorite: device.isFavorite,
      lastSeen: device.lastSeen,
      deviceInfo: device.deviceInfo,
    };

    const serials = new Set(this.store.getLastSeenSerials(this.networkId));
    serials.add(device.serialNumber);

    await Promise.all([
      this.store.setCachedDevice(device.serialNumber, stored),
      this.store.setLastSeenSerials(this.networkId, [...serials]),
      this.store.setSerialForIp(this.networkId, device.ip, device.serialNumber),
    ]);
  }

  // ── Conversion helpers ────────────────────────────────────

  /** Convert an ECP device-info record + metadata into a full RokuDevice. */
  private toRokuDevice(
    info: Record<string, string>,
    serial: string,
    ip: string,
    port: number,
    state: DeviceState,
    source: DeviceSource,
  ): RokuDevice {
    return {
      ip,
      port,
      serialNumber: serial,
      friendlyName: info['friendly-device-name'] || info['default-device-name'] || `Roku (${ip})`,
      modelName: info['model-name'] || 'Unknown',
      modelNumber: info['model-number'] || '',
      softwareVersion: info['software-version'] || '',
      state,
      source,
      isFavorite: this.store.isFavorite(serial),
      developerEnabled: info['developer-enabled'] === 'true',
      isTV: info['is-tv'] === 'true',
      lastSeen: Date.now(),
      deviceInfo: info,
    };
  }

  /** Convert a StoredDevice into an offline RokuDevice placeholder. */
  private storedToRokuDevice(stored: StoredDevice): RokuDevice {
    return {
      ip: stored.ip,
      port: stored.port,
      serialNumber: stored.serialNumber,
      friendlyName: stored.friendlyName,
      modelName: stored.modelName,
      modelNumber: stored.modelNumber,
      softwareVersion: '',
      state: 'offline',
      source: 'discovered',
      isFavorite: stored.isFavorite,
      lastSeen: stored.lastSeen,
      deviceInfo: stored.deviceInfo,
    };
  }

  /** Sort priority: 0 = favorite, 1 = online, 2 = everything else. */
  private sortGroup(device: RokuDevice): number {
    if (device.isFavorite) return 0;
    if (device.state === 'online') return 1;
    return 2;
  }
}

export default DeviceManager;

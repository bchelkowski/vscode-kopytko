import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import {
  DeviceManager,
  DeviceStorage,
  NetworkWatcher,
} from '../../src/discovery/deviceManager';
import { SsdpClient } from '../../src/ssdp/ssdpClient';
import { EcpClient } from '../../src/ecp/ecpClient';
import { SsdpDeviceFound, StoredDevice } from '../../src/types';

// ── Mock helpers ─────────────────────────────────────────────────────────────

/** Plain in-memory DeviceStorage implementation. */
class InMemoryDeviceStorage implements DeviceStorage {
  private lastSeen = new Map<string, string[]>();
  private cache = new Map<string, StoredDevice>();
  private favorites = new Set<string>();
  private active: string | undefined;
  private envs = new Map<string, string>();
  private ipMap = new Map<string, string>();

  getLastSeenSerials(networkId: string): string[] {
    return this.lastSeen.get(networkId) ?? [];
  }
  async setLastSeenSerials(networkId: string, serials: string[]): Promise<void> {
    this.lastSeen.set(networkId, serials);
  }
  getCachedDevice(serial: string): StoredDevice | undefined {
    return this.cache.get(serial);
  }
  async setCachedDevice(serial: string, device: StoredDevice): Promise<void> {
    this.cache.set(serial, device);
  }
  getFavoriteSerials(): string[] {
    return [...this.favorites];
  }
  async setFavorite(serial: string, isFavorite: boolean): Promise<void> {
    if (isFavorite) {
      this.favorites.add(serial);
    } else {
      this.favorites.delete(serial);
    }
    const cached = this.cache.get(serial);
    if (cached) cached.isFavorite = isFavorite;
  }
  isFavorite(serial: string): boolean {
    return this.favorites.has(serial);
  }
  getActiveDeviceSerial(): string | undefined {
    return this.active;
  }
  async setActiveDeviceSerial(serial: string | undefined): Promise<void> {
    this.active = serial;
  }
  getDeviceEnvironment(serial: string): string | undefined {
    return this.envs.get(serial);
  }
  async setDeviceEnvironment(serial: string, env: string): Promise<void> {
    this.envs.set(serial, env);
  }
  async setSerialForIp(networkId: string, ip: string, serial: string): Promise<void> {
    this.ipMap.set(`${networkId}|${ip}`, serial);
  }
  async cleanup(): Promise<void> {}
}

const TEST_OPTIONS = { networkIdProvider: () => 'test-network-id' };

function makeDeviceInfo(serial: string, name: string): Record<string, string> {
  return {
    'serial-number': serial,
    'device-id': `AA:BB:CC:DD:EE:${serial.slice(-2)}`,
    'vendor-name': 'Roku',
    'user-device-name': name,
    'friendly-device-name': name,
    'model-name': 'Roku Ultra',
    'model-number': '4800X',
    'software-version': '12.5.0',
    'software-build': '4200.45',
    'developer-enabled': 'true',
    'keyed-developer-id': `devid-${serial}`,
    'ecp-setting-mode': 'default',
    'ui-resolution': '1080p',
    'locale': 'en_US',
    'time-zone': 'United States/Eastern',
    'time-zone-offset': '-300',
    'is-tv': 'false',
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DeviceManager', () => {
  let ssdp: SsdpClient;
  let ecp: EcpClient;
  let deviceStore: InMemoryDeviceStorage;
  let networkMonitor: NetworkWatcher & EventEmitter;
  let manager: DeviceManager;

  beforeEach(() => {
    // Stub SsdpClient (EventEmitter)
    ssdp = new EventEmitter() as unknown as SsdpClient;
    (ssdp as unknown as Record<string, unknown>).start = sinon.stub().resolves();
    (ssdp as unknown as Record<string, unknown>).scan = sinon.stub().resolves();
    (ssdp as unknown as Record<string, unknown>).stop = sinon.stub();
    (ssdp as unknown as Record<string, unknown>).restart = sinon.stub().resolves();

    // Stub EcpClient
    ecp = {
      queryDeviceInfo: sinon.stub().resolves({}),
      checkDeviceAlive: sinon.stub().resolves(true),
      validatePassword: sinon.stub().resolves(true),
    } as unknown as EcpClient;

    deviceStore = new InMemoryDeviceStorage();

    // Stub NetworkWatcher (EventEmitter)
    networkMonitor = new EventEmitter() as unknown as NetworkWatcher & EventEmitter;
    (networkMonitor as unknown as Record<string, unknown>).start = sinon.stub();
    (networkMonitor as unknown as Record<string, unknown>).stop = sinon.stub();

    manager = new DeviceManager(ssdp, ecp, deviceStore, networkMonitor, undefined, TEST_OPTIONS);
  });

  afterEach(() => {
    manager.dispose();
    sinon.restore();
  });

  // ---------------------------------------------------------------------------
  // initialize
  // ---------------------------------------------------------------------------

  describe('initialize', () => {
    it('starts SSDP and network monitor', async () => {
      await manager.initialize();

      expect((ssdp.start as sinon.SinonStub).calledOnce).to.be.true;
      expect((ssdp.scan as sinon.SinonStub).calledOnce).to.be.true;
      expect((networkMonitor.start as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('loads cached devices for current network', async () => {
      // Pre-populate store
      await deviceStore.setLastSeenSerials('test-network-id', ['SN001']);
      await deviceStore.setCachedDevice('SN001', {
        serialNumber: 'SN001',
        ip: '192.168.1.10',
        port: 8060,
        friendlyName: 'Cached Device',
        modelName: 'Roku Ultra',
        modelNumber: '4800X',
        isFavorite: false,
        lastSeen: Date.now(),
      });

      await manager.initialize();

      const devices = manager.getDevices();
      expect(devices).to.have.length(1);
      expect(devices[0].serialNumber).to.equal('SN001');
      expect(devices[0].friendlyName).to.equal('Cached Device');
      expect(devices[0].state).to.equal('offline');
    });

    it('loads favorites and marks them in device map', async () => {
      await deviceStore.setCachedDevice('SN001', {
        serialNumber: 'SN001',
        ip: '192.168.1.10',
        port: 8060,
        friendlyName: 'Favorite Device',
        modelName: 'Roku Ultra',
        modelNumber: '4800X',
        isFavorite: true,
        lastSeen: Date.now(),
      });
      await deviceStore.setFavorite('SN001', true);

      await manager.initialize();

      const devices = manager.getDevices();
      const fav = devices.find((d) => d.serialNumber === 'SN001');
      expect(fav).to.not.be.undefined;
      expect(fav!.isFavorite).to.be.true;
    });

    it('restores active device serial from store', async () => {
      await deviceStore.setActiveDeviceSerial('SN001');
      await deviceStore.setLastSeenSerials('test-network-id', ['SN001']);
      await deviceStore.setCachedDevice('SN001', {
        serialNumber: 'SN001',
        ip: '192.168.1.10',
        port: 8060,
        friendlyName: 'Active Device',
        modelName: 'Roku Ultra',
        modelNumber: '4800X',
        isFavorite: false,
        lastSeen: Date.now(),
      });

      await manager.initialize();

      const active = manager.getActiveDevice();
      expect(active).to.not.be.undefined;
      expect(active!.serialNumber).to.equal('SN001');
    });
  });

  // ---------------------------------------------------------------------------
  // SSDP found event
  // ---------------------------------------------------------------------------

  describe('SSDP found event', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('adds a new device to the list', () => {
      const found: SsdpDeviceFound = { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' };
      ssdp.emit('found', found);

      const device = manager.getDevice('SN100');
      expect(device).to.not.be.undefined;
      expect(device!.ip).to.equal('192.168.1.20');
      expect(device!.source).to.equal('discovered');
    });

    it('emits devices-changed when new device found', () => {
      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      expect(changeSpy.called).to.be.true;
    });

    it('updates IP for existing device without duplicating', () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });
      ssdp.emit('found', { ip: '192.168.1.30', port: 8060, serialNumber: 'SN100' });

      const devices = manager.getDevices().filter((d) => d.serialNumber === 'SN100');
      expect(devices).to.have.length(1);
      expect(devices[0].ip).to.equal('192.168.1.30');
    });

    it('triggers health check for new device', () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves(makeDeviceInfo('SN100', 'New Roku'));

      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      // health check is async — queryDeviceInfo should be called
      expect((ecp.queryDeviceInfo as sinon.SinonStub).called).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // SSDP lost event
  // ---------------------------------------------------------------------------

  describe('SSDP lost event', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('removes non-favorite discovered device', () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });
      expect(manager.getDevice('SN100')).to.not.be.undefined;

      ssdp.emit('lost', '192.168.1.20');

      expect(manager.getDevice('SN100')).to.be.undefined;
    });

    it('marks favorite device as offline instead of removing', async () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });
      await manager.setFavorite('SN100', true);

      ssdp.emit('lost', '192.168.1.20');

      const device = manager.getDevice('SN100');
      expect(device).to.not.be.undefined;
      expect(device!.state).to.equal('offline');
    });

    it('emits devices-changed on lost event', () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      ssdp.emit('lost', '192.168.1.20');

      expect(changeSpy.called).to.be.true;
    });

    it('does not emit when lost IP matches no device', () => {
      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      ssdp.emit('lost', '10.0.0.1');

      expect(changeSpy.called).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  describe('health check', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('updates device to online with info on success', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves(makeDeviceInfo('SN100', 'Living Room'));

      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      // Wait for the async health check triggered by onSsdpFound
      await new Promise((r) => setTimeout(r, 10));

      const device = manager.getDevice('SN100');
      expect(device!.state).to.equal('online');
      expect(device!.friendlyName).to.equal('Living Room');
      expect(device!.modelName).to.equal('Roku Ultra');
    });

    it('marks device as offline on check failure', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).rejects(new Error('ECONNREFUSED'));

      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      // Wait for the async health check triggered by onSsdpFound
      await new Promise((r) => setTimeout(r, 10));

      const device = manager.getDevice('SN100');
      expect(device!.state).to.equal('offline');
    });

    it('does nothing for unknown serial', async () => {
      await manager.healthCheckDevice('NONEXISTENT');
      // Should not throw
    });

    it('emits devices-changed after health check', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves(makeDeviceInfo('SN100', 'Roku'));

      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      // Wait for the async health check triggered by onSsdpFound
      await new Promise((r) => setTimeout(r, 10));

      expect(changeSpy.called).to.be.true;
    });

    it('populates deviceId from ECP device-id field', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves(makeDeviceInfo('SN100', 'Living Room'));

      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      await new Promise((r) => setTimeout(r, 10));

      const device = manager.getDevice('SN100');
      expect(device!.deviceId).to.equal('AA:BB:CC:DD:EE:00');
    });

    it('prefers user-device-name over friendly-device-name for friendlyName', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves({
        ...makeDeviceInfo('SN100', 'Friendly Name'),
        'user-device-name': 'My Living Room TV',
      });

      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      await new Promise((r) => setTimeout(r, 10));

      const device = manager.getDevice('SN100');
      expect(device!.friendlyName).to.equal('My Living Room TV');
    });
  });

  // ---------------------------------------------------------------------------
  // addManualDevice
  // ---------------------------------------------------------------------------

  describe('addManualDevice', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('probes ECP and adds device as favorite', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves(makeDeviceInfo('SN200', 'Manual Roku'));

      const device = await manager.addManualDevice('10.0.0.5');

      expect(device.serialNumber).to.equal('SN200');
      expect(device.deviceId).to.equal('AA:BB:CC:DD:EE:00');
      expect(device.friendlyName).to.equal('Manual Roku');
      expect(device.source).to.equal('manual');
      expect(device.state).to.equal('online');
      expect(device.isFavorite).to.be.true;

      expect(manager.getDevice('SN200')).to.not.be.undefined;
    });

    it('persists the manual device to store', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves(makeDeviceInfo('SN200', 'Manual Roku'));

      await manager.addManualDevice('10.0.0.5');

      expect(deviceStore.isFavorite('SN200')).to.be.true;
      expect(deviceStore.getCachedDevice('SN200')).to.not.be.undefined;
    });

    it('emits devices-changed', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves(makeDeviceInfo('SN200', 'Manual Roku'));

      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      await manager.addManualDevice('10.0.0.5');

      expect(changeSpy.called).to.be.true;
    });

    it('throws if ECP fails', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).rejects(new Error('EHOSTUNREACH'));

      try {
        await manager.addManualDevice('10.0.0.5');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('EHOSTUNREACH');
      }
    });

    it('throws if device returns no serial number', async () => {
      (ecp.queryDeviceInfo as sinon.SinonStub).resolves({
        'friendly-device-name': 'No Serial',
        'model-name': 'Unknown',
      });

      try {
        await manager.addManualDevice('10.0.0.5');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('serial number');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // setFavorite
  // ---------------------------------------------------------------------------

  describe('setFavorite', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('toggles favorite on a device', async () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      await manager.setFavorite('SN100', true);
      expect(manager.getDevice('SN100')!.isFavorite).to.be.true;

      await manager.setFavorite('SN100', false);
      expect(manager.getDevice('SN100')!.isFavorite).to.be.false;
    });

    it('persists favorite to store', async () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      await manager.setFavorite('SN100', true);
      expect(deviceStore.isFavorite('SN100')).to.be.true;
    });

    it('emits devices-changed', async () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      await manager.setFavorite('SN100', true);
      expect(changeSpy.called).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // setActiveDevice
  // ---------------------------------------------------------------------------

  describe('setActiveDevice', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('sets the active device', async () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      await manager.setActiveDevice('SN100');

      expect(manager.getActiveDevice()?.serialNumber).to.equal('SN100');
    });

    it('persists active selection to store', async () => {
      await manager.setActiveDevice('SN100');

      expect(deviceStore.getActiveDeviceSerial()).to.equal('SN100');
    });

    it('clears active device with undefined', async () => {
      await manager.setActiveDevice('SN100');
      await manager.setActiveDevice(undefined);

      expect(manager.getActiveDevice()).to.be.undefined;
    });

    it('emits devices-changed', async () => {
      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      await manager.setActiveDevice('SN100');
      expect(changeSpy.called).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // getDevices sorting
  // ---------------------------------------------------------------------------

  describe('getDevices sorting', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('sorts favorites first, then online, then offline', async () => {
      // Set up stubs for sequential health checks
      (ecp.queryDeviceInfo as sinon.SinonStub)
        .withArgs('192.168.1.10', sinon.match.any, sinon.match.any)
        .resolves(makeDeviceInfo('SN_ONLINE', 'B Online'))
        .withArgs('192.168.1.20', sinon.match.any, sinon.match.any)
        .resolves(makeDeviceInfo('SN_FAV', 'A Favorite'))
        .withArgs('192.168.1.30', sinon.match.any, sinon.match.any)
        .rejects(new Error('offline'));

      ssdp.emit('found', { ip: '192.168.1.10', port: 8060, serialNumber: 'SN_ONLINE' });
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN_FAV' });
      ssdp.emit('found', { ip: '192.168.1.30', port: 8060, serialNumber: 'SN_OFFLINE' });

      // Wait for health checks
      await new Promise((r) => setTimeout(r, 50));

      await manager.setFavorite('SN_FAV', true);

      const devices = manager.getDevices();

      // Favorite first
      expect(devices[0].serialNumber).to.equal('SN_FAV');
      // Online second
      expect(devices[1].serialNumber).to.equal('SN_ONLINE');
      // Offline last
      expect(devices[2].serialNumber).to.equal('SN_OFFLINE');
    });
  });

  // ---------------------------------------------------------------------------
  // Network change
  // ---------------------------------------------------------------------------

  describe('network change', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('removes discovered non-favorite devices on network change', () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });
      expect(manager.getDevice('SN100')).to.not.be.undefined;

      networkMonitor.emit('network-changed', 'new-network-id');

      expect(manager.getDevice('SN100')).to.be.undefined;
    });

    it('preserves favorite devices on network change', async () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });
      await manager.setFavorite('SN100', true);

      networkMonitor.emit('network-changed', 'new-network-id');

      expect(manager.getDevice('SN100')).to.not.be.undefined;
    });

    it('restarts SSDP and re-scans after network change', () => {
      networkMonitor.emit('network-changed', 'new-network-id');

      expect((ssdp.restart as sinon.SinonStub).called).to.be.true;
    });

    it('emits devices-changed on network change', () => {
      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      networkMonitor.emit('network-changed', 'new-network-id');

      expect(changeSpy.called).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // removeDevice
  // ---------------------------------------------------------------------------

  describe('removeDevice', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('removes a device from the map', () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });
      expect(manager.getDevice('SN100')).to.not.be.undefined;

      manager.removeDevice('SN100');

      expect(manager.getDevice('SN100')).to.be.undefined;
    });

    it('clears active device if removed device was active', async () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });
      await manager.setActiveDevice('SN100');

      manager.removeDevice('SN100');

      expect(manager.getActiveDevice()).to.be.undefined;
    });

    it('does not clear active if different device removed', async () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });
      ssdp.emit('found', { ip: '192.168.1.30', port: 8060, serialNumber: 'SN200' });
      await manager.setActiveDevice('SN100');

      manager.removeDevice('SN200');

      expect(manager.getActiveDevice()?.serialNumber).to.equal('SN100');
    });

    it('emits devices-changed', () => {
      ssdp.emit('found', { ip: '192.168.1.20', port: 8060, serialNumber: 'SN100' });

      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      manager.removeDevice('SN100');

      expect(changeSpy.called).to.be.true;
    });

    it('does nothing for unknown serial', () => {
      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      manager.removeDevice('NONEXISTENT');

      expect(changeSpy.called).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------

  describe('dispose', () => {
    it('stops SSDP and network monitor', async () => {
      await manager.initialize();
      manager.dispose();

      expect((ssdp.stop as sinon.SinonStub).called).to.be.true;
      expect((networkMonitor.stop as sinon.SinonStub).called).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // SSDP error handling
  // ---------------------------------------------------------------------------

  describe('SSDP error handling', () => {
    it('does not crash when SSDP emits an error event', async () => {
      await manager.initialize();

      // Should not throw — error is caught by the error handler
      expect(() => {
        (ssdp as unknown as EventEmitter).emit('error', new Error('UDP socket error'));
      }).to.not.throw();
    });

    it('logs SSDP errors to the output channel', async () => {
      const logged: string[] = [];
      const channel = { appendLine: (msg: string) => logged.push(msg) };
      const loggedManager = new DeviceManager(ssdp, ecp, deviceStore, networkMonitor, channel, TEST_OPTIONS);

      await loggedManager.initialize();
      (ssdp as unknown as EventEmitter).emit('error', new Error('bind failed'));

      expect(logged.some(msg => msg.includes('SSDP error: bind failed'))).to.be.true;

      loggedManager.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // output channel logging
  // ---------------------------------------------------------------------------

  describe('output channel logging', () => {
    it('logs discovery events when output channel is provided', async () => {
      const logged: string[] = [];
      const channel = { appendLine: (msg: string) => logged.push(msg) };
      const loggedManager = new DeviceManager(ssdp, ecp, deviceStore, networkMonitor, channel, TEST_OPTIONS);

      await loggedManager.initialize();

      expect(logged.some(msg => msg.includes('Initializing device manager'))).to.be.true;
      expect(logged.some(msg => msg.includes('SSDP listening'))).to.be.true;

      loggedManager.dispose();
    });

    it('logs when a new device is found via SSDP', async () => {
      const logged: string[] = [];
      const channel = { appendLine: (msg: string) => logged.push(msg) };
      const loggedManager = new DeviceManager(ssdp, ecp, deviceStore, networkMonitor, channel, TEST_OPTIONS);

      (ecp.queryDeviceInfo as sinon.SinonStub).resolves(makeDeviceInfo('SN002', 'Test Device'));

      await loggedManager.initialize();
      (ssdp as unknown as EventEmitter).emit('found', {
        ip: '192.168.1.20',
        port: 8060,
        serialNumber: 'SN002',
      } as SsdpDeviceFound);

      expect(logged.some(msg => msg.includes('new device found') && msg.includes('SN002'))).to.be.true;

      loggedManager.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Device environment
  // ---------------------------------------------------------------------------

  describe('device environment', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('returns undefined when no environment is set', () => {
      expect(manager.getDeviceEnvironment('SN001')).to.be.undefined;
    });

    it('sets and retrieves an environment', async () => {
      await manager.setDeviceEnvironment('SN001', 'staging');
      expect(manager.getDeviceEnvironment('SN001')).to.equal('staging');
    });

    it('emits devices-changed when environment is set', async () => {
      const changeSpy = sinon.spy();
      manager.on('devices-changed', changeSpy);

      await manager.setDeviceEnvironment('SN001', 'dev');
      expect(changeSpy.called).to.be.true;
    });

    describe('getEffectiveEnvironment', () => {
      it('returns stored env when set', async () => {
        await manager.setDeviceEnvironment('SN001', 'production');

        const env = manager.getEffectiveEnvironment('SN001', ['dev', 'staging', 'production']);
        expect(env).to.equal('production');
      });

      it('returns first available env when no stored env', () => {
        const env = manager.getEffectiveEnvironment('SN001', ['dev', 'staging']);
        expect(env).to.equal('dev');
      });

      it('returns undefined when no stored env and no available envs', () => {
        const env = manager.getEffectiveEnvironment('SN001', []);
        expect(env).to.be.undefined;
      });
    });
  });
});

import '../vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { DeviceStore } from '../../../src/client/roku/persistence/deviceStore';
import { StoredDevice } from '../../../src/client/roku/types';

interface MockMemento {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

function createMockMemento(): MockMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) as T : defaultValue) as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  };
}

function makeStoredDevice(overrides: Partial<StoredDevice> = {}): StoredDevice {
  return {
    serialNumber: 'SN001',
    ip: '192.168.1.100',
    port: 8060,
    friendlyName: 'Living Room Roku',
    modelName: 'Roku Ultra',
    modelNumber: '4800X',
    isFavorite: false,
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe('DeviceStore', () => {
  let memento: MockMemento;
  let deviceStore: DeviceStore;

  beforeEach(() => {
    memento = createMockMemento();
    deviceStore = new DeviceStore(memento as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  // ---------------------------------------------------------------------------
  // Network-scoped serials
  // ---------------------------------------------------------------------------

  describe('network-scoped serials', () => {
    it('returns empty array for unknown network', () => {
      const serials = deviceStore.getLastSeenSerials('unknown-network');
      expect(serials).to.deep.equal([]);
    });

    it('stores and retrieves serials for a network', async () => {
      await deviceStore.setLastSeenSerials('net-1', ['SN001', 'SN002']);

      const serials = deviceStore.getLastSeenSerials('net-1');
      expect(serials).to.deep.equal(['SN001', 'SN002']);
    });

    it('isolates serials between different networks', async () => {
      await deviceStore.setLastSeenSerials('home', ['SN001']);
      await deviceStore.setLastSeenSerials('office', ['SN002', 'SN003']);

      expect(deviceStore.getLastSeenSerials('home')).to.deep.equal(['SN001']);
      expect(deviceStore.getLastSeenSerials('office')).to.deep.equal(['SN002', 'SN003']);
    });

    it('replaces serials on update', async () => {
      await deviceStore.setLastSeenSerials('net-1', ['SN001']);
      await deviceStore.setLastSeenSerials('net-1', ['SN002', 'SN003']);

      expect(deviceStore.getLastSeenSerials('net-1')).to.deep.equal(['SN002', 'SN003']);
    });
  });

  // ---------------------------------------------------------------------------
  // Device cache
  // ---------------------------------------------------------------------------

  describe('device cache', () => {
    it('returns undefined for unknown serial', () => {
      expect(deviceStore.getCachedDevice('UNKNOWN')).to.be.undefined;
    });

    it('stores and retrieves a device', async () => {
      const device = makeStoredDevice();
      await deviceStore.setCachedDevice('SN001', device);

      const cached = deviceStore.getCachedDevice('SN001');
      expect(cached).to.deep.equal(device);
    });

    it('overwrites existing device on update', async () => {
      await deviceStore.setCachedDevice('SN001', makeStoredDevice({ friendlyName: 'Old Name' }));
      await deviceStore.setCachedDevice('SN001', makeStoredDevice({ friendlyName: 'New Name' }));

      const cached = deviceStore.getCachedDevice('SN001');
      expect(cached!.friendlyName).to.equal('New Name');
    });

    it('getAllCachedDevices returns all devices', async () => {
      await deviceStore.setCachedDevice('SN001', makeStoredDevice({ serialNumber: 'SN001' }));
      await deviceStore.setCachedDevice('SN002', makeStoredDevice({ serialNumber: 'SN002', friendlyName: 'Bedroom Roku' }));

      const all = deviceStore.getAllCachedDevices();
      expect(all).to.have.length(2);

      const serials = all.map((d) => d.serialNumber);
      expect(serials).to.include.members(['SN001', 'SN002']);
    });

    it('getAllCachedDevices returns empty array when cache is empty', () => {
      expect(deviceStore.getAllCachedDevices()).to.deep.equal([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Favorites
  // ---------------------------------------------------------------------------

  describe('favorites', () => {
    it('returns empty array when no favorites set', () => {
      expect(deviceStore.getFavoriteSerials()).to.deep.equal([]);
    });

    it('adds a device to favorites', async () => {
      await deviceStore.setFavorite('SN001', true);

      expect(deviceStore.getFavoriteSerials()).to.include('SN001');
      expect(deviceStore.isFavorite('SN001')).to.be.true;
    });

    it('removes a device from favorites', async () => {
      await deviceStore.setFavorite('SN001', true);
      await deviceStore.setFavorite('SN001', false);

      expect(deviceStore.getFavoriteSerials()).to.not.include('SN001');
      expect(deviceStore.isFavorite('SN001')).to.be.false;
    });

    it('isFavorite returns false for unknown serial', () => {
      expect(deviceStore.isFavorite('UNKNOWN')).to.be.false;
    });

    it('syncs favorite flag with cached device', async () => {
      const device = makeStoredDevice({ isFavorite: false });
      await deviceStore.setCachedDevice('SN001', device);
      await deviceStore.setFavorite('SN001', true);

      const cached = deviceStore.getCachedDevice('SN001');
      expect(cached!.isFavorite).to.be.true;
    });

    it('syncs unfavorite with cached device', async () => {
      const device = makeStoredDevice({ isFavorite: true });
      await deviceStore.setCachedDevice('SN001', device);
      await deviceStore.setFavorite('SN001', false);

      const cached = deviceStore.getCachedDevice('SN001');
      expect(cached!.isFavorite).to.be.false;
    });

    it('handles setFavorite for device not in cache', async () => {
      await deviceStore.setFavorite('SN999', true);

      expect(deviceStore.isFavorite('SN999')).to.be.true;
      expect(deviceStore.getCachedDevice('SN999')).to.be.undefined;
    });

    it('does not duplicate serials in favorites', async () => {
      await deviceStore.setFavorite('SN001', true);
      await deviceStore.setFavorite('SN001', true);

      const favorites = deviceStore.getFavoriteSerials();
      expect(favorites.filter((s) => s === 'SN001')).to.have.length(1);
    });
  });

  // ---------------------------------------------------------------------------
  // IP-to-serial mapping
  // ---------------------------------------------------------------------------

  describe('IP-to-serial mapping', () => {
    it('returns undefined for unmapped IP', () => {
      expect(deviceStore.getSerialForIp('net-1', '10.0.0.1')).to.be.undefined;
    });

    it('maps an IP to a serial on a given network', async () => {
      await deviceStore.setSerialForIp('net-1', '192.168.1.100', 'SN001');

      expect(deviceStore.getSerialForIp('net-1', '192.168.1.100')).to.equal('SN001');
    });

    it('isolates mappings per network', async () => {
      await deviceStore.setSerialForIp('home', '192.168.1.100', 'SN001');
      await deviceStore.setSerialForIp('office', '10.0.0.100', 'SN002');

      expect(deviceStore.getSerialForIp('home', '192.168.1.100')).to.equal('SN001');
      expect(deviceStore.getSerialForIp('office', '10.0.0.100')).to.equal('SN002');
      expect(deviceStore.getSerialForIp('home', '10.0.0.100')).to.be.undefined;
    });

    it('overwrites mapping for same IP on same network', async () => {
      await deviceStore.setSerialForIp('net-1', '192.168.1.100', 'SN001');
      await deviceStore.setSerialForIp('net-1', '192.168.1.100', 'SN002');

      expect(deviceStore.getSerialForIp('net-1', '192.168.1.100')).to.equal('SN002');
    });
  });

  // ---------------------------------------------------------------------------
  // Active device
  // ---------------------------------------------------------------------------

  describe('active device', () => {
    it('returns undefined when no active device set', () => {
      expect(deviceStore.getActiveDeviceSerial()).to.be.undefined;
    });

    it('sets and retrieves the active device', async () => {
      await deviceStore.setActiveDeviceSerial('SN001');
      expect(deviceStore.getActiveDeviceSerial()).to.equal('SN001');
    });

    it('clears the active device with undefined', async () => {
      await deviceStore.setActiveDeviceSerial('SN001');
      await deviceStore.setActiveDeviceSerial(undefined);
      expect(deviceStore.getActiveDeviceSerial()).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // Device environment
  // ---------------------------------------------------------------------------

  describe('device environment', () => {
    it('returns undefined for device with no environment set', () => {
      expect(deviceStore.getDeviceEnvironment('SN001')).to.be.undefined;
    });

    it('sets and retrieves an environment', async () => {
      await deviceStore.setDeviceEnvironment('SN001', 'staging');
      expect(deviceStore.getDeviceEnvironment('SN001')).to.equal('staging');
    });

    it('overwrites existing environment', async () => {
      await deviceStore.setDeviceEnvironment('SN001', 'dev');
      await deviceStore.setDeviceEnvironment('SN001', 'production');
      expect(deviceStore.getDeviceEnvironment('SN001')).to.equal('production');
    });

    it('clears an environment', async () => {
      await deviceStore.setDeviceEnvironment('SN001', 'staging');
      await deviceStore.clearDeviceEnvironment('SN001');
      expect(deviceStore.getDeviceEnvironment('SN001')).to.be.undefined;
    });

    it('isolates environments between devices', async () => {
      await deviceStore.setDeviceEnvironment('SN001', 'dev');
      await deviceStore.setDeviceEnvironment('SN002', 'production');

      expect(deviceStore.getDeviceEnvironment('SN001')).to.equal('dev');
      expect(deviceStore.getDeviceEnvironment('SN002')).to.equal('production');
    });
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  describe('cleanup', () => {
    it('removes cache entries older than 30 days', async () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;

      await deviceStore.setCachedDevice('SN001', makeStoredDevice({
        serialNumber: 'SN001',
        lastSeen: thirtyOneDaysAgo,
      }));
      await deviceStore.setCachedDevice('SN002', makeStoredDevice({
        serialNumber: 'SN002',
        lastSeen: Date.now(),
      }));

      await deviceStore.cleanup();

      expect(deviceStore.getCachedDevice('SN001')).to.be.undefined;
      expect(deviceStore.getCachedDevice('SN002')).to.not.be.undefined;
    });

    it('preserves old devices that are favorites', async () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;

      await deviceStore.setCachedDevice('SN001', makeStoredDevice({
        serialNumber: 'SN001',
        lastSeen: thirtyOneDaysAgo,
      }));
      await deviceStore.setFavorite('SN001', true);

      await deviceStore.cleanup();

      expect(deviceStore.getCachedDevice('SN001')).to.not.be.undefined;
    });

    it('removes stale network entries', async () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;

      // Manually set a network entry with old timestamp
      await memento.update('kopytko.devices.networks', {
        'old-net': { serials: ['SN001'], lastSeen: thirtyOneDaysAgo },
        'new-net': { serials: ['SN002'], lastSeen: Date.now() },
      });

      await deviceStore.cleanup();

      expect(deviceStore.getLastSeenSerials('old-net')).to.deep.equal([]);
      expect(deviceStore.getLastSeenSerials('new-net')).to.deep.equal(['SN002']);
    });

    it('removes stale IP mappings', async () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;

      await memento.update('kopytko.devices.ipToSerial', {
        'net-1': {
          '192.168.1.100': { serial: 'SN001', timestamp: thirtyOneDaysAgo },
          '192.168.1.200': { serial: 'SN002', timestamp: Date.now() },
        },
      });

      await deviceStore.cleanup();

      expect(deviceStore.getSerialForIp('net-1', '192.168.1.100')).to.be.undefined;
      expect(deviceStore.getSerialForIp('net-1', '192.168.1.200')).to.equal('SN002');
    });

    it('removes empty network entries from IP mapping', async () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;

      await memento.update('kopytko.devices.ipToSerial', {
        'empty-net': {
          '10.0.0.1': { serial: 'SN001', timestamp: thirtyOneDaysAgo },
        },
      });

      await deviceStore.cleanup();

      expect(deviceStore.getSerialForIp('empty-net', '10.0.0.1')).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // computeNetworkId
  // ---------------------------------------------------------------------------

  describe('computeNetworkId', () => {
    it('returns a string', () => {
      const id = DeviceStore.computeNetworkId();
      expect(id).to.be.a('string');
      expect(id.length).to.be.greaterThan(0);
    });

    it('is deterministic (same result on repeated calls)', () => {
      const id1 = DeviceStore.computeNetworkId();
      const id2 = DeviceStore.computeNetworkId();
      expect(id1).to.equal(id2);
    });
  });
});

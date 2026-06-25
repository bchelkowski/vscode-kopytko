import '../vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { RendezvousManager } from '../../../src/client/roku/rendezvous/rendezvousManager';

// ── Mock helpers ─────────────────────────────────────────────────────────────

function createMockMemento() {
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

function createMockDeviceManager(activeDevice?: { serialNumber: string; ip: string; port: number }) {
  const emitter = new EventEmitter();
  let _active = activeDevice;
  const _registry = new Map<string, typeof activeDevice>();
  if (activeDevice) _registry.set(activeDevice.serialNumber, activeDevice);

  return {
    getActiveDevice: () => _active,
    getDevice: (serial: string) => _registry.get(serial),
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    emit: emitter.emit.bind(emitter),
    setActive: (device: typeof activeDevice) => {
      if (device) _registry.set(device.serialNumber, device);
      _active = device;
      emitter.emit('devices-changed');
    },
  };
}

function createMockEcp() {
  return {
    enableRendezvousTracking: sinon.stub().resolves(true),
    disableRendezvousTracking: sinon.stub().resolves(true),
    queryRendezvousEvents: sinon.stub().resolves({ events: [], dropCount: 0 }),
  };
}

const DEVICE_A = { serialNumber: 'SERIALA', ip: '192.168.1.10', port: 8060 };
const DEVICE_B = { serialNumber: 'SERIALB', ip: '192.168.1.11', port: 8060 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RendezvousManager', () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  // ── setEnabled ──────────────────────────────────────────────────────────────

  describe('setEnabled(true)', () => {
    it('calls enableRendezvousTracking on the active device', async () => {
      const ecp = createMockEcp();
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);

      expect(ecp.enableRendezvousTracking.calledOnceWith(DEVICE_A.ip, DEVICE_A.port)).to.be.true;
      expect(mgr.isEnabled).to.be.true;
      mgr.dispose();
    });

    it('does nothing when no active device', async () => {
      const ecp = createMockEcp();
      const dm = createMockDeviceManager(undefined);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);

      expect(ecp.enableRendezvousTracking.called).to.be.false;
      expect(mgr.isEnabled).to.be.false;
      mgr.dispose();
    });

    it('stays disabled and does not start polling when ECP call fails', async () => {
      const ecp = createMockEcp();
      ecp.enableRendezvousTracking.resolves(false);
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);

      expect(mgr.isEnabled).to.be.false;
      clock.tick(2000);
      expect(ecp.queryRendezvousEvents.called).to.be.false;
      mgr.dispose();
    });

    it('persists enabled state for the active device serial', async () => {
      const ecp = createMockEcp();
      const dm = createMockDeviceManager(DEVICE_A);
      const memento = createMockMemento();
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', memento as any);

      await mgr.setEnabled(true);

      const stored = memento.get<Record<string, boolean>>('kopytko.rendezvousEnabled');
      expect(stored?.[DEVICE_A.serialNumber]).to.be.true;
      mgr.dispose();
    });
  });

  describe('setEnabled(false)', () => {
    it('calls disableRendezvousTracking, clears groups, stops polling', async () => {
      const ecp = createMockEcp();
      ecp.queryRendezvousEvents.resolves({
        events: [{ id: '1', startTimeMs: 100, endTimeMs: 115, line: 42, file: 'pkg:/Foo.brs' }],
        dropCount: 0,
      });
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);
      await clock.tickAsync(1100);

      expect(mgr.getGroups().length).to.equal(1);

      await mgr.setEnabled(false);

      expect(ecp.disableRendezvousTracking.calledWith(DEVICE_A.ip, DEVICE_A.port)).to.be.true;
      expect(mgr.isEnabled).to.be.false;
      expect(mgr.getGroups().length).to.equal(0);

      // No more polling after disable
      const queryCalls = ecp.queryRendezvousEvents.callCount;
      await clock.tickAsync(2000);
      expect(ecp.queryRendezvousEvents.callCount).to.equal(queryCalls);
      mgr.dispose();
    });

    it('persists disabled state', async () => {
      const ecp = createMockEcp();
      const dm = createMockDeviceManager(DEVICE_A);
      const memento = createMockMemento();
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', memento as any);

      await mgr.setEnabled(true);
      await mgr.setEnabled(false);

      const stored = memento.get<Record<string, boolean>>('kopytko.rendezvousEnabled');
      expect(stored?.[DEVICE_A.serialNumber]).to.be.false;
      mgr.dispose();
    });
  });

  // ── polling and event grouping ───────────────────────────────────────────────

  describe('polling', () => {
    it('accumulates events into groups keyed by file:line', async () => {
      const ecp = createMockEcp();
      ecp.queryRendezvousEvents
        .onFirstCall().resolves({
          events: [{ id: '1', startTimeMs: 100, endTimeMs: 115, line: 42, file: 'pkg:/Foo.brs' }],
          dropCount: 0,
        })
        .onSecondCall().resolves({
          events: [
            { id: '2', startTimeMs: 200, endTimeMs: 208, line: 42, file: 'pkg:/Foo.brs' },
            { id: '3', startTimeMs: 210, endTimeMs: 215, line: 88, file: 'pkg:/Bar.brs' },
          ],
          dropCount: 0,
        })
        .resolves({ events: [], dropCount: 0 });
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);
      await clock.tickAsync(1100);   // first poll
      await clock.tickAsync(1000);   // second poll

      const groups = mgr.getGroups();
      expect(groups.length).to.equal(2);

      const fooGroup = groups.find((g) => g.line === 42);
      expect(fooGroup).to.exist;
      expect(fooGroup!.entries.length).to.equal(2);
      expect(fooGroup!.entries[0].duration).to.equal(15);
      expect(fooGroup!.entries[1].duration).to.equal(8);

      const barGroup = groups.find((g) => g.line === 88);
      expect(barGroup).to.exist;
      expect(barGroup!.entries.length).to.equal(1);

      mgr.dispose();
    });

    it('emits "changed" only when new events arrive', async () => {
      const ecp = createMockEcp();
      ecp.queryRendezvousEvents.resolves([]);
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      let changeCount = 0;
      mgr.on('changed', () => { changeCount++; });

      await mgr.setEnabled(true);
      const afterEnable = changeCount;

      await clock.tickAsync(3000); // 3 polls, all empty

      // No additional change events from empty polls
      expect(changeCount).to.equal(afterEnable);
      mgr.dispose();
    });
  });

  // ── device change ────────────────────────────────────────────────────────────

  describe('device change', () => {
    it('resets enabled state and clears groups when active device changes', async () => {
      const ecp = createMockEcp();
      ecp.queryRendezvousEvents.resolves({
        events: [{ id: '1', startTimeMs: 0, endTimeMs: 10, line: 1, file: 'pkg:/A.brs' }],
        dropCount: 0,
      });
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);
      await clock.tickAsync(1100);
      expect(mgr.getGroups().length).to.equal(1);

      dm.setActive(DEVICE_B);

      expect(mgr.isEnabled).to.be.false;
      expect(mgr.getGroups().length).to.equal(0);
      mgr.dispose();
    });

    it('sends untrack to the old device when switching away while enabled', async () => {
      const ecp = createMockEcp();
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);
      dm.setActive(DEVICE_B);

      // Wait a tick for async fire-and-forget
      await Promise.resolve();

      expect(ecp.disableRendezvousTracking.calledWith(DEVICE_A.ip, DEVICE_A.port)).to.be.true;
      mgr.dispose();
    });

    it('auto-enables on the new device when its persisted state is true', async () => {
      const ecp = createMockEcp();
      const memento = createMockMemento();
      // Pre-populate persisted state for DEVICE_B
      await memento.update('kopytko.rendezvousEnabled', { [DEVICE_B.serialNumber]: true });

      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', memento as any);

      dm.setActive(DEVICE_B);

      // Allow async setEnabled to run
      await Promise.resolve();
      await Promise.resolve();

      expect(mgr.isEnabled).to.be.true;
      expect(ecp.enableRendezvousTracking.calledWith(DEVICE_B.ip, DEVICE_B.port)).to.be.true;
      mgr.dispose();
    });
  });

  // ── clear ────────────────────────────────────────────────────────────────────

  describe('clear()', () => {
    it('empties groups and emits "changed"', async () => {
      const ecp = createMockEcp();
      ecp.queryRendezvousEvents.resolves({
        events: [{ id: '1', startTimeMs: 0, endTimeMs: 5, line: 1, file: 'pkg:/A.brs' }],
        dropCount: 0,
      });
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);
      await clock.tickAsync(1100);
      expect(mgr.getGroups().length).to.equal(1);

      let changed = false;
      mgr.on('changed', () => { changed = true; });
      mgr.clear();

      expect(mgr.getGroups().length).to.equal(0);
      expect(changed).to.be.true;
      mgr.dispose();
    });
  });

  // ── sorting ───────────────────────────────────────────────────────────────────

  describe('sorting', () => {
    async function buildManagerWithGroups() {
      const ecp = createMockEcp();
      ecp.queryRendezvousEvents
        .onFirstCall().resolves({
          events: [
            // Foo.brs:1 — 1 occurrence, 5ms total
            { id: '1', startTimeMs: 0, endTimeMs: 5, line: 1, file: 'pkg:/Foo.brs' },
          ],
          dropCount: 0,
        })
        .onSecondCall().resolves({
          events: [
            // Bar.brs:2 — 3 occurrences, 3ms total
            { id: '2', startTimeMs: 0, endTimeMs: 1, line: 2, file: 'pkg:/Bar.brs' },
            { id: '3', startTimeMs: 0, endTimeMs: 1, line: 2, file: 'pkg:/Bar.brs' },
            { id: '4', startTimeMs: 0, endTimeMs: 1, line: 2, file: 'pkg:/Bar.brs' },
          ],
          dropCount: 0,
        })
        .resolves({ events: [], dropCount: 0 });

      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);
      await mgr.setEnabled(true);
      await clock.tickAsync(1100); // first poll: Foo.brs 1×, 5ms
      await clock.tickAsync(1000); // second poll: Bar.brs 3×, 3ms total
      return { mgr };
    }

    it('defaults to sort by count descending', async () => {
      const { mgr } = await buildManagerWithGroups();
      const groups = mgr.getGroups();
      expect(groups[0].line).to.equal(2); // Bar.brs 3 occurrences
      expect(groups[1].line).to.equal(1); // Foo.brs 1 occurrence
      mgr.dispose();
    });

    it('sorts by total time descending when mode is "time"', async () => {
      const { mgr } = await buildManagerWithGroups();
      mgr.setSortMode('time');
      const groups = mgr.getGroups();
      expect(groups[0].line).to.equal(1); // Foo.brs 5ms total
      expect(groups[1].line).to.equal(2); // Bar.brs 3ms total
      mgr.dispose();
    });

    it('emits "changed" when sort mode is set', async () => {
      const ecp = createMockEcp();
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);
      let changed = false;
      mgr.on('changed', () => { changed = true; });
      mgr.setSortMode('time');
      expect(changed).to.be.true;
      mgr.dispose();
    });
  });

  // ── dispose ───────────────────────────────────────────────────────────────────

  describe('dispose()', () => {
    it('stops polling after dispose', async () => {
      const ecp = createMockEcp();
      const dm = createMockDeviceManager(DEVICE_A);
      const mgr = new RendezvousManager(dm as any, ecp as any, '/ws', createMockMemento() as any);

      await mgr.setEnabled(true);
      mgr.dispose();

      const callsBeforeDispose = ecp.queryRendezvousEvents.callCount;
      await clock.tickAsync(3000);
      expect(ecp.queryRendezvousEvents.callCount).to.equal(callsBeforeDispose);
    });
  });
});

import '../roku/vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { DiagnosticsController } from '../../src/client/diagnostics/diagnosticsController';
import type { DiagnosticsSink, SinkDirEntry } from '../../src/client/diagnostics/storage/sink';

function makeFakeSink() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const sink: DiagnosticsSink = {
    async ensureDir(dir) { dirs.add(dir); },
    async appendFile(file, data) { files.set(file, (files.get(file) ?? '') + data); },
    async writeFile(file, data) { files.set(file, data); },
    async readFile(file) {
      if (!files.has(file)) throw new Error('ENOENT');
      return files.get(file)!;
    },
    async readdir(): Promise<SinkDirEntry[]> { return []; },
    async exists(t) { return files.has(t) || dirs.has(t); },
  };
  return { sink, files };
}

const DEVICE = {
  deviceId: 'd1',
  serialNumber: 'S1',
  ip: '1.2.3.4',
  port: 8060,
  modelName: 'Ultra',
  softwareVersion: '15.2.4',
};

function makeDeps(device: typeof DEVICE | undefined) {
  return {
    deviceManager: { getActiveDevice: () => device },
    ecp: {
      queryApps: sinon.stub().resolves([{ id: 'dev', name: 'DAZN', version: '3.30.3' }]),
      enableRendezvousTracking: sinon.stub().resolves(true),
      disableRendezvousTracking: sinon.stub().resolves(true),
      queryRendezvousEvents: sinon.stub().resolves({ events: [], dropCount: 0 }),
      enableFwBeaconTracking: sinon.stub().resolves(true),
      disableFwBeaconTracking: sinon.stub().resolves(true),
      queryFwBeacons: sinon.stub().resolves({ events: [], dropCount: 0 }),
      queryChanperf: sinon.stub().rejects(new Error('offline')),
      querySgNodes: sinon.stub().rejects(new Error('offline')),
      queryAppObjectCounts: sinon.stub().rejects(new Error('offline')),
      queryRegistry: sinon.stub().resolves(
        '<plugin-registry><registry><dev-id>abc</dev-id><plugins>dev</plugins></registry></plugin-registry>',
      ),
    },
    rendezvousManager: { suspend: sinon.spy(), resume: sinon.spy() },
    workspaceRoot: '/ws',
  };
}

// A socket that never connects, so no real network is touched.
function dummySocketFactory() {
  return () => {
    const e = new EventEmitter() as any;
    e.write = () => {};
    e.destroy = () => {};
    return e;
  };
}

describe('DiagnosticsController', () => {
  afterEach(() => sinon.restore());

  it('warns and does nothing when no active device', async () => {
    const deps = makeDeps(undefined);
    const { sink } = makeFakeSink();
    const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

    const session = await controller.startSession();
    expect(session).to.equal(undefined);
    expect(deps.rendezvousManager.suspend.called).to.be.false;
  });

  it('starts a session, writes a manifest, and suspends the legacy rendezvous poller', async () => {
    const deps = makeDeps(DEVICE);
    const { sink, files } = makeFakeSink();
    const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

    const session = await controller.startSession();
    expect(session).to.not.equal(undefined);
    expect(controller.isRecording).to.be.true;
    expect(deps.rendezvousManager.suspend.calledOnce).to.be.true;

    const manifestEntry = [...files.entries()].find(([k]) => k.endsWith('session.json'));
    expect(manifestEntry, 'manifest written').to.exist;
    expect(manifestEntry![0]).to.include('/ws/debug/');
    const manifest = JSON.parse(manifestEntry![1]);
    expect(manifest.app.title).to.equal('DAZN');
    expect(manifest.device.ip).to.equal('1.2.3.4');
    expect(manifest.collectors.map((c: any) => c.type)).to.include.members([
      'mem-cpu', 'node-counts', 'object-counts', 'rendezvous', 'fw-beacon',
    ]);

    await controller.stopSession();
    expect(controller.isRecording).to.be.false;
    expect(deps.rendezvousManager.resume.calledOnce).to.be.true;
  });

  it('is idempotent — a second start returns the same session', async () => {
    const deps = makeDeps(DEVICE);
    const { sink } = makeFakeSink();
    const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

    const a = await controller.startSession();
    const b = await controller.startSession();
    expect(a).to.equal(b);
    expect(deps.rendezvousManager.suspend.calledOnce).to.be.true;
    await controller.stopSession();
  });

  it('setCollectorActive stops/starts a single collector and cannot enable one settings never built', async () => {
    const clock = sinon.useFakeTimers();
    const deps = makeDeps(DEVICE);
    const { sink } = makeFakeSink();
    const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

    await controller.startSession();
    try {
      expect(controller.hasCollector('mem-cpu')).to.be.true;

      // system-mem.enabled defaults to false — setCollectorActive can only narrow, never widen.
      expect(controller.hasCollector('system-mem')).to.be.false;
      controller.setCollectorActive('system-mem', true);
      expect(controller.hasCollector('system-mem')).to.be.false;

      await clock.tickAsync(1);
      const callsBefore = (deps.ecp.queryChanperf as sinon.SinonStub).callCount;
      controller.setCollectorActive('mem-cpu', false);
      await clock.tickAsync(5000);
      expect((deps.ecp.queryChanperf as sinon.SinonStub).callCount).to.equal(callsBefore);
    } finally {
      await controller.stopSession();
      clock.restore();
    }
  });

  describe('framework beacon collector (ECP)', () => {
    it('enables beacon tracking for the resolved app id via ECP, not the port-8085 log', async () => {
      const clock = sinon.useFakeTimers();
      const deps = makeDeps(DEVICE);
      const { sink } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      await controller.startSession();
      try {
        await clock.tickAsync(1);
        expect(deps.ecp.enableFwBeaconTracking.calledWith('1.2.3.4', 'dev', 8060)).to.be.true;
      } finally {
        await controller.stopSession();
        clock.restore();
      }
    });

    it('tracks whichever channel is selected in the dropdown, not just "dev"', async () => {
      const clock = sinon.useFakeTimers();
      const deps = makeDeps(DEVICE);
      deps.ecp.queryApps.resolves([
        { id: 'dev', name: 'DAZN', version: '3.30.3' },
        { id: '268970', name: 'DAZN - PROD TESTER', version: '3.30.5' },
      ]);
      const { sink } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      await controller.setSelectedApp('268970');
      await controller.startSession();
      try {
        await clock.tickAsync(1);
        expect(deps.ecp.enableFwBeaconTracking.calledWith('1.2.3.4', '268970', 8060)).to.be.true;
        expect(deps.ecp.enableFwBeaconTracking.calledWith('1.2.3.4', 'dev', 8060)).to.be.false;
      } finally {
        await controller.stopSession();
        clock.restore();
      }
    });

    it('skips the collector when the selected app id cannot be resolved', async () => {
      const deps = makeDeps(DEVICE);
      deps.ecp.queryApps.resolves([]); // "dev" not found — resolveApp() returns {}
      const { sink, files } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      await controller.startSession();
      const manifestEntry = [...files.entries()].find(([k]) => k.endsWith('session.json'));
      const manifest = JSON.parse(manifestEntry![1]);
      expect(manifest.collectors.map((c: any) => c.type)).to.not.include('fw-beacon');
      expect(controller.hasCollector('fw-beacon')).to.be.false;
      // object-counts is app-scoped too — also skipped without a resolved app id.
      expect(manifest.collectors.map((c: any) => c.type)).to.not.include('object-counts');
      expect(controller.hasCollector('object-counts')).to.be.false;
      await controller.stopSession();
    });
  });

  describe('multi-channel selection', () => {
    it('defaults to "dev" and resolves the manifest app from the selected id', async () => {
      const deps = makeDeps(DEVICE);
      deps.ecp.queryApps.resolves([
        { id: 'dev', name: 'DAZN', version: '3.30.3' },
        { id: '268970', name: 'DAZN - PROD TESTER', version: '3.30.5' },
      ]);
      const { sink, files } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      expect(controller.selectedApp).to.equal('dev');
      await controller.startSession();
      const manifestEntry = [...files.entries()].find(([k]) => k.endsWith('session.json'));
      const manifest = JSON.parse(manifestEntry![1]);
      expect(manifest.app.title).to.equal('DAZN');
      await controller.stopSession();
    });

    it('setSelectedApp targets the new app id for the next session', async () => {
      const deps = makeDeps(DEVICE);
      deps.ecp.queryApps.resolves([
        { id: 'dev', name: 'DAZN', version: '3.30.3' },
        { id: '268970', name: 'DAZN - PROD TESTER', version: '3.30.5' },
      ]);
      const { sink, files } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      await controller.setSelectedApp('268970');
      expect(controller.selectedApp).to.equal('268970');

      await controller.startSession();
      const manifestEntry = [...files.entries()].find(([k]) => k.endsWith('session.json'));
      const manifest = JSON.parse(manifestEntry![1]);
      expect(manifest.app.title).to.equal('DAZN - PROD TESTER');
      await controller.stopSession();
    });

    it('setSelectedApp stops a running session when the selection actually changes', async () => {
      const clock = sinon.useFakeTimers();
      const deps = makeDeps(DEVICE);
      const { sink } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      await controller.startSession();
      await clock.tickAsync(1);
      expect(controller.isRecording).to.be.true;
      expect(deps.ecp.enableFwBeaconTracking.calledWith('1.2.3.4', 'dev', 8060)).to.be.true;

      await controller.setSelectedApp('268970');
      expect(controller.isRecording).to.be.false;
      expect(deps.rendezvousManager.resume.calledOnce).to.be.true;
      // Untracks the *old* (dev) channel's beacons — switching channels never
      // leaves a stale /fwbeacons/track registered on the device.
      expect(deps.ecp.disableFwBeaconTracking.calledWith('1.2.3.4', 'dev', 8060)).to.be.true;
      clock.restore();
    });

    it('setSelectedApp does not stop a running session when the selection is unchanged', async () => {
      const deps = makeDeps(DEVICE);
      const { sink } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      await controller.startSession();
      await controller.setSelectedApp('dev'); // already the default — no change
      expect(controller.isRecording).to.be.true;
      await controller.stopSession();
    });

    it('listAvailableApps cross-references registry plugins against queryApps, "dev" first', async () => {
      const deps = makeDeps(DEVICE);
      deps.ecp.queryApps.resolves([
        { id: '12', name: 'Netflix', version: '1.0' },
        { id: '268970', name: 'DAZN - PROD TESTER', version: '3.30.5' },
        { id: '158987', name: 'DAZN Live Sports Streaming', version: '3.30.5' },
        { id: '852522', name: 'Binge Tester', version: '3.30.304' },
        { id: 'dev', name: 'DAZN', version: '3.30.5' },
      ]);
      deps.ecp.queryRegistry.resolves(
        '<plugin-registry><registry><dev-id>x</dev-id><plugins>158987,268970,dev</plugins></registry></plugin-registry>',
      );
      const { sink } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      const apps = await controller.listAvailableApps();
      expect(apps.map((a) => a.id)).to.deep.equal(['dev', '268970', '158987']);
      // Netflix (12) and Binge Tester (852522) are excluded — not in the registry's plugins list.
      expect(apps.some((a) => a.id === '12')).to.be.false;
      expect(apps.some((a) => a.id === '852522')).to.be.false;
    });

    it('listAvailableApps falls back to dev-only when the registry query fails', async () => {
      const deps = makeDeps(DEVICE);
      deps.ecp.queryRegistry.resolves(
        '<plugin-registry><status>FAILED</status><error>Specified dev ID does not match the device key</error></plugin-registry>',
      );
      const { sink } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      const apps = await controller.listAvailableApps();
      expect(apps).to.deep.equal([{ id: 'dev', title: 'DAZN', version: '3.30.3' }]);
    });

    it('listAvailableApps returns an empty array with no active device', async () => {
      const deps = makeDeps(undefined);
      const { sink } = makeFakeSink();
      const controller = new DiagnosticsController(deps as any, sink, dummySocketFactory());

      expect(await controller.listAvailableApps()).to.deep.equal([]);
    });
  });
});

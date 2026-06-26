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
      'mem-cpu', 'node-counts', 'rendezvous',
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
});

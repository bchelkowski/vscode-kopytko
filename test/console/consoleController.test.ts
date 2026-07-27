import '../roku/vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import {
  ConsoleController,
  type ConsoleSettings,
} from '../../src/client/console/consoleController';
import type { DiagnosticsSink, SinkDirEntry } from '../../src/client/diagnostics/storage/sink';

/** Stand-in for ConsoleStream: same event surface, no sockets. */
class FakeStream extends EventEmitter {
  writes: string[] = [];
  started = false;
  closed = false;
  connected = false;
  consecutiveFailures = 0;

  constructor(readonly host: string, readonly port: number) {
    super();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    this.started = true;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  close(): void {
    this.closed = true;
    this.connected = false;
  }

  /** Test helper: bring the fake connection up. */
  goLive(): void {
    this.connected = true;
    this.emit('connect');
  }
}

/** In-memory DiagnosticsSink so no test touches real disk. */
function makeSink(): DiagnosticsSink & { files: Map<string, string>; dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    async ensureDir(dir: string) { dirs.add(dir); },
    async appendFile(file: string, data: string) {
      files.set(file, (files.get(file) ?? '') + data);
    },
    async writeFile(file: string, data: string) { files.set(file, data); },
    async readFile(file: string) { return files.get(file) ?? ''; },
    async readdir(): Promise<SinkDirEntry[]> { return []; },
    async exists(target: string) { return files.has(target) || dirs.has(target); },
  };
}

const DEVICE = {
  deviceId: 'aa:bb:cc',
  ip: '192.168.1.20',
  port: 8060,
  serialNumber: 'X0280DEV',
  friendlyName: 'Roku Ultra',
  modelName: 'Ultra',
  modelNumber: '4850X',
  softwareVersion: '15.2.4',
  state: 'online' as const,
  source: 'discovered' as const,
  isFavorite: false,
  lastSeen: 0,
};

const SETTINGS: ConsoleSettings = {
  maxLines: 100,
  reconnect: true,
  logToFile: false,
  outputDir: 'debug',
  historySize: 50,
};

describe('ConsoleController', () => {
  let streams: FakeStream[];
  let sink: ReturnType<typeof makeSink>;
  let deviceManager: ReturnType<typeof makeDeviceManager>;

  /** Minimal DeviceManager stand-in with a settable active device. */
  function makeDeviceManager(activeDevice: typeof DEVICE | null) {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      active: activeDevice,
      getActiveDevice(): typeof DEVICE | undefined {
        return (this as { active: typeof DEVICE | null }).active ?? undefined;
      },
      /** Test helper: mimic the sidebar switching the active device. */
      setActive(device: typeof DEVICE | null) {
        (this as { active: typeof DEVICE | null }).active = device;
        emitter.emit('devices-changed');
      },
    });
  }

  function makeController(
    overrides: Partial<ConsoleSettings> = {},
    activeDevice: typeof DEVICE | null = DEVICE,
  ) {
    streams = [];
    sink = makeSink();
    deviceManager = makeDeviceManager(activeDevice);

    const controller = new ConsoleController(
      // The controller only uses the three methods stubbed above.
      { deviceManager: deviceManager as never, workspaceRoot: '/ws' },
      { ...SETTINGS, ...overrides },
      {
        streamFactory: (host, port) => {
          const stream = new FakeStream(host, port);
          streams.push(stream);
          return stream as never;
        },
        sink,
        now: () => Date.UTC(2026, 6, 27, 10, 42, 13),
      },
    );
    return controller;
  }

  /** Connect and bring the stream live. */
  async function bringUp(controller: ConsoleController): Promise<FakeStream> {
    await controller.connect();
    const stream = streams[streams.length - 1];
    stream.goLive();
    return stream;
  }

  afterEach(() => sinon.restore());

  describe('selection', () => {
    it('defaults to port 8085 and follows the active device', () => {
      const controller = makeController();
      expect(controller.port).to.equal(8085);
      expect(controller.serial).to.equal('X0280DEV');
      expect(controller.device?.ip).to.equal('192.168.1.20');
      controller.dispose();
    });

    it('offers both interactive ports', () => {
      const controller = makeController();
      expect(controller.listPorts().map((p) => p.port)).to.deep.equal([8085, 8080]);
      controller.dispose();
    });

    it('emits state when the port changes, and not when it is re-selected', () => {
      const controller = makeController();
      const onState = sinon.spy();
      controller.on('state', onState);

      controller.selectPort(8080);
      expect(controller.port).to.equal(8080);
      expect(onState.calledOnce).to.be.true;

      controller.selectPort(8080);
      expect(onState.calledOnce).to.be.true;
      controller.dispose();
    });

    it('reports no serial when there is no device at all', () => {
      const controller = makeController({}, null);
      expect(controller.serial).to.be.null;
      expect(controller.device).to.be.undefined;
      controller.dispose();
    });

    it('re-emits state when the device list changes', () => {
      // Without this the panel snapshots the device once and never notices
      // discovery finishing or a health check landing.
      const controller = makeController();
      const onState = sinon.spy();
      controller.on('state', onState);

      deviceManager.setActive(DEVICE);

      expect(onState.calledOnce).to.be.true;
      controller.dispose();
    });

    it('picks up a device selected in the sidebar after starting with none', () => {
      const controller = makeController({}, null);
      expect(controller.serial).to.be.null;

      deviceManager.setActive(DEVICE);

      expect(controller.serial).to.equal('X0280DEV');
      controller.dispose();
    });

    it('closes sessions belonging to a device that is no longer active', async () => {
      const controller = makeController();
      const stream = await bringUp(controller);

      deviceManager.setActive({ ...DEVICE, serialNumber: 'OTHER', ip: '192.168.1.99' });

      expect(stream.closed).to.be.true;
      expect(controller.bufferedLines()).to.be.empty;
      controller.dispose();
    });

    it('stops listening to the device manager on dispose', () => {
      const controller = makeController();
      const onState = sinon.spy();
      controller.on('state', onState);

      controller.dispose();
      deviceManager.setActive(null);

      expect(onState.called).to.be.false;
    });
  });

  describe('connect', () => {
    it('connects the selected device on the selected port', async () => {
      const controller = makeController();
      await controller.connect();

      expect(streams).to.have.length(1);
      expect(streams[0].host).to.equal('192.168.1.20');
      expect(streams[0].port).to.equal(8085);
      expect(streams[0].started).to.be.true;
      controller.dispose();
    });

    it('warns instead of connecting when no device is selected', async () => {
      const controller = makeController({}, null);
      const onStatus = sinon.spy();
      controller.on('status', onStatus);

      await controller.connect();

      expect(streams).to.be.empty;
      expect(onStatus.calledOnce).to.be.true;
      expect(onStatus.firstCall.args[0]).to.match(/No active Roku device/);
      controller.dispose();
    });

    it('is idempotent for the same device and port', async () => {
      const controller = makeController();
      await controller.connect();
      await controller.connect();
      expect(streams).to.have.length(1);
      controller.dispose();
    });

    it('keeps 8085 and 8080 connected at the same time', async () => {
      const controller = makeController();
      await bringUp(controller);
      controller.selectPort(8080);
      await bringUp(controller);

      expect(streams.map((s) => s.port)).to.deep.equal([8085, 8080]);
      expect(streams.every((s) => !s.closed)).to.be.true;
      controller.dispose();
    });

    it('disconnect closes only the selected port and keeps the buffer', async () => {
      const controller = makeController();
      const first = await bringUp(controller);
      first.emit('data', 'hello\n');

      controller.selectPort(8080);
      await bringUp(controller);
      controller.disconnect();

      expect(streams[1].closed).to.be.true;
      expect(first.closed).to.be.false;

      controller.selectPort(8085);
      expect(controller.bufferedLines()).to.deep.equal(['hello']);
      controller.dispose();
    });

    it('warns about a held port after repeated connection failures', async () => {
      const controller = makeController();
      const onStatus = sinon.spy();
      controller.on('status', onStatus);
      await controller.connect();

      streams[0].consecutiveFailures = 1;
      streams[0].emit('error', new Error('ECONNREFUSED'));
      expect(onStatus.called).to.be.false;

      streams[0].consecutiveFailures = 2;
      streams[0].emit('error', new Error('ECONNREFUSED'));
      expect(onStatus.calledOnce).to.be.true;
      expect(onStatus.firstCall.args[0]).to.match(/single consumer/);
      controller.dispose();
    });
  });

  describe('line assembly', () => {
    it('splits a chunk into complete lines and emits them', async () => {
      const controller = makeController();
      const onLines = sinon.spy();
      controller.on('lines', onLines);
      const stream = await bringUp(controller);

      stream.emit('data', 'first\nsecond\n');

      expect(onLines.calledOnce).to.be.true;
      expect(onLines.firstCall.args[1]).to.deep.equal(['first', 'second']);
      controller.dispose();
    });

    it('holds a partial line until the rest arrives', async () => {
      const controller = makeController();
      const onLines = sinon.spy();
      controller.on('lines', onLines);
      const stream = await bringUp(controller);

      stream.emit('data', 'BRIGHTSCRIPT: ERROR: Type Mis');
      expect(onLines.called).to.be.false;

      stream.emit('data', 'match\n');
      expect(onLines.firstCall.args[1]).to.deep.equal(['BRIGHTSCRIPT: ERROR: Type Mismatch']);
      controller.dispose();
    });

    it('strips the CR of CRLF terminators', async () => {
      const controller = makeController();
      const stream = await bringUp(controller);

      stream.emit('data', 'chanperf\r\nfree\r\n');

      expect(controller.bufferedLines()).to.deep.equal(['chanperf', 'free']);
      controller.dispose();
    });

    it('caps the buffer at maxLines, dropping the oldest', async () => {
      const controller = makeController({ maxLines: 3 });
      const stream = await bringUp(controller);

      stream.emit('data', 'a\nb\nc\nd\ne\n');

      expect(controller.bufferedLines()).to.deep.equal(['c', 'd', 'e']);
      controller.dispose();
    });

    it('keeps each port buffer separate', async () => {
      const controller = makeController();
      const first = await bringUp(controller);
      first.emit('data', 'from-8085\n');

      controller.selectPort(8080);
      const second = await bringUp(controller);
      second.emit('data', 'from-8080\n');

      expect(controller.bufferedLines()).to.deep.equal(['from-8080']);
      controller.selectPort(8085);
      expect(controller.bufferedLines()).to.deep.equal(['from-8085']);
      controller.dispose();
    });

    it('clear() empties the buffer without disconnecting', async () => {
      const controller = makeController();
      const stream = await bringUp(controller);
      stream.emit('data', 'a\nb\n');

      controller.clear();

      expect(controller.bufferedLines()).to.be.empty;
      expect(stream.closed).to.be.false;
      controller.dispose();
    });
  });

  describe('send', () => {
    it('writes the command with a CRLF terminator', async () => {
      const controller = makeController();
      const stream = await bringUp(controller);

      expect(controller.send('chanperf')).to.equal('sent');
      expect(stream.writes).to.deep.equal(['chanperf\r\n']);
      controller.dispose();
    });

    it('reports not-connected rather than writing', async () => {
      const controller = makeController();
      await controller.connect(); // never goes live

      expect(controller.send('chanperf')).to.equal('not-connected');
      expect(streams[0].writes).to.be.empty;
      controller.dispose();
    });

    it('requires confirmation for a destructive command', async () => {
      const controller = makeController();
      controller.selectPort(8080);
      const stream = await bringUp(controller);

      expect(controller.send('genkey')).to.equal('needs-confirmation');
      expect(stream.writes).to.be.empty;

      expect(controller.send('genkey', true)).to.equal('sent');
      expect(stream.writes).to.deep.equal(['genkey\r\n']);
      controller.dispose();
    });

    it('does not gate ordinary commands', async () => {
      const controller = makeController();
      controller.selectPort(8080);
      await bringUp(controller);
      expect(controller.send('chanperf -r 5')).to.equal('sent');
      controller.dispose();
    });

    it('interrupt sends a raw Ctrl+C with no terminator', async () => {
      const controller = makeController();
      const stream = await bringUp(controller);

      controller.interrupt();

      expect(stream.writes).to.deep.equal(['\x03']);
      controller.dispose();
    });
  });

  describe('file output', () => {
    it('saveBuffer writes the scrollback to a timestamped file', async () => {
      const controller = makeController();
      const stream = await bringUp(controller);
      stream.emit('data', 'one\ntwo\n');

      const file = await controller.saveBuffer();

      expect(file).to.match(/console-8085-2026-07-27_10-42-13\.log$/);
      expect(sink.files.get(file!)).to.equal('one\ntwo\n');
      controller.dispose();
    });

    it('saveBuffer returns null when there is nothing buffered', async () => {
      const controller = makeController();
      await bringUp(controller);
      expect(await controller.saveBuffer()).to.be.null;
      controller.dispose();
    });

    it('appends live lines to a log file when logToFile is on', async () => {
      const controller = makeController({ logToFile: true });
      const stream = await bringUp(controller);

      stream.emit('data', 'one\n');
      stream.emit('data', 'two\n');
      // Appends are chained through a promise queue; let it drain.
      await new Promise((resolve) => setImmediate(resolve));

      const logFile = controller.logFile!;
      expect(logFile).to.match(/console-8085-.*\.log$/);
      expect(sink.files.get(logFile)).to.equal('one\ntwo\n');
      controller.dispose();
    });

    it('writes no log file when logToFile is off', async () => {
      const controller = makeController();
      const stream = await bringUp(controller);
      stream.emit('data', 'one\n');
      await new Promise((resolve) => setImmediate(resolve));

      expect(controller.logFile).to.be.null;
      expect(sink.files.size).to.equal(0);
      controller.dispose();
    });
  });

  it('dispose closes every stream', async () => {
    const controller = makeController();
    await bringUp(controller);
    controller.selectPort(8080);
    await bringUp(controller);

    controller.dispose();

    expect(streams.every((s) => s.closed)).to.be.true;
  });
});

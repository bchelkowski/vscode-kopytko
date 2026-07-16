import { expect } from 'chai';
import { EventEmitter } from 'events';
import type { DiagnosticsSink, SinkDirEntry } from '../../src/client/diagnostics/storage/sink';
import { NdjsonWriter } from '../../src/client/diagnostics/storage/ndjsonWriter';
import { SessionReader } from '../../src/client/diagnostics/storage/sessionReader';
import {
  type SessionManifest,
  SCHEMA_VERSION,
  buildSessionId,
} from '../../src/client/diagnostics/storage/sessionStore';
import { DiagnosticsSession } from '../../src/client/diagnostics/session/diagnosticsSession';
import type {
  DiagnosticEventType,
  DiagnosticSample,
} from '../../src/client/diagnostics/session/eventModel';

// ── in-memory sink ─────────────────────────────────────────────────────────────

function makeFakeSink() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const sink: DiagnosticsSink = {
    async ensureDir(dir) { dirs.add(dir); },
    async appendFile(file, data) { files.set(file, (files.get(file) ?? '') + data); },
    async writeFile(file, data) { files.set(file, data); },
    async readFile(file) {
      if (!files.has(file)) throw new Error(`ENOENT: ${file}`);
      return files.get(file)!;
    },
    async readdir(dir): Promise<SinkDirEntry[]> {
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      const all = [...dirs, ...files.keys()];
      const seen = new Set<string>();
      const out: SinkDirEntry[] = [];
      for (const p of all) {
        if (!p.startsWith(prefix)) continue;
        const name = p.slice(prefix.length).split('/')[0];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const full = prefix + name;
        out.push({ name, isDirectory: dirs.has(full) || all.some((x) => x.startsWith(full + '/')) });
      }
      return out;
    },
    async exists(target) {
      return files.has(target) || dirs.has(target) || [...files.keys()].some((f) => f.startsWith(target + '/'));
    },
  };

  return { sink, files, dirs };
}

class FakeCollector extends EventEmitter {
  started = false;
  stopped = false;
  constructor(readonly type: DiagnosticEventType) { super(); }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  push(sample: DiagnosticSample) { this.emit('sample', sample); }
}

function makeManifest(id: string): SessionManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    startedWall: 0,
    endedWall: null,
    device: { ip: '1.2.3.4', modelName: 'Ultra' },
    app: { id: 'dev', title: 'Acme', version: '3.30.3' },
    collectors: [{ type: 'mem-cpu', intervalMs: 1000 }],
    streams: {},
  };
}

const memCpuSample = (wall: number, mem: number): DiagnosticSample => ({
  type: 'mem-cpu',
  wall,
  memKiB: mem,
  anonKiB: mem,
  fileKiB: 0,
  sharedKiB: 0,
  swapKiB: 0,
  cpuPct: 0,
  cpuUser: 0,
  cpuSys: 0,
});

// ── tests ──────────────────────────────────────────────────────────────────────

describe('diagnostics storage', () => {
  describe('buildSessionId', () => {
    it('produces a filesystem-safe id with app label', () => {
      const id = buildSessionId(new Date('2026-06-26T07:30:05').getTime(), 'Acme Live!');
      expect(id).to.match(/^2026-06-26_07-30-05__Acme-Live$/);
    });
  });

  describe('NdjsonWriter', () => {
    it('appends events as one JSON object per line and tracks counts', async () => {
      const { sink, files } = makeFakeSink();
      const writer = new NdjsonWriter(sink, '/root/sess', 50);
      writer.append({ ...memCpuSample(1000, 10), t: 0 } as any);
      writer.append({ ...memCpuSample(2000, 20), t: 1000 } as any);
      await writer.close();

      const content = files.get('/root/sess/mem-cpu.ndjson')!;
      const lines = content.trim().split('\n');
      expect(lines).to.have.length(2);
      expect(JSON.parse(lines[0]).memKiB).to.equal(10);
      expect(writer.countFor('mem-cpu')).to.equal(2);
    });

    it('retains buffered lines when a flush fails, then writes on retry', async () => {
      const { sink, files } = makeFakeSink();
      let failNext = true;
      const flaky: DiagnosticsSink = {
        ...sink,
        async appendFile(file, data) {
          if (failNext) { failNext = false; throw new Error('EIO'); }
          return sink.appendFile(file, data);
        },
      };
      const writer = new NdjsonWriter(flaky, '/root/sess', 50);
      writer.append({ ...memCpuSample(1000, 10), t: 0 } as any);

      await writer.flush(); // fails — line retained
      expect(files.get('/root/sess/mem-cpu.ndjson')).to.equal(undefined);

      await writer.flush(); // succeeds
      expect(files.get('/root/sess/mem-cpu.ndjson')!.trim().split('\n')).to.have.length(1);
    });
  });

  describe('DiagnosticsSession', () => {
    it('writes the manifest, stamps t, persists NDJSON, and finalizes on stop', async () => {
      const { sink, files } = makeFakeSink();
      const collector = new FakeCollector('mem-cpu');
      let nowVal = 1000;
      const session = new DiagnosticsSession({
        sink,
        dir: '/root/sess',
        manifest: makeManifest('sess'),
        collectors: [collector],
        now: () => nowVal,
      });

      const events: any[] = [];
      session.on('event', (e) => events.push(e));

      await session.start();
      expect(collector.started).to.be.true;
      expect(files.get('/root/sess/session.json')).to.exist;

      collector.push(memCpuSample(1500, 50)); // t = 500
      collector.push(memCpuSample(2500, 60)); // t = 1500

      nowVal = 9000;
      await session.stop();

      expect(collector.stopped).to.be.true;
      expect(events.map((e) => e.t)).to.deep.equal([500, 1500]);
      expect(session.getRing('mem-cpu')).to.have.length(2);

      const ndjson = files.get('/root/sess/mem-cpu.ndjson')!.trim().split('\n');
      expect(ndjson).to.have.length(2);

      const manifest = JSON.parse(files.get('/root/sess/session.json')!) as SessionManifest;
      expect(manifest.startedWall).to.equal(1000);
      expect(manifest.endedWall).to.equal(9000);
      expect(manifest.streams['mem-cpu']).to.deep.equal({ file: 'mem-cpu.ndjson', count: 2 });
    });

    it('bounds the in-memory ring buffer', async () => {
      const { sink } = makeFakeSink();
      const collector = new FakeCollector('mem-cpu');
      const session = new DiagnosticsSession({
        sink,
        dir: '/root/sess',
        manifest: makeManifest('sess'),
        collectors: [collector],
        ringSize: 3,
        now: () => 0,
      });
      await session.start();
      for (let i = 0; i < 10; i++) collector.push(memCpuSample(i, i));
      await session.stop();
      expect(session.getRing('mem-cpu')).to.have.length(3);
    });
  });

  describe('SessionReader', () => {
    it('lists sessions newest-first and reads streams, skipping torn lines', async () => {
      const { sink, files } = makeFakeSink();
      // Two sessions under the root.
      files.set('/root/a/session.json', JSON.stringify({ ...makeManifest('a'), startedWall: 1000 }));
      files.set('/root/b/session.json', JSON.stringify({ ...makeManifest('b'), startedWall: 2000 }));
      // A stream with a valid line, a blank line, and a torn final line.
      files.set(
        '/root/b/mem-cpu.ndjson',
        '{"type":"mem-cpu","t":0,"wall":1,"memKiB":10}\n\n{"type":"mem-cpu","t":1,"wall":2,"memK',
      );

      const reader = new SessionReader(sink);
      const sessions = await reader.listSessions('/root');
      expect(sessions.map((s) => s.manifest.id)).to.deep.equal(['b', 'a']);

      const events = await reader.readStream(sessions[0].dir, 'mem-cpu');
      expect(events).to.have.length(1);
      expect((events[0] as any).memKiB).to.equal(10);
    });

    it('returns [] for a missing stream and an empty root', async () => {
      const { sink } = makeFakeSink();
      const reader = new SessionReader(sink);
      expect(await reader.listSessions('/nope')).to.deep.equal([]);
      expect(await reader.readStream('/root/x', 'rendezvous')).to.deep.equal([]);
    });
  });
});

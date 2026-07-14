import { expect } from 'chai';
import * as path from 'path';
import {
  BODIES_DIR,
  FLOWS_FILE,
  NETWORK_SESSION_MANIFEST,
  NetworkSessionStore,
  type NetworkSessionManifest,
  type NetworkSessionSink,
} from '../../src/client/network/storage/networkSessionStore';
import type { SerializedFlow } from '../../src/client/network/webview/protocol';

/** In-memory sink — tests never touch real disk. */
function memSink() {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const sink: NetworkSessionSink = {
    async ensureDir(dir) {
      dirs.add(dir);
    },
    async appendFile(file, data) {
      files.set(file, Buffer.concat([files.get(file) ?? Buffer.alloc(0), Buffer.from(data)]));
    },
    async writeFile(file, data) {
      files.set(file, Buffer.isBuffer(data) ? data : Buffer.from(data));
    },
    async readFile(file) {
      const f = files.get(file);
      if (!f) throw new Error(`ENOENT: ${file}`);
      return f;
    },
    async exists(target) {
      return files.has(target);
    },
  };
  return { sink, files, dirs };
}

function flow(over: Partial<SerializedFlow> = {}): SerializedFlow {
  return {
    id: 'flow-1',
    startedWall: 0,
    method: 'GET',
    host: 'api.test',
    port: 80,
    path: '/',
    query: '',
    status: 200,
    statusText: 'OK',
    contentType: 'application/json',
    durationMs: 5,
    requestBytes: 0,
    responseBytes: 10,
    clientIp: '1.2.3.4',
    upstreamScheme: 'https',
    rewrittenBody: false,
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  };
}

// 2026-07-14 10:30:00 UTC — folder names use local time, so only assert the suffix.
const NOW = Date.UTC(2026, 6, 14, 10, 30, 0);

// `null` = "no resolvable root" — an explicit `undefined` argument would
// still get the default (JS default-param semantics).
function make(root: string | null = '/out') {
  const mem = memSink();
  const store = new NetworkSessionStore({ resolveRoot: () => root ?? undefined, sink: mem.sink, now: () => NOW });
  return { store, ...mem };
}

describe('network/NetworkSessionStore', () => {
  it('startSession creates a timestamped __network folder with a manifest and bodies dir', async () => {
    const { store, files, dirs } = make();
    await store.startSession({ device: { ip: '1.2.3.4', label: 'Ultra' }, proxyPort: 8888 });

    const dir = store.sessionDir!;
    expect(dir).to.match(/__network$/);
    expect(path.dirname(dir)).to.equal('/out');
    expect(dirs.has(path.join(dir, BODIES_DIR))).to.equal(true);

    const manifest = JSON.parse(files.get(path.join(dir, NETWORK_SESSION_MANIFEST))!.toString()) as NetworkSessionManifest;
    expect(manifest.schemaVersion).to.equal(1);
    expect(manifest.startedWall).to.equal(NOW);
    expect(manifest.endedWall).to.equal(null);
    expect(manifest.device).to.deep.equal({ ip: '1.2.3.4', label: 'Ultra' });
    expect(manifest.proxyPort).to.equal(8888);
  });

  it('appendFlow appends one NDJSON line per flow and writes each body file', async () => {
    const { store, files } = make();
    await store.startSession({ proxyPort: 8888 });
    const dir = store.sessionDir!;

    await store.appendFlow(flow({ id: 'a' }), {
      request: Buffer.from('req-bytes'),
      response: Buffer.from('res-bytes'),
      originalRequest: Buffer.from('orig-req'),
      originalResponse: Buffer.from('orig-res'),
    });
    await store.appendFlow(flow({ id: 'b' })); // no bodies at all

    const lines = files.get(path.join(dir, FLOWS_FILE))!.toString().trim().split('\n');
    expect(lines).to.have.length(2);
    expect((JSON.parse(lines[0]) as SerializedFlow).id).to.equal('a');
    expect((JSON.parse(lines[1]) as SerializedFlow).id).to.equal('b');

    expect(files.get(path.join(dir, BODIES_DIR, 'a.req'))!.toString()).to.equal('req-bytes');
    expect(files.get(path.join(dir, BODIES_DIR, 'a.res'))!.toString()).to.equal('res-bytes');
    expect(files.get(path.join(dir, BODIES_DIR, 'a.req.orig'))!.toString()).to.equal('orig-req');
    expect(files.get(path.join(dir, BODIES_DIR, 'a.res.orig'))!.toString()).to.equal('orig-res');
    expect(files.has(path.join(dir, BODIES_DIR, 'b.req'))).to.equal(false);
  });

  it('readBody/hasBody return the written bytes and null/false for missing files', async () => {
    const { store } = make();
    await store.startSession({ proxyPort: 8888 });
    await store.appendFlow(flow({ id: 'a' }), { response: Buffer.from('payload') });

    expect((await store.readBody('a', 'res'))!.toString()).to.equal('payload');
    expect(await store.hasBody('a', 'res')).to.equal(true);
    expect(await store.readBody('a', 'req')).to.equal(null);
    expect(await store.hasBody('a', 'req')).to.equal(false);
  });

  it('endSession finalizes endedWall and flowCount but keeps bodies readable', async () => {
    const { store, files } = make();
    await store.startSession({ proxyPort: 8888 });
    const dir = store.sessionDir!;
    await store.appendFlow(flow({ id: 'a' }), { response: Buffer.from('x') });
    await store.endSession();

    const manifest = JSON.parse(files.get(path.join(dir, NETWORK_SESSION_MANIFEST))!.toString()) as NetworkSessionManifest;
    expect(manifest.endedWall).to.equal(NOW);
    expect(manifest.flowCount).to.equal(1);
    // The folder stays addressable after the session ends — flows still in
    // the buffer must keep their "open full body" path working.
    expect(store.sessionDir).to.equal(dir);
    expect((await store.readBody('a', 'res'))!.toString()).to.equal('x');
  });

  it('stays inactive (all no-ops) when no output root resolves', async () => {
    const { store, files } = make(null);
    await store.startSession({ proxyPort: 8888 });
    expect(store.sessionDir).to.equal(null);
    await store.appendFlow(flow(), { request: Buffer.from('x') });
    await store.endSession();
    expect(files.size).to.equal(0);
    expect(await store.readBody('flow-1', 'req')).to.equal(null);
  });
});

import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { NetworkController, type NetworkConfig } from '../../src/client/network/networkController';
import {
  RedirectController,
  type ElevatedRunner,
  type WindowsRedirectDriver,
} from '../../src/client/network/redirect/redirectController';
import type { CaptureProxy } from '../../src/client/network/capture/captureProxy';
import type { FlowRecord } from '../../src/client/network/capture/flow';
import { defaultRuleSet } from '../../src/client/network/capture/rewrite/rules';
import { NetworkSessionStore, type NetworkSessionSink } from '../../src/client/network/storage/networkSessionStore';

class FakeProxy extends EventEmitter {
  started = false;
  stopped = false;
  rules = defaultRuleSet();
  port = 8888;
  replays: FlowRecord[] = [];
  start(): Promise<void> { this.started = true; return Promise.resolve(); }
  stop(): Promise<void> { this.stopped = true; return Promise.resolve(); }
  setRules(r: typeof this.rules): void { this.rules = r; }
  replay(rec: FlowRecord): void { this.replays.push(rec); }
  dispose(): void {}
}

function makeConfig(over: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    proxyPort: 8888,
    redirectPorts: [80],
    maxEntries: 5000,
    maxBufferBytes: 0,
    filterToActiveDevice: true,
    maxBodyBytes: 65536,
    upstreamKeepAlive: true,
    breakpointTimeoutMs: 30000,
    rules: defaultRuleSet(),
    ...over,
  };
}

function rec(over: Partial<FlowRecord> = {}): FlowRecord {
  return {
    id: `f${Math.random().toString(36).slice(2)}`,
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
    upstreamScheme: 'http',
    rewrittenBody: false,
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  };
}

const DEVICE = { ip: '1.2.3.4', modelName: 'Ultra' };

function make(opts: {
  config?: NetworkConfig;
  runner?: ElevatedRunner;
  platform?: NodeJS.Platform;
  device?: typeof DEVICE | undefined;
  windowsDriver?: WindowsRedirectDriver;
  sessionStore?: NetworkSessionStore;
}) {
  const proxy = new FakeProxy();
  const redirect = new RedirectController(
    opts.runner ?? (() => Promise.resolve()),
    opts.platform ?? 'linux',
    opts.windowsDriver,
  );
  const device = 'device' in opts ? opts.device : DEVICE;
  let proxyOpts: import('../../src/client/network/capture/captureProxy').CaptureProxyOptions | undefined;
  const controller = new NetworkController({
    deviceManager: { getActiveDevice: () => device },
    redirect,
    readConfig: () => opts.config ?? makeConfig(),
    proxyFactory: (o) => {
      proxyOpts = o;
      return proxy as unknown as CaptureProxy;
    },
    sessionStore: opts.sessionStore,
  });
  return { controller, proxy, redirect, getProxyOpts: () => proxyOpts };
}

/** In-memory session store on top of the real NetworkSessionStore class. */
function makeStore() {
  const files = new Map<string, Buffer>();
  const sink: NetworkSessionSink = {
    async ensureDir() { /* dirs are implicit in the map */ },
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
    async exists(target) { return files.has(target); },
  };
  const store = new NetworkSessionStore({ resolveRoot: () => '/out', sink, now: () => 1_752_480_000_000 });
  return { store, files };
}

/** Lets the controller's fire-and-forget persistFlow settle. */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('network/NetworkController', () => {
  it('enable() starts the proxy, applies redirect, and reports capturing', async () => {
    const { controller, proxy } = make({});
    const states: string[] = [];
    controller.on('state', (s) => states.push(s.redirectStatus));

    await controller.enable();
    expect(proxy.started).to.equal(true);
    expect(controller.isEnabled).to.equal(true);
    expect(controller.getState().redirectStatus).to.equal('on');
    expect(states).to.include('on');
  });

  it('refuses to enable without an active device', async () => {
    const { controller } = make({ device: undefined });
    let threw: unknown;
    try { await controller.enable(); } catch (e) { threw = e; }
    expect(threw).to.be.instanceOf(Error);
    expect(controller.isEnabled).to.equal(false);
  });

  it('rolls the proxy back if redirect setup fails hard', async () => {
    const { controller, proxy } = make({ runner: () => Promise.reject(new Error('pkexec denied')) });
    let threw: unknown;
    try { await controller.enable(); } catch (e) { threw = e; }
    expect(threw).to.be.instanceOf(Error);
    expect(proxy.stopped).to.equal(true);
    expect(controller.isEnabled).to.equal(false);
  });

  it('keeps capturing but marks redirect unsupported on Windows', async () => {
    const { controller, proxy } = make({ platform: 'win32' });
    await controller.enable();
    expect(controller.isEnabled).to.equal(true);
    expect(proxy.stopped).to.equal(false);
    expect(controller.getState().redirectStatus).to.equal('unsupported');
    expect(controller.getState().message).to.be.a('string');
  });

  it('warns (but still redirects successfully) when redirectPorts includes 443 — the proxy cannot terminate TLS on that port', async () => {
    const { controller } = make({ config: makeConfig({ redirectPorts: [80, 443] }) });
    await controller.enable();
    expect(controller.getState().redirectStatus).to.equal('on');
    expect(controller.getState().message).to.be.a('string');
    expect(controller.getState().message).to.contain('443');
  });

  it('does not warn when redirectPorts is the default (80 only)', async () => {
    const { controller } = make({});
    await controller.enable();
    expect(controller.getState().redirectStatus).to.equal('on');
    expect(controller.getState().message).to.equal(undefined);
  });

  it('caps the ring buffer and prunes dropped ids', async () => {
    const { controller, proxy } = make({ config: makeConfig({ maxEntries: 3 }) });
    await controller.enable();

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = rec({ id: `id${i}`, responseBody: Buffer.from('x') });
      ids.push(r.id);
      proxy.emit('flow', r);
    }
    expect(controller.getHistory()).to.have.length(3);
    expect(controller.getDetail('id0')).to.equal(undefined); // dropped
    expect(controller.getDetail('id4')).to.not.equal(undefined); // retained
  });

  it('emits trimmed with the evicted ids when the count cap drops flows', async () => {
    const { controller, proxy } = make({ config: makeConfig({ maxEntries: 2 }) });
    await controller.enable();
    const trimmed: string[][] = [];
    controller.on('trimmed', (ids: string[]) => trimmed.push(ids));

    proxy.emit('flow', rec({ id: 'a' }));
    proxy.emit('flow', rec({ id: 'b' }));
    expect(trimmed).to.deep.equal([]); // under the cap — nothing evicted
    proxy.emit('flow', rec({ id: 'c' }));
    expect(trimmed).to.deep.equal([['a']]);
  });

  it('evicts oldest flows when the byte budget is exceeded', async () => {
    // Each flow retains a 10 KB body (+2 KB flat overhead) — a 30 KB budget
    // holds two such flows, so the third arrival must evict the first.
    const { controller, proxy } = make({ config: makeConfig({ maxBufferBytes: 30 * 1024 }) });
    await controller.enable();
    const trimmed: string[] = [];
    controller.on('trimmed', (ids: string[]) => trimmed.push(...ids));

    const body = Buffer.alloc(10 * 1024, 'x');
    proxy.emit('flow', rec({ id: 'big1', responseBody: body }));
    proxy.emit('flow', rec({ id: 'big2', responseBody: body }));
    proxy.emit('flow', rec({ id: 'big3', responseBody: body }));

    expect(trimmed).to.deep.equal(['big1']);
    expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['big2', 'big3']);
    expect(controller.getDetail('big1')).to.equal(undefined);
  });

  it('byte budget of 0 disables byte-based eviction', async () => {
    const { controller, proxy } = make({ config: makeConfig({ maxBufferBytes: 0 }) });
    await controller.enable();
    const body = Buffer.alloc(64 * 1024, 'x');
    for (let i = 0; i < 5; i++) proxy.emit('flow', rec({ id: `id${i}`, responseBody: body }));
    expect(controller.getHistory()).to.have.length(5);
  });

  it('clear() resets the byte budget so old costs are not double-counted', async () => {
    const { controller, proxy } = make({ config: makeConfig({ maxBufferBytes: 30 * 1024 }) });
    await controller.enable();
    const body = Buffer.alloc(10 * 1024, 'x');
    proxy.emit('flow', rec({ id: 'pre1', responseBody: body }));
    proxy.emit('flow', rec({ id: 'pre2', responseBody: body }));
    controller.clear();

    const trimmed: string[] = [];
    controller.on('trimmed', (ids: string[]) => trimmed.push(...ids));
    proxy.emit('flow', rec({ id: 'post1', responseBody: body }));
    proxy.emit('flow', rec({ id: 'post2', responseBody: body }));
    expect(trimmed).to.deep.equal([]); // budget restarted from zero after clear
    expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['post1', 'post2']);
  });

  it('exposes maxEntries from config for the webview init handshake', async () => {
    const { controller } = make({ config: makeConfig({ maxEntries: 42 }) });
    expect(controller.maxEntries).to.equal(42);
  });

  it('pause drops flows without touching proxy or redirect state', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    const states: boolean[] = [];
    controller.on('state', (s) => states.push(s.paused));

    controller.setPaused(true);
    proxy.emit('flow', rec({ id: 'while-paused' }));
    expect(controller.getHistory()).to.have.length(0);
    expect(controller.isEnabled).to.equal(true);
    expect(proxy.stopped).to.equal(false);
    expect(states).to.deep.equal([true]);

    controller.setPaused(false);
    proxy.emit('flow', rec({ id: 'after-resume' }));
    expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['after-resume']);
  });

  it('records replayed flows even while paused', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    controller.setPaused(true);
    proxy.emit('flow', rec({ id: 'replayed', replayed: true, clientIp: '127.0.0.1' }));
    expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['replayed']);
  });

  it('replayed flows bypass the active-device clientIp filter', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({ id: 'replayed', replayed: true, clientIp: '127.0.0.1' }));
    proxy.emit('flow', rec({ id: 'foreign', clientIp: '127.0.0.1' }));
    expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['replayed']);
  });

  it('replay() forwards the stored record to the proxy', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({ id: 'orig' }));
    await controller.replay('orig');
    expect(proxy.replays.map((r) => r.id)).to.deep.equal(['orig']);
  });

  it('replay() rejects when capture is off or the flow is gone', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({ id: 'orig' }));
    let missingErr: unknown;
    try { await controller.replay('missing'); } catch (e) { missingErr = e; }
    expect((missingErr as Error).message).to.contain('no longer in the capture buffer');
    await controller.disable();
    let offErr: unknown;
    try { await controller.replay('orig'); } catch (e) { offErr = e; }
    expect((offErr as Error).message).to.contain('Enable capture');
  });

  it('disable() resets pause so the next session starts recording', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    controller.setPaused(true);
    await controller.disable();
    await controller.enable();
    proxy.emit('flow', rec({ id: 'fresh' }));
    expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['fresh']);
  });

  const interceptPayload = (over: Record<string, unknown> = {}) => ({
    id: 'ic-1',
    phase: 'request' as const,
    method: 'GET',
    host: 'api.test',
    path: '/x',
    query: '',
    upstreamScheme: 'https' as const,
    headers: { accept: 'application/json' },
    body: '',
    bodyEditable: true,
    ...over,
  });

  it('bridges a breakpoint pause to an intercept event and resolves it with the user edits', async () => {
    const { controller, getProxyOpts } = make({});
    await controller.enable();
    const onIntercept = getProxyOpts()!.onIntercept!;

    const emitted: unknown[] = [];
    controller.on('intercept', (p) => emitted.push(p));

    const resultP = onIntercept(interceptPayload());
    expect(emitted).to.have.length(1);
    controller.resolveIntercept('ic-1', { action: 'continue', method: 'POST' });
    const result = await resultP;
    expect(result).to.deep.equal({ action: 'continue', method: 'POST' });
    expect(controller.getPendingIntercepts()).to.have.length(0);
  });

  it('exposes pending intercepts until they are resolved (for panel resync)', async () => {
    const { controller, getProxyOpts } = make({});
    await controller.enable();
    const onIntercept = getProxyOpts()!.onIntercept!;
    const resultP = onIntercept(interceptPayload({ id: 'ic-2' }));
    expect(controller.getPendingIntercepts().map((p) => p.id)).to.deep.equal(['ic-2']);
    controller.resolveIntercept('ic-2', { action: 'abort' });
    expect(await resultP).to.deep.equal({ action: 'abort' });
    expect(controller.getPendingIntercepts()).to.have.length(0);
  });

  it('auto-continues a breakpoint after the timeout so a forgotten one never hangs', async () => {
    const clock = sinon.useFakeTimers();
    try {
      const { controller, getProxyOpts } = make({ config: makeConfig({ breakpointTimeoutMs: 5000 }) });
      await controller.enable();
      const onIntercept = getProxyOpts()!.onIntercept!;
      const resultP = onIntercept(interceptPayload({ id: 'ic-3' }));
      await clock.tickAsync(5001);
      expect(await resultP).to.deep.equal({ action: 'continue' });
      expect(controller.getPendingIntercepts()).to.have.length(0);
    } finally {
      clock.restore();
    }
  });

  it('drains pending intercepts (continue) when capture is disabled', async () => {
    const { controller, getProxyOpts } = make({});
    await controller.enable();
    const onIntercept = getProxyOpts()!.onIntercept!;
    const resultP = onIntercept(interceptPayload({ id: 'ic-4' }));
    await controller.disable();
    expect(await resultP).to.deep.equal({ action: 'continue' });
    expect(controller.getPendingIntercepts()).to.have.length(0);
  });

  it('filters out flows not from the active device', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({ id: 'keep', clientIp: '1.2.3.4' }));
    proxy.emit('flow', rec({ id: 'drop', clientIp: '9.9.9.9' }));
    const hist = controller.getHistory();
    expect(hist.map((f) => f.id)).to.deep.equal(['keep']);
  });

  it('does not filter by clientIp on Windows, where traffic arrives via netsh portproxy as 127.0.0.1', async () => {
    // Unlike macOS/Linux's real transparent redirect, netsh portproxy makes a
    // brand-new local connection to the proxy, so every flow's clientIp would
    // be 127.0.0.1, never the device's real IP — filtering here would drop
    // everything.
    const { controller, proxy } = make({ platform: 'win32' });
    await controller.enable();
    expect(controller.getState().redirectStatus).to.equal('unsupported');
    proxy.emit('flow', rec({ id: 'via-portproxy', clientIp: '127.0.0.1' }));
    expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['via-portproxy']);
  });

  it('does not filter by clientIp on Windows even when redirectStatus is "on" (WinDivert bridges through 127.0.0.1)', async () => {
    // Unlike macOS/Linux, WinDivert has to rewrite BOTH source and
    // destination to 127.0.0.1 to get Windows to accept the injected packet
    // for local delivery at all — so even a fully successful ("on") Windows
    // redirect never preserves the device's real source IP. Filtering here
    // would silently drop every flow despite the redirect genuinely working.
    const windowsDriver: WindowsRedirectDriver = { enable: () => Promise.resolve(), disable: () => Promise.resolve() };
    const { controller, proxy } = make({ platform: 'win32', windowsDriver });
    await controller.enable();
    expect(controller.getState().redirectStatus).to.equal('on');
    proxy.emit('flow', rec({ id: 'via-windivert', clientIp: '127.0.0.1' }));
    expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['via-windivert']);
  });

  it('hot-reloads rules onto the proxy and emits them', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    const emitted: unknown[] = [];
    controller.on('rules', (r) => emitted.push(r));

    const newRules = { ...defaultRuleSet(), defaultUpstreamScheme: 'http' as const };
    controller.setRules(newRules);
    expect(proxy.rules).to.equal(newRules);
    expect(emitted).to.have.length(1);
  });

  it('builds a HAR log from captured flows', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({ id: 'h1', host: 'api.test', path: '/v1', query: 'a=1', responseBody: Buffer.from('{}') }));

    const har = controller.buildHar() as { log: { entries: Array<{ request: { url: string } }> } };
    expect(har.log.entries).to.have.length(1);
    expect(har.log.entries[0].request.url).to.equal('http://api.test/v1?a=1');
  });

  it('writes real per-phase HAR timings when the flow has them', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({
      id: 't1',
      timings: { blockedMs: 1, dnsMs: 2, connectMs: 3, tlsMs: 4, sendMs: 0, waitMs: 20, receiveMs: 5 },
    }));

    type HarTimings = { blocked: number; dns: number; connect: number; ssl: number; send: number; wait: number; receive: number };
    const har = controller.buildHar() as { log: { entries: Array<{ timings: HarTimings }> } };
    expect(har.log.entries[0].timings).to.deep.equal({ blocked: 1, dns: 2, connect: 3, ssl: 4, send: 0, wait: 20, receive: 5 });
  });

  it('marks absent phases as -1 (HAR not-applicable) for reused sockets', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({
      id: 't2',
      timings: { blockedMs: 0, sendMs: 0, waitMs: 8, receiveMs: 2, socketReused: true },
    }));

    type Entry = { timings: { dns: number; connect: number; ssl: number }; _socketReused?: boolean };
    const har = controller.buildHar() as { log: { entries: Entry[] } };
    expect(har.log.entries[0].timings.dns).to.equal(-1);
    expect(har.log.entries[0].timings.connect).to.equal(-1);
    expect(har.log.entries[0].timings.ssl).to.equal(-1);
    expect(har.log.entries[0]._socketReused).to.equal(true);
  });

  it('falls back to the legacy whole-duration timings shape when a flow has none', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({ id: 't3', durationMs: 42 }));

    const har = controller.buildHar() as { log: { entries: Array<{ timings: unknown }> } };
    expect(har.log.entries[0].timings).to.deep.equal({ send: 0, wait: 42, receive: 0 });
  });

  it('search finds matches in url, headers, and text bodies but skips binary bodies', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    proxy.emit('flow', rec({ id: 'byurl', host: 'search-me.test', path: '/find' }));
    proxy.emit('flow', rec({ id: 'byheader', host: 'h.test', requestHeaders: { 'x-token': 'NEEDLE-42' } }));
    proxy.emit('flow', rec({ id: 'bybody', host: 'b.test', contentType: 'application/json', responseBody: Buffer.from('{"k":"NEEDLE-42"}') }));
    proxy.emit('flow', rec({ id: 'binary', host: 'i.test', contentType: 'image/png', responseBody: Buffer.from('NEEDLE-42-but-binary') }));

    const urlHits = controller.search('search-me');
    expect(urlHits.map((h) => h.id)).to.deep.equal(['byurl']);

    const needleHits = controller.search('needle-42');
    // header + text body match; binary body is skipped.
    expect(needleHits.map((h) => h.id).sort()).to.deep.equal(['bybody', 'byheader']);
    expect(needleHits.find((h) => h.id === 'byheader')?.where).to.equal('header');
  });

  it('search caps at 200 hits', async () => {
    const { controller, proxy } = make({ config: makeConfig({ maxEntries: 500 }) });
    await controller.enable();
    for (let i = 0; i < 300; i++) proxy.emit('flow', rec({ id: `m${i}`, path: '/match' }));
    expect(controller.search('match')).to.have.length(200);
  });

  it('HAR encodes a binary response body as base64', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    proxy.emit('flow', rec({ id: 'img', contentType: 'image/png', responseBody: png, responseBytes: png.length }));

    type Content = { text: string; encoding?: string };
    const har = controller.buildHar() as { log: { entries: Array<{ response: { content: Content } }> } };
    const content = har.log.entries[0].response.content;
    expect(content.encoding).to.equal('base64');
    expect(content.text).to.equal(png.toString('base64'));
  });

  it('disable() reverts redirect and stops the proxy', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    await controller.disable();
    expect(controller.isEnabled).to.equal(false);
    expect(proxy.stopped).to.equal(true);
    expect(controller.getState().redirectStatus).to.equal('off');
  });

  describe('in-flight (pending) flows', () => {
    it('upserts the terminal record over the pending one, preserving buffer position', async () => {
      const { controller, proxy } = make({});
      await controller.enable();
      const emitted: Array<{ id: string; pending?: true; status: number }> = [];
      controller.on('flow', (f: { id: string; pending?: true; status: number }) => emitted.push(f));

      proxy.emit('flow', rec({ id: 'a', pending: true, status: 0, durationMs: 0 }));
      proxy.emit('flow', rec({ id: 'b' }));
      proxy.emit('flow', rec({ id: 'a', status: 200, durationMs: 42 }));

      const history = controller.getHistory();
      expect(history.map((f) => f.id)).to.deep.equal(['a', 'b']); // merged in place, arrival order kept
      expect(history[0].status).to.equal(200);
      expect(history[0].pending).to.equal(undefined); // Object.assign can't remove keys — must be deleted
      expect(emitted.filter((f) => f.id === 'a')).to.have.length(2);
      expect(emitted[0].pending).to.equal(true);
      expect(emitted[2].pending).to.equal(undefined);
    });

    it('a completion for a known id merges even when the pause gate is on', async () => {
      const { controller, proxy } = make({});
      await controller.enable();
      proxy.emit('flow', rec({ id: 'a', pending: true, status: 0 }));
      controller.setPaused(true);
      proxy.emit('flow', rec({ id: 'a', status: 200 }));

      const history = controller.getHistory();
      expect(history).to.have.length(1);
      expect(history[0].status).to.equal(200);
      expect(history[0].pending).to.equal(undefined);
    });

    it('a pending flow dropped while paused appends exactly one completed entry after unpause', async () => {
      const { controller, proxy } = make({});
      await controller.enable();
      controller.setPaused(true);
      proxy.emit('flow', rec({ id: 'a', pending: true, status: 0 }));
      expect(controller.getHistory()).to.have.length(0);
      controller.setPaused(false);
      proxy.emit('flow', rec({ id: 'a', status: 200 }));

      const history = controller.getHistory();
      expect(history).to.have.length(1);
      expect(history[0].pending).to.equal(undefined);
    });

    it('a pending flow evicted by the entry cap re-appends when its completion arrives', async () => {
      const { controller, proxy } = make({ config: makeConfig({ maxEntries: 1 }) });
      await controller.enable();
      const trimmed: string[] = [];
      controller.on('trimmed', (ids: string[]) => trimmed.push(...ids));

      proxy.emit('flow', rec({ id: 'a', pending: true, status: 0 }));
      proxy.emit('flow', rec({ id: 'b' })); // evicts pending a
      expect(trimmed).to.deep.equal(['a']);
      proxy.emit('flow', rec({ id: 'a', status: 200 })); // unknown id again → appends (evicts b)

      const history = controller.getHistory();
      expect(history).to.have.length(1);
      expect(history[0].id).to.equal('a');
      expect(history[0].status).to.equal(200);
    });

    it('clear() while a flow is in flight: the completion appends one lone completed flow', async () => {
      const { controller, proxy } = make({});
      await controller.enable();
      proxy.emit('flow', rec({ id: 'a', pending: true, status: 0 }));
      controller.clear();
      expect(controller.getHistory()).to.have.length(0);
      proxy.emit('flow', rec({ id: 'a', status: 200 }));

      const history = controller.getHistory();
      expect(history).to.have.length(1);
      expect(history[0].pending).to.equal(undefined);
    });

    it('buildHar() leaves pending flows out', async () => {
      const { controller, proxy } = make({});
      await controller.enable();
      proxy.emit('flow', rec({ id: 'done' }));
      proxy.emit('flow', rec({ id: 'inflight', pending: true, status: 0 }));

      const har = controller.buildHar() as { log: { entries: unknown[] } };
      expect(har.log.entries).to.have.length(1);
    });

    it('replay() refuses a flow that is still in flight', async () => {
      const { controller, proxy } = make({});
      await controller.enable();
      proxy.emit('flow', rec({ id: 'a', pending: true, status: 0 }));

      let threw: unknown;
      try { await controller.replay('a'); } catch (e) { threw = e; }
      expect(threw).to.be.instanceOf(Error);
      expect((threw as Error).message).to.contain('in flight');
    });

    it('upserts adjust the byte budget by the cost delta, not by re-adding', async () => {
      // Correct accounting: A completes at ~22 KB (20 KB body + 2 KB flat),
      // B at ~7 KB → ~29 KB total, under the 30 KB budget, nothing evicted.
      // Broken accounting (add-without-subtract) would carry A's stale 2 KB
      // pending cost too, cross the budget, and evict A.
      const { controller, proxy } = make({ config: makeConfig({ maxBufferBytes: 30 * 1024 }) });
      await controller.enable();
      const trimmed: string[] = [];
      controller.on('trimmed', (ids: string[]) => trimmed.push(...ids));

      proxy.emit('flow', rec({ id: 'a', pending: true, status: 0 }));
      proxy.emit('flow', rec({ id: 'a', responseBody: Buffer.alloc(20 * 1024, 'x') }));
      proxy.emit('flow', rec({ id: 'b', pending: true, status: 0 }));
      proxy.emit('flow', rec({ id: 'b', responseBody: Buffer.alloc(5 * 1024, 'x') }));

      expect(trimmed).to.deep.equal([]);
      expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['a', 'b']);
    });

    it('persists a flow only once, on completion', async () => {
      const { store, files } = makeStore();
      const { controller, proxy } = make({ sessionStore: store });
      await controller.enable();

      proxy.emit('flow', rec({ id: 'a', pending: true, status: 0 }));
      await flushAsync();
      expect(files.has(`${store.sessionDir!}/flows.ndjson`)).to.equal(false);

      proxy.emit('flow', rec({ id: 'a', status: 200 }), { request: Buffer.from('req-bytes') });
      await flushAsync();
      const ndjson = files.get(`${store.sessionDir!}/flows.ndjson`)!.toString();
      expect(ndjson.trim().split('\n')).to.have.length(1);
      expect(ndjson).to.contain('"id":"a"');
      expect(files.get(`${store.sessionDir!}/bodies/a.req`)!.toString()).to.equal('req-bytes');
    });
  });

  describe('session store integration', () => {
    it('enable() starts a session; flows and full bodies persist; disable() finalizes', async () => {
      const { store, files } = makeStore();
      const { controller, proxy } = make({ sessionStore: store });
      await controller.enable();

      const dir = store.sessionDir!;
      expect(dir).to.match(/__network$/);

      proxy.emit('flow', rec({ id: 'a' }), { request: Buffer.from('full-request-bytes') });
      await flushAsync();

      expect(files.get(`${dir}/flows.ndjson`)!.toString()).to.contain('"id":"a"');
      expect(files.get(`${dir}/bodies/a.req`)!.toString()).to.equal('full-request-bytes');

      await controller.disable();
      const manifest = JSON.parse(files.get(`${dir}/session.json`)!.toString()) as { endedWall: number | null; flowCount: number };
      expect(manifest.endedWall).to.not.equal(null);
      expect(manifest.flowCount).to.equal(1);
    });

    it('does not persist flows dropped by the pause gate', async () => {
      const { store, files } = makeStore();
      const { controller, proxy } = make({ sessionStore: store });
      await controller.enable();
      controller.setPaused(true);
      proxy.emit('flow', rec({ id: 'hidden' }), { request: Buffer.from('x') });
      await flushAsync();
      expect(files.has(`${store.sessionDir!}/flows.ndjson`)).to.equal(false);
    });

    it('clear() empties the buffer but keeps the on-disk session files', async () => {
      const { store, files } = makeStore();
      const { controller, proxy } = make({ sessionStore: store });
      await controller.enable();
      proxy.emit('flow', rec({ id: 'a' }), { response: Buffer.from('kept') });
      await flushAsync();
      controller.clear();
      expect(controller.getHistory()).to.have.length(0);
      expect(files.get(`${store.sessionDir!}/bodies/a.res`)!.toString()).to.equal('kept');
    });

    it('replay() sends the full on-disk request body when the in-memory one was truncated', async () => {
      const { store } = makeStore();
      const { controller, proxy } = make({ sessionStore: store });
      await controller.enable();
      proxy.emit(
        'flow',
        rec({ id: 'big', requestBody: Buffer.from('trunc'), requestBodyTruncated: true }),
        { request: Buffer.from('the-complete-request-body') },
      );
      await flushAsync();

      expect(await controller.hasFullRequestBody('big')).to.equal(true);
      await controller.replay('big');
      expect(proxy.replays[0].requestBody!.toString()).to.equal('the-complete-request-body');
      expect(proxy.replays[0].requestBodyTruncated).to.equal(false);
    });

    it('getFullBody() prefers the complete on-disk bytes and falls back to the capped buffer', async () => {
      const { store } = makeStore();
      const { controller, proxy } = make({ sessionStore: store });
      await controller.enable();
      proxy.emit(
        'flow',
        rec({ id: 'a', responseBody: Buffer.from('capped'), responseBodyTruncated: true }),
        { response: Buffer.from('the-complete-response') },
      );
      // No disk copy for this one — memory fallback, honestly marked incomplete.
      proxy.emit('flow', rec({ id: 'b', responseBody: Buffer.from('capped-only'), responseBodyTruncated: true }));
      await flushAsync();

      const fromDisk = await controller.getFullBody('a', 'response', 'current');
      expect(fromDisk!.data.toString()).to.equal('the-complete-response');
      expect(fromDisk!.complete).to.equal(true);

      const fromMem = await controller.getFullBody('b', 'response', 'current');
      expect(fromMem!.data.toString()).to.equal('capped-only');
      expect(fromMem!.complete).to.equal(false);

      expect(await controller.getFullBody('missing', 'response', 'current')).to.equal(undefined);
    });

    it('a failing store never breaks capture', async () => {
      const sink: NetworkSessionSink = {
        ensureDir: () => Promise.reject(new Error('disk full')),
        appendFile: () => Promise.reject(new Error('disk full')),
        writeFile: () => Promise.reject(new Error('disk full')),
        readFile: () => Promise.reject(new Error('disk full')),
        exists: () => Promise.resolve(false),
      };
      const store = new NetworkSessionStore({ resolveRoot: () => '/out', sink, now: () => 1 });
      const { controller, proxy } = make({ sessionStore: store });
      await controller.enable();
      expect(controller.isEnabled).to.equal(true);
      proxy.emit('flow', rec({ id: 'a' }), { request: Buffer.from('x') });
      await flushAsync();
      expect(controller.getHistory().map((f) => f.id)).to.deep.equal(['a']);
      await controller.disable();
      expect(controller.isEnabled).to.equal(false);
    });
  });
});

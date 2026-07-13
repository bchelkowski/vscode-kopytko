import { expect } from 'chai';
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

class FakeProxy extends EventEmitter {
  started = false;
  stopped = false;
  rules = defaultRuleSet();
  port = 8888;
  start(): Promise<void> { this.started = true; return Promise.resolve(); }
  stop(): Promise<void> { this.stopped = true; return Promise.resolve(); }
  setRules(r: typeof this.rules): void { this.rules = r; }
  dispose(): void {}
}

function makeConfig(over: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    proxyPort: 8888,
    redirectPorts: [80],
    maxEntries: 5000,
    filterToActiveDevice: true,
    maxBodyBytes: 65536,
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
}) {
  const proxy = new FakeProxy();
  const redirect = new RedirectController(
    opts.runner ?? (() => Promise.resolve()),
    opts.platform ?? 'linux',
    opts.windowsDriver,
  );
  const device = 'device' in opts ? opts.device : DEVICE;
  const controller = new NetworkController({
    deviceManager: { getActiveDevice: () => device },
    redirect,
    readConfig: () => opts.config ?? makeConfig(),
    proxyFactory: () => proxy as unknown as CaptureProxy,
  });
  return { controller, proxy, redirect };
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

  it('disable() reverts redirect and stops the proxy', async () => {
    const { controller, proxy } = make({});
    await controller.enable();
    await controller.disable();
    expect(controller.isEnabled).to.equal(false);
    expect(proxy.stopped).to.equal(true);
    expect(controller.getState().redirectStatus).to.equal('off');
  });
});

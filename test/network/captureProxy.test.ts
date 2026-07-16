import { expect } from 'chai';
import * as http from 'http';
import * as net from 'net';
import * as zlib from 'zlib';
import { CaptureProxy } from '../../src/client/network/capture/captureProxy';
import type { FlowBodies, FlowRecord } from '../../src/client/network/capture/flow';
import { defaultRuleSet } from '../../src/client/network/capture/rewrite/rules';

/** Sends a raw HTTP request over a plain socket, bypassing Node's http client
 * (which always adds its own Host header) -- needed to exercise a request
 * that omits one entirely. */
function sendRawRequest(proxyPort: number, raw: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(proxyPort, '127.0.0.1', () => socket.write(raw));
    let data = '';
    socket.on('data', (c: Buffer) => { data += c.toString(); });
    socket.on('end', () => {
      const status = parseInt(data.split(' ')[1] ?? '0', 10);
      resolve({ status });
    });
    socket.on('error', reject);
  });
}

/** Starts a throwaway upstream server; resolves with its port + a close fn. */
function startUpstream(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** Makes an origin-form request through the proxy with an explicit Host header. */
function requestThroughProxy(
  proxyPort: number,
  hostHeader: string,
  opts: { method?: string; path?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: proxyPort, path: opts.path ?? '/', method: opts.method ?? 'GET', headers: { host: hostHeader, ...opts.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Next *terminal* flow — skips the `pending: true` in-flight emit that now
 * precedes every accepted exchange (see the pending-flow tests below). */
function nextFlow(proxy: CaptureProxy): Promise<FlowRecord> {
  return new Promise((resolve) => {
    const onFlow = (rec: FlowRecord): void => {
      if (rec.pending) return;
      proxy.off('flow', onFlow);
      resolve(rec);
    };
    proxy.on('flow', onFlow);
  });
}

/** Collects the next `n` flow emits — pending AND terminal, in order. */
function collectFlows(proxy: CaptureProxy, n: number): Promise<FlowRecord[]> {
  return new Promise((resolve) => {
    const flows: FlowRecord[] = [];
    const onFlow = (rec: FlowRecord): void => {
      flows.push(rec);
      if (flows.length === n) {
        proxy.off('flow', onFlow);
        resolve(flows);
      }
    };
    proxy.on('flow', onFlow);
  });
}

describe('network/CaptureProxy', () => {
  let proxy: CaptureProxy;
  let upstream: { port: number; close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await proxy?.stop();
    await upstream?.close();
    upstream = undefined;
  });

  it('bridges the request and rewrites https:// out of the response body', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"next":"https://api.test/x"}');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.equal('{"next":"http://api.test/x"}');

    const flow = await flowP;
    expect(flow.host).to.equal('127.0.0.1');
    expect(flow.status).to.equal(200);
    expect(flow.rewrittenBody).to.equal(true);
    expect(flow.upstreamScheme).to.equal('http');
    expect(flow.originalResponseBody?.toString()).to.contain('https://api.test/x');
  });

  it('rewrites wss:// out of the response body via the built-in rule', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"socket":"wss://api.test/live"}');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);

    expect(res.body).to.equal('{"socket":"ws://api.test/live"}');
    const flow = await flowP;
    expect(flow.rewrittenBody).to.equal(true);
  });

  it('a rewrite-exclude rule leaves a matched host+path byte-for-byte untouched, other paths still rewrite', async () => {
    upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(`{"path":"${req.url}","next":"https://api.test/x"}`);
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      rewriteExcludes: [{ id: 'x', enabled: true, hostPattern: '127.0.0.1', pathPattern: '/webhook' }],
    });
    await proxy.start();

    const excludedFlowP = nextFlow(proxy);
    const excludedRes = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, { path: '/webhook' });
    expect(excludedRes.body).to.contain('https://api.test/x'); // untouched
    const excludedFlow = await excludedFlowP;
    expect(excludedFlow.rewrittenBody).to.equal(false);

    const rewrittenFlowP = nextFlow(proxy);
    const rewrittenRes = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, { path: '/other' });
    expect(rewrittenRes.body).to.contain('http://api.test/x');
    const rewrittenFlow = await rewrittenFlowP;
    expect(rewrittenFlow.rewrittenBody).to.equal(true);
  });

  it('preserves the pre-rewrite request body alongside the rewritten one actually sent upstream', async () => {
    let receivedBody = '';
    upstream = await startUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      bodyRules: [
        { id: 'redact', enabled: true, direction: 'request', find: 'secret', replace: 'REDACTED', isRegex: false },
      ],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"token":"secret"}',
    });

    expect(receivedBody).to.equal('{"token":"REDACTED"}');

    const flow = await flowP;
    expect(flow.rewrittenBody).to.equal(true);
    expect(flow.requestBody?.toString()).to.equal('{"token":"REDACTED"}');
    expect(flow.originalRequestBody?.toString()).to.equal('{"token":"secret"}');
    // Response was untouched, so no original-response variant should exist.
    expect(flow.originalResponseBody).to.equal(undefined);
  });

  it('decodes a gzipped upstream body before rewriting and returns identity', async () => {
    upstream = await startUpstream((_req, res) => {
      const gz = zlib.gzipSync(Buffer.from('{"u":"https://x.test/1"}'));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(gz.length) });
      res.end(gz);
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    expect(res.headers['content-encoding']).to.equal(undefined);
    expect(res.body).to.equal('{"u":"http://x.test/1"}');
    expect(res.headers['content-length']).to.equal(String(res.body.length));
  });

  it('forwards request bodies for POST', async () => {
    let received = '';
    upstream = await startUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, { method: 'POST', body: 'hello=world' });
    expect(received).to.equal('hello=world');
  });

  it('falls back to http when auto-mode HTTPS handshake fails', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('plain');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'auto' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    expect(res.body).to.equal('plain');
    const flow = await flowP;
    expect(flow.upstreamScheme).to.equal('http');
  });

  it('forces Connection: close on every response, regardless of what upstream sent', async () => {
    // netsh interface portproxy (the Windows manual-capture relay) is a
    // lightweight raw-TCP forwarder, not a robust HTTP-aware proxy -- it can
    // fail to cleanly relay a keep-alive connection's closing sequence back
    // to the device for larger responses, leaving the device's TCP
    // connection stuck half-closed (observed live: FinWait2 on the device
    // leg while the proxy's own upstream leg had already closed cleanly).
    // Forcing a fresh connection per request sidesteps that ambiguity.
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', connection: 'keep-alive' });
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    expect(res.headers['connection']).to.equal('close');
  });

  it('bypasses the local hosts file when resolving the upstream host, via the injected resolver', async () => {
    // On the Windows manual-capture path, the hosts file entry that routes the
    // ROKU to this proxy is global to the OS -- it also applies to the proxy's
    // OWN outbound request to the real backend. Without a DNS bypass, this
    // request would resolve right back to itself and fail with
    // ECONNREFUSED <gatewayIp>:443. A hostname that cannot resolve via real
    // DNS at all (RFC 2606's .invalid) proves the injected resolver's
    // override is what made this connection succeed, not real DNS.
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('reached the real backend');
    });
    const fakeResolver = {
      resolve4: () => Promise.resolve(['127.0.0.1']),
      resolve6: () => Promise.reject(new Error('unused')),
    };

    proxy = new CaptureProxy({ port: 0, hostsResolver: fakeResolver });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const res = await requestThroughProxy(proxy.port, `this-host-does-not-resolve.invalid:${upstream.port}`);
    expect(res.status).to.equal(200);
    expect(res.body).to.equal('reached the real backend');
  });

  it('records a flow (not just a bare 400) when a request cannot even be parsed, e.g. missing Host header', async () => {
    // Previously this path returned a bare 400 with NO flow record at all --
    // permanently invisible in the panel no matter how many times the
    // device retried, indistinguishable from "never reached the proxy".
    proxy = new CaptureProxy({ port: 0 });
    await proxy.start();

    const flowP = nextFlow(proxy);
    // HTTP/1.0 doesn't require a Host header, so this reaches our own
    // parseTarget() instead of being rejected by Node's own HTTP parser
    // before our request handler ever runs (which is what happens for a
    // Host-less HTTP/1.1 request).
    const res = await sendRawRequest(proxy.port, 'GET / HTTP/1.0\r\n\r\n');
    expect(res.status).to.equal(400);

    const flow = await flowP;
    expect(flow.status).to.equal(400);
    expect(flow.error).to.contain('missing Host header');
  });

  it('records a flow when Node\'s own HTTP parser rejects a request before we ever see it', async () => {
    // Distinct from the parseTarget() gap above: this is Node's low-level
    // parser rejecting garbage before an IncomingMessage is even created --
    // handleRequest() (and recordUnparseableRequest) never run at all, only
    // the server's own 'clientError' event fires. Without a handler for it,
    // Node silently writes its own generic 400 and destroys the socket --
    // invisible to every flow-recording path in this file.
    proxy = new CaptureProxy({ port: 0 });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await sendRawRequest(proxy.port, 'NOT EVEN CLOSE TO HTTP\r\n\r\n');

    const flow = await flowP;
    expect(flow.status).to.equal(400);
    expect(flow.error).to.contain('Client error before request could be parsed');
  });

  it('map-local rule short-circuits the upstream and serves an injected body', async () => {
    let upstreamHits = 0;
    upstream = await startUpstream((_req, res) => {
      upstreamHits++;
      res.writeHead(200);
      res.end('SHOULD NOT BE REACHED');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      mapLocal: [{ id: 'm', enabled: true, hostPattern: '127.0.0.1', pathPattern: '/mock', body: '{"mocked":true}', contentType: 'application/json', status: 201 }],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, { path: '/mock' });
    const flow = await flowP;

    expect(upstreamHits).to.equal(0);
    expect(res.status).to.equal(201);
    expect(res.body).to.equal('{"mocked":true}');
    expect(flow.servedBy).to.equal('map-local');
  });

  it('map-local reads a file through the injected fileReader', async () => {
    proxy = new CaptureProxy({ port: 0, fileReader: (p) => Buffer.from(`file-contents-of:${p}`) });
    proxy.setRules({
      ...defaultRuleSet(),
      mapLocal: [{ id: 'm', enabled: true, hostPattern: 'x.test', filePath: '/fake/path.json', contentType: 'text/plain' }],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, 'x.test', { path: '/' });
    await flowP;
    expect(res.body).to.equal('file-contents-of:/fake/path.json');
  });

  it('map-local file-read failure surfaces as a 502 error flow', async () => {
    proxy = new CaptureProxy({
      port: 0,
      fileReader: () => { throw new Error('ENOENT'); },
    });
    proxy.setRules({
      ...defaultRuleSet(),
      mapLocal: [{ id: 'm', enabled: true, hostPattern: 'x.test', filePath: '/missing' }],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, 'x.test');
    const flow = await flowP;
    expect(res.status).to.equal(502);
    expect(flow.error).to.contain('ENOENT');
  });

  it('latency rule delays the response via the injected sleep and records the injected ms', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    const sleeps: number[] = [];
    proxy = new CaptureProxy({ port: 0, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      latency: [{ id: 'l', enabled: true, hostPattern: '127.0.0.1', delayMs: 250 }],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flow = await flowP;
    expect(sleeps).to.deep.equal([250]);
    expect(flow.latencyInjectedMs).to.equal(250);
  });

  it('header rules add a request header upstream and set a response header the device sees', async () => {
    let receivedAuth = '';
    upstream = await startUpstream((req, res) => {
      receivedAuth = String(req.headers['x-injected'] ?? '');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      headerRules: [
        { id: 'req', enabled: true, direction: 'request', op: 'set', name: 'x-injected', value: 'yes' },
        { id: 'res', enabled: true, direction: 'response', op: 'set', name: 'x-added', value: 'seen' },
      ],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flow = await flowP;
    expect(receivedAuth).to.equal('yes');
    expect(res.headers['x-added']).to.equal('seen');
    expect(flow.rewrittenHeaders).to.equal(true);
  });

  it('retains an image response body (capped) for preview', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    });

    proxy = new CaptureProxy({ port: 0, maxBodyBytes: 4 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flow = await flowP;
    expect(flow.responseBody).to.not.equal(undefined);
    expect(flow.responseBody!.length).to.equal(4); // capped
    expect(flow.responseBodyTruncated).to.equal(true);
  });

  it("emits the full pre-cap bodies alongside the capped record on 'flow'", async () => {
    const bigResponse = 'A'.repeat(64);
    upstream = await startUpstream((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(bigResponse);
      });
    });

    proxy = new CaptureProxy({ port: 0, maxBodyBytes: 8 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const pair = new Promise<{ rec: FlowRecord; bodies?: FlowBodies }>((resolve) => {
      const onFlow = (rec: FlowRecord, bodies?: FlowBodies): void => {
        if (rec.pending) return; // the in-flight emit carries no bodies
        proxy.off('flow', onFlow);
        resolve({ rec, bodies });
      };
      proxy.on('flow', onFlow);
    });
    const bigRequest = 'B'.repeat(32);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, {
      method: 'POST',
      body: bigRequest,
      headers: { 'content-type': 'text/plain' },
    });

    const { rec, bodies } = await pair;
    // The record's own buffers stay capped for display/HAR...
    expect(rec.requestBody!.length).to.equal(8);
    expect(rec.requestBodyTruncated).to.equal(true);
    expect(rec.responseBody!.length).to.equal(8);
    expect(rec.responseBodyTruncated).to.equal(true);
    // ...while the second event argument carries the complete bytes.
    expect(bodies!.request!.toString()).to.equal(bigRequest);
    expect(bodies!.response!.toString()).to.equal(bigResponse);
  });

  it('streams a Server-Sent-Events response through instead of buffering (no hang) and tags it', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: one\n\n');
      res.write('data: two\n\n');
      res.end();
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flow = await flowP;

    expect(res.body).to.contain('data: one');
    expect(res.body).to.contain('data: two');
    expect(flow.streamed).to.equal(true);
    expect(flow.status).to.equal(200);
    expect(flow.responseBody?.toString()).to.contain('data: one'); // teed capture
  });

  it('streams a no-content-length binary response through', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }); // chunked, no length
      res.write(Buffer.from([1, 2, 3]));
      res.end(Buffer.from([4, 5, 6]));
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flow = await flowP;
    expect(flow.streamed).to.equal(true);
    expect(flow.responseBytes).to.equal(6);
  });

  it('does NOT stream a text response that a body rule would rewrite (bridge stays intact)', async () => {
    upstream = await startUpstream((_req, res) => {
      // Chunked JSON (no content-length) that contains an https:// link.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"u":"https://api.test/x"}');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' }); // built-in https→http rule matches
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flow = await flowP;
    // Buffered + rewritten, not streamed.
    expect(flow.streamed).to.equal(undefined);
    expect(res.body).to.equal('{"u":"http://api.test/x"}');
  });

  it('block rule aborts the connection and records a blocked flow without contacting the upstream', async () => {
    let upstreamHits = 0;
    upstream = await startUpstream((_req, res) => {
      upstreamHits++;
      res.writeHead(200);
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      block: [{ id: 'b', enabled: true, hostPattern: '127.0.0.1', pathPattern: '/blocked' }],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    let reqErrored = false;
    try {
      await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, { path: '/blocked' });
    } catch {
      reqErrored = true; // connection reset by the block
    }
    const flow = await flowP;

    expect(reqErrored).to.equal(true);
    expect(upstreamHits).to.equal(0);
    expect(flow.blocked).to.equal(true);
    expect(flow.error).to.contain('Blocked by rule');
  });

  it('request breakpoint intercepts and applies the edited method/headers/body upstream', async () => {
    const seen: Array<{ method: string; auth: string; body: string }> = [];
    upstream = await startUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({ method: req.method ?? '', auth: String(req.headers['x-auth'] ?? ''), body: Buffer.concat(chunks).toString() });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });

    let interceptPhase = '';
    proxy = new CaptureProxy({
      port: 0,
      onIntercept: async (payload) => {
        interceptPhase = payload.phase;
        return { action: 'continue', method: 'PUT', headers: { ...payload.headers, 'x-auth': 'injected' }, body: '{"edited":true}' };
      },
    });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      breakpoints: [{ id: 'bp', enabled: true, hostPattern: '127.0.0.1', onRequest: true, onResponse: false }],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"orig":1}',
    });
    await flowP;

    expect(interceptPhase).to.equal('request');
    expect(seen).to.have.length(1);
    expect(seen[0].method).to.equal('PUT');
    expect(seen[0].auth).to.equal('injected');
    expect(seen[0].body).to.equal('{"edited":true}');
  });

  it('response breakpoint intercepts and applies the edited status/body to the device', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"orig":true}');
    });

    proxy = new CaptureProxy({
      port: 0,
      onIntercept: async (payload) => ({ action: 'continue', status: 503, body: payload.body.replace('orig', 'edited') }),
    });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      breakpoints: [{ id: 'bp', enabled: true, hostPattern: '127.0.0.1', onRequest: false, onResponse: true }],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flow = await flowP;

    expect(res.status).to.equal(503);
    expect(res.body).to.equal('{"edited":true}');
    expect(flow.status).to.equal(503);
  });

  it('aborting a request breakpoint resets the device connection with no upstream contact', async () => {
    let upstreamHits = 0;
    upstream = await startUpstream((_req, res) => {
      upstreamHits++;
      res.writeHead(200);
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0, onIntercept: async () => ({ action: 'abort' }) });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      breakpoints: [{ id: 'bp', enabled: true, hostPattern: '127.0.0.1', onRequest: true, onResponse: false }],
    });
    await proxy.start();

    const flowP = nextFlow(proxy);
    let errored = false;
    try {
      await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    } catch {
      errored = true;
    }
    const flow = await flowP;
    expect(errored).to.equal(true);
    expect(upstreamHits).to.equal(0);
    expect(flow.blocked).to.equal(true);
  });

  it('does not intercept when no breakpoint rule matches', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    let called = false;
    proxy = new CaptureProxy({ port: 0, onIntercept: async () => { called = true; return { action: 'continue' }; } });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' }); // no breakpoints
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    await flowP;
    expect(called).to.equal(false);
  });

  it('records a 502 flow when the upstream is unreachable', async () => {
    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    // Port 9 (discard) with nothing listening on loopback → connection refused.
    const res = await requestThroughProxy(proxy.port, '127.0.0.1:9');
    expect(res.status).to.equal(502);
    const flow = await flowP;
    expect(flow.status).to.equal(0);
    expect(flow.error).to.be.a('string');
  });

  it('reuses one upstream connection across sequential requests by default (keep-alive)', async () => {
    // Count distinct TCP sockets, not HTTP requests — reuse means both
    // requests arrive over the same socket.
    const seenSockets = new Set<unknown>();
    upstream = await startUpstream((req, res) => {
      seenSockets.add(req.socket);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);

    expect(seenSockets.size).to.equal(1);
  });

  it('opens a fresh upstream connection per request when keepAlive is disabled', async () => {
    const seenSockets = new Set<unknown>();
    upstream = await startUpstream((req, res) => {
      seenSockets.add(req.socket);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0, keepAlive: false });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);

    expect(seenSockets.size).to.equal(2);
  });

  it('captures per-phase timings for a bridged request', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flow = await flowP;

    expect(flow.timings).to.not.equal(undefined);
    expect(flow.timings!.waitMs).to.be.at.least(0);
    expect(flow.timings!.receiveMs).to.be.at.least(0);
    expect(flow.timings!.blockedMs).to.be.at.least(0);
    expect(flow.timings!.tlsMs).to.equal(undefined); // plain-http upstream — no TLS phase
    expect(flow.timings!.socketReused).to.equal(undefined);
  });

  it('marks reused sockets and omits dns/connect phases for them', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const second = await flowP;

    expect(second.timings!.socketReused).to.equal(true);
    expect(second.timings!.dnsMs).to.equal(undefined);
    expect(second.timings!.connectMs).to.equal(undefined);
    expect(second.timings!.tlsMs).to.equal(undefined);
  });

  it('omits timings on error flows', async () => {
    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, '127.0.0.1:9'); // nothing listening
    const flow = await flowP;
    expect(flow.error).to.be.a('string');
    expect(flow.timings).to.equal(undefined);
  });

  it('error flows retain the request body (headers-only error flows are useless for debugging)', async () => {
    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, '127.0.0.1:9', { method: 'POST', body: '{"poll":"payload"}' }); // nothing listening
    const flow = await flowP;

    expect(flow.error).to.be.a('string');
    expect(flow.requestBody?.toString()).to.equal('{"poll":"payload"}');
    expect(flow.requestBytes).to.equal('{"poll":"payload"}'.length);
  });

  it('a fresh (non-reused) connection failure surfaces immediately, with no retry', async () => {
    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    let flowCount = 0;
    proxy.on('flow', (rec: FlowRecord) => {
      if (!rec.pending) flowCount++; // terminal emits only — the in-flight emit isn't a retry
    });

    await requestThroughProxy(proxy.port, '127.0.0.1:9'); // nothing listening, never a pooled socket
    // Give a would-be (incorrect) retry a moment to surface as a second flow.
    await new Promise((r) => setTimeout(r, 50));

    expect(flowCount).to.equal(1);
  });

  it('retries once on a fresh connection when a reused pooled socket goes stale, and the flow succeeds', async () => {
    // Raw TCP server (not http.Server) so the test can precisely control what
    // happens on a *second* request over an already-answered, pooled socket --
    // simulating a keep-alive connection that died mid-idle (e.g. a network
    // hop silently dropping it) without racing Node's own close detection.
    const openSockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      openSockets.add(socket);
      socket.on('close', () => openSockets.delete(socket));
      let respondedOnce = false;
      let buf = '';
      socket.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        if (!buf.includes('\r\n\r\n')) return;
        buf = '';
        if (!respondedOnce) {
          respondedOnce = true;
          const body = 'ok';
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n${body}`);
        } else {
          // A second request landing on this same reused socket: go dark
          // instead of responding, producing a genuine "socket hang up" on
          // the client -- exactly what a silently-dropped pooled connection
          // looks like from the proxy's side.
          socket.destroy();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      proxy = new CaptureProxy({ port: 0 });
      proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
      await proxy.start();

      const first = await requestThroughProxy(proxy.port, `127.0.0.1:${port}`);
      expect(first.status).to.equal(200);

      const flowP = nextFlow(proxy);
      const second = await requestThroughProxy(proxy.port, `127.0.0.1:${port}`);
      const flow = await flowP;

      expect(second.status).to.equal(200);
      expect(second.body).to.equal('ok');
      expect(flow.error).to.equal(undefined);
    } finally {
      // The retried request's connection stays open (proxy-side keep-alive
      // pooling) -- net.Server.close() waits for all sockets to close on
      // their own, so destroy them explicitly rather than hang.
      for (const s of openSockets) s.destroy();
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  it('replay() re-sends a captured request upstream and emits a replayed-tagged flow', async () => {
    const seen: Array<{ method: string; url: string; auth: string; body: string }> = [];
    upstream = await startUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          auth: String(req.headers['x-auth'] ?? ''),
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    // Capture an original POST through the proxy...
    const firstFlowP = nextFlow(proxy);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, {
      method: 'POST',
      path: '/v1/create?x=1',
      headers: { 'content-type': 'application/json', 'x-auth': 'tok' },
      body: '{"a":1}',
    });
    const original = await firstFlowP;

    // ...then replay it with no device connection involved.
    const replayFlowP = nextFlow(proxy);
    proxy.replay(original);
    const replayed = await replayFlowP;

    expect(seen).to.have.length(2);
    expect(seen[1]).to.deep.equal(seen[0]); // same method, url, header, body
    expect(replayed.replayed).to.equal(true);
    expect(replayed.method).to.equal('POST');
    expect(replayed.status).to.equal(200);
    expect(original.replayed).to.equal(undefined);
  });

  it('still closes the device-facing connection per request even with upstream keep-alive on', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    expect(res.headers.connection).to.equal('close');
  });

  // ── in-flight (pending) flow emission ───────────────────────────────────────

  it('emits a pending flow first, then a terminal flow with the same id', async () => {
    upstream = await startUpstream((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      }, 30);
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowsP = collectFlows(proxy, 2);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, { path: '/slow?a=1' });
    const [first, second] = await flowsP;

    expect(first.pending).to.equal(true);
    expect(first.status).to.equal(0);
    expect(first.method).to.equal('GET');
    expect(first.host).to.equal('127.0.0.1');
    expect(first.path).to.equal('/slow');
    expect(first.query).to.equal('a=1');
    expect(Object.keys(first.requestHeaders)).to.not.be.empty;
    expect(second.id).to.equal(first.id);
    expect(second.pending).to.equal(undefined);
    expect(second.status).to.equal(200);
  });

  it('emits the pending flow before the request body has finished uploading', async () => {
    upstream = await startUpstream((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200);
        res.end('ok');
      });
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const pendingP = new Promise<FlowRecord>((resolve) => {
      const onFlow = (rec: FlowRecord): void => {
        if (!rec.pending) return;
        proxy.off('flow', onFlow);
        resolve(rec);
      };
      proxy.on('flow', onFlow);
    });
    const terminalP = nextFlow(proxy);

    // Send the body in two chunks with the pending emit awaited in between —
    // proof the flow surfaces while the upload is still in progress.
    const done = new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxy.port,
          method: 'POST',
          path: '/upload',
          headers: { host: `127.0.0.1:${upstream!.port}`, 'content-length': '8' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.write('firs');
      void pendingP.then(() => req.end('tpar')); // 4 + 4 = the declared content-length of 8
    });

    const pending = await pendingP;
    expect(pending.pending).to.equal(true);
    expect(pending.method).to.equal('POST');
    await done;
    const terminal = await terminalP;
    expect(terminal.id).to.equal(pending.id);
    expect(terminal.status).to.equal(200);
  });

  it('a blocked request emits exactly one flow — no pending placeholder flashes for it', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({
      ...defaultRuleSet(),
      defaultUpstreamScheme: 'http',
      block: [{ id: 'b', enabled: true, hostPattern: '127.0.0.1', pathPattern: '/blocked' }],
    });
    await proxy.start();

    const emits: FlowRecord[] = [];
    proxy.on('flow', (rec: FlowRecord) => emits.push(rec));

    try {
      await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`, { path: '/blocked' });
    } catch {
      // connection reset by the block — expected
    }
    await new Promise((r) => setTimeout(r, 30));

    expect(emits).to.have.length(1);
    expect(emits[0].pending).to.equal(undefined);
    expect(emits[0].blocked).to.equal(true);
  });

  it('an unparseable request emits exactly one flow, with no pending phase', async () => {
    proxy = new CaptureProxy({ port: 0 });
    await proxy.start();

    const emits: FlowRecord[] = [];
    proxy.on('flow', (rec: FlowRecord) => emits.push(rec));

    // HTTP/1.0 with no Host header reaches handleRequest but can't be parsed
    // into a target (HTTP/1.1 without Host is rejected by Node's parser first).
    await sendRawRequest(proxy.port, 'GET / HTTP/1.0\r\n\r\n');
    await new Promise((r) => setTimeout(r, 30));

    expect(emits).to.have.length(1);
    expect(emits[0].pending).to.equal(undefined);
    expect(emits[0].status).to.equal(400);
  });

  it('auto-mode https→http fallback still emits exactly one pending and one terminal flow', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'auto' }); // https attempt fails against the plain-http upstream, retries http
    await proxy.start();

    const emits: FlowRecord[] = [];
    proxy.on('flow', (rec: FlowRecord) => emits.push(rec));

    const res = await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    await new Promise((r) => setTimeout(r, 30));

    expect(res.status).to.equal(200);
    expect(emits).to.have.length(2);
    expect(emits[0].pending).to.equal(true);
    expect(emits[1].pending).to.equal(undefined);
    expect(emits[1].id).to.equal(emits[0].id);
    expect(emits[1].upstreamScheme).to.equal('http');
  });

  it('an errored exchange reuses the pending flow id', async () => {
    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowsP = collectFlows(proxy, 2);
    await requestThroughProxy(proxy.port, '127.0.0.1:9'); // nothing listening
    const [pending, terminal] = await flowsP;

    expect(pending.pending).to.equal(true);
    expect(terminal.id).to.equal(pending.id);
    expect(terminal.error).to.be.a('string');
  });

  it('replay() emits a pending flow and a terminal flow, both replay-tagged, same id', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const original = await (async () => {
      const p = nextFlow(proxy);
      await requestThroughProxy(proxy.port, `127.0.0.1:${upstream!.port}`);
      return p;
    })();

    const flowsP = collectFlows(proxy, 2);
    proxy.replay(original);
    const [pending, terminal] = await flowsP;

    expect(pending.pending).to.equal(true);
    expect(pending.replayed).to.equal(true);
    expect(terminal.id).to.equal(pending.id);
    expect(terminal.id).to.not.equal(original.id);
    expect(terminal.replayed).to.equal(true);
    expect(terminal.status).to.equal(200);
  });

  it('a streamed (SSE) response gets a pending flow up front and a terminal streamed flow on close', async () => {
    upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: one\n\n');
      res.end();
    });

    proxy = new CaptureProxy({ port: 0 });
    proxy.setRules({ ...defaultRuleSet(), defaultUpstreamScheme: 'http' });
    await proxy.start();

    const flowsP = collectFlows(proxy, 2);
    await requestThroughProxy(proxy.port, `127.0.0.1:${upstream.port}`);
    const [pending, terminal] = await flowsP;

    expect(pending.pending).to.equal(true);
    expect(terminal.id).to.equal(pending.id);
    expect(terminal.streamed).to.equal(true);
  });
});

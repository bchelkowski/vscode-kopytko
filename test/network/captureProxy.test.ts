import { expect } from 'chai';
import * as http from 'http';
import * as net from 'net';
import * as zlib from 'zlib';
import { CaptureProxy } from '../../src/client/network/capture/captureProxy';
import type { FlowRecord } from '../../src/client/network/capture/flow';
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

function nextFlow(proxy: CaptureProxy): Promise<FlowRecord> {
  return new Promise((resolve) => proxy.once('flow', resolve));
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
});

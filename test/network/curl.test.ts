import { expect } from 'chai';
import { buildCurl, buildUrl } from '../../src/client/network/capture/curl';
import type { FlowRecord } from '../../src/client/network/capture/flow';

function rec(over: Partial<FlowRecord> = {}): FlowRecord {
  return {
    id: 'f1',
    startedWall: 0,
    method: 'GET',
    host: 'api.test',
    port: 80,
    path: '/v1/items',
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

describe('network/curl', () => {
  describe('buildUrl', () => {
    it('uses the upstream scheme and omits the port for the bridge default (device :80 → https)', () => {
      expect(buildUrl(rec())).to.equal('https://api.test/v1/items');
    });

    it('keeps an explicit non-default port', () => {
      expect(buildUrl(rec({ port: 8080, upstreamScheme: 'http' }))).to.equal('http://api.test:8080/v1/items');
    });

    it('omits scheme-default ports', () => {
      expect(buildUrl(rec({ port: 443, upstreamScheme: 'https' }))).to.equal('https://api.test/v1/items');
      expect(buildUrl(rec({ port: 80, upstreamScheme: 'http' }))).to.equal('http://api.test/v1/items');
    });

    it('appends the query string', () => {
      expect(buildUrl(rec({ query: 'a=1&b=2' }))).to.equal('https://api.test/v1/items?a=1&b=2');
    });
  });

  describe('buildCurl', () => {
    it('omits -X for GET and quotes the URL', () => {
      const cmd = buildCurl(rec());
      expect(cmd).to.contain("curl \\\n  'https://api.test/v1/items'");
      expect(cmd).to.not.contain('-X');
    });

    it('adds -X for non-GET methods', () => {
      expect(buildCurl(rec({ method: 'POST' }))).to.contain('-X POST');
    });

    it('includes request headers but skips proxy-managed ones', () => {
      const cmd = buildCurl(rec({
        requestHeaders: {
          host: 'api.test',
          'content-length': '5',
          connection: 'keep-alive',
          'accept-encoding': 'gzip',
          'x-auth': 'token-1',
          accept: 'application/json',
        },
      }));
      expect(cmd).to.contain("-H 'x-auth: token-1'");
      expect(cmd).to.contain("-H 'accept: application/json'");
      expect(cmd).to.not.contain('host:');
      expect(cmd).to.not.contain('content-length');
      expect(cmd).to.not.contain('connection');
      expect(cmd).to.not.contain('accept-encoding');
    });

    it('emits one -H per value for repeated headers', () => {
      const cmd = buildCurl(rec({ requestHeaders: { 'set-thing': ['a', 'b'] } }));
      expect(cmd).to.contain("-H 'set-thing: a'");
      expect(cmd).to.contain("-H 'set-thing: b'");
    });

    it('includes a text request body with single quotes escaped', () => {
      const cmd = buildCurl(rec({
        method: 'POST',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: Buffer.from(`{"name":"o'brien"}`),
      }));
      expect(cmd).to.contain(`--data-raw '{"name":"o'\\''brien"}'`);
    });

    it('notes truncation instead of pretending the body is complete', () => {
      const cmd = buildCurl(rec({
        method: 'POST',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: Buffer.from('{"partial":true'),
        requestBodyTruncated: true,
      }));
      expect(cmd).to.contain('# NOTE: request body was truncated');
    });

    it('does not inline binary request bodies', () => {
      const cmd = buildCurl(rec({
        method: 'POST',
        requestHeaders: { 'content-type': 'application/octet-stream' },
        requestBody: Buffer.from([0, 1, 2, 255]),
      }));
      expect(cmd).to.contain('<binary body omitted>');
    });
  });
});

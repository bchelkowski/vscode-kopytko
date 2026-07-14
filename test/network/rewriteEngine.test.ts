import { expect } from 'chai';
import * as zlib from 'zlib';
import {
  applyBodyRewrites,
  applyHeaderRules,
  decodeBody,
  isImageContentType,
  isTextContentType,
  rewriteResponseHeaders,
} from '../../src/client/network/capture/rewrite/engine';
import {
  defaultRuleSet,
  findLatencyMs,
  findMapLocal,
  resolveUpstreamScheme,
  ruleSetFromConfig,
  type RuleSet,
} from '../../src/client/network/capture/rewrite/rules';

describe('network/rewrite/engine', () => {
  describe('isTextContentType', () => {
    it('detects json/xml/text/javascript', () => {
      expect(isTextContentType('application/json; charset=utf-8')).to.equal(true);
      expect(isTextContentType('text/html')).to.equal(true);
      expect(isTextContentType('application/xml')).to.equal(true);
      expect(isTextContentType('application/vnd.api+json')).to.equal(true);
      expect(isTextContentType('image/png')).to.equal(false);
      expect(isTextContentType('')).to.equal(false);
    });
  });

  describe('decodeBody', () => {
    const raw = Buffer.from('{"u":"https://api.test/x"}');
    it('decodes gzip, deflate, br and passes identity through', () => {
      expect(decodeBody(zlib.gzipSync(raw), 'gzip').toString()).to.equal(raw.toString());
      expect(decodeBody(zlib.deflateSync(raw), 'deflate').toString()).to.equal(raw.toString());
      expect(decodeBody(zlib.brotliCompressSync(raw), 'br').toString()).to.equal(raw.toString());
      expect(decodeBody(raw, undefined).toString()).to.equal(raw.toString());
    });
    it('returns raw bytes on a corrupt encoding rather than throwing', () => {
      expect(decodeBody(Buffer.from('not gzip'), 'gzip').toString()).to.equal('not gzip');
    });
  });

  describe('applyBodyRewrites', () => {
    const rules = defaultRuleSet();

    it('rewrites https:// to http:// in a json body and reports the change', () => {
      const body = Buffer.from('{"a":"https://x.test/1","b":"https://y.test/2"}');
      const out = applyBodyRewrites(body, rules, { host: 'x.test', contentType: 'application/json', direction: 'response' });
      expect(out.changed).to.equal(true);
      expect(out.body.toString()).to.equal('{"a":"http://x.test/1","b":"http://y.test/2"}');
      // Content length shrinks by one char per occurrence.
      expect(out.body.length).to.equal(body.length - 2);
    });

    it('leaves binary content types untouched', () => {
      const body = Buffer.from('https://x.test');
      const out = applyBodyRewrites(body, rules, { host: 'x.test', contentType: 'image/png', direction: 'response' });
      expect(out.changed).to.equal(false);
      expect(out.body).to.equal(body);
    });

    it('does not touch request bodies with a response-only rule', () => {
      const body = Buffer.from('https://x.test');
      const out = applyBodyRewrites(body, rules, { host: 'x.test', contentType: 'application/json', direction: 'request' });
      expect(out.changed).to.equal(false);
    });

    it('honours hostPattern scoping', () => {
      const scoped: RuleSet = {
        ...defaultRuleSet(),
        bodyRules: [{ id: 'r', enabled: true, direction: 'response', hostPattern: 'only.test', find: 'A', replace: 'B' }],
      };
      const hit = applyBodyRewrites(Buffer.from('A'), scoped, { host: 'only.test', contentType: 'text/plain', direction: 'response' });
      const miss = applyBodyRewrites(Buffer.from('A'), scoped, { host: 'other.test', contentType: 'text/plain', direction: 'response' });
      expect(hit.body.toString()).to.equal('B');
      expect(miss.body.toString()).to.equal('A');
    });

    it('supports regex rules and ignores invalid regex safely', () => {
      const rx: RuleSet = {
        ...defaultRuleSet(),
        bodyRules: [{ id: 'r', enabled: true, direction: 'response', find: 'v\\d+', replace: 'vN', isRegex: true }],
      };
      const out = applyBodyRewrites(Buffer.from('v1 v22 v3'), rx, { host: 'h', contentType: 'text/plain', direction: 'response' });
      expect(out.body.toString()).to.equal('vN vN vN');

      const bad: RuleSet = {
        ...defaultRuleSet(),
        bodyRules: [{ id: 'r', enabled: true, direction: 'response', find: '(', replace: 'x', isRegex: true }],
      };
      const safe = applyBodyRewrites(Buffer.from('abc'), bad, { host: 'h', contentType: 'text/plain', direction: 'response' });
      expect(safe.body.toString()).to.equal('abc');
    });
  });

  describe('rewriteResponseHeaders', () => {
    it('downgrades Location, strips cookie Secure, drops HSTS and encoding/length', () => {
      const out = rewriteResponseHeaders({
        'location': 'https://x.test/next',
        'set-cookie': ['sid=1; Path=/; Secure; HttpOnly', 'a=2; SameSite=None; Secure'],
        'strict-transport-security': 'max-age=63072000',
        'content-encoding': 'gzip',
        'content-length': '123',
        'transfer-encoding': 'chunked',
        'content-type': 'application/json',
      });

      expect(out['location']).to.equal('http://x.test/next');
      expect(out['strict-transport-security']).to.equal(undefined);
      expect(out['content-encoding']).to.equal(undefined);
      expect(out['content-length']).to.equal(undefined);
      expect(out['transfer-encoding']).to.equal(undefined);
      expect(out['content-type']).to.equal('application/json');

      const cookies = out['set-cookie'] as string[];
      expect(cookies[0]).to.not.match(/secure/i);
      expect(cookies[0]).to.contain('HttpOnly');
      expect(cookies[1]).to.contain('SameSite=Lax');
      expect(cookies[1]).to.not.match(/secure/i);
    });
  });

  describe('resolveUpstreamScheme', () => {
    it('uses per-host overrides then the default', () => {
      const rules: RuleSet = {
        bodyRules: [],
        defaultUpstreamScheme: 'https',
        upstreamSchemes: [{ hostPattern: '*.plain.test', scheme: 'http' }],
      };
      expect(resolveUpstreamScheme('api.plain.test', rules)).to.equal('http');
      expect(resolveUpstreamScheme('api.secure.test', rules)).to.equal('https');
    });
  });

  describe('isImageContentType', () => {
    it('detects image/* only', () => {
      expect(isImageContentType('image/png')).to.equal(true);
      expect(isImageContentType('IMAGE/JPEG')).to.equal(true);
      expect(isImageContentType('application/json')).to.equal(false);
      expect(isImageContentType('')).to.equal(false);
    });
  });

  describe('applyHeaderRules', () => {
    it('sets, adds, and removes headers case-insensitively', () => {
      const headers = { 'x-keep': 'v', 'x-remove': 'gone', 'x-multi': 'a' };
      const rules = [
        { id: '1', enabled: true, direction: 'request' as const, op: 'set' as const, name: 'X-Set', value: 's' },
        { id: '2', enabled: true, direction: 'request' as const, op: 'remove' as const, name: 'x-remove' },
        { id: '3', enabled: true, direction: 'request' as const, op: 'add' as const, name: 'x-multi', value: 'b' },
      ];
      const out = applyHeaderRules(headers, rules, { host: 'h.test', direction: 'request' });
      expect(out.changed).to.equal(true);
      expect(out.headers['x-set']).to.equal('s');
      expect(out.headers['x-remove']).to.equal(undefined);
      expect(out.headers['x-multi']).to.deep.equal(['a', 'b']);
      expect(out.headers['x-keep']).to.equal('v');
    });

    it('refuses to touch proxy-owned header names', () => {
      const rules = [
        { id: '1', enabled: true, direction: 'response' as const, op: 'set' as const, name: 'content-length', value: '0' },
        { id: '2', enabled: true, direction: 'response' as const, op: 'remove' as const, name: 'connection' },
      ];
      const out = applyHeaderRules({ connection: 'close' }, rules, { host: 'h.test', direction: 'response' });
      expect(out.changed).to.equal(false);
      expect(out.headers.connection).to.equal('close');
    });

    it('scopes by direction and host', () => {
      const rules = [
        { id: '1', enabled: true, direction: 'request' as const, hostPattern: 'only.test', op: 'set' as const, name: 'x', value: '1' },
      ];
      const wrongDir = applyHeaderRules({}, rules, { host: 'only.test', direction: 'response' });
      const wrongHost = applyHeaderRules({}, rules, { host: 'other.test', direction: 'request' });
      const hit = applyHeaderRules({}, rules, { host: 'only.test', direction: 'request' });
      expect(wrongDir.changed).to.equal(false);
      expect(wrongHost.changed).to.equal(false);
      expect(hit.headers.x).to.equal('1');
    });

    it('is a no-op for a disabled rule', () => {
      const rules = [{ id: '1', enabled: false, direction: 'request' as const, op: 'set' as const, name: 'x', value: '1' }];
      const out = applyHeaderRules({}, rules, { host: 'h.test', direction: 'request' });
      expect(out.changed).to.equal(false);
    });
  });

  describe('findMapLocal / findLatencyMs', () => {
    const rules: RuleSet = {
      ...defaultRuleSet(),
      mapLocal: [
        { id: 'a', enabled: true, hostPattern: 'api.test', pathPattern: '/v1/*', body: '{}' },
        { id: 'b', enabled: false, hostPattern: 'api.test', pathPattern: '/off', body: 'x' },
      ],
      latency: [
        { id: 'l1', enabled: true, hostPattern: 'api.test', pathPattern: '/slow', delayMs: 300 },
        { id: 'l2', enabled: false, hostPattern: 'api.test', delayMs: 999 },
      ],
    };

    it('returns the first enabled map-local match', () => {
      expect(findMapLocal(rules, 'api.test', '/v1/items')?.id).to.equal('a');
      expect(findMapLocal(rules, 'api.test', '/other')).to.equal(undefined);
      expect(findMapLocal(rules, 'api.test', '/off')).to.equal(undefined); // disabled
    });

    it('returns the delay for the first enabled latency match, else 0', () => {
      expect(findLatencyMs(rules, 'api.test', '/slow')).to.equal(300);
      expect(findLatencyMs(rules, 'api.test', '/fast')).to.equal(0);
    });
  });

  describe('ruleSetFromConfig', () => {
    it('accepts the legacy 3-arg form and defaults the new arrays to empty', () => {
      const rs = ruleSetFromConfig([], [], 'https');
      expect(rs.mapLocal).to.deep.equal([]);
      expect(rs.latency).to.deep.equal([]);
      expect(rs.headerRules).to.deep.equal([]);
    });

    it('coerces the new rule arrays and drops malformed entries', () => {
      const rs = ruleSetFromConfig(
        [],
        [],
        'https',
        [{ hostPattern: 'a', body: 'x' }, { hostPattern: 'b' }], // second has no file/body → dropped
        [{ hostPattern: 'a', delayMs: 100 }, { hostPattern: 'b', delayMs: 0 }], // second not > 0 → dropped
        [{ name: 'X', op: 'set', value: '1' }, { op: 'set' }], // second has no name → dropped
      );
      expect(rs.mapLocal).to.have.length(1);
      expect(rs.latency).to.have.length(1);
      expect(rs.headerRules).to.have.length(1);
      expect(rs.headerRules![0].name).to.equal('X');
    });
  });
});

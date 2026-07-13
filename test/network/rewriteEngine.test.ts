import { expect } from 'chai';
import * as zlib from 'zlib';
import {
  applyBodyRewrites,
  decodeBody,
  isTextContentType,
  rewriteResponseHeaders,
} from '../../src/client/network/capture/rewrite/engine';
import { defaultRuleSet, resolveUpstreamScheme, type RuleSet } from '../../src/client/network/capture/rewrite/rules';

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
});

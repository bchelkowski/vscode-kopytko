import { expect } from 'chai';
import * as zlib from 'zlib';
import {
  applyBodyRewrites,
  applyHeaderRules,
  decodeBody,
  hasMatchingBodyRules,
  isImageContentType,
  isTextContentType,
  rewriteResponseHeaders,
} from '../../src/client/network/capture/rewrite/engine';
import {
  defaultRuleSet,
  findBlock,
  findBreakpoint,
  findLatencyMs,
  findMapLocal,
  findRewriteExclude,
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
      const out = applyBodyRewrites(body, rules, { host: 'x.test', path: '/', contentType: 'application/json', direction: 'response' });
      expect(out.changed).to.equal(true);
      expect(out.body.toString()).to.equal('{"a":"http://x.test/1","b":"http://y.test/2"}');
      // Content length shrinks by one char per occurrence.
      expect(out.body.length).to.equal(body.length - 2);
    });

    it('rewrites wss:// to ws:// via the built-in rule too', () => {
      const body = Buffer.from('{"socket":"wss://x.test/live"}');
      const out = applyBodyRewrites(body, rules, { host: 'x.test', path: '/', contentType: 'application/json', direction: 'response' });
      expect(out.changed).to.equal(true);
      expect(out.body.toString()).to.equal('{"socket":"ws://x.test/live"}');
    });

    it('leaves binary content types untouched', () => {
      const body = Buffer.from('https://x.test');
      const out = applyBodyRewrites(body, rules, { host: 'x.test', path: '/', contentType: 'image/png', direction: 'response' });
      expect(out.changed).to.equal(false);
      expect(out.body).to.equal(body);
    });

    it('does not touch request bodies with a response-only rule', () => {
      const body = Buffer.from('https://x.test');
      const out = applyBodyRewrites(body, rules, { host: 'x.test', path: '/', contentType: 'application/json', direction: 'request' });
      expect(out.changed).to.equal(false);
    });

    it('honours hostPattern scoping', () => {
      const scoped: RuleSet = {
        ...defaultRuleSet(),
        bodyRules: [{ id: 'r', enabled: true, direction: 'response', hostPattern: 'only.test', find: 'A', replace: 'B' }],
      };
      const hit = applyBodyRewrites(Buffer.from('A'), scoped, { host: 'only.test', path: '/', contentType: 'text/plain', direction: 'response' });
      const miss = applyBodyRewrites(Buffer.from('A'), scoped, { host: 'other.test', path: '/', contentType: 'text/plain', direction: 'response' });
      expect(hit.body.toString()).to.equal('B');
      expect(miss.body.toString()).to.equal('A');
    });

    it('honours pathPattern scoping', () => {
      const scoped: RuleSet = {
        ...defaultRuleSet(),
        bodyRules: [{ id: 'r', enabled: true, direction: 'response', pathPattern: '/v1/*', find: 'A', replace: 'B' }],
      };
      const hit = applyBodyRewrites(Buffer.from('A'), scoped, { host: 'h', path: '/v1/items', contentType: 'text/plain', direction: 'response' });
      const miss = applyBodyRewrites(Buffer.from('A'), scoped, { host: 'h', path: '/v2/items', contentType: 'text/plain', direction: 'response' });
      expect(hit.body.toString()).to.equal('B');
      expect(miss.body.toString()).to.equal('A');
    });

    it('supports regex rules and ignores invalid regex safely', () => {
      const rx: RuleSet = {
        ...defaultRuleSet(),
        bodyRules: [{ id: 'r', enabled: true, direction: 'response', find: 'v\\d+', replace: 'vN', isRegex: true }],
      };
      const out = applyBodyRewrites(Buffer.from('v1 v22 v3'), rx, { host: 'h', path: '/', contentType: 'text/plain', direction: 'response' });
      expect(out.body.toString()).to.equal('vN vN vN');

      const bad: RuleSet = {
        ...defaultRuleSet(),
        bodyRules: [{ id: 'r', enabled: true, direction: 'response', find: '(', replace: 'x', isRegex: true }],
      };
      const safe = applyBodyRewrites(Buffer.from('abc'), bad, { host: 'h', path: '/', contentType: 'text/plain', direction: 'response' });
      expect(safe.body.toString()).to.equal('abc');
    });

    it('a matching rewrite-exclude wins over every otherwise-applicable rule', () => {
      const excluded: RuleSet = {
        ...defaultRuleSet(),
        rewriteExcludes: [{ id: 'x', enabled: true, hostPattern: 'signed.test', pathPattern: '/webhook' }],
      };
      const body = Buffer.from('{"cb":"https://signed.test/x","sig":"wss://signed.test/x"}');
      const excludedOut = applyBodyRewrites(body, excluded, { host: 'signed.test', path: '/webhook', contentType: 'application/json', direction: 'response' });
      expect(excludedOut.changed).to.equal(false);
      expect(excludedOut.body).to.equal(body);

      // Same host, a path the exclude doesn't cover — rewriting still applies.
      const otherPath = applyBodyRewrites(body, excluded, { host: 'signed.test', path: '/other', contentType: 'application/json', direction: 'response' });
      expect(otherPath.changed).to.equal(true);
    });

    it('a disabled rewrite-exclude does not suppress rewriting', () => {
      const rs: RuleSet = {
        ...defaultRuleSet(),
        rewriteExcludes: [{ id: 'x', enabled: false, hostPattern: 'signed.test' }],
      };
      const out = applyBodyRewrites(Buffer.from('https://signed.test'), rs, { host: 'signed.test', path: '/', contentType: 'text/plain', direction: 'response' });
      expect(out.changed).to.equal(true);
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

  describe('findBlock', () => {
    const rules: RuleSet = {
      ...defaultRuleSet(),
      block: [
        { id: 'b1', enabled: true, hostPattern: 'ads.test' },
        { id: 'b2', enabled: true, hostPattern: 'api.test', pathPattern: '/fail/*' },
        { id: 'b3', enabled: false, hostPattern: 'off.test' },
      ],
    };
    it('matches by host and optional path, ignoring disabled rules', () => {
      expect(findBlock(rules, 'ads.test', '/anything')?.id).to.equal('b1');
      expect(findBlock(rules, 'api.test', '/fail/x')?.id).to.equal('b2');
      expect(findBlock(rules, 'api.test', '/ok')).to.equal(undefined);
      expect(findBlock(rules, 'off.test', '/')).to.equal(undefined);
    });
  });

  describe('findBreakpoint', () => {
    const rules: RuleSet = {
      ...defaultRuleSet(),
      breakpoints: [
        { id: 'bp1', enabled: true, hostPattern: 'api.test', pathPattern: '/edit/*', onRequest: true, onResponse: false },
        { id: 'bp2', enabled: true, hostPattern: 'other.test', onRequest: false, onResponse: false }, // neither side → skipped
        { id: 'bp3', enabled: false, hostPattern: 'off.test', onRequest: true, onResponse: true },
      ],
    };
    it('matches an enabled rule with at least one side active', () => {
      expect(findBreakpoint(rules, 'api.test', '/edit/x')?.id).to.equal('bp1');
      expect(findBreakpoint(rules, 'api.test', '/other')).to.equal(undefined);
      expect(findBreakpoint(rules, 'other.test', '/')).to.equal(undefined); // no side active
      expect(findBreakpoint(rules, 'off.test', '/')).to.equal(undefined); // disabled
    });
  });

  describe('hasMatchingBodyRules', () => {
    it('is true when an enabled rule would rewrite this response, false otherwise', () => {
      const rs = defaultRuleSet(); // built-in https→http and wss→ws response rules, all hosts
      expect(hasMatchingBodyRules(rs, 'any.test', '/', 'application/json', 'response')).to.equal(true);
      expect(hasMatchingBodyRules(rs, 'any.test', '/', 'image/png', 'response')).to.equal(false); // binary
      expect(hasMatchingBodyRules(rs, 'any.test', '/', 'application/json', 'request')).to.equal(false); // wrong direction
    });

    it('is false when a rewrite-exclude matches the host+path, even though a body rule would otherwise apply', () => {
      const rs: RuleSet = {
        ...defaultRuleSet(),
        rewriteExcludes: [{ id: 'x', enabled: true, hostPattern: 'signed.test', pathPattern: '/webhook' }],
      };
      expect(hasMatchingBodyRules(rs, 'signed.test', '/webhook', 'application/json', 'response')).to.equal(false);
      expect(hasMatchingBodyRules(rs, 'signed.test', '/other', 'application/json', 'response')).to.equal(true);
    });

    it('respects pathPattern scoping on the body rule itself', () => {
      const rs: RuleSet = {
        ...defaultRuleSet(),
        bodyRules: [{ id: 'r', enabled: true, direction: 'response', pathPattern: '/v1/*', find: 'A', replace: 'B' }],
      };
      expect(hasMatchingBodyRules(rs, 'h', '/v1/items', 'text/plain', 'response')).to.equal(true);
      expect(hasMatchingBodyRules(rs, 'h', '/v2/items', 'text/plain', 'response')).to.equal(false);
    });
  });

  describe('findRewriteExclude', () => {
    const rules: RuleSet = {
      ...defaultRuleSet(),
      rewriteExcludes: [
        { id: 'e1', enabled: true, hostPattern: 'signed.test', pathPattern: '/webhook' },
        { id: 'e2', enabled: true, pathPattern: '/no-touch' }, // no host = every host
        { id: 'e3', enabled: false, hostPattern: 'off.test' },
      ],
    };
    it('matches by host and/or path, ignoring disabled rules', () => {
      expect(findRewriteExclude(rules, 'signed.test', '/webhook')?.id).to.equal('e1');
      expect(findRewriteExclude(rules, 'signed.test', '/other')).to.equal(undefined);
      expect(findRewriteExclude(rules, 'any.test', '/no-touch')?.id).to.equal('e2');
      expect(findRewriteExclude(rules, 'off.test', '/')).to.equal(undefined); // disabled
    });
  });

  describe('ruleSetFromConfig', () => {
    it('accepts the legacy 3-arg form and defaults the new arrays to empty', () => {
      const rs = ruleSetFromConfig([], [], 'https');
      expect(rs.mapLocal).to.deep.equal([]);
      expect(rs.latency).to.deep.equal([]);
      expect(rs.headerRules).to.deep.equal([]);
      expect(rs.block).to.deep.equal([]);
      expect(rs.breakpoints).to.deep.equal([]);
      expect(rs.rewriteExcludes).to.deep.equal([]);
    });

    it('defaults bodyRules to both built-in rewrite rules (https→http, wss→ws) when empty', () => {
      const rs = ruleSetFromConfig([], [], 'https');
      expect(rs.bodyRules.map((r) => r.id).sort()).to.deep.equal(['builtin-https-to-http', 'builtin-wss-to-ws']);
    });

    it('coerces the new rule arrays and drops malformed entries', () => {
      const rs = ruleSetFromConfig(
        [],
        [],
        'https',
        [{ hostPattern: 'a', body: 'x' }, { hostPattern: 'b' }], // second has no file/body → dropped
        [{ hostPattern: 'a', delayMs: 100 }, { hostPattern: 'b', delayMs: 0 }], // second not > 0 → dropped
        [{ name: 'X', op: 'set', value: '1' }, { op: 'set' }], // second has no name → dropped
        [{ hostPattern: 'ads.test' }, { pathPattern: '/x' }], // second has no host → dropped
        [{ hostPattern: 'api.test', onResponse: true }, { pathPattern: '/x' }], // second has no host → dropped
        [{ hostPattern: 'signed.test', pathPattern: '/webhook' }, {}], // second has neither host nor path → dropped
      );
      expect(rs.mapLocal).to.have.length(1);
      expect(rs.latency).to.have.length(1);
      expect(rs.headerRules).to.have.length(1);
      expect(rs.headerRules![0].name).to.equal('X');
      expect(rs.block).to.have.length(1);
      expect(rs.block![0].hostPattern).to.equal('ads.test');
      expect(rs.breakpoints).to.have.length(1);
      // onRequest defaults to false when onResponse was explicitly set.
      expect(rs.breakpoints![0].onResponse).to.equal(true);
      expect(rs.breakpoints![0].onRequest).to.equal(false);
      expect(rs.rewriteExcludes).to.have.length(1);
      expect(rs.rewriteExcludes![0].hostPattern).to.equal('signed.test');
    });

    it('accepts a rewrite-exclude with only a pathPattern (no host = every host)', () => {
      const rs = ruleSetFromConfig([], [], 'https', [], [], [], [], [], [{ pathPattern: '/no-touch' }]);
      expect(rs.rewriteExcludes).to.have.length(1);
      expect(rs.rewriteExcludes![0].hostPattern).to.equal(undefined);
      expect(rs.rewriteExcludes![0].pathPattern).to.equal('/no-touch');
    });
  });
});

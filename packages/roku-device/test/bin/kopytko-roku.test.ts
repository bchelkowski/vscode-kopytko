import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import {
  parseArgs,
  resolveConfig,
  requireHost,
  requireFlag,
  paramsToRecord,
  printResult,
  type CliFlags,
} from '../../bin/kopytko-roku';

function emptyFlags(overrides: Partial<CliFlags> = {}): CliFlags {
  return { force: false, escaped: false, json: false, help: false, version: false, params: [], ...overrides };
}

describe('kopytko-roku CLI', () => {
  describe('parseArgs', () => {
    it('parses group, op, and --host/--port flags', () => {
      const parsed = parseArgs(['ecp', 'device-info', '--host', '192.168.1.1', '--port', '8060']);
      expect(parsed.group).to.equal('ecp');
      expect(parsed.op).to.equal('device-info');
      expect(parsed.flags.host).to.equal('192.168.1.1');
      expect(parsed.flags.port).to.equal('8060');
    });

    it('parses boolean flags without consuming the next arg', () => {
      const parsed = parseArgs(['ecp', 'exit-app', '--host', 'x', '--app', 'dev', '--force']);
      expect(parsed.flags.force).to.be.true;
      expect(parsed.flags.app).to.equal('dev');
    });

    it('collects repeatable --param key=value pairs', () => {
      const parsed = parseArgs(['ecp', 'launch', '--host', 'x', '--app', 'dev', '--param', 'contentId=42', '--param', 'mediaType=movie']);
      expect(parsed.flags.params).to.deep.equal([['contentId', '42'], ['mediaType', 'movie']]);
    });

    it('parses --escaped as a boolean flag and --keys/--sections as pipe-separated strings', () => {
      const parsed = parseArgs([
        'ecp', 'registry', '--host', 'x', '--app', 'dev',
        '--escaped', '--keys', 'foo|bar', '--sections', 'general',
      ]);
      expect(parsed.flags.escaped).to.be.true;
      expect(parsed.flags.keys).to.equal('foo|bar');
      expect(parsed.flags.sections).to.equal('general');
      expect(parsed.flags.app).to.equal('dev');
    });

    it('parses --help and --json', () => {
      const parsed = parseArgs(['--help']);
      expect(parsed.flags.help).to.be.true;

      const parsed2 = parseArgs(['discover', '--json']);
      expect(parsed2.flags.json).to.be.true;
    });

    it('throws when --param is not in key=value form', () => {
      expect(() => parseArgs(['ecp', 'launch', '--param', 'bogus'])).to.throw('key=value');
    });

    it('treats any --xxx as a flag name expecting a value, throwing if none follows', () => {
      expect(() => parseArgs(['ecp', 'device-info', '--bogus'])).to.throw('Missing value for --bogus');
    });

    it('throws on a single-dash flag it does not recognize', () => {
      expect(() => parseArgs(['-x'])).to.throw('Unknown option');
    });

    it('returns undefined group/op when no positional args are given', () => {
      const parsed = parseArgs(['--json']);
      expect(parsed.group).to.be.undefined;
      expect(parsed.op).to.be.undefined;
    });
  });

  describe('resolveConfig', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('prefers CLI flags over env vars', () => {
      process.env.ROKU_HOST = 'env-host';
      process.env.ROKU_PASSWORD = 'env-pass';

      const config = resolveConfig(emptyFlags({ host: 'flag-host', password: 'flag-pass' }));
      expect(config.host).to.equal('flag-host');
      expect(config.password).to.equal('flag-pass');
    });

    it('falls back to environment variables when no flags are given', () => {
      process.env.ROKU_HOST = 'env-host';
      process.env.ROKU_PASSWORD = 'env-pass';

      const config = resolveConfig(emptyFlags());
      expect(config.host).to.equal('env-host');
      expect(config.password).to.equal('env-pass');
    });

    it('reads host/password/port from a --config JSON file', () => {
      delete process.env.ROKU_HOST;
      delete process.env.ROKU_PASSWORD;

      const configPath = path.join(os.tmpdir(), `kopytko-roku-test-${Date.now()}.json`);
      fs.writeFileSync(configPath, JSON.stringify({ host: 'file-host', password: 'file-pass', port: 8061 }));

      try {
        const config = resolveConfig(emptyFlags({ config: configPath }));
        expect(config.host).to.equal('file-host');
        expect(config.password).to.equal('file-pass');
        expect(config.port).to.equal(8061);
      } finally {
        fs.unlinkSync(configPath);
      }
    });

    it('CLI --port flag overrides the config file port', () => {
      const configPath = path.join(os.tmpdir(), `kopytko-roku-test-${Date.now()}.json`);
      fs.writeFileSync(configPath, JSON.stringify({ port: 8061 }));

      try {
        const config = resolveConfig(emptyFlags({ config: configPath, port: '9999' }));
        expect(config.port).to.equal(9999);
      } finally {
        fs.unlinkSync(configPath);
      }
    });

    it('throws with the file path in the message when --config points to a missing file', () => {
      const missingPath = path.join(os.tmpdir(), `kopytko-roku-missing-${Date.now()}.json`);
      expect(() => resolveConfig(emptyFlags({ config: missingPath }))).to.throw(
        `Failed to read --config file at ${missingPath}`,
      );
    });

    it('throws with the file path in the message when --config contains invalid JSON', () => {
      const configPath = path.join(os.tmpdir(), `kopytko-roku-badjson-${Date.now()}.json`);
      fs.writeFileSync(configPath, '{ not valid json');

      try {
        expect(() => resolveConfig(emptyFlags({ config: configPath }))).to.throw(
          `--config file at ${configPath} is not valid JSON`,
        );
      } finally {
        fs.unlinkSync(configPath);
      }
    });
  });

  describe('requireHost', () => {
    it('returns the host when present', () => {
      expect(requireHost({ host: '1.2.3.4' })).to.equal('1.2.3.4');
    });

    it('throws a helpful error when no host is configured', () => {
      expect(() => requireHost({})).to.throw('No device host given');
    });
  });

  describe('requireFlag', () => {
    it('returns the flag value when present', () => {
      expect(requireFlag(emptyFlags({ app: 'dev' }), 'app')).to.equal('dev');
    });

    it('throws when the flag is missing', () => {
      expect(() => requireFlag(emptyFlags(), 'app')).to.throw('Missing required --app flag');
    });

    it('throws when the flag is an empty string', () => {
      expect(() => requireFlag(emptyFlags({ app: '' }), 'app')).to.throw('Missing required --app flag');
    });
  });

  describe('paramsToRecord', () => {
    it('converts key=value pairs into an object', () => {
      expect(paramsToRecord([['a', '1'], ['b', '2']])).to.deep.equal({ a: '1', b: '2' });
    });

    it('returns an empty object for no params', () => {
      expect(paramsToRecord([])).to.deep.equal({});
    });
  });

  describe('printResult', () => {
    let logSpy: sinon.SinonStub;

    beforeEach(() => {
      logSpy = sinon.stub(console, 'log');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('prints a raw XML string as-is, ignoring --json (never double-JSON-escapes it)', () => {
      const xml = '<chanperf><cpu>12</cpu>\n\t<mem>4096</mem></chanperf>';
      printResult(xml, true);
      expect(logSpy.calledOnceWith(xml)).to.be.true;
    });

    it('prints a raw XML string as-is in text mode too', () => {
      const xml = '<sgnodes><status>OK</status></sgnodes>';
      printResult(xml, false);
      expect(logSpy.calledOnceWith(xml)).to.be.true;
    });

    it('pretty-prints an object result as JSON', () => {
      printResult({ 'model-name': 'Roku Ultra' }, false);
      expect(logSpy.calledOnceWith(JSON.stringify({ 'model-name': 'Roku Ultra' }, null, 2))).to.be.true;
    });

    it('pretty-prints an array result as JSON', () => {
      const apps = [{ id: '12', name: 'Netflix' }];
      printResult(apps, false);
      expect(logSpy.calledOnceWith(JSON.stringify(apps, null, 2))).to.be.true;
    });

    it('prints "(none)" for an undefined result in text mode (e.g. no active app)', () => {
      printResult(undefined, false);
      expect(logSpy.calledOnceWith('(none)')).to.be.true;
    });

    it('prints "null" for an undefined result in --json mode', () => {
      printResult(undefined, true);
      expect(logSpy.calledOnceWith('null')).to.be.true;
    });
  });
});

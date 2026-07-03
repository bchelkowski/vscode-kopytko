import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getAvailableEnvironments } from '../../src/config/kopytkorc';

describe('kopytkorc — getAvailableEnvironments', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopytko-rc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns environment names from .kopytkorc', () => {
    fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
      baseManifest: '/manifest/base.js',
      environments: {
        dev: { manifest: '/manifest/dev.js' },
        staging: { manifest: '/manifest/staging.js' },
        production: { manifest: '/manifest/production.js' },
      },
    }));

    const envs = getAvailableEnvironments(tmpDir);
    expect(envs).to.deep.equal(['dev', 'staging', 'production']);
  });

  it('returns empty array when no .kopytkorc file exists', () => {
    const envs = getAvailableEnvironments(tmpDir);
    expect(envs).to.deep.equal([]);
  });

  it('returns empty array when .kopytkorc has no environments key', () => {
    fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
      baseManifest: '/manifest/base.js',
    }));

    const envs = getAvailableEnvironments(tmpDir);
    expect(envs).to.deep.equal([]);
  });

  it('returns empty array when environments is null', () => {
    fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
      environments: null,
    }));

    const envs = getAvailableEnvironments(tmpDir);
    expect(envs).to.deep.equal([]);
  });

  it('returns empty array when environments is not an object', () => {
    fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
      environments: 'invalid',
    }));

    const envs = getAvailableEnvironments(tmpDir);
    expect(envs).to.deep.equal([]);
  });

  it('returns empty array when .kopytkorc has invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), 'not valid json {{{');

    const envs = getAvailableEnvironments(tmpDir);
    expect(envs).to.deep.equal([]);
  });

  it('returns empty array for empty environments object', () => {
    fs.writeFileSync(path.join(tmpDir, '.kopytkorc'), JSON.stringify({
      environments: {},
    }));

    const envs = getAvailableEnvironments(tmpDir);
    expect(envs).to.deep.equal([]);
  });
});

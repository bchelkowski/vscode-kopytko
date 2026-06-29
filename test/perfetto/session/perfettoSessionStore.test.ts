import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect } from 'chai';
import {
  buildPerfettoSessionId,
  writeManifest,
  readManifest,
  listSessions,
  PERFETTO_SESSION_SUFFIX,
  SCHEMA_VERSION,
  type PerfettoManifest,
} from '../../../src/client/perfetto/session/perfettoSessionStore';

function makeManifest(overrides: Partial<PerfettoManifest> = {}): PerfettoManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'test-session',
    startedWall: 1000,
    endedWall: null,
    device: { ip: '192.168.1.1' },
    app: { title: 'TestApp' },
    ...overrides,
  };
}

describe('buildPerfettoSessionId', () => {
  it('ends with __perfetto suffix', () => {
    const id = buildPerfettoSessionId(Date.now());
    expect(id).to.match(/__perfetto$/);
  });

  it('includes a sanitized app label', () => {
    const id = buildPerfettoSessionId(Date.now(), 'My App!');
    expect(id).to.include('My-App');
    expect(id).to.include(PERFETTO_SESSION_SUFFIX);
  });

  it('omits label when not provided', () => {
    const id = buildPerfettoSessionId(0);
    expect(id).to.not.include('undefined');
    expect(id).to.match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}__perfetto$/);
  });
});

describe('writeManifest / readManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfetto-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips a manifest', () => {
    const manifest = makeManifest({ id: 'round-trip', startedWall: 9999 });
    writeManifest(tmpDir, manifest);
    const read = readManifest(tmpDir);
    expect(read).to.deep.equal(manifest);
  });

  it('returns null for missing manifest', () => {
    expect(readManifest(tmpDir)).to.be.null;
  });

  it('returns null for invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'session.json'), 'not-json', 'utf-8');
    expect(readManifest(tmpDir)).to.be.null;
  });
});

describe('listSessions', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'perfetto-list-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeSession(id: string, startedWall: number): void {
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    writeManifest(dir, makeManifest({ id, startedWall }));
  }

  it('returns empty array when root does not exist', () => {
    expect(listSessions('/no/such/path/abc123')).to.deep.equal([]);
  });

  it('lists only __perfetto directories with valid manifests', () => {
    makeSession(`2026-01-01_00-00-01__App${PERFETTO_SESSION_SUFFIX}`, 1000);
    makeSession(`2026-01-01_00-00-02__App${PERFETTO_SESSION_SUFFIX}`, 2000);
    // Non-perfetto dir — should be ignored.
    const diagnosticsDir = path.join(root, '2026-01-01_00-00-03__App');
    fs.mkdirSync(diagnosticsDir);
    writeManifest(diagnosticsDir, makeManifest({ id: 'diag' }));
    // Perfetto dir without manifest — should be ignored.
    fs.mkdirSync(path.join(root, `2026-01-01_00-00-04__App${PERFETTO_SESSION_SUFFIX}`));

    const sessions = listSessions(root);
    expect(sessions).to.have.length(2);
  });

  it('sorts newest first', () => {
    makeSession(`a${PERFETTO_SESSION_SUFFIX}`, 1000);
    makeSession(`b${PERFETTO_SESSION_SUFFIX}`, 3000);
    makeSession(`c${PERFETTO_SESSION_SUFFIX}`, 2000);

    const sessions = listSessions(root);
    expect(sessions.map((s) => s.startedWall)).to.deep.equal([3000, 2000, 1000]);
  });
});

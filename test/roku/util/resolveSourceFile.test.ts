import '../vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';

// The vscode-mock sets up the 'vscode' module in Node's require cache.
// workspace.findFiles and workspace.fs.stat are not in the base mock, so we
// inject them and then clear the module cache before each test so that
// resolveSourceFile.ts re-imports vscode with the current stub configuration
// (TypeScript's __importStar creates a new wrapper on each require, so the
// stubs are visible only when the module is freshly loaded).
function injectWorkspaceExtras(stubs: { findFiles: sinon.SinonStub; stat: sinon.SinonStub }): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require('vscode') as Record<string, Record<string, unknown>>;
  vscode['workspace']['findFiles'] = stubs.findFiles;
  vscode['workspace']['fs'] = { stat: stubs.stat };
  vscode['Uri'] = { file: (p: string) => ({ fsPath: p }) };
}

function loadModule() {
  const key = require.resolve('../../../src/client/roku/util/resolveSourceFile');
  delete require.cache[key];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../src/client/roku/util/resolveSourceFile') as
    typeof import('../../../src/client/roku/util/resolveSourceFile');
}

const makeUri = (fsPath: string) => ({ fsPath, toString: () => `file://${fsPath}` });

describe('resolveSourceFile', () => {
  let findFiles: sinon.SinonStub;
  let stat: sinon.SinonStub;

  beforeEach(() => {
    findFiles = sinon.stub().resolves([]);
    stat     = sinon.stub().rejects(new Error('not found'));
    injectWorkspaceExtras({ findFiles, stat });
  });

  afterEach(() => sinon.restore());

  // ── resolveRendezvousFile ───────────────────────────────────────────────────

  describe('resolveRendezvousFile', () => {
    it('returns a pre-resolved local path when the file exists on disk', async () => {
      stat.resolves({});
      const { resolveRendezvousFile } = loadModule();
      const result = await resolveRendezvousFile('/ws/app/Foo.brs', 'pkg:/Foo.brs');
      expect(result?.fsPath).to.equal('/ws/app/Foo.brs');
    });

    it('falls through when local path does not exist, uses findFiles', async () => {
      const match = makeUri('/ws/app/Foo.brs');
      findFiles.resolves([match]);
      const { resolveRendezvousFile } = loadModule();
      const result = await resolveRendezvousFile('/ws/app/Foo.brs', 'pkg:/Foo.brs');
      expect(result?.fsPath).to.equal('/ws/app/Foo.brs');
    });

    it('prefers node_modules match when multiple files are found', async () => {
      findFiles.resolves([makeUri('/ws/app/Foo.brs'), makeUri('/ws/node_modules/kopytko-utils/Foo.brs')]);
      const { resolveRendezvousFile } = loadModule();
      const result = await resolveRendezvousFile('', 'pkg:/Foo.brs');
      expect(result?.fsPath).to.equal('/ws/node_modules/kopytko-utils/Foo.brs');
    });

    it('falls back to filename-only search when full-path search returns nothing', async () => {
      findFiles.onFirstCall().resolves([]);
      findFiles.onSecondCall().resolves([makeUri('/ws/app/subdir/Foo.brs')]);
      const { resolveRendezvousFile } = loadModule();
      const result = await resolveRendezvousFile('', 'pkg:/some/deep/Foo.brs');
      expect(result?.fsPath).to.equal('/ws/app/subdir/Foo.brs');
    });

    it('returns undefined when no file is found', async () => {
      const { resolveRendezvousFile } = loadModule();
      expect(await resolveRendezvousFile('', 'pkg:/Missing.brs')).to.equal(undefined);
    });
  });


});

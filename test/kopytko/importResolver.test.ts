import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';

describe('KopytkoImportResolver', () => {
  let resolver: KopytkoImportResolver;

  const WORKSPACE = '/workspace';
  const DOCUMENT_PATH = '/workspace/app/components/MyComponent.brs';

  beforeEach(() => {
    sinon.stub(fsWrapper, 'existsSync');
    resolver = new KopytkoImportResolver({
      workspaceFolders: [WORKSPACE],
      sourceDir: 'app',
      resolveModules: true,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  // ---------------------------------------------------------------------------
  // getInstalledKopytkoPackages
  // ---------------------------------------------------------------------------

  describe('getInstalledKopytkoPackages', () => {
    let readdirStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;

    beforeEach(() => {
      readdirStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
    });

    it('returns empty array when resolveModules is false', () => {
      const noModuleResolver = new KopytkoImportResolver({
        workspaceFolders: [WORKSPACE],
        sourceDir: 'app',
        resolveModules: false,
      });
      readdirStub.withArgs(path.join(WORKSPACE, 'node_modules')).returns([
        { name: 'my-pkg', isDirectory: true },
      ]);
      readFileStub.returns(JSON.stringify({ kopytkoModuleDir: '' }));
      expect(noModuleResolver.getInstalledKopytkoPackages(DOCUMENT_PATH)).to.be.empty;
    });

    it('returns a regular (non-scoped) package with kopytkoModuleDir', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'node_modules')).returns([
        { name: 'kopytko-utils', isDirectory: true },
      ]);
      readFileStub
        .withArgs(path.join(WORKSPACE, 'node_modules', 'kopytko-utils', 'package.json'), 'utf-8')
        .returns(JSON.stringify({ kopytkoModuleDir: 'src' }));
      expect(resolver.getInstalledKopytkoPackages(DOCUMENT_PATH)).to.deep.equal(['kopytko-utils']);
    });

    it('returns a scoped package with kopytkoModuleDir', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'node_modules')).returns([
        { name: '@dazn', isDirectory: true },
      ]);
      readdirStub.withArgs(path.join(WORKSPACE, 'node_modules', '@dazn')).returns([
        { name: 'kopytko-framework', isDirectory: true },
      ]);
      readFileStub
        .withArgs(path.join(WORKSPACE, 'node_modules', '@dazn', 'kopytko-framework', 'package.json'), 'utf-8')
        .returns(JSON.stringify({ kopytkoModuleDir: '' }));
      expect(resolver.getInstalledKopytkoPackages(DOCUMENT_PATH)).to.deep.equal(['@dazn/kopytko-framework']);
    });

    it('skips packages without kopytkoModuleDir', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'node_modules')).returns([
        { name: 'lodash', isDirectory: true },
        { name: 'kopytko-utils', isDirectory: true },
      ]);
      readFileStub
        .withArgs(path.join(WORKSPACE, 'node_modules', 'lodash', 'package.json'), 'utf-8')
        .returns(JSON.stringify({ version: '4.0.0' }));
      readFileStub
        .withArgs(path.join(WORKSPACE, 'node_modules', 'kopytko-utils', 'package.json'), 'utf-8')
        .returns(JSON.stringify({ kopytkoModuleDir: 'dist' }));
      expect(resolver.getInstalledKopytkoPackages(DOCUMENT_PATH)).to.deep.equal(['kopytko-utils']);
    });

    it('deduplicates when the same node_modules dir appears multiple times', () => {
      // workspace root and a path-walk ancestor both point to the same node_modules
      readdirStub.withArgs(path.join(WORKSPACE, 'node_modules')).returns([
        { name: 'kopytko-utils', isDirectory: true },
      ]);
      readFileStub
        .withArgs(path.join(WORKSPACE, 'node_modules', 'kopytko-utils', 'package.json'), 'utf-8')
        .returns(JSON.stringify({ kopytkoModuleDir: '' }));
      const result = resolver.getInstalledKopytkoPackages(DOCUMENT_PATH);
      expect(result.filter((p) => p === 'kopytko-utils')).to.have.length(1);
    });

    it('returns empty when node_modules directory does not exist', () => {
      readdirStub.throws(new Error('ENOENT'));
      expect(resolver.getInstalledKopytkoPackages(DOCUMENT_PATH)).to.be.empty;
    });

    it('returns results sorted alphabetically', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'node_modules')).returns([
        { name: 'zebra-pkg', isDirectory: true },
        { name: 'alpha-pkg', isDirectory: true },
      ]);
      readFileStub.returns(JSON.stringify({ kopytkoModuleDir: '' }));
      const result = resolver.getInstalledKopytkoPackages(DOCUMENT_PATH);
      expect(result).to.deep.equal(['alpha-pkg', 'zebra-pkg']);
    });
  });
});

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { KopytkoModuleCatalog } from '../../src/server/kopytko/moduleCatalog';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';

const BASE_DIR = '/workspace/node_modules/@dazn/kopytko-framework/src';

function makeResolver(packages: string[] = ['@dazn/kopytko-framework'], baseDir: string = BASE_DIR): KopytkoImportResolver {
  const resolver = new KopytkoImportResolver({
    workspaceFolders: ['/workspace'],
    sourceDir: 'app',
    resolveModules: true,
  });
  sinon.stub(resolver, 'getInstalledKopytkoPackages').returns(packages);
  sinon.stub(resolver, 'resolvePackageBaseDir').callsFake((pkg) =>
    pkg === '@dazn/kopytko-framework' ? baseDir : undefined
  );
  return resolver;
}

describe('KopytkoModuleCatalog', () => {
  let catalog: KopytkoModuleCatalog;
  let readdirStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;

  beforeEach(() => {
    catalog = new KopytkoModuleCatalog();
    readdirStub = sinon.stub(fsWrapper, 'readdirTyped');
    readFileStub = sinon.stub(fsWrapper, 'readFileSync');
    // Default: empty directory
    readdirStub.returns([]);
  });

  afterEach(() => sinon.restore());

  // ── scan ──────────────────────────────────────────────────────────────────

  describe('scan()', () => {
    it('produces an empty catalog when no packages are installed', () => {
      const resolver = makeResolver([]);
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(0);
    });

    it('discovers functions from a single .brs file', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(newState as Object)\nend sub\n\nfunction getState() as Object\nend function'
      );
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(2);
    });

    it('walks subdirectories recursively', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'utils', isDirectory: true },
      ]);
      readdirStub.withArgs(path.join(BASE_DIR, 'utils')).returns([
        { name: 'helpers.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'utils', 'helpers.brs'), 'utf-8').returns(
        'function helperFn() as String\nend function'
      );
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(1);
      expect(catalog.findExport('helperFn')).to.not.be.undefined;
    });

    it('sets importPath with leading slash relative to baseDir', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(newState as Object)\nend sub'
      );
      catalog.scan('/workspace', resolver);
      const entry = catalog.findExport('setState');
      expect(entry!.importPath).to.equal('/Renderer.brs');
    });

    it('sets importPath with subdirectory prefix', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'utils', isDirectory: true },
      ]);
      readdirStub.withArgs(path.join(BASE_DIR, 'utils')).returns([
        { name: 'helpers.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'utils', 'helpers.brs'), 'utf-8').returns(
        'function helperFn() as String\nend function'
      );
      catalog.scan('/workspace', resolver);
      const entry = catalog.findExport('helperFn');
      expect(entry!.importPath).to.match(/^\/utils\/helpers\.brs$/);
    });

    it('skips hidden directories (names starting with .)', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: '.hidden', isDirectory: true },
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(newState as Object)\nend sub'
      );
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(1);
    });

    it('skips non-.brs files', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'README.md', isDirectory: false },
        { name: 'package.json', isDirectory: false },
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(newState as Object)\nend sub'
      );
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(1);
    });

    it('skips unreadable files gracefully without throwing', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'Bad.brs', isDirectory: false },
        { name: 'Good.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Bad.brs'), 'utf-8').throws(new Error('ENOENT'));
      readFileStub.withArgs(path.join(BASE_DIR, 'Good.brs'), 'utf-8').returns(
        'function goodFn() as Void\nend function'
      );
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(1);
      expect(catalog.findExport('goodFn')).to.not.be.undefined;
    });

    it('handles unreadable directories gracefully', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).throws(new Error('EPERM'));
      expect(() => catalog.scan('/workspace', resolver)).to.not.throw();
      expect(catalog.size).to.equal(0);
    });

    it('clears old entries when rescanned', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(newState as Object)\nend sub'
      );
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(1);

      // Rescan with empty package list
      const emptyResolver = makeResolver([]);
      catalog.scan('/workspace', emptyResolver);
      expect(catalog.size).to.equal(0);
    });

    it('indexes functions from multiple packages', () => {
      const resolver = makeResolver(['@dazn/kopytko-framework', '@dazn/kopytko-utils'], BASE_DIR);
      const utilsDir = '/workspace/node_modules/@dazn/kopytko-utils/src';
      (resolver.resolvePackageBaseDir as sinon.SinonStub).callsFake((pkg: string) => {
        if (pkg === '@dazn/kopytko-framework') return BASE_DIR;
        if (pkg === '@dazn/kopytko-utils') return utilsDir;
        return undefined;
      });
      readdirStub.withArgs(BASE_DIR).returns([{ name: 'Renderer.brs', isDirectory: false }]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(s as Object)\nend sub'
      );
      readdirStub.withArgs(utilsDir).returns([{ name: 'getProperty.brs', isDirectory: false }]);
      readFileStub.withArgs(path.join(utilsDir, 'getProperty.brs'), 'utf-8').returns(
        'function getProperty(obj as Object, key as String) as Dynamic\nend function'
      );
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(2);
      expect(catalog.findExport('setState')!.npmPackage).to.equal('@dazn/kopytko-framework');
      expect(catalog.findExport('getProperty')!.npmPackage).to.equal('@dazn/kopytko-utils');
    });

    it('skips packages whose resolvePackageBaseDir returns undefined', () => {
      const resolver = makeResolver(['@unknown/pkg']);
      (resolver.resolvePackageBaseDir as sinon.SinonStub).returns(undefined);
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(0);
    });
  });

  // ── findExport ────────────────────────────────────────────────────────────

  describe('findExport()', () => {
    beforeEach(() => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(newState as Object)\nend sub\n\nfunction getState() as Object\nend function'
      );
      catalog.scan('/workspace', resolver);
    });

    it('returns an entry for a known function name', () => {
      const entry = catalog.findExport('setState');
      expect(entry).to.not.be.undefined;
      expect(entry!.name).to.equal('setState');
    });

    it('is case-insensitive', () => {
      expect(catalog.findExport('SETSTATE')).to.not.be.undefined;
      expect(catalog.findExport('setstate')).to.not.be.undefined;
      expect(catalog.findExport('SetState')).to.not.be.undefined;
    });

    it('returns undefined for an unknown name', () => {
      expect(catalog.findExport('nonExistentFunction')).to.be.undefined;
    });

    it('includes npmPackage and importPath in the returned entry', () => {
      const entry = catalog.findExport('setState');
      expect(entry!.npmPackage).to.equal('@dazn/kopytko-framework');
      expect(entry!.importPath).to.equal('/Renderer.brs');
    });

    it('includes the signature from the source declaration', () => {
      const entry = catalog.findExport('setState');
      expect(entry!.signature).to.include('setState');
    });
  });

  // ── getAllNamesLower ──────────────────────────────────────────────────────

  describe('getAllNamesLower()', () => {
    it('returns an empty set when catalog is empty', () => {
      const resolver = makeResolver([]);
      catalog.scan('/workspace', resolver);
      expect(catalog.getAllNamesLower().size).to.equal(0);
    });

    it('returns all function names in lowercase', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(newState as Object)\nend sub\n\nfunction GetState() as Object\nend function'
      );
      catalog.scan('/workspace', resolver);
      const names = catalog.getAllNamesLower();
      expect(names.has('setstate')).to.be.true;
      expect(names.has('getstate')).to.be.true;
    });

    it('does not include names in original casing', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(newState as Object)\nend sub'
      );
      catalog.scan('/workspace', resolver);
      const names = catalog.getAllNamesLower();
      expect(names.has('setState')).to.be.false;
    });
  });

  // ── size ─────────────────────────────────────────────────────────────────

  describe('size', () => {
    it('is 0 for a fresh catalog', () => {
      expect(catalog.size).to.equal(0);
    });

    it('reflects the number of discovered functions', () => {
      const resolver = makeResolver();
      readdirStub.withArgs(BASE_DIR).returns([
        { name: 'Renderer.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(BASE_DIR, 'Renderer.brs'), 'utf-8').returns(
        'sub setState(s as Object)\nend sub\n\nfunction getState() as Object\nend function\n\nsub doThing()\nend sub'
      );
      catalog.scan('/workspace', resolver);
      expect(catalog.size).to.equal(3);
    });
  });
});

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fsWrapper from '../../src/server/utils/fsWrapper';
import { KopytkoImportResolver, KopytkoImport } from '../../src/server/kopytko/importResolver';

describe('KopytkoImportResolver', () => {
  let resolver: KopytkoImportResolver;
  let fsExistsStub: sinon.SinonStub;

  const WORKSPACE = '/workspace';
  const DOCUMENT_PATH = '/workspace/app/components/MyComponent.brs';

  beforeEach(() => {
    fsExistsStub = sinon.stub(fsWrapper, 'existsSync');
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
  // parseImports
  // ---------------------------------------------------------------------------

  describe('parseImports', () => {
    it('parses a simple internal import', () => {
      const text = `' @import /components/utils.brs\nsub init()\nend sub`;
      const imports = resolver.parseImports(text);

      expect(imports).to.have.length(1);
      expect(imports[0].importPath).to.equal('/components/utils.brs');
      expect(imports[0].fromModule).to.be.undefined;
      expect(imports[0].line).to.equal(1);
    });

    it('parses an external import with "from" clause', () => {
      const text = `' @import /components/KopytkoFramework.brs from @dazn/kopytko-framework`;
      const imports = resolver.parseImports(text);

      expect(imports).to.have.length(1);
      expect(imports[0].importPath).to.equal('/components/KopytkoFramework.brs');
      expect(imports[0].fromModule).to.equal('@dazn/kopytko-framework');
    });

    it('parses multiple imports across lines', () => {
      const text = [
        `' @import /source/helper.brs`,
        `sub init()`,
        `' @import /components/utils.brs from @kopytko/utils`,
        `end sub`,
      ].join('\n');

      const imports = resolver.parseImports(text);
      expect(imports).to.have.length(2);
      expect(imports[0].line).to.equal(1);
      expect(imports[1].line).to.equal(3);
    });

    it('ignores regular comments that do not contain @import', () => {
      const text = `' This is a regular comment\n' Some other comment\nsub foo()\nend sub`;
      const imports = resolver.parseImports(text);
      expect(imports).to.be.empty;
    });

    it('preserves the raw annotation text', () => {
      const raw = `' @import /components/foo.brs from @dazn/kopytko-framework`;
      const imports = resolver.parseImports(raw);
      expect(imports[0].raw).to.equal(raw.trim());
    });

    it('handles Windows-style CRLF line endings', () => {
      const text = `' @import /components/a.brs\r\n' @import /components/b.brs\r\n`;
      const imports = resolver.parseImports(text);
      expect(imports).to.have.length(2);
    });

    it('ignores import-like text that is not a comment', () => {
      const text = `@import /something.brs\nsub foo()\nend sub`;
      const imports = resolver.parseImports(text);
      expect(imports).to.be.empty;
    });
  });

  // ---------------------------------------------------------------------------
  // resolveImportPath — internal
  // ---------------------------------------------------------------------------

  describe('resolveImportPath (internal)', () => {
    it('resolves an internal import via workspace + sourceDir', () => {
      const expectedPath = path.join(WORKSPACE, 'app', '/components/utils.brs');
      fsExistsStub.withArgs(expectedPath).returns(true);
      fsExistsStub.returns(false);

      const imp: KopytkoImport = { raw: '', importPath: '/components/utils.brs', line: 1 };
      const result = resolver.resolveImportPath(imp, DOCUMENT_PATH);
      expect(result).to.equal(expectedPath);
    });

    it('falls back to workspace root when sourceDir path does not exist', () => {
      const sourceDirPath = path.join(WORKSPACE, 'app', '/components/utils.brs');
      const rootPath = path.join(WORKSPACE, '/components/utils.brs');

      fsExistsStub.withArgs(sourceDirPath).returns(false);
      fsExistsStub.withArgs(rootPath).returns(true);
      fsExistsStub.returns(false);

      const imp: KopytkoImport = { raw: '', importPath: '/components/utils.brs', line: 1 };
      const result = resolver.resolveImportPath(imp, DOCUMENT_PATH);
      expect(result).to.equal(rootPath);
    });

    it('returns undefined when no path resolves', () => {
      fsExistsStub.returns(false);

      const imp: KopytkoImport = { raw: '', importPath: '/nonexistent/file.brs', line: 1 };
      const result = resolver.resolveImportPath(imp, DOCUMENT_PATH);
      expect(result).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // resolveImportPath — external
  // ---------------------------------------------------------------------------

  describe('resolveImportPath (external)', () => {
    it('resolves an external import when node_modules exists', () => {
      const modulePath = path.join(WORKSPACE, 'node_modules', '@dazn/kopytko-framework');
      const pkgJsonPath = path.join(modulePath, 'package.json');
      const filePath = path.join(modulePath, '/components/KopytkoFramework.brs');

      // Stub package.json read
      sinon.stub(fsWrapper, 'readFileSync').withArgs(pkgJsonPath, 'utf-8').returns('{}');
      fsExistsStub.withArgs(modulePath).returns(true);
      fsExistsStub.withArgs(filePath).returns(true);
      fsExistsStub.returns(false);

      const imp: KopytkoImport = {
        raw: '',
        importPath: '/components/KopytkoFramework.brs',
        fromModule: '@dazn/kopytko-framework',
        line: 1,
      };
      const result = resolver.resolveImportPath(imp, DOCUMENT_PATH);
      expect(result).to.equal(filePath);
    });

    it('returns undefined when resolveModules is false', () => {
      const noModuleResolver = new KopytkoImportResolver({
        workspaceFolders: [WORKSPACE],
        sourceDir: 'app',
        resolveModules: false,
      });

      const imp: KopytkoImport = {
        raw: '',
        importPath: '/components/foo.brs',
        fromModule: '@dazn/kopytko-framework',
        line: 1,
      };
      expect(noModuleResolver.resolveImportPath(imp, DOCUMENT_PATH)).to.be.undefined;
    });

    it('returns undefined when module directory does not exist', () => {
      fsExistsStub.returns(false);

      const imp: KopytkoImport = {
        raw: '',
        importPath: '/components/foo.brs',
        fromModule: '@kopytko/utils',
        line: 1,
      };
      expect(resolver.resolveImportPath(imp, DOCUMENT_PATH)).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // importExists
  // ---------------------------------------------------------------------------

  describe('importExists', () => {
    it('returns true when file exists', () => {
      fsExistsStub.withArgs('/some/file.brs').returns(true);
      expect(resolver.importExists('/some/file.brs')).to.be.true;
    });

    it('returns false when file does not exist', () => {
      fsExistsStub.withArgs('/nonexistent.brs').returns(false);
      expect(resolver.importExists('/nonexistent.brs')).to.be.false;
    });
  });
});

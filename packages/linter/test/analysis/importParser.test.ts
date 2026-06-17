import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import fsWrapper from '../../src/analysis/fsWrapper';
import { parseImports, ImportResolver } from '../../src/analysis/importParser';
import type { KopytkoImport } from '../../src/types';

describe('importParser', () => {
  let fsExistsStub: sinon.SinonStub;

  const WORKSPACE = '/workspace';
  const DOCUMENT_PATH = '/workspace/app/components/MyComponent.brs';

  beforeEach(() => {
    fsExistsStub = sinon.stub(fsWrapper, 'existsSync');
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
      const imports = parseImports(text);

      expect(imports).to.have.length(1);
      expect(imports[0].importPath).to.equal('/components/utils.brs');
      expect(imports[0].fromModule).to.be.undefined;
      expect(imports[0].line).to.equal(1);
    });

    it('parses an external import with "from" clause', () => {
      const text = `' @import /components/KopytkoFramework.brs from @dazn/kopytko-framework`;
      const imports = parseImports(text);

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

      const imports = parseImports(text);
      expect(imports).to.have.length(2);
      expect(imports[0].line).to.equal(1);
      expect(imports[1].line).to.equal(3);
    });

    it('ignores regular comments that do not contain @import', () => {
      const text = `' This is a regular comment\n' Some other comment\nsub foo()\nend sub`;
      const imports = parseImports(text);
      expect(imports).to.be.empty;
    });

    it('preserves the raw annotation text', () => {
      const raw = `' @import /components/foo.brs from @dazn/kopytko-framework`;
      const imports = parseImports(raw);
      expect(imports[0].raw).to.equal(raw.trim());
    });

    it('handles Windows-style CRLF line endings', () => {
      const text = `' @import /components/a.brs\r\n' @import /components/b.brs\r\n`;
      const imports = parseImports(text);
      expect(imports).to.have.length(2);
    });

    it('ignores import-like text that is not a comment', () => {
      const text = `@import /something.brs\nsub foo()\nend sub`;
      const imports = parseImports(text);
      expect(imports).to.be.empty;
    });

    it('parses @mock annotations like @import', () => {
      const text = `' @mock /components/MyService.brs\n' @mock /components/Router.brs from @dazn/kopytko-framework`;
      const imports = parseImports(text);

      expect(imports).to.have.length(2);
      expect(imports[0].importPath).to.equal('/components/MyService.brs');
      expect(imports[0].isMock).to.be.true;
      expect(imports[0].fromModule).to.be.undefined;
      expect(imports[1].importPath).to.equal('/components/Router.brs');
      expect(imports[1].isMock).to.be.true;
      expect(imports[1].fromModule).to.equal('@dazn/kopytko-framework');
    });

    it('distinguishes @import from @mock via isMock flag', () => {
      const text = `' @import /components/utils.brs\n' @mock /components/service.brs`;
      const imports = parseImports(text);

      expect(imports).to.have.length(2);
      expect(imports[0].isMock).to.not.be.true;
      expect(imports[1].isMock).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // resolveImportPath — internal
  // ---------------------------------------------------------------------------

  describe('resolveImportPath (internal)', () => {
    let resolver: ImportResolver;

    beforeEach(() => {
      resolver = new ImportResolver({
        workspaceFolders: [WORKSPACE],
        sourceDir: 'app',
        resolveModules: true,
      });
    });

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

    it('resolves an internal @import inside a node_modules file using the package kopytkoModuleDir', () => {
      const nodeModulesDoc = path.join(
        WORKSPACE, 'node_modules', '@dazn', 'kopytko-framework',
        'src', 'components', 'eventBus', 'EventBus.facade.brs'
      );
      const pkgRoot = path.join(WORKSPACE, 'node_modules', '@dazn', 'kopytko-framework');
      const pkgJson = path.join(pkgRoot, 'package.json');
      const resolvedFile = path.join(pkgRoot, 'src', 'components', 'utils', 'Core.brs');

      sinon.stub(fsWrapper, 'readFileSync').withArgs(pkgJson, 'utf-8').returns('{"kopytkoModuleDir":"src/"}');
      fsExistsStub.returns(false);
      fsExistsStub.withArgs(resolvedFile).returns(true);

      const imp: KopytkoImport = { raw: '', importPath: '/components/utils/Core.brs', line: 1 };
      const result = resolver.resolveImportPath(imp, nodeModulesDoc);
      expect(result).to.equal(resolvedFile);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveImportPath — external
  // ---------------------------------------------------------------------------

  describe('resolveImportPath (external)', () => {
    let resolver: ImportResolver;

    beforeEach(() => {
      resolver = new ImportResolver({
        workspaceFolders: [WORKSPACE],
        sourceDir: 'app',
        resolveModules: true,
      });
    });

    it('resolves an external import when node_modules exists', () => {
      const modulePath = path.join(WORKSPACE, 'node_modules', '@dazn/kopytko-framework');
      const pkgJsonPath = path.join(modulePath, 'package.json');
      const filePath = path.join(modulePath, '/components/KopytkoFramework.brs');

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
      const noModuleResolver = new ImportResolver({
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
    let resolver: ImportResolver;

    beforeEach(() => {
      resolver = new ImportResolver({
        workspaceFolders: [WORKSPACE],
        sourceDir: 'app',
        resolveModules: true,
      });
    });

    it('returns true when import resolves', () => {
      const resolvedPath = path.join(WORKSPACE, 'app', '/components/utils.brs');
      fsExistsStub.withArgs(resolvedPath).returns(true);
      fsExistsStub.returns(false);

      const imp: KopytkoImport = { raw: '', importPath: '/components/utils.brs', line: 1 };
      expect(resolver.importExists(imp, DOCUMENT_PATH)).to.be.true;
    });

    it('returns false when import does not resolve', () => {
      fsExistsStub.returns(false);

      const imp: KopytkoImport = { raw: '', importPath: '/nonexistent.brs', line: 1 };
      expect(resolver.importExists(imp, DOCUMENT_PATH)).to.be.false;
    });
  });
});

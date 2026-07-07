import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { BrightScriptDiagnosticsProvider } from '../../src/server/providers/diagnosticsProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';
import { WorkspaceFunctionIndex } from '../../src/server/utils/workspaceFunctionIndex';
import { KopytkoModuleCatalog } from '../../src/server/kopytko/moduleCatalog';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';
import * as path from 'path';

function makeDocument(content: string, uri = 'file:///workspace/app/components/Test.brs'): TextDocument {
  return TextDocument.create(uri, 'brightscript', 1, content);
}

describe('BrightScriptDiagnosticsProvider', () => {
  let fsExistsStub: sinon.SinonStub;
  let resolver: KopytkoImportResolver;
  let provider: BrightScriptDiagnosticsProvider;

  beforeEach(() => {
    fsExistsStub = sinon.stub(fsWrapper, 'existsSync').returns(false);
    resolver = new KopytkoImportResolver({
      workspaceFolders: ['/workspace'],
      sourceDir: 'app',
      resolveModules: true,
    });
    provider = new BrightScriptDiagnosticsProvider(resolver);
  });

  afterEach(() => {
    sinon.restore();
    invalidateAllCaches();
  });

  it('returns no diagnostics for a file with no @import annotations', async () => {
    const doc = makeDocument(`sub init()\n  print "hello"\nend sub`);
    const diags = await provider.provideDiagnostics(doc);
    expect(diags).to.be.empty;
  });

  it('produces an error for an unresolved internal import', async () => {
    fsExistsStub.returns(false);
    const doc = makeDocument(`' @import /components/missing.brs\nsub init()\nend sub`);
    const diags = await provider.provideDiagnostics(doc);

    expect(diags).to.have.length(1);
    expect(diags[0].severity).to.equal(DiagnosticSeverity.Error);
    expect(diags[0].code).to.equal('import/unresolved');
  });

  it('produces a warning for an unresolved external import', async () => {
    fsExistsStub.returns(false);
    const doc = makeDocument(
      `' @import /components/KopytkoFramework.brs from @dazn/kopytko-framework\nsub init()\nend sub`
    );
    const diags = await provider.provideDiagnostics(doc);

    const unresolved = diags.find((d) => d.code === 'import/unresolved');
    expect(unresolved).to.not.be.undefined;
    expect(unresolved!.message).to.include('@dazn/kopytko-framework');
  });

  it('produces no diagnostics when import resolves successfully', async () => {
    fsExistsStub.withArgs(sinon.match('/workspace/app/components/utils.brs')).returns(true);

    const doc = makeDocument(`' @import /components/utils.brs\nsub init()\nend sub`);
    const diags = await provider.provideDiagnostics(doc);

    const unresolved = diags.filter((d) => d.code === 'import/unresolved');
    expect(unresolved).to.be.empty;
  });

  it('warns about import paths not starting with /', async () => {
    const doc = makeDocument(`' @import components/utils.brs\nsub init()\nend sub`);
    const diags = await provider.provideDiagnostics(doc);

    const pathWarning = diags.find((d) => d.code === 'import/path-not-absolute');
    expect(pathWarning).to.not.be.undefined;
    expect(pathWarning!.severity).to.equal(DiagnosticSeverity.Warning);
  });

  it('attaches diagnostics to the correct line', async () => {
    fsExistsStub.returns(false);
    const doc = makeDocument(
      `sub init()\nend sub\n' @import /missing.brs\nsub other()\nend sub`
    );
    const diags = await provider.provideDiagnostics(doc);

    const importDiag = diags.find((d) => d.code === 'import/unresolved');
    expect(importDiag).to.not.be.undefined;
    // @import is on line index 2 (0-based)
    expect(importDiag!.range.start.line).to.equal(2);
  });

  // ── Duplicate import diagnostics ─────────────────────────────────────────

  describe('duplicate import diagnostics', () => {
    it('produces no diagnostic when an import appears exactly once', async () => {
      const doc = makeDocument("' @import /components/utils.brs\nsub init()\nend sub");
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/duplicate')).to.be.empty;
    });

    it('produces a warning on the second occurrence of the same import', async () => {
      const doc = makeDocument([
        "' @import /utils.brs",
        "' @import /utils.brs",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const dupes = diags.filter((d) => d.code === 'import/duplicate');
      expect(dupes).to.have.length(1);
      expect(dupes[0].severity).to.equal(DiagnosticSeverity.Warning);
    });

    it('attaches the duplicate diagnostic to the second occurrence (line index 1)', async () => {
      const doc = makeDocument([
        "' @import /utils.brs",
        "' @import /utils.brs",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const dupe = diags.find((d) => d.code === 'import/duplicate')!;
      expect(dupe.range.start.line).to.equal(1);
    });

    it('includes the path in the duplicate diagnostic message', async () => {
      const doc = makeDocument([
        "' @import /utils.brs",
        "' @import /utils.brs",
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const dupe = diags.find((d) => d.code === 'import/duplicate')!;
      expect(dupe.message).to.include('/utils.brs');
    });

    it('treats same path from different packages as separate imports (no duplicate)', async () => {
      const doc = makeDocument([
        "' @import /utils.brs from @dazn/pkg-a",
        "' @import /utils.brs from @dazn/pkg-b",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/duplicate')).to.be.empty;
    });

    it('detects duplicate external imports (path + package both match)', async () => {
      const doc = makeDocument([
        "' @import /file.brs from @dazn/kopytko-framework",
        "' @import /file.brs from @dazn/kopytko-framework",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const dupes = diags.filter((d) => d.code === 'import/duplicate');
      expect(dupes).to.have.length(1);
      expect(dupes[0].message).to.include('@dazn/kopytko-framework');
    });

    it('does not run further checks on the duplicate line', async () => {
      // The duplicate is unresolved too — but we should only get import/duplicate, not both
      fsExistsStub.returns(false);
      const doc = makeDocument([
        "' @import /missing.brs",
        "' @import /missing.brs",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      // First line → import/unresolved; second line → import/duplicate only
      const unresolvedLines = diags
        .filter((d) => d.code === 'import/unresolved')
        .map((d) => d.range.start.line);
      expect(unresolvedLines).to.deep.equal([0]);
      expect(diags.filter((d) => d.code === 'import/duplicate')).to.have.length(1);
    });
  });

  // ── Unused import diagnostics ─────────────────────────────────────────────

  describe('unused import diagnostics', () => {
    let readFileStub: sinon.SinonStub;

    beforeEach(() => {
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('produces no diagnostic when all exported functions are used', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn(x as Integer) as Integer\n  return x\nend function');

      const doc = makeDocument([
        "' @import /utils.brs",
        'sub init()',
        '  result = helperFn(42)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('warns when import resolves but none of its functions are referenced', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn(x as Integer) as Integer\n  return x\nend function');

      const doc = makeDocument([
        "' @import /utils.brs",
        'sub init()',
        '  print "no helper call here"',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const unused = diags.filter((d) => d.code === 'import/unused');
      expect(unused).to.have.length(1);
      expect(unused[0].severity).to.equal(DiagnosticSeverity.Warning);
    });

    it('attaches the unused diagnostic to the import line', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');

      const doc = makeDocument([
        'sub init()',
        'end sub',
        "' @import /utils.brs",
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const unused = diags.find((d) => d.code === 'import/unused')!;
      expect(unused.range.start.line).to.equal(2);
    });

    it('includes the import path in the unused diagnostic message', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');

      const doc = makeDocument("' @import /utils.brs\nsub init()\nend sub");
      const diags = await provider.provideDiagnostics(doc);
      const unused = diags.find((d) => d.code === 'import/unused')!;
      expect(unused.message).to.include('/utils.brs');
    });

    it('function reference check is case-insensitive', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function HelperFn() as Void\nend function');

      const doc = makeDocument([
        "' @import /utils.brs",
        'sub init()',
        '  helperfn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('does not count a mention in a comment line as a reference', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');

      const doc = makeDocument([
        "' @import /utils.brs",
        "' TODO: call helperFn someday",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });

    it('does not count a mention inside a string literal as a reference', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');

      const doc = makeDocument([
        "' @import /utils.brs",
        'sub init()',
        '  name = "helperFn"',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });

    it('uses word boundaries — partial name match does not count as used', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function get() as Dynamic\nend function');

      const doc = makeDocument([
        "' @import /utils.brs",
        'sub init()',
        '  result = getProperty(m.data)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      // "get" appears as a prefix of "getProperty" — should NOT count as a reference
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });

    it('considers import used if ANY of the imported functions is referenced', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8').returns([
        'function fnA() as Void',
        'end function',
        'function fnB() as Void',
        'end function',
      ].join('\n'));

      const doc = makeDocument([
        "' @import /utils.brs",
        'sub init()',
        '  fnB()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('produces no diagnostic when imported file has no function definitions', async () => {
      fsExistsStub.withArgs('/workspace/app/constants.brs').returns(true);
      readFileStub.withArgs('/workspace/app/constants.brs', 'utf-8')
        .returns("' just a constant file\nMAX_RETRIES = 3");

      const doc = makeDocument("' @import /constants.brs\nsub init()\nend sub");
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('does not check for unused when import is unresolved', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument("' @import /missing.brs\nsub init()\nend sub");
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
      expect(diags.some((d) => d.code === 'import/unresolved')).to.be.true;
    });

    it('silently skips unused check when the resolved file cannot be read', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8').throws(new Error('EACCES'));

      const doc = makeDocument("' @import /utils.brs\nsub init()\nend sub");
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('suppresses unused warning for PromiseResolve import when .resolvedValue() is used in a test file', async () => {
      const modulePath = '/workspace/node_modules/@dazn/kopytko-utils';
      const filePath = modulePath + '/components/promise/PromiseResolve.brs';
      fsExistsStub.withArgs(modulePath).returns(true);
      fsExistsStub.withArgs(filePath).returns(true);
      readFileStub.withArgs(filePath, 'utf-8')
        .returns('function PromiseResolve(value as Dynamic) as Object\n  return {}\nend function');
      readFileStub.withArgs(modulePath + '/package.json', 'utf-8').returns('{}');

      const doc = makeDocument([
        "' @import /components/promise/PromiseResolve.brs from @dazn/kopytko-utils",
        'sub testCase()',
        '  mockFunction("someModule").resolvedValue({ data: "ok" })',
        'end sub',
      ].join('\n'), 'file:///workspace/app/_tests/Foo.test.brs');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('suppresses unused warning for PromiseReject import when .rejectedValue() is used in a test file', async () => {
      const modulePath = '/workspace/node_modules/@dazn/kopytko-utils';
      const filePath = modulePath + '/components/promise/PromiseReject.brs';
      fsExistsStub.withArgs(modulePath).returns(true);
      fsExistsStub.withArgs(filePath).returns(true);
      readFileStub.withArgs(filePath, 'utf-8')
        .returns('function PromiseReject(error as Dynamic) as Object\n  return {}\nend function');
      readFileStub.withArgs(modulePath + '/package.json', 'utf-8').returns('{}');

      const doc = makeDocument([
        "' @import /components/promise/PromiseReject.brs from @dazn/kopytko-utils",
        'sub testCase()',
        '  mockFunction("someModule").rejectedValue("error")',
        'end sub',
      ].join('\n'), 'file:///workspace/app/_tests/Foo.test.brs');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('still warns for PromiseResolve import when .resolvedValue() is NOT used', async () => {
      const modulePath = '/workspace/node_modules/@dazn/kopytko-utils';
      const filePath = modulePath + '/components/promise/PromiseResolve.brs';
      fsExistsStub.withArgs(modulePath).returns(true);
      fsExistsStub.withArgs(filePath).returns(true);
      readFileStub.withArgs(filePath, 'utf-8')
        .returns('function PromiseResolve(value as Dynamic) as Object\n  return {}\nend function');
      readFileStub.withArgs(modulePath + '/package.json', 'utf-8').returns('{}');

      const doc = makeDocument([
        "' @import /components/promise/PromiseResolve.brs from @dazn/kopytko-utils",
        'sub testCase()',
        '  mockFunction("someModule").returnValue("ok")',
        'end sub',
      ].join('\n'), 'file:///workspace/app/_tests/Foo.test.brs');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });
  });

  // ── Sibling pattern scope expansion ──────────────────────────────────────

  describe('sibling pattern scope for unused import check', () => {
    const COMPONENT_URI = 'file:///workspace/app/components/Foo.component.brs';
    const SIBLING_PATTERNS = [['*.component.brs', '*.template.brs']];

    function makeComponentDoc(content: string): TextDocument {
      return TextDocument.create(COMPONENT_URI, 'brightscript', 1, content);
    }

    let readFileStub: sinon.SinonStub;

    beforeEach(() => {
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('suppresses import/unused when sibling file uses the imported function', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      fsExistsStub.withArgs('/workspace/app/components/Foo.template.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');
      readFileStub.withArgs('/workspace/app/components/Foo.template.brs', 'utf-8')
        .returns('sub init()\n  helperFn()\nend sub');

      const doc = makeComponentDoc([
        "' @import /utils.brs",
        'sub init()',
        '  print "component side"',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('still flags import/unused when neither current nor sibling file uses it', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      fsExistsStub.withArgs('/workspace/app/components/Foo.template.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');
      readFileStub.withArgs('/workspace/app/components/Foo.template.brs', 'utf-8')
        .returns('sub init()\n  print "nothing"\nend sub');

      const doc = makeComponentDoc([
        "' @import /utils.brs",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });

    it('works when sibling file does not exist on disk', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      fsExistsStub.withArgs('/workspace/app/components/Foo.template.brs').returns(false);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');

      const doc = makeComponentDoc([
        "' @import /utils.brs",
        'sub init()',
        'end sub',
      ].join('\n'));
      // Sibling doesn't exist → only current file checked → unused
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });

    it('handles view.brs / template.brs pair', async () => {
      const VIEW_URI = 'file:///workspace/app/components/Bar.view.brs';
      const patterns = [['*.view.brs', '*.template.brs']];

      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      fsExistsStub.withArgs('/workspace/app/components/Bar.template.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function renderHelper() as Void\nend function');
      readFileStub.withArgs('/workspace/app/components/Bar.template.brs', 'utf-8')
        .returns('sub init()\n  renderHelper()\nend sub');

      const doc = TextDocument.create(VIEW_URI, 'brightscript', 1, [
        "' @import /utils.brs",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [], patterns);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('does not suppress when file does not match any pattern group', async () => {
      // Use a file that does not match *.component.brs or *.template.brs
      const OTHER_URI = 'file:///workspace/app/components/Foo.helper.brs';
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');

      const doc = TextDocument.create(OTHER_URI, 'brightscript', 1, [
        "' @import /utils.brs",
        'sub init()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });

    it('silently skips an unreadable sibling and still checks the current file', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      fsExistsStub.withArgs('/workspace/app/components/Foo.template.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');
      readFileStub.withArgs('/workspace/app/components/Foo.template.brs', 'utf-8')
        .throws(new Error('EACCES'));

      const doc = makeComponentDoc("' @import /utils.brs\nsub init()\nend sub");
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      // Sibling unreadable, current file has no call → still flagged
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });

    it('current file usage still suppresses even when sibling has no match', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      fsExistsStub.withArgs('/workspace/app/components/Foo.template.brs').returns(true);
      readFileStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');
      readFileStub.withArgs('/workspace/app/components/Foo.template.brs', 'utf-8')
        .returns('sub init()\nend sub');

      const doc = makeComponentDoc([
        "' @import /utils.brs",
        'sub init()',
        '  helperFn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });
  });

  // ── Test sibling scope: unused import check ───────────────────────────────

  describe('test sibling scope for unused import check', () => {
    const MAIN_TEST_URI = 'file:///workspace/app/components/_tests/Foo.test.brs';
    const SPLIT_TEST_PATH = '/workspace/app/components/_tests/Foo_Bar.test.brs';

    let readStub: sinon.SinonStub;
    let readdirStub: sinon.SinonStub;

    beforeEach(() => {
      readStub = sinon.stub(fsWrapper, 'readFileSync');
      readdirStub = sinon.stub(fsWrapper, 'readdirSync');
    });

    it('suppresses import/unused when sibling test file uses the imported function', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');
      // Sibling test file calls helperFn
      readdirStub.withArgs('/workspace/app/components/_tests').returns(['Foo.test.brs', 'Foo_Bar.test.brs']);
      fsExistsStub.withArgs(SPLIT_TEST_PATH).returns(true);
      readStub.withArgs(SPLIT_TEST_PATH, 'utf-8')
        .returns('function TestSuite__Foo_Bar() as Object\n  helperFn()\nend function');

      const doc = TextDocument.create(MAIN_TEST_URI, 'brightscript', 1, [
        "' @import /utils.brs",
        'function TestSuite__Foo() as Object',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], []);
      expect(diags.filter((d) => d.code === 'import/unused')).to.be.empty;
    });

    it('still flags import/unused when no sibling test file uses it', async () => {
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      readStub.withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function helperFn() as Void\nend function');
      readdirStub.withArgs('/workspace/app/components/_tests').returns(['Foo.test.brs', 'Foo_Bar.test.brs']);
      fsExistsStub.withArgs(SPLIT_TEST_PATH).returns(true);
      readStub.withArgs(SPLIT_TEST_PATH, 'utf-8')
        .returns('function TestSuite__Foo_Bar() as Object\nend function');

      const doc = TextDocument.create(MAIN_TEST_URI, 'brightscript', 1, [
        "' @import /utils.brs",
        'function TestSuite__Foo() as Object',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], []);
      expect(diags.filter((d) => d.code === 'import/unused')).to.have.length(1);
    });
  });

  // ── Test file scope: undefined function call check ───────────────────────

  describe('test file scope for undefined function check', () => {
    const TEST_URI = 'file:///workspace/app/components/_tests/Foo.test.brs';
    const SOURCE_PATH = '/workspace/app/components/Foo.brs';
    const COMPONENT_SOURCE_PATH = '/workspace/app/components/Foo.component.brs';

    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('does not flag a function defined in the tested source file (.brs)', async () => {
      const sourceText = 'function testedFn() as Void\nend function';
      fsExistsStub.withArgs(SOURCE_PATH).returns(true);
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs(SOURCE_PATH, 'utf-8').returns(sourceText);

      const doc = TextDocument.create(TEST_URI, 'brightscript', 1, [
        'sub TestSuite__Foo()',
        '  testedFn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], []);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not flag a function defined in the tested component file (.component.brs)', async () => {
      const sourceText = 'function componentFn() as Void\nend function';
      fsExistsStub.withArgs(COMPONENT_SOURCE_PATH).returns(true);
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs(COMPONENT_SOURCE_PATH, 'utf-8').returns(sourceText);

      const doc = TextDocument.create(TEST_URI, 'brightscript', 1, [
        'sub TestSuite__Foo()',
        '  componentFn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], []);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('flags an undefined function when it is not in the tested source file', async () => {
      const sourceText = 'function testedFn() as Void\nend function';
      fsExistsStub.withArgs(SOURCE_PATH).returns(true);
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs(SOURCE_PATH, 'utf-8').returns(sourceText);

      const doc = TextDocument.create(TEST_URI, 'brightscript', 1, [
        'sub TestSuite__Foo()',
        '  unknownFn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], []);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(1);
      expect(undef[0].message).to.include('unknownFn');
    });

  });

  // ── Mock file scope: functions from _mocks/*.mock.brs ─────────────────────

  describe('mock file scope for undefined function check', () => {
    const TEST_URI = 'file:///workspace/app/components/_tests/Foo.test.brs';
    const MOCKED_FILE_PATH = '/workspace/app/components/Bar.brs';
    const MOCK_IMPL_PATH = '/workspace/app/components/_mocks/Bar.mock.brs';

    it('does not flag a function defined in the mock implementation file (_mocks/*.mock.brs)', async () => {
      // The original file defines init() but NOT Bar()
      const originalText = 'sub init()\n  print "real"\nend sub';
      // The mock file defines Bar() — a factory generated by the mock framework
      const mockImplText = 'function Bar() as Object\n  return {}\nend function';

      fsExistsStub.withArgs(MOCKED_FILE_PATH).returns(true);
      fsExistsStub.withArgs(MOCK_IMPL_PATH).returns(true);
      const readStub = sinon.stub(fsWrapper, 'readFileSync');
      readStub.withArgs(MOCKED_FILE_PATH, 'utf-8').returns(originalText);
      readStub.withArgs(MOCK_IMPL_PATH, 'utf-8').returns(mockImplText);
      sinon.stub(fsWrapper, 'readdirSync').returns([]);

      const doc = TextDocument.create(TEST_URI, 'brightscript', 1, [
        "' @mock /components/Bar.brs",
        'sub TestSuite__Foo()',
        '  myBar = Bar()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], []);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('still flags an undefined function that is not in the mock file', async () => {
      const originalText = 'sub init()\nend sub';
      const mockImplText = 'function Bar() as Object\n  return {}\nend function';

      fsExistsStub.withArgs(MOCKED_FILE_PATH).returns(true);
      fsExistsStub.withArgs(MOCK_IMPL_PATH).returns(true);
      const readStub = sinon.stub(fsWrapper, 'readFileSync');
      readStub.withArgs(MOCKED_FILE_PATH, 'utf-8').returns(originalText);
      readStub.withArgs(MOCK_IMPL_PATH, 'utf-8').returns(mockImplText);
      sinon.stub(fsWrapper, 'readdirSync').returns([]);

      const doc = TextDocument.create(TEST_URI, 'brightscript', 1, [
        "' @mock /components/Bar.brs",
        'sub TestSuite__Foo()',
        '  completelyUnknown()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], []);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(1);
      expect(undef[0].message).to.include('completelyUnknown');
    });
  });

  // ── Sibling scope: undefined function call check ─────────────────────────

  describe('sibling pattern scope for undefined function check', () => {
    const TEMPLATE_URI = 'file:///workspace/app/components/Foo.template.brs';
    const SIBLING_PATTERNS = [['*.component.brs', '*.template.brs']];

    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('does not flag a function defined in the sibling component file', async () => {
      const componentText = 'function sharedHelper() as Void\nend function';
      fsExistsStub.withArgs('/workspace/app/components/Foo.component.brs').returns(true);
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs('/workspace/app/components/Foo.component.brs', 'utf-8').returns(componentText);

      const doc = TextDocument.create(TEMPLATE_URI, 'brightscript', 1, [
        'sub init()',
        '  sharedHelper()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not flag a function imported by the sibling component file', async () => {
      const componentText = "' @import /utils.brs\nsub componentInit()\nend sub";
      const utilsText = 'function helperFn() as Void\nend function';
      fsExistsStub.withArgs('/workspace/app/components/Foo.component.brs').returns(true);
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs('/workspace/app/components/Foo.component.brs', 'utf-8').returns(componentText)
        .withArgs('/workspace/app/utils.brs', 'utf-8').returns(utilsText);

      const doc = TextDocument.create(TEMPLATE_URI, 'brightscript', 1, [
        'sub init()',
        '  helperFn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('flags the function when no sibling patterns are configured', async () => {
      const doc = TextDocument.create(TEMPLATE_URI, 'brightscript', 1, [
        'sub init()',
        '  helperFn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], []);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(1);
      expect(undef[0].message).to.include('helperFn');
    });

    it('flags the function when the file does not match any sibling group', async () => {
      const OTHER_URI = 'file:///workspace/app/components/Foo.helper.brs';
      const doc = TextDocument.create(OTHER_URI, 'brightscript', 1, [
        'sub init()',
        '  helperFn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(1);
    });

    it('skips an unreadable sibling gracefully', async () => {
      fsExistsStub.withArgs('/workspace/app/components/Foo.component.brs').returns(true);
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs('/workspace/app/components/Foo.component.brs', 'utf-8').throws(new Error('EACCES'));

      const doc = TextDocument.create(TEMPLATE_URI, 'brightscript', 1, [
        'sub init()',
        '  helperFn()',
        'end sub',
      ].join('\n'));
      // Sibling unreadable → falls back to current-file-only scope → flags as undefined
      const diags = await provider.provideDiagnostics(doc, [], [], SIBLING_PATTERNS);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(1);
    });
  });

  // ── generatedPaths ────────────────────────────────────────────────────────

  describe('generatedPaths configuration', () => {
    it('shows Information (not Warning) for an unresolved import matching a generated pattern', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument("' @import /generated/AutoComponent.brs");
      const diags = await provider.provideDiagnostics(doc, ['/generated/**']);

      expect(diags).to.have.length(1);
      expect(diags[0].severity).to.equal(DiagnosticSeverity.Information);
      expect(diags[0].code).to.equal('import/build-generated');
    });

    it('includes the matched pattern in the Information message', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument("' @import /generated/AutoComponent.brs");
      const diags = await provider.provideDiagnostics(doc, ['/generated/**']);

      expect(diags[0].message).to.include('/generated/**');
      expect(diags[0].message).to.include('/generated/AutoComponent.brs');
    });

    it('still shows Error for unresolved imports that do not match any pattern', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument("' @import /missing/RealFile.brs");
      const diags = await provider.provideDiagnostics(doc, ['/generated/**']);

      expect(diags[0].severity).to.equal(DiagnosticSeverity.Error);
      expect(diags[0].code).to.equal('import/unresolved');
    });

    it('shows no diagnostic when a generated import resolves (file was created by earlier build step)', async () => {
      fsExistsStub.withArgs(sinon.match('/workspace/app/generated/AutoComponent.brs')).returns(true);
      const doc = makeDocument("' @import /generated/AutoComponent.brs");
      const diags = await provider.provideDiagnostics(doc, ['/generated/**']);

      expect(diags.filter((d) => d.code === 'import/build-generated')).to.be.empty;
      expect(diags.filter((d) => d.code === 'import/unresolved')).to.be.empty;
    });

    it('matches using ** wildcard spanning multiple path segments', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument("' @import /deep/nested/auto/Foo.brs");
      const diags = await provider.provideDiagnostics(doc, ['**/auto/**']);

      expect(diags[0].code).to.equal('import/build-generated');
    });

    it('empty generatedPaths keeps existing Error behaviour', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument("' @import /missing.brs");
      const diags = await provider.provideDiagnostics(doc, []);

      expect(diags[0].severity).to.equal(DiagnosticSeverity.Error);
    });
  });

  // ── generatedModules configuration ───────────────────────────────────────

  describe('generatedModules configuration', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('shows Information (not Warning) for an unresolved import matching a generatedModule path', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument("' @import /generated/PluginApi.brs");
      const diags = await provider.provideDiagnostics(doc, [], [
        { path: '/generated/PluginApi.brs', functions: [] },
      ]);

      expect(diags).to.have.length(1);
      expect(diags[0].severity).to.equal(DiagnosticSeverity.Information);
      expect(diags[0].code).to.equal('import/build-generated');
    });

    it('matches using glob wildcards in generatedModule path', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument("' @import /generated/AutoFoo.brs");
      const diags = await provider.provideDiagnostics(doc, [], [
        { path: '/generated/*.brs', functions: [] },
      ]);

      expect(diags[0].code).to.equal('import/build-generated');
    });

    it('does not flag functions listed in generatedModules as undefined', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument([
        "' @import /generated/PluginApi.brs",
        'sub init()',
        '  PluginInit()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [
        { path: '/generated/PluginApi.brs', functions: ['PluginInit'] },
      ]);

      const undefDiags = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undefDiags).to.be.empty;
    });

    it('still flags functions not listed in generatedModules as undefined', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument([
        "' @import /generated/PluginApi.brs",
        'sub init()',
        '  NotDeclared()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [
        { path: '/generated/PluginApi.brs', functions: ['PluginInit'] },
      ]);

      const undefDiags = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undefDiags).to.have.length(1);
      expect(undefDiags[0].message).to.include('NotDeclared');
    });

    it('treats function name matching as case-insensitive', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument([
        "' @import /generated/PluginApi.brs",
        'sub init()',
        '  plugininit()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [
        { path: '/generated/PluginApi.brs', functions: ['PluginInit'] },
      ]);

      const undefDiags = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undefDiags).to.be.empty;
    });

    it('only injects functions when the matching import is present in the current file', async () => {
      fsExistsStub.returns(false);
      // No @import for PluginApi.brs here
      const doc = makeDocument([
        'sub init()',
        '  PluginInit()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc, [], [
        { path: '/generated/PluginApi.brs', functions: ['PluginInit'] },
      ]);

      const undefDiags = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undefDiags).to.have.length(1);
    });

    it('combines generatedPaths and generatedModules for the build-generated diagnostic', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument([
        "' @import /generated/PluginApi.brs",
        "' @import /other/Auto.brs",
      ].join('\n'));
      const diags = await provider.provideDiagnostics(
        doc,
        ['/other/**'],
        [{ path: '/generated/PluginApi.brs', functions: [] }],
      );

      const infoDiags = diags.filter((d) => d.code === 'import/build-generated');
      expect(infoDiags).to.have.length(2);
    });
  });

  // ── Undefined function call diagnostics ───────────────────────────────────

  describe('undefined function call diagnostics', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('produces no warning for a known same-file function', async () => {
      const doc = makeDocument([
        'function greet(name as String) as String',
        '  return "hello"',
        'end function',
        'sub init()',
        '  msg = greet("world")',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('warns for a genuinely undefined function call', async () => {
      const doc = makeDocument([
        'sub init()',
        '  result = unknownFunc()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(1);
      expect(undef[0].message).to.include('unknownFunc');
    });

    it('uses Error severity', async () => {
      const doc = makeDocument('sub init()\n  ghost()\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef[0].severity).to.equal(DiagnosticSeverity.Error);
    });

    it('reports the correct line and character range', async () => {
      const doc = makeDocument('sub init()\n  result = unknownFunc()\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef[0].range.start.line).to.equal(1);
      expect(undef[0].range.start.character).to.equal(11); // after "  result = "
      expect(undef[0].range.end.character).to.equal(11 + 'unknownFunc'.length);
    });

    it('produces no warning for a BrightScript built-in', async () => {
      const doc = makeDocument('sub init()\n  x = Abs(-1)\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('is case-insensitive for built-in names', async () => {
      const doc = makeDocument('sub init()\n  x = abs(-1)\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('produces no warning for a language keyword used as a function', async () => {
      const doc = makeDocument('sub init()\n  print tab(3)\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('flags a Kopytko function name when it is not imported', async () => {
      // setState exists in kopytko-framework but is not @imported here — must be flagged
      const doc = makeDocument('sub init()\n  setState({ loading: true })\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length.greaterThan(0);
      expect(undef[0].message).to.include('setState');
    });

    it('does not warn for a Kopytko function that is reachable via an @import chain', async () => {
      const helperText = 'sub setState(newState as Object)\nend sub';
      fsExistsStub.withArgs('/workspace/app/Renderer.brs').returns(true);
      sinon.stub(fsWrapper, 'readFileSync').withArgs('/workspace/app/Renderer.brs', 'utf-8').returns(helperText);

      const doc = makeDocument([
        "' @import /Renderer.brs",
        'sub init()',
        '  setState({ loading: true })',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not flag method calls (preceded by a dot)', async () => {
      const doc = makeDocument([
        'sub init()',
        '  arr = CreateObject("roArray")',
        '  arr.Push("hello")',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not flag the function name on its own declaration line', async () => {
      const doc = makeDocument('function myFunc(x as Integer) as Integer\n  return x\nend function');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not flag calls inside comment lines', async () => {
      const doc = makeDocument("sub init()\n  ' ghost()\nend sub");
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not flag calls inside string literals', async () => {
      const doc = makeDocument('sub init()\n  x = "ghost()"\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not flag dim array declarations', async () => {
      const doc = makeDocument('sub init()\n  dim arr(10)\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('finds multiple undefined calls in one file', async () => {
      const doc = makeDocument([
        'sub init()',
        '  ghostOne()',
        '  ghostTwo()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(2);
      const names = undef.map((d) => d.message as string);
      expect(names.some((m) => m.includes('ghostOne'))).to.be.true;
      expect(names.some((m) => m.includes('ghostTwo'))).to.be.true;
    });

    it('does not warn for a function defined in an @imported file', async () => {
      const helperText = 'function helperFn(x as Integer) as Integer\n  return x\nend function';
      fsExistsStub.withArgs('/workspace/app/utils.brs').returns(true);
      sinon.stub(fsWrapper, 'readFileSync').withArgs('/workspace/app/utils.brs', 'utf-8').returns(helperText);

      const doc = makeDocument([
        "' @import /utils.brs",
        'sub init()',
        '  result = helperFn(42)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not warn when the call target is a local variable holding a function reference', async () => {
      // handler = m._videoStateHandlers[videoState]  then  handler()
      const doc = makeDocument([
        'sub init()',
        '  handler = m._videoStateHandlers["play"]',
        '  handler()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not warn when the call target is a function assigned from another variable', async () => {
      const doc = makeDocument([
        'sub init()',
        '  fn = someKnownModule.getHandler()',
        '  fn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      // fn is a local variable assigned on the line above — must not warn about fn()
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'fn'"))).to.be.false;
    });

    it('does not warn when the call target is a function parameter typed as Function', async () => {
      const doc = makeDocument([
        'sub doWithCallback(callback as Function)',
        '  callback()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not warn when calling an anonymous function parameter typed as Function', async () => {
      const doc = makeDocument([
        'function SomeClass() as Object',
        '  prototype = {}',
        '  prototype._invokeCallback = sub (callback as Function, payload = Invalid as Object, context = Invalid as Object)',
        '    if (callback <> Invalid AND context <> Invalid)',
        '      callback(payload, context)',
        '    else if (callback <> Invalid)',
        '      callback(payload)',
        '    end if',
        '  end sub',
        '  return prototype',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'callback'"))).to.be.false;
    });

    it('does not warn for for-loop iteration variables used as calls', async () => {
      // edge case: a variable from a for loop later used in a call position
      const doc = makeDocument([
        'sub init()',
        '  for each handler in m.handlers',
        '    handler()',
        '  end for',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('still warns for a genuinely undefined name even when other locals exist', async () => {
      const doc = makeDocument([
        'sub init()',
        '  handler = m._handlers["key"]',
        '  result = reallyUnknownFn()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(1);
      expect(undef[0].message).to.include('reallyUnknownFn');
    });

    it('does not interfere with existing import diagnostics', async () => {
      fsExistsStub.returns(false);
      const doc = makeDocument([
        "' @import /missing.brs",
        'sub init()',
        '  ghost()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.some((d) => d.code === 'import/unresolved')).to.be.true;
      expect(diags.some((d) => d.code === 'identifier/undefined-function')).to.be.true;
    });
  });

  // ── Builtin arity checking ────────────────────────────────────────────────

  describe('builtin arity checking', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('flags LCase called with 2 arguments (expects 1)', async () => {
      const doc = makeDocument('sub init()\n  x = LCase("hello", "extra")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const arity = diags.filter((d) => d.code === 'identifier/wrong-arg-count');
      expect(arity).to.have.length(1);
      expect(arity[0].message).to.include('LCase');
      expect(arity[0].message).to.include('1 argument');
      expect(arity[0].message).to.include('2');
    });

    it('does not flag LCase called with 1 argument', async () => {
      const doc = makeDocument('sub init()\n  x = LCase("hello")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/wrong-arg-count')).to.be.empty;
    });

    it('flags UCase called with 0 arguments', async () => {
      const doc = makeDocument('sub init()\n  x = UCase()\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const arity = diags.filter((d) => d.code === 'identifier/wrong-arg-count');
      expect(arity).to.have.length(1);
      expect(arity[0].message).to.include('UCase');
    });

    it('does not flag Substitute called with 2 required args and optional omitted', async () => {
      const doc = makeDocument('sub init()\n  x = Substitute("{0}", "a")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/wrong-arg-count')).to.be.empty;
    });

    it('does not flag Substitute called with all 5 args', async () => {
      const doc = makeDocument('sub init()\n  x = Substitute("{0}", "a", "b", "c", "d")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/wrong-arg-count')).to.be.empty;
    });

    it('flags Substitute called with 6 args (max is 5)', async () => {
      const doc = makeDocument('sub init()\n  x = Substitute("{0}", "a", "b", "c", "d", "e")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const arity = diags.filter((d) => d.code === 'identifier/wrong-arg-count');
      expect(arity).to.have.length(1);
      expect(arity[0].message).to.include('Substitute');
    });

    it('uses Error severity', async () => {
      const doc = makeDocument('sub init()\n  x = LCase("a", "b")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const arity = diags.filter((d) => d.code === 'identifier/wrong-arg-count');
      expect(arity[0].severity).to.equal(DiagnosticSeverity.Error);
    });

    it('reports the correct range (the function name token)', async () => {
      const doc = makeDocument('sub init()\n  x = LCase("a", "b")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const arity = diags.filter((d) => d.code === 'identifier/wrong-arg-count');
      expect(arity[0].range.start.line).to.equal(1);
      expect(arity[0].range.start.character).to.equal(6); // "  x = " = 6
      expect(arity[0].range.end.character).to.equal(6 + 'LCase'.length);
    });

    it('handles nested function calls correctly — counts only top-level args', async () => {
      // Substitute(tmpl, LCase(a), UCase(b)) — LCase and UCase each get 1 arg = correct
      // But LCase(a, b) inside would flag only LCase, not Substitute
      const doc = makeDocument('sub init()\n  x = Substitute("{0}", LCase("a"), UCase("b"))\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/wrong-arg-count')).to.be.empty;
    });

    it('flags the inner call when it has wrong arity, not the outer', async () => {
      // LCase("a", "b") has 2 args (wrong), is nested inside Substitute which is fine
      const doc = makeDocument('sub init()\n  x = Substitute("{0}", LCase("a", "b"))\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const arity = diags.filter((d) => d.code === 'identifier/wrong-arg-count');
      expect(arity).to.have.length(1);
      expect(arity[0].message).to.include('LCase');
    });

    it('does not flag method calls on objects (preceded by dot)', async () => {
      // arr.Push() is a method call, not a builtin — not flagged for arity
      const doc = makeDocument('sub init()\n  arr.Push("x", "y")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/wrong-arg-count')).to.be.empty;
    });

    it('does not flag CreateObject with 1 argument', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("roAssociativeArray")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/wrong-arg-count')).to.be.empty;
    });

    it('does not flag CreateObject with 3 arguments', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("roSGNode", "Component", true)\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/wrong-arg-count')).to.be.empty;
    });

    it('flags CreateObject with 0 arguments', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject()\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const arity = diags.filter((d) => d.code === 'identifier/wrong-arg-count');
      expect(arity).to.have.length(1);
      expect(arity[0].message).to.include('CreateObject');
    });
  });

  // ── Undefined variable diagnostics ───────────────────────────────────────

  describe('undefined variable diagnostics', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('flags an argument that is never defined anywhere in the file', async () => {
      const doc = makeDocument('sub init()\n  asd(s)\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.have.length(1);
      expect(undef[0].message).to.include("'s'");
    });

    it('does not flag a locally assigned variable', async () => {
      const doc = makeDocument('sub init()\n  s = "hello"\n  print s\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'s'"))).to.be.false;
    });

    it('does not flag a function parameter', async () => {
      const doc = makeDocument('function process(s as String) as Void\n  print s\nend function');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'s'"))).to.be.false;
    });

    it('does not flag m (BrightScript component self-reference)', async () => {
      const doc = makeDocument('sub init()\n  m.state = {}\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'m'"))).to.be.false;
    });

    it('does not flag BrightScript keywords or type names', async () => {
      const doc = makeDocument(
        'function add(x as Integer, y as Integer) as Integer\n  return x + y\nend function'
      );
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });

    it('does not flag associative array literal keys', async () => {
      const doc = makeDocument(
        'sub init()\n  state = { loading: false, count: 0 }\nend sub'
      );
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });

    it('does not flag a known function name used as a value reference', async () => {
      const doc = makeDocument(
        'sub doWork()\nend sub\nsub init()\n  ref = doWork\nend sub'
      );
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'doWork'"))).to.be.false;
    });

    it('does not flag for-loop iteration variables', async () => {
      const doc = makeDocument(
        'sub init()\n  for each item in m.items\n    print item\n  end for\nend sub'
      );
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'item'"))).to.be.false;
    });

    it('uses Warning severity', async () => {
      const doc = makeDocument('sub init()\n  print s\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.have.length(1);
      expect(undef[0].severity).to.equal(DiagnosticSeverity.Error);
    });

    it('reports the correct line and character range', async () => {
      const doc = makeDocument('sub init()\n  asd(s)\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef[0].range.start.line).to.equal(1);
      expect(undef[0].range.start.character).to.equal(6); // "  asd(" = 6 chars
      expect(undef[0].range.end.character).to.equal(7);
    });

    it('does not interfere with undefined function diagnostics', async () => {
      // asd() → identifier/undefined-function; s → identifier/undefined-variable
      const doc = makeDocument('sub init()\n  asd(s)\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.some((d) => d.code === 'identifier/undefined-function')).to.be.true;
      expect(diags.some((d) => d.code === 'identifier/undefined-variable')).to.be.true;
    });

    it('does not flag anonymous function parameters', async () => {
      const doc = makeDocument([
        'sub init()',
        '  m.handler = function(event as Object)',
        '    print event',
        '  end function',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'event'"))).to.be.false;
    });

    it('does not flag anonymous function parameters when passed as a function call argument', async () => {
      const doc = makeDocument([
        'sub init()',
        '  SomeFunction({ a: "asd" }, function (someArg as Object) as Boolean',
        '    print someArg',
        '    return true',
        '  end function)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'someArg'"))).to.be.false;
    });

    it('does not flag params of a second anonymous function on an end-function line', async () => {
      const doc = makeDocument([
        'sub init()',
        '  callWith(function (a as Object) as Boolean',
        '    print a',
        '    return true',
        '  end function, function (b as String) as Void',
        '    print b',
        '  end function)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'a'"))).to.be.false;
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'b'"))).to.be.false;
    });

    it('flags an undefined variable inside a call to a function whose name starts with "sub" (e.g. Substitute)', async () => {
      // Regression: FUNC_PARAMS_RE with /i flag matched "Sub" in "Substitute", treating
      // its argument list as function parameters and silently adding "dd" to fileScope.
      const doc = makeDocument([
        'function getUserLocale() as String',
        '  LOCALE_FORMAT = "{0}_{1}"',
        '  userLanguage = getUserLanguageCode()',
        '  countryCode = "US"',
        '  return Substitute(LOCALE_FORMAT, LCase(userLanguage, dd), UCase(countryCode))',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'dd'"))).to.be.true;
    });

    it('does not flag a variable assigned with a BrightScript type-declaration character (e.g. nowTimestamp&)', async () => {
      const doc = makeDocument([
        'sub init()',
        '  nowTimestamp& = CreateObject("roDateTime").asSeconds()',
        '  validTimestamp = (nowTimestamp& - (14 - 4) * 6)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'nowTimestamp'"))).to.be.false;
    });

    it('does not flag variables with % (Integer) type-declaration suffix', async () => {
      const doc = makeDocument([
        'sub init()',
        '  count% = 0',
        '  total = count% + 1',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'count'"))).to.be.false;
    });

    it('does not flag variables with ! (Float) type-declaration suffix', async () => {
      const doc = makeDocument([
        'sub init()',
        '  rate! = 1.5',
        '  result = rate! * 100',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'rate'"))).to.be.false;
    });

    it('does not flag variables with # (Double) type-declaration suffix', async () => {
      const doc = makeDocument([
        'sub init()',
        '  precise# = 3.14159265',
        '  val = precise# + 1',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'precise'"))).to.be.false;
    });

    it('does not flag variables with $ (String) type-declaration suffix', async () => {
      const doc = makeDocument([
        'sub init()',
        '  name$ = "hello"',
        '  msg = name$ + " world"',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'name'"))).to.be.false;
    });

    it('does not flag a compound assignment lvalue (x += 1)', async () => {
      const doc = makeDocument([
        'sub init()',
        '  count = 0',
        '  count += 1',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });
  });

  // ── Shadowed built-in names ─────────────────────────────────────────────

  describe('shadowed built-in function names', () => {
    it('flags a parameter that shadows a built-in function', async () => {
      const doc = makeDocument([
        'function test(str as String) as String',
        '  return str',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const shadows = diags.filter((d) => d.code === 'identifier/shadows-builtin');
      expect(shadows).to.have.lengthOf(1);
      expect(shadows[0].message).to.include("'str'");
      expect(shadows[0].range.start.line).to.equal(0);
    });

    it('flags a variable assignment that shadows a built-in', async () => {
      const doc = makeDocument([
        'sub init()',
        '  len = 5',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const shadows = diags.filter((d) => d.code === 'identifier/shadows-builtin');
      expect(shadows).to.have.lengthOf(1);
      expect(shadows[0].message).to.include("'len'");
    });

    it('flags a for-loop variable that shadows a built-in', async () => {
      const doc = makeDocument([
        'sub init()',
        '  for val = 1 to 10',
        '    print val',
        '  end for',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const shadows = diags.filter((d) => d.code === 'identifier/shadows-builtin');
      expect(shadows).to.have.lengthOf(1);
      expect(shadows[0].message).to.include("'val'");
    });

    it('flags anonymous function parameter that shadows a built-in', async () => {
      const doc = makeDocument([
        'sub init()',
        '  SomeFunction({ a: "asd" }, function (str as Object) as Boolean',
        '    return true',
        '  end function)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const shadows = diags.filter((d) => d.code === 'identifier/shadows-builtin');
      expect(shadows).to.have.lengthOf(1);
      expect(shadows[0].message).to.include("'str'");
    });

    it('does not flag normal variable names that do not match builtins', async () => {
      const doc = makeDocument([
        'sub init()',
        '  myVar = 5',
        '  result = myVar + 1',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const shadows = diags.filter((d) => d.code === 'identifier/shadows-builtin');
      expect(shadows).to.have.lengthOf(0);
    });

    it('uses Error severity', async () => {
      const doc = makeDocument([
        'sub init()',
        '  str = "hello"',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const shadows = diags.filter((d) => d.code === 'identifier/shadows-builtin');
      expect(shadows[0].severity).to.equal(DiagnosticSeverity.Error);
    });
  });

  // ── Function scope isolation ─────────────────────────────────────────────

  describe('function scope isolation (no closures)', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('flags an outer function parameter used inside an anonymous inner function', async () => {
      const doc = makeDocument([
        'function outer(name as String)',
        '  callback = function()',
        '    print name',
        '  end function',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'name'"))).to.be.true;
    });

    it('flags an outer local variable used inside an anonymous inner function', async () => {
      const doc = makeDocument([
        'sub outer()',
        '  count = 0',
        '  callback = function()',
        '    print count',
        '  end function',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'count'"))).to.be.true;
    });

    it('does not flag variables defined inside the inner function', async () => {
      const doc = makeDocument([
        'sub outer()',
        '  callback = function()',
        '    inner = 42',
        '    print inner',
        '  end function',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'inner'"))).to.be.false;
    });

    it('does not flag variables defined in the outer function when used in the outer body', async () => {
      const doc = makeDocument([
        'function outer(a as Integer) as Integer',
        '  b = a + 1',
        '  return b',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });

    it('does not flag variables from one function in a sibling function', async () => {
      const doc = makeDocument([
        'function foo(x as Integer) as Integer',
        '  return x',
        'end function',
        'function bar() as Integer',
        '  return x',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'x'"))).to.be.true;
    });

    it('does not flag the outer variable assigned on the same line as the inner function', async () => {
      const doc = makeDocument([
        'sub outer()',
        '  callback = function()',
        '  end function',
        '  callback()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'callback'"))).to.be.false;
    });

    it('isolates variables in 3+ levels of nesting', async () => {
      const doc = makeDocument([
        'sub outer()',
        '  outerVar = 1',
        '  cb = function()',
        '    innerCb = function()',
        '      print outerVar',
        '    end function',
        '  end function',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'outerVar'"))).to.be.true;
    });

    it('does not flag variables at file level (outside any function)', async () => {
      const doc = makeDocument([
        'someGlobal = 123',
        'sub init()',
        '  x = 1',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'someGlobal'"))).to.be.false;
    });

    it('does not flag an outer variable used before an inline anonymous sub on the same line', async () => {
      const doc = makeDocument([
        'sub init()',
        '  a = 1',
        '  setState({ b: false, a: a }, sub ()',
        '  end sub)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'a'"))).to.be.false;
    });

    it('does not flag an outer variable used after end function on the same line', async () => {
      const doc = makeDocument([
        'sub init()',
        '  a = 1',
        '  return m.service.fetch().then(function (items as Object) as Object',
        '    return items',
        '  end function, Invalid, { a: a })',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'a'"))).to.be.false;
    });

    it('still flags a truly undefined variable before an inline anonymous sub', async () => {
      const doc = makeDocument([
        'sub init()',
        '  setState({ b: false, a: nope }, sub ()',
        '  end sub)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'nope'"))).to.be.true;
    });

    it('still flags a truly undefined variable after end function on the same line', async () => {
      const doc = makeDocument([
        'sub init()',
        '  m.service.fetch().then(function () as Void',
        '    doStuff()',
        '  end function, Invalid, { x: nope })',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => typeof d.message === 'string' && d.message.includes("'nope'"))).to.be.true;
    });
  });

  // ── SceneGraph extends inheritance ───────────────────────────────────────

  describe('extends inheritance', () => {
    let readdirStub: sinon.SinonStub;
    let readdirTypedStub: sinon.SinonStub;
    let readStub: sinon.SinonStub;

    beforeEach(() => {
      readdirStub = sinon.stub(fsWrapper, 'readdirSync');
      readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped');
      readStub = sinon.stub(fsWrapper, 'readFileSync');
    });

    it('does not flag a function inherited from a parent component', async () => {
      // Child XML: extends KopytkoGroup, lists Test.brs
      readdirStub.withArgs('/workspace/app/components').returns(['Test.xml']);
      readdirStub.returns([]);
      readStub.withArgs('/workspace/app/components/Test.xml', 'utf-8').returns(
        `<component name="Test" extends="KopytkoGroup">
           <script type="text/brightscript" uri="Test.brs" />
         </component>`
      );
      fsExistsStub.withArgs('/workspace/app/components/Test.brs').returns(true);

      // findComponentXml: search /workspace/app, then /workspace
      readdirTypedStub.withArgs('/workspace/app').returns([
        { name: 'KopytkoGroup.xml', isDirectory: false },
      ]);
      readdirTypedStub.returns([]);
      readStub.withArgs('/workspace/app/KopytkoGroup.xml', 'utf-8').returns(
        `<component name="KopytkoGroup">
           <script type="text/brightscript" uri="KopytkoGroup.brs" />
         </component>`
      );
      fsExistsStub.withArgs('/workspace/app/KopytkoGroup.brs').returns(true);
      readStub.withArgs('/workspace/app/KopytkoGroup.brs', 'utf-8').returns(
        'function setState(state as Object)\nend function\nfunction getState() as Object\nend function'
      );

      const doc = makeDocument('sub init()\n  setState({})\n  getState()\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(0);
    });

    it('still flags a function that is not inherited from any parent', async () => {
      readdirStub.withArgs('/workspace/app/components').returns(['Test.xml']);
      readdirStub.returns([]);
      readStub.withArgs('/workspace/app/components/Test.xml', 'utf-8').returns(
        `<component name="Test" extends="KopytkoGroup">
           <script type="text/brightscript" uri="Test.brs" />
         </component>`
      );
      fsExistsStub.withArgs('/workspace/app/components/Test.brs').returns(true);

      readdirTypedStub.withArgs('/workspace/app').returns([
        { name: 'KopytkoGroup.xml', isDirectory: false },
      ]);
      readdirTypedStub.returns([]);
      readStub.withArgs('/workspace/app/KopytkoGroup.xml', 'utf-8').returns(
        `<component name="KopytkoGroup">
           <script type="text/brightscript" uri="KopytkoGroup.brs" />
         </component>`
      );
      fsExistsStub.withArgs('/workspace/app/KopytkoGroup.brs').returns(true);
      readStub.withArgs('/workspace/app/KopytkoGroup.brs', 'utf-8').returns(
        'function setState(state as Object)\nend function'
      );

      const doc = makeDocument('sub init()\n  notDeclaredAnywhere()\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.have.length(1);
      expect(undef[0].message).to.include('notDeclaredAnywhere');
    });

    it('does not flag undefined-variable for a name that is a parent-inherited function', async () => {
      readdirStub.withArgs('/workspace/app/components').returns(['Test.xml']);
      readdirStub.returns([]);
      readStub.withArgs('/workspace/app/components/Test.xml', 'utf-8').returns(
        `<component name="Test" extends="KopytkoGroup">
           <script type="text/brightscript" uri="Test.brs" />
         </component>`
      );
      fsExistsStub.withArgs('/workspace/app/components/Test.brs').returns(true);

      readdirTypedStub.withArgs('/workspace/app').returns([
        { name: 'KopytkoGroup.xml', isDirectory: false },
      ]);
      readdirTypedStub.returns([]);
      readStub.withArgs('/workspace/app/KopytkoGroup.xml', 'utf-8').returns(
        `<component name="KopytkoGroup">
           <script type="text/brightscript" uri="KopytkoGroup.brs" />
         </component>`
      );
      fsExistsStub.withArgs('/workspace/app/KopytkoGroup.brs').returns(true);
      readStub.withArgs('/workspace/app/KopytkoGroup.brs', 'utf-8').returns(
        'function setState(state as Object)\nend function'
      );

      // Use setState as a value reference (no parentheses) — should not be flagged as undefined var
      const doc = makeDocument('sub init()\n  ref = setState\n  ref({})\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.have.length(0);
    });
  });

  // ── XML sibling scope isolation ───────────────────────────────────────────

  it('does NOT flag a function defined in an XML sibling BRS file (available at runtime)', async () => {
    // XML sibling scripts share scope at runtime — flagging them would produce false positives.
    const readdirStub = sinon.stub(fsWrapper, 'readdirSync');
    const readStub = sinon.stub(fsWrapper, 'readFileSync');

    readdirStub.withArgs('/workspace/app/components').returns(['Test.brs', 'Test.xml']);
    readdirStub.returns([]);

    fsExistsStub.withArgs('/workspace/app/components/Test.xml').returns(true);
    readStub.withArgs('/workspace/app/components/Test.xml', 'utf-8').returns(
      '<component name="Test">' +
      '<script type="text/brightscript" uri="Sibling.brs"/>' +
      '<script type="text/brightscript" uri="Test.brs"/>' +
      '</component>'
    );
    fsExistsStub.withArgs('/workspace/app/components/Sibling.brs').returns(true);
    readStub.withArgs('/workspace/app/components/Sibling.brs', 'utf-8').returns(
      'function xmlSiblingFunc() as Void\nend function'
    );

    const doc = makeDocument('sub init()\n  xmlSiblingFunc()\nend sub');
    const diags = await provider.provideDiagnostics(doc);
    const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
    expect(undef).to.have.length(0);
  });

  // ── CreateObject argument validation ─────────────────────────────────────

  describe('CreateObject argument validation', () => {
    it('flags an unknown component name in CreateObject', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("roNotARealComponent")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const co = diags.filter((d) => d.code === 'createobject/unknown-component');
      expect(co).to.have.length(1);
      expect(co[0].message).to.include('roNotARealComponent');
      expect(co[0].severity).to.equal(DiagnosticSeverity.Warning);
    });

    it('does not flag a valid component name', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("roArray")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'createobject/unknown-component')).to.be.empty;
    });

    it('does not flag roSGNode (second arg is custom)', async () => {
      const doc = makeDocument('sub init()\n  node = CreateObject("roSGNode", "MyComponent")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'createobject/unknown-component')).to.be.empty;
    });

    it('is case-insensitive for component lookup', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("roarray")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'createobject/unknown-component')).to.be.empty;
    });

    it('skips comment lines', async () => {
      const doc = makeDocument("sub init()\n  ' CreateObject(\"roFakeComponent\")\nend sub");
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'createobject/unknown-component')).to.be.empty;
    });

    it('highlights the string literal including quotes', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("roFake")\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const co = diags.filter((d) => d.code === 'createobject/unknown-component');
      expect(co).to.have.length(1);
      // "roFake" starts at the quote position
      const line = 'sub init()\n  obj = CreateObject("roFake")\nend sub'.split('\n')[1];
      const quotePos = line.indexOf('"roFake"');
      expect(co[0].range.start.character).to.equal(quotePos);
      expect(co[0].range.end.character).to.equal(quotePos + '"roFake"'.length);
    });
  });

  // ── Loop flow control errors ──────────────────────────────────────────────

  describe('loop flow control', () => {
    it('flags "exit while" outside a while loop', async () => {
      const doc = makeDocument('sub init()\n  exit while\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const flow = diags.filter((d) => d.code === 'syntax/flow-outside-loop');
      expect(flow).to.have.length(1);
      expect(flow[0].message).to.include('exit while');
      expect(flow[0].severity).to.equal(DiagnosticSeverity.Error);
    });

    it('flags "continue for" outside a for loop', async () => {
      const doc = makeDocument('sub init()\n  continue for\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const flow = diags.filter((d) => d.code === 'syntax/flow-outside-loop');
      expect(flow).to.have.length(1);
      expect(flow[0].message).to.include('continue for');
    });

    it('does not flag "exit while" inside a while loop', async () => {
      const doc = makeDocument('sub init()\n  while true\n    exit while\n  end while\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'syntax/flow-outside-loop')).to.be.empty;
    });

    it('does not flag "exit for" inside a for loop', async () => {
      const doc = makeDocument('sub init()\n  for i = 0 to 10\n    exit for\n  end for\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'syntax/flow-outside-loop')).to.be.empty;
    });

    it('flags "exit for" inside a while loop (wrong loop type)', async () => {
      const doc = makeDocument('sub init()\n  while true\n    exit for\n  end while\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const flow = diags.filter((d) => d.code === 'syntax/flow-outside-loop');
      expect(flow).to.have.length(1);
      expect(flow[0].message).to.include('exit for');
    });

    it('does not flag "continue while" inside nested while', async () => {
      const doc = makeDocument([
        'sub init()',
        '  for i = 0 to 5',
        '    while m.running',
        '      continue while',
        '    end while',
        '  end for',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'syntax/flow-outside-loop')).to.be.empty;
    });
  });

  // ── Unused parameter diagnostics ────────────────────────────────────────

  describe('unused parameter diagnostics', () => {
    it('flags an unused parameter', async () => {
      const doc = makeDocument('function myFunc(unused as String)\n  return 1\nend function');
      const diags = await provider.provideDiagnostics(doc);
      const unused = diags.filter((d) => d.code === 'identifier/unused-parameter');
      expect(unused).to.have.length(1);
      expect(unused[0].message).to.include('unused');
    });

    it('does not flag a used parameter', async () => {
      const doc = makeDocument('function myFunc(name as String)\n  print name\nend function');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/unused-parameter')).to.be.empty;
    });

    it('does not flag _prefixed parameters', async () => {
      const doc = makeDocument('function myFunc(_unused as String)\n  return 1\nend function');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/unused-parameter')).to.be.empty;
    });

    it('uses Warning severity', async () => {
      const doc = makeDocument('sub init(cb as Function)\n  return\nend sub');
      const diags = await provider.provideDiagnostics(doc);
      const unused = diags.filter((d) => d.code === 'identifier/unused-parameter');
      expect(unused).to.have.length(1);
      expect(unused[0].severity).to.equal(DiagnosticSeverity.Warning);
    });
  });

  // ── Main function entry-point exemption ──────────────────────────────────

  describe('Roku entry-point — undefined function call exemption', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('does not flag an unimported function call inside Main', async () => {
      const doc = makeDocument([
        'sub Main(args as Object)',
        '  StartUserInterface(args)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('is case-insensitive for the Main function name', async () => {
      const doc = makeDocument([
        'function main(args as Object)',
        '  doSetup(args)',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('still flags undefined calls outside Main', async () => {
      const doc = makeDocument([
        'sub Main(args as Object)',
        'end sub',
        'sub helper()',
        '  notDefined()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef.some((d) => d.message.includes("'notDefined'"))).to.be.true;
    });

    it('does not suppress checks for a function also named "main" that is nested inside another', async () => {
      // Only the TOP-LEVEL Main is exempt; a helper sub called main is not.
      const doc = makeDocument([
        'sub outer()',
        '  inner()',
        'end sub',
        'sub inner()',
        '  notExist()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef.some((d) => d.message.includes("'notExist'"))).to.be.true;
    });

    it('does not flag calls inside anonymous callbacks declared within Main', async () => {
      // NewRelic / analytics SDKs are often called inside observeField callbacks.
      // The anonymous function is technically a nested scope but the user considers
      // it "inside Main" and expects no false positives.
      const doc = makeDocument([
        'sub Main(args as Object)',
        '  m.onReady = function()',
        '    NewRelic("ready")',
        '  end function',
        '  RunUserInterface(args)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('still suppresses when Main body lines have trailing comments containing "function("', async () => {
      // Regression: `doWork() ' calls function(x)` in a comment used to trick
      // ANON_FUNC_SCOPE_RE into pushing a phantom scope that was never popped,
      // causing findMainFunctionScope to return null for the whole file.
      const doc = makeDocument([
        'sub Main(args as Object)',
        "  StartUserInterface(args) ' called as function(args)",
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('does not suppress undefined-variable checks inside Main', async () => {
      const doc = makeDocument([
        'sub Main(args as Object)',
        '  print undeclaredVar',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => d.message.includes("'undeclaredVar'"))).to.be.true;
    });

    it('does not flag an unimported function call inside RunUserInterface', async () => {
      const doc = makeDocument([
        'sub RunUserInterface(args as Object)',
        '  InitApp(args)',
        '  ShowScreen(args)',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('does not flag an unimported function call inside RunScreenSaver', async () => {
      const doc = makeDocument([
        'sub RunScreenSaver()',
        '  StartScreenSaver()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('is case-insensitive for RunUserInterface', async () => {
      const doc = makeDocument([
        'function runuserinterface(args as Object)',
        '  doSetup(args)',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('still flags undefined calls outside RunUserInterface', async () => {
      const doc = makeDocument([
        'sub RunUserInterface(args as Object)',
        'end sub',
        'sub helper()',
        '  notDefined()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef.some((d) => d.message.includes("'notDefined'"))).to.be.true;
    });
  });

  // ── main.brs file-level exemption ─────────────────────────────────────────

  describe('main.brs file — undefined function call exemption', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('does not flag any undefined function call in a file named main.brs', async () => {
      const doc = makeDocument([
        'sub Main(args as Object)',
        '  StartUI(args)',
        'end sub',
        'sub StartUI(args as Object)',
        '  ShowMainScreen(args)',
        'end sub',
      ].join('\n'), 'file:///workspace/app/source/main.brs');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('is case-insensitive for the filename', async () => {
      const doc = makeDocument([
        'sub Main(args as Object)',
        '  ExternalFunc()',
        'end sub',
        'sub Helper()',
        '  AnotherExternal()',
        'end sub',
      ].join('\n'), 'file:///workspace/app/source/Main.brs');
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('still flags undefined calls in non-main files', async () => {
      const doc = makeDocument([
        'sub helper()',
        '  notDefined()',
        'end sub',
      ].join('\n'), 'file:///workspace/app/components/helper.brs');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-function');
      expect(undef.some((d) => d.message.includes("'notDefined'"))).to.be.true;
    });

    it('still checks undefined variables in main.brs', async () => {
      const doc = makeDocument([
        'sub Main(args as Object)',
        '  print undeclaredVar',
        'end sub',
      ].join('\n'), 'file:///workspace/app/source/main.brs');
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef.some((d) => d.message.includes("'undeclaredVar'"))).to.be.true;
    });
  });

  // ── catch variable scope ──────────────────────────────────────────────────

  describe('catch variable scope', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('does not flag the catch variable as undefined when used in the catch block', async () => {
      const doc = makeDocument([
        'sub init()',
        '  try',
        '    doWork()',
        '  catch e',
        '    print e.message',
        '  end try',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });

    it('does not flag the catch variable with parenthesised syntax', async () => {
      const doc = makeDocument([
        'sub init()',
        '  try',
        '    doWork()',
        '  catch (e)',
        '    print e.message',
        '  end try',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });

    it('does not flag the catch variable used in a rethrow expression', async () => {
      const doc = makeDocument([
        'sub init()',
        '  try',
        '    doWork()',
        '  catch err',
        '    throw err',
        '  end try',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const undef = diags.filter((d) => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });
  });

  // ── throw statement validation ────────────────────────────────────────────

  describe('throw statement validation', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('does not flag throw with a string literal', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw "something went wrong"',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'throw/invalid-value')).to.be.empty;
      expect(diags.filter((d) => d.code === 'throw/missing-message')).to.be.empty;
    });

    it('does not flag throw with a variable', async () => {
      const doc = makeDocument([
        'sub init()',
        '  err = { message: "oops" }',
        '  throw err',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'throw/invalid-value')).to.be.empty;
    });

    it('does not flag throw with an AA literal that has a message field', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw { message: "oops", number: -1 }',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'throw/missing-message')).to.be.empty;
    });

    it('warns when an AA literal is thrown without a message field', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw { number: -1 }',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const missing = diags.filter((d) => d.code === 'throw/missing-message');
      expect(missing).to.have.length(1);
      expect(missing[0].severity).to.equal(DiagnosticSeverity.Warning);
    });

    it('warns when throwing a numeric literal', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw 42',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const invalid = diags.filter((d) => d.code === 'throw/invalid-value');
      expect(invalid).to.have.length(1);
      expect(invalid[0].severity).to.equal(DiagnosticSeverity.Warning);
    });

    it('warns when throwing an array literal', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw ["error"]',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const invalid = diags.filter((d) => d.code === 'throw/invalid-value');
      expect(invalid).to.have.length(1);
    });

    it('warns when throwing invalid', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw invalid',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const invalid = diags.filter((d) => d.code === 'throw/invalid-value');
      expect(invalid).to.have.length(1);
    });

    it('does not flag throw (expr) — parentheses are visual grouping only', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw ("error message")',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'throw/invalid-value')).to.be.empty;
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('throw (someVar) does not flag someVar as undefined function call', async () => {
      const doc = makeDocument([
        'sub init()',
        '  try',
        '    print "test"',
        '  catch e',
        '    throw (e)',
        '  end try',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('places the warning on the throw keyword', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw 42',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const d = diags.find((d) => d.code === 'throw/invalid-value')!;
      expect(d.range.start.line).to.equal(1);
    });

    it('warns for a negative numeric literal', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw -1',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'throw/invalid-value')).to.have.length(1);
    });

    it('warns for a floating-point numeric literal', async () => {
      const doc = makeDocument([
        'sub init()',
        '  throw 3.14',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'throw/invalid-value')).to.have.length(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Callback validation — observeField / observeFieldScoped
  // ---------------------------------------------------------------------------

  describe('callback/undefined-observer-callback', () => {
    it('reports an error when observer callback function is not defined', async () => {
      const doc = makeDocument([
        'sub init()',
        '  m.top.observeFieldScoped("focusedChild", "onFocusChanged")',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const found = diags.filter((d) => d.code === 'callback/undefined-observer-callback');
      expect(found).to.have.length(1);
      expect(found[0].message).to.include('onFocusChanged');
    });

    it('does not report when callback is defined in the same file', async () => {
      const doc = makeDocument([
        'sub init()',
        '  m.top.observeFieldScoped("focusedChild", "onFocusChanged")',
        'end sub',
        '',
        'sub onFocusChanged()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'callback/undefined-observer-callback')).to.be.empty;
    });

    it('does not report when callback is available via @import', async () => {
      const importedFile = '/workspace/app/components/utils.brs';
      fsExistsStub.withArgs(importedFile).returns(true);
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs(importedFile, 'utf-8')
        .returns('sub onFocusChanged()\nend sub');

      const doc = makeDocument([
        "' @import /components/utils.brs",
        'sub init()',
        '  m.top.observeFieldScoped("focusedChild", "onFocusChanged")',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'callback/undefined-observer-callback')).to.be.empty;
    });
  });

  // ---------------------------------------------------------------------------
  // Callback validation — Kopytko events field
  // ---------------------------------------------------------------------------

  describe('callback/undefined-event-callback', () => {
    it('reports an error when event callback function is not defined', async () => {
      const doc = makeDocument([
        'function render() as Object',
        '  return {',
        '    name: "Button",',
        '    events: {',
        '      buttonSelected: "_onButtonSelected",',
        '    },',
        '  }',
        'end function',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      const found = diags.filter((d) => d.code === 'callback/undefined-event-callback');
      expect(found).to.have.length(1);
      expect(found[0].message).to.include('_onButtonSelected');
    });

    it('does not report when event callback is defined in the same file', async () => {
      const doc = makeDocument([
        'function render() as Object',
        '  return {',
        '    name: "Button",',
        '    events: {',
        '      buttonSelected: "_onButtonSelected",',
        '    },',
        '  }',
        'end function',
        '',
        'sub _onButtonSelected()',
        'end sub',
      ].join('\n'));
      const diags = await provider.provideDiagnostics(doc);
      expect(diags.filter((d) => d.code === 'callback/undefined-event-callback')).to.be.empty;
    });
  });

  // ── source/ directory global functions ───────────────────────────────────

  describe('source/ directory global functions', () => {
    const WORKSPACE = '/workspace';
    const SOURCE_FILE = path.join(WORKSPACE, 'app', 'source', 'Helpers.brs');

    let readdirStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;

    beforeEach(() => {
      readdirStub = sinon.stub(fsWrapper, 'readdirTyped');
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
      readdirStub.returns([]);
      readFileStub.returns('');
    });

    function buildIndexWithSource(sourceContent: string): WorkspaceFunctionIndex {
      readdirStub.withArgs(WORKSPACE).returns([{ name: 'app', isDirectory: true }]);
      readdirStub.withArgs(path.join(WORKSPACE, 'app')).returns([
        { name: 'source', isDirectory: true },
      ]);
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'source')).returns([
        { name: 'Helpers.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(SOURCE_FILE, 'utf-8').returns(sourceContent);
      const idx = new WorkspaceFunctionIndex();
      idx.build([WORKSPACE]);
      return idx;
    }

    it('does not flag a call to a function defined in source/', async () => {
      const idx = buildIndexWithSource(
        'function globalHelper() as Void\nend function\n',
      );
      const p = new BrightScriptDiagnosticsProvider(resolver, idx);
      const doc = makeDocument([
        'sub init()',
        '  globalHelper()',
        'end sub',
      ].join('\n'));

      const diags = await p.provideDiagnostics(doc);
      const undef = diags.filter(d => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('still flags a call to a function NOT in source/', async () => {
      const idx = buildIndexWithSource(
        'function globalHelper() as Void\nend function\n',
      );
      const p = new BrightScriptDiagnosticsProvider(resolver, idx);
      const doc = makeDocument([
        'sub init()',
        '  missingFn()',
        'end sub',
      ].join('\n'));

      const diags = await p.provideDiagnostics(doc);
      const undef = diags.filter(d => d.code === 'identifier/undefined-function');
      expect(undef).to.have.lengthOf(1);
    });

    it('uses kopytko module source/ names from catalog when provided', async () => {
      const catalogStub = {
        getSourceDirNamesLower: () => new Set(['modulesourcefn']),
      } as unknown as KopytkoModuleCatalog;

      const p = new BrightScriptDiagnosticsProvider(resolver, undefined, catalogStub);
      const doc = makeDocument([
        'sub init()',
        '  moduleSourceFn()',
        'end sub',
      ].join('\n'));

      const diags = await p.provideDiagnostics(doc);
      const undef = diags.filter(d => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('is backward-compatible when workspaceIndex and catalog are omitted', async () => {
      const p = new BrightScriptDiagnosticsProvider(resolver);
      const doc = makeDocument('sub init()\nend sub');
      // Should not throw
      const diags = await p.provideDiagnostics(doc);
      expect(diags).to.be.an('array');
    });
  });

  // ── kopytko.lint.rules.* severity overrides ──────────────────────────────

  describe('lint rule severity overrides', () => {
    beforeEach(() => {
      sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('defaults to warning severity for a missing return type annotation', async () => {
      const doc = makeDocument('function greet(name as String)\n  return "hi"\nend function');
      const diags = await provider.provideDiagnostics(doc, [], [], []);
      const missing = diags.find((d) => d.code === 'type/missing-return-type');
      expect(missing).to.not.be.undefined;
      expect(missing!.severity).to.equal(DiagnosticSeverity.Warning);
    });

    it('escalates missing return type to Error when overridden via kopytko.lint.rules', async () => {
      const doc = makeDocument('function greet(name as String)\n  return "hi"\nend function');
      const diags = await provider.provideDiagnostics(doc, [], [], [], {
        'type/missing-return-type': 'error',
      });
      const missing = diags.find((d) => d.code === 'type/missing-return-type');
      expect(missing).to.not.be.undefined;
      expect(missing!.severity).to.equal(DiagnosticSeverity.Error);
    });

    it('suppresses missing param type diagnostics when overridden to off', async () => {
      const doc = makeDocument('function greet(name)\n  return "hi"\nend function');
      const withDefault = await provider.provideDiagnostics(doc, [], [], []);
      expect(withDefault.filter((d) => d.code === 'type/missing-param-type')).to.have.length(1);

      const withOverride = await provider.provideDiagnostics(doc, [], [], [], {
        'type/missing-param-type': 'off',
      });
      expect(withOverride.filter((d) => d.code === 'type/missing-param-type')).to.be.empty;
    });

    it('leaves the other rule at its default when only one override is provided', async () => {
      const doc = makeDocument('function greet(name)\n  return "hi"\nend function');
      const diags = await provider.provideDiagnostics(doc, [], [], [], {
        'type/missing-return-type': 'error',
      });
      const paramDiag = diags.find((d) => d.code === 'type/missing-param-type');
      expect(paramDiag).to.not.be.undefined;
      expect(paramDiag!.severity).to.equal(DiagnosticSeverity.Warning);
    });
  });
});

import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BrightScriptSignatureHelpProvider } from '../../src/server/providers/signatureHelpProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';
import { KopytkoModuleCatalog, KopytkoExportEntry } from '../../src/server/kopytko/moduleCatalog';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///workspace/app/Test.brs', 'brightscript', 1, content);
}

function makeResolver(): KopytkoImportResolver {
  return new KopytkoImportResolver({
    workspaceFolders: ['/workspace'],
    sourceDir: 'app',
    resolveModules: true,
  });
}

function makeEmptyCatalog(): KopytkoModuleCatalog {
  const stub = sinon.createStubInstance(KopytkoModuleCatalog);
  stub.findExport.returns(undefined);
  return stub as unknown as KopytkoModuleCatalog;
}

const KOPYTKO_ENTRIES: KopytkoExportEntry[] = [
  { name: 'setState', signature: 'sub setState(newState as Object)', importPath: '/Renderer.brs', npmPackage: '@dazn/kopytko-framework' },
  { name: 'navigate', signature: 'sub navigate(route as String, params = {} as Object)', importPath: '/Router.brs', npmPackage: '@dazn/kopytko-framework' },
];

function makeKopytkoCatalog(): KopytkoModuleCatalog {
  const stub = sinon.createStubInstance(KopytkoModuleCatalog);
  stub.findExport.callsFake((name: string) =>
    KOPYTKO_ENTRIES.find((e) => e.name.toLowerCase() === name.toLowerCase())
  );
  return stub as unknown as KopytkoModuleCatalog;
}

describe('BrightScriptSignatureHelpProvider', () => {
  let provider: BrightScriptSignatureHelpProvider;
  let existsStub: sinon.SinonStub;

  beforeEach(() => {
    existsStub = sinon.stub(fsWrapper, 'existsSync').returns(false);
    sinon.stub(fsWrapper, 'readdirSync').returns([]);
    provider = new BrightScriptSignatureHelpProvider(makeResolver(), makeEmptyCatalog());
  });

  afterEach(() => { sinon.restore(); invalidateAllCaches(); });

  // ── Returns null ───────────────────────────────────────────────────────────

  it('returns null on an empty line', () => {
    const doc = makeDocument('');
    expect(provider.provideSignatureHelp(doc, { line: 0, character: 0 })).to.be.null;
  });

  it('returns null when cursor is not inside a call', () => {
    const doc = makeDocument('x = 1');
    expect(provider.provideSignatureHelp(doc, { line: 0, character: 5 })).to.be.null;
  });

  it('returns null for a comment line starting with apostrophe', () => {
    const doc = makeDocument("' Abs(");
    expect(provider.provideSignatureHelp(doc, { line: 0, character: 6 })).to.be.null;
  });

  it('returns null for a REM comment line', () => {
    const doc = makeDocument('rem Abs(');
    expect(provider.provideSignatureHelp(doc, { line: 0, character: 8 })).to.be.null;
  });

  it('returns null when the function name is unknown', () => {
    const doc = makeDocument('unknownFn(');
    expect(provider.provideSignatureHelp(doc, { line: 0, character: 10 })).to.be.null;
  });

  it('returns null when cursor is after the closing paren', () => {
    const doc = makeDocument('Abs(x)');
    expect(provider.provideSignatureHelp(doc, { line: 0, character: 6 })).to.be.null;
  });

  // ── Built-in functions ─────────────────────────────────────────────────────

  it('returns signature for a built-in function', () => {
    const doc = makeDocument('Abs(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 4 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('Abs');
    expect(result!.signatures[0].label).to.include('x as Float');
  });

  it('is case-insensitive for built-in function names', () => {
    const doc = makeDocument('abs(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 4 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('Abs');
  });

  it('strips function/sub keyword from the label', () => {
    // Built-ins have no keyword prefix — just verify format is consistent
    const doc = makeDocument('Len(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 4 });
    expect(result!.signatures[0].label).not.to.match(/^function /i);
    expect(result!.signatures[0].label).not.to.match(/^sub /i);
  });

  it('shows first parameter active when no commas', () => {
    const doc = makeDocument('Left(s');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 6 });
    expect(result!.activeParameter).to.equal(0);
  });

  it('advances active parameter after the first comma', () => {
    const doc = makeDocument('Left(s, ');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 8 });
    expect(result).to.not.be.null;
    expect(result!.activeParameter).to.equal(1);
  });

  it('advances active parameter after the second comma', () => {
    const doc = makeDocument('Mid(s, 1, ');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 10 });
    expect(result!.activeParameter).to.equal(2);
  });

  it('clamps activeParameter to the last param when too many args', () => {
    // Abs has 1 param; pretend we have 3 commas
    const doc = makeDocument('Abs(x, y, z, ');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 13 });
    expect(result!.activeParameter).to.equal(0);
  });

  it('returns all ParameterInformation entries for a multi-param built-in', () => {
    const doc = makeDocument('Mid(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 4 });
    expect(result).to.not.be.null;
    // Mid(s as String, start as Integer, length = -1 as Integer) → 3 params
    expect(result!.signatures[0].parameters).to.have.length(3);
  });

  it('has no parameters for a zero-arg built-in', () => {
    const doc = makeDocument('GetGlobalAA(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 12 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].parameters).to.have.length(0);
    expect(result!.activeParameter).to.equal(0);
  });

  it('always returns exactly one signature', () => {
    const doc = makeDocument('Str(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 4 });
    expect(result!.signatures).to.have.length(1);
    expect(result!.activeSignature).to.equal(0);
  });

  // ── Component methods ──────────────────────────────────────────────────────

  it('returns signature for a known component method', () => {
    const doc = makeDocument(['arr = CreateObject("roArray")', 'arr.Push('].join('\n'));
    const result = provider.provideSignatureHelp(doc, { line: 1, character: 9 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('Push');
    expect(result!.signatures[0].label).to.include('a as Dynamic');
  });

  it('highlights active parameter for component method', () => {
    const doc = makeDocument(['arr = CreateObject("roArray")', 'arr.Push(val'].join('\n'));
    const result = provider.provideSignatureHelp(doc, { line: 1, character: 12 });
    expect(result!.activeParameter).to.equal(0);
  });

  it('returns null for method on unknown receiver type', () => {
    const doc = makeDocument('unknownObj.Push(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 16 });
    // unknownObj has no inferred type, so no component method help
    expect(result).to.be.null;
  });

  it('returns signature for a roUrlTransfer method', () => {
    const doc = makeDocument([
      'transfer = CreateObject("roUrlTransfer")',
      'transfer.SetUrl(',
    ].join('\n'));
    const result = provider.provideSignatureHelp(doc, { line: 1, character: 16 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('SetUrl');
  });

  // ── Nested calls ───────────────────────────────────────────────────────────

  it('shows the outer call when cursor is past a completed nested call', () => {
    // Left(Str(x), cursor) → outer = Left, commaCount = 1
    const doc = makeDocument('Left(Str(x), ');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 13 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('Left');
    expect(result!.activeParameter).to.equal(1);
  });

  it('shows the inner call when cursor is inside a nested call', () => {
    // Left(Str(cursor), n) → inner = Str
    const doc = makeDocument('Left(Str(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 9 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('Str');
  });

  it('handles commas inside array literal arguments without miscounting params', () => {
    // Outer: Len, first argument is an array literal [1, 2, 3]
    // After array, cursor is at commaCount=0 in Len's context
    // Actually Len takes a single string, but the shape of the call is what matters
    const doc = makeDocument('Left([1, 2], ');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 13 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('Left');
    expect(result!.activeParameter).to.equal(1);
  });

  // ── Kopytko module exports ─────────────────────────────────────────────────

  it('returns signature for a Kopytko export from the catalog', () => {
    provider = new BrightScriptSignatureHelpProvider(makeResolver(), makeKopytkoCatalog());
    const doc = makeDocument('setState(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 9 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('setState');
    expect(result!.signatures[0].label).to.include('newState');
  });

  it('returns signature for navigate from the catalog', () => {
    provider = new BrightScriptSignatureHelpProvider(makeResolver(), makeKopytkoCatalog());
    const doc = makeDocument('navigate(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 9 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('navigate');
  });

  it('returns null for a Kopytko function when catalog is empty', () => {
    // provider uses makeEmptyCatalog() — no kopytko entries
    const doc = makeDocument('setState(');
    const result = provider.provideSignatureHelp(doc, { line: 0, character: 9 });
    expect(result).to.be.null;
  });

  // ── User-defined functions ─────────────────────────────────────────────────

  it('returns signature for a user-defined function in the same file', () => {
    const text = [
      'function greet(name as String, count = 0 as Integer) as String',
      '  return ""',
      'end function',
      '',
      'greet(',
    ].join('\n');
    const doc = makeDocument(text);
    const result = provider.provideSignatureHelp(doc, { line: 4, character: 6 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('greet');
    expect(result!.signatures[0].parameters).to.have.length(2);
  });

  it('strips the function keyword from user-defined function label', () => {
    const text = ['function myFunc(x as Integer) as Void', '  end function', '', 'myFunc('].join('\n');
    const doc = makeDocument(text);
    const result = provider.provideSignatureHelp(doc, { line: 3, character: 7 });
    expect(result!.signatures[0].label).to.match(/^myFunc\(/);
  });

  it('highlights correct parameter index for user-defined function', () => {
    const text = [
      'function greet(name as String, count = 0 as Integer) as String',
      '  return ""',
      'end function',
      '',
      'greet("hello", ',
    ].join('\n');
    const doc = makeDocument(text);
    const result = provider.provideSignatureHelp(doc, { line: 4, character: 15 });
    expect(result!.activeParameter).to.equal(1);
  });

  it('returns signature for a user-defined sub', () => {
    const text = ['sub doWork(items as Object)', '  end sub', '', 'doWork('].join('\n');
    const doc = makeDocument(text);
    const result = provider.provideSignatureHelp(doc, { line: 3, character: 7 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('doWork');
  });

  it('returns signature for a user-defined function from an @imported file', () => {
    const importedText = 'function helper(x as Integer, y as Integer) as Integer\n  return x + y\nend function';
    existsStub.withArgs('/workspace/app/utils.brs').returns(true);
    sinon.stub(fsWrapper, 'readFileSync').withArgs('/workspace/app/utils.brs', 'utf-8').returns(importedText);

    const text = ["' @import /utils.brs", '', 'helper('].join('\n');
    const doc = makeDocument(text);
    const result = provider.provideSignatureHelp(doc, { line: 2, character: 7 });
    expect(result).to.not.be.null;
    expect(result!.signatures[0].label).to.include('helper');
    expect(result!.signatures[0].parameters).to.have.length(2);
  });
});

import { expect } from 'chai';
import * as sinon from 'sinon';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver/node';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { BrightScriptHoverProvider } from '../../src/server/providers/hoverProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';
import { KopytkoModuleCatalog, KopytkoExportEntry } from '../../src/server/kopytko/moduleCatalog';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///test.brs', 'brightscript', 1, content);
}

function hoverValue(hover: Hover | null): string {
  if (!hover) return '';
  return (hover.contents as MarkupContent).value;
}

function makeEmptyCatalog(): KopytkoModuleCatalog {
  const stub = sinon.createStubInstance(KopytkoModuleCatalog);
  stub.findExport.returns(undefined);
  return stub as unknown as KopytkoModuleCatalog;
}

describe('BrightScriptHoverProvider', () => {
  let provider: BrightScriptHoverProvider;

  afterEach(() => { sinon.restore(); invalidateAllCaches(); });

  beforeEach(() => {
    provider = new BrightScriptHoverProvider(makeEmptyCatalog());
  });

  // ── Component name hover ───────────────────────────────────────────────────

  describe('component name hover', () => {
    it('shows documentation when hovering over a component name', async () => {
      const doc = makeDocument('roArray');
      const hover = await provider.provideHover(doc, { line: 0, character: 3 });
      const val = hoverValue(hover);
      expect(val).to.include('roArray');
      expect(val).to.include('BrightScript component');
      expect(val).to.include('ifArray');
    });

    it('shows the docs URL', async () => {
      const doc = makeDocument('roUrlTransfer');
      const hover = await provider.provideHover(doc, { line: 0, character: 5 });
      expect(hoverValue(hover)).to.include('developer.roku.com');
    });

    it('shows CATALOG_LAST_VERIFIED date', async () => {
      const doc = makeDocument('roDeviceInfo');
      const hover = await provider.provideHover(doc, { line: 0, character: 5 });
      expect(hoverValue(hover)).to.match(/\d{4}-\d{2}-\d{2}/);
    });

    it('shows roSGNode component info', async () => {
      const doc = makeDocument('roSGNode');
      const hover = await provider.provideHover(doc, { line: 0, character: 3 });
      const val = hoverValue(hover);
      expect(val).to.include('roSGNode');
      expect(val).to.include('ifSGNode');
    });
  });

  // ── Component member hover ────────────────────────────────────────────────

  describe('component member hover', () => {
    it('shows method docs when hovering over a member call with known receiver type', async () => {
      const src = [
        `myArr = CreateObject("roArray")`,
        `myArr.Push("hello")`,
      ].join('\n');
      const doc = makeDocument(src);
      // cursor on "Push" at line 1, char 6
      const hover = await provider.provideHover(doc, { line: 1, character: 7 });
      const val = hoverValue(hover);
      expect(val).to.include('Push');
      expect(val).to.include('roArray');
      expect(val).to.include('ifArray');
    });

    it('shows method docs for roUrlTransfer member', async () => {
      const src = [
        `tr = CreateObject("roUrlTransfer")`,
        `tr.SetUrl("https://example.com")`,
      ].join('\n');
      const doc = makeDocument(src);
      const hover = await provider.provideHover(doc, { line: 1, character: 5 });
      const val = hoverValue(hover);
      expect(val).to.include('SetUrl');
      expect(val).to.include('roUrlTransfer');
    });

    it('shows method docs for roAssociativeArray member', async () => {
      const src = [
        `aa = CreateObject("roAssociativeArray")`,
        `aa.DoesExist("key")`,
      ].join('\n');
      const doc = makeDocument(src);
      const hover = await provider.provideHover(doc, { line: 1, character: 5 });
      const val = hoverValue(hover);
      expect(val).to.include('DoesExist');
      expect(val).to.include('roAssociativeArray');
    });

    it('returns null when receiver type is unknown', async () => {
      const doc = makeDocument(`someUnknown.Push("x")`);
      const hover = await provider.provideHover(doc, { line: 0, character: 14 });
      // No component name match either → null
      expect(hover).to.be.null;
    });

    it('returns null when method name is not on the component', async () => {
      const src = [
        `arr = CreateObject("roArray")`,
        `arr.GetToString()`,
      ].join('\n');
      const doc = makeDocument(src);
      const hover = await provider.provideHover(doc, { line: 1, character: 7 });
      expect(hover).to.be.null;
    });
  });

  // ── Built-in function hover ───────────────────────────────────────────────

  describe('built-in function hover', () => {
    it('returns hover info for Abs', async () => {
      const doc = makeDocument('Abs(-5)');
      const hover = await provider.provideHover(doc, { line: 0, character: 1 });
      const val = hoverValue(hover);
      expect(val).to.include('Abs');
      expect(val).to.include('built-in');
    });

    it('is case-insensitive for built-in names', async () => {
      const doc = makeDocument('len("hello")');
      const hover = await provider.provideHover(doc, { line: 0, character: 1 });
      expect(hoverValue(hover)).to.include('Len');
    });
  });

  // ── Kopytko export hover ──────────────────────────────────────────────────

  describe('Kopytko export hover', () => {
    it('returns hover for a catalogued function', async () => {
      const entry: KopytkoExportEntry = {
        name: 'setState',
        signature: 'sub setState(newState as Object)',
        importPath: '/Renderer.brs',
        npmPackage: '@dazn/kopytko-framework',
      };
      const catalogStub = sinon.createStubInstance(KopytkoModuleCatalog);
      catalogStub.findExport.callsFake((n) => n.toLowerCase() === 'setstate' ? entry : undefined);
      provider = new BrightScriptHoverProvider(catalogStub as unknown as KopytkoModuleCatalog);

      const doc = makeDocument('setState({ loading: true })');
      const hover = await provider.provideHover(doc, { line: 0, character: 3 });
      const val = hoverValue(hover);
      expect(val).to.include('setState');
      expect(val).to.include('Renderer');
      expect(val).to.include('@dazn/kopytko-framework');
    });

    it('shows the signature in a brightscript code block', async () => {
      const entry: KopytkoExportEntry = {
        name: 'navigate',
        signature: 'sub navigate(route as String)',
        importPath: '/Router.brs',
        npmPackage: '@dazn/kopytko-framework',
      };
      const catalogStub = sinon.createStubInstance(KopytkoModuleCatalog);
      catalogStub.findExport.callsFake((n) => n.toLowerCase() === 'navigate' ? entry : undefined);
      provider = new BrightScriptHoverProvider(catalogStub as unknown as KopytkoModuleCatalog);

      const doc = makeDocument('navigate("home")');
      const hover = await provider.provideHover(doc, { line: 0, character: 3 });
      const val = hoverValue(hover);
      expect(val).to.include('navigate(route as String)');
    });

    it('returns null when catalog has no entry for the word', async () => {
      // Uses makeEmptyCatalog (catalog.findExport always returns undefined)
      const doc = makeDocument('unknownKopytkoFn()');
      const hover = await provider.provideHover(doc, { line: 0, character: 5 });
      expect(hover).to.be.null;
    });
  });

  // ── Null cases ────────────────────────────────────────────────────────────

  it('returns null for an unknown identifier', async () => {
    const doc = makeDocument('myLocalVariable = 42');
    const hover = await provider.provideHover(doc, { line: 0, character: 3 });
    expect(hover).to.be.null;
  });

  it('returns null on an empty line', async () => {
    const doc = makeDocument('');
    const hover = await provider.provideHover(doc, { line: 0, character: 0 });
    expect(hover).to.be.null;
  });

  it('returns null when cursor is on whitespace', async () => {
    const doc = makeDocument('   Abs(-5)');
    const hover = await provider.provideHover(doc, { line: 0, character: 1 });
    expect(hover).to.be.null;
  });

  // ── User-defined function hover ──────────────────────────────────────────

  describe('user-defined function hover', () => {
    let existsStub: sinon.SinonStub;
    let readStub: sinon.SinonStub;
    let readdirStub: sinon.SinonStub;

    beforeEach(() => {
      existsStub = sinon.stub(fsWrapper, 'existsSync');
      readStub = sinon.stub(fsWrapper, 'readFileSync');
      readdirStub = sinon.stub(fsWrapper, 'readdirSync');
      existsStub.returns(false);
      readdirStub.returns([]);
    });

    it('shows signature for a function defined in the same file', () => {
      const resolver = new KopytkoImportResolver({
        workspaceFolders: ['/project'],
        sourceDir: 'app',
        resolveModules: false,
      });
      const p = new BrightScriptHoverProvider(makeEmptyCatalog(), resolver);
      const doc = TextDocument.create(
        'file:///project/app/main.brs', 'brightscript', 1,
        'function helperFn(x as Integer, y as String) as Boolean\n  return true\nend function\n\nsub init()\n  helperFn(1, "a")\nend sub',
      );
      // cursor on "helperFn" in the call at line 5
      const hover = p.provideHover(doc, { line: 5, character: 4 });
      expect(hover).to.not.be.null;
      const value = hoverValue(hover);
      expect(value).to.include('helperFn');
      expect(value).to.include('x as Integer');
      expect(value).to.include('y as String');
      expect(value).to.include('as Boolean');
    });

    it('shows signature for a function from an @imported file', () => {
      const resolver = new KopytkoImportResolver({
        workspaceFolders: ['/project'],
        sourceDir: 'app',
        resolveModules: false,
      });
      existsStub.withArgs('/project/app/utils.brs').returns(true);
      readStub.withArgs('/project/app/utils.brs', 'utf-8').returns(
        'function utilHelper(data as Object) as Void\nend function'
      );

      const p = new BrightScriptHoverProvider(makeEmptyCatalog(), resolver);
      const doc = TextDocument.create(
        'file:///project/app/main.brs', 'brightscript', 1,
        "' @import /utils.brs\nsub init()\n  utilHelper(m)\nend sub",
      );
      const hover = p.provideHover(doc, { line: 2, character: 4 });
      expect(hover).to.not.be.null;
      const value = hoverValue(hover);
      expect(value).to.include('utilHelper');
      expect(value).to.include('data as Object');
    });

    it('returns null for unknown identifiers even with importResolver', () => {
      const resolver = new KopytkoImportResolver({
        workspaceFolders: ['/project'],
        sourceDir: 'app',
        resolveModules: false,
      });
      const p = new BrightScriptHoverProvider(makeEmptyCatalog(), resolver);
      const doc = TextDocument.create(
        'file:///project/app/main.brs', 'brightscript', 1,
        'sub init()\n  unknownThing = 42\nend sub',
      );
      const hover = p.provideHover(doc, { line: 1, character: 4 });
      expect(hover).to.be.null;
    });
  });
});

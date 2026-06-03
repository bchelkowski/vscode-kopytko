import { expect } from 'chai';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver/node';
import { BrightScriptHoverProvider } from '../../src/server/providers/hoverProvider';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///test.brs', 'brightscript', 1, content);
}

function hoverValue(hover: Hover | null): string {
  if (!hover) return '';
  return (hover.contents as MarkupContent).value;
}

describe('BrightScriptHoverProvider', () => {
  let provider: BrightScriptHoverProvider;

  beforeEach(() => {
    provider = new BrightScriptHoverProvider();
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
    it('returns hover for setState', async () => {
      const doc = makeDocument('setState({ loading: true })');
      const hover = await provider.provideHover(doc, { line: 0, character: 3 });
      const val = hoverValue(hover);
      expect(val).to.include('setState');
      expect(val).to.include('Renderer');
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
});

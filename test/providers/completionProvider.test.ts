import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fsWrapper from '../../src/server/utils/fsWrapper';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver/node';
import { BrightScriptCompletionProvider } from '../../src/server/providers/completionProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///workspace/app/components/Test.brs', 'brightscript', 1, content);
}

function makeResolver(): KopytkoImportResolver {
  return new KopytkoImportResolver({
    workspaceFolders: ['/workspace'],
    sourceDir: 'app',
    resolveModules: true,
  });
}

describe('BrightScriptCompletionProvider', () => {
  let provider: BrightScriptCompletionProvider;
  let fsStub: sinon.SinonStub;

  beforeEach(() => {
    fsStub = sinon.stub(fsWrapper, 'existsSync').returns(false);
    provider = new BrightScriptCompletionProvider(makeResolver());
  });

  afterEach(() => sinon.restore());

  // ── Kopytko annotation context ─────────────────────────────────────────────

  it('returns @import completions on a Kopytko annotation line', async () => {
    const doc = makeDocument(`' @`);
    const items = await provider.provideCompletions(doc, { line: 0, character: 3 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include('@import');
    expect(items.every((i) => i.kind === CompletionItemKind.Keyword)).to.be.true;
  });

  it('returns module names in @import … from context', async () => {
    const doc = makeDocument(`' @import /foo.brs from `);
    const items = await provider.provideCompletions(doc, { line: 0, character: 24 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include('@dazn/kopytko-framework');
    expect(items.every((i) => i.kind === CompletionItemKind.Module)).to.be.true;
  });

  // ── Member completions ────────────────────────────────────────────────────

  describe('member completions (dot trigger)', () => {
    it('returns roArray methods after myArr.', async () => {
      const doc = makeDocument([
        `myArr = CreateObject("roArray")`,
        `myArr.`,
      ].join('\n'));
      const items = await provider.provideCompletions(doc, { line: 1, character: 6 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include.members(['Push', 'Pop', 'Peek', 'Count', 'Sort', 'Join']);
      expect(items.every((i) => i.kind === CompletionItemKind.Method)).to.be.true;
    });

    it('returns roAssociativeArray methods after aa.', async () => {
      const doc = makeDocument([
        `aa = CreateObject("roAssociativeArray")`,
        `aa.`,
      ].join('\n'));
      const items = await provider.provideCompletions(doc, { line: 1, character: 3 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include.members(['AddReplace', 'DoesExist', 'Lookup', 'Keys', 'Values', 'Count']);
    });

    it('returns roUrlTransfer methods after transfer.', async () => {
      const doc = makeDocument([
        `transfer = CreateObject("roUrlTransfer")`,
        `transfer.`,
      ].join('\n'));
      const items = await provider.provideCompletions(doc, { line: 1, character: 9 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include.members(['SetUrl', 'GetToString', 'AsyncGetToString', 'AddHeader', 'GetResponseCode']);
    });

    it('returns roSGNode methods for m.transfer when assigned via CreateObject', async () => {
      const doc = makeDocument([
        `m.node = CreateObject("roSGNode", "Label")`,
        `m.node.`,
      ].join('\n'));
      const items = await provider.provideCompletions(doc, { line: 1, character: 7 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include.members(['FindNode', 'SetField', 'GetField', 'ObserveField']);
    });

    it('returns empty array when receiver type is unknown', async () => {
      const doc = makeDocument(`unknownVar.`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 11 });
      expect(items).to.be.empty;
    });

    it('member items are sorted above default items (sortText starts with 0_)', async () => {
      const doc = makeDocument([
        `arr = CreateObject("roArray")`,
        `arr.`,
      ].join('\n'));
      const items = await provider.provideCompletions(doc, { line: 1, character: 4 });
      for (const item of items) {
        expect(item.sortText).to.match(/^0_/);
      }
    });

    it('method insert text is a snippet with tab stops for parameters', async () => {
      const doc = makeDocument([
        `arr = CreateObject("roArray")`,
        `arr.`,
      ].join('\n'));
      const items = await provider.provideCompletions(doc, { line: 1, character: 4 });
      const pushItem = items.find((i) => i.label === 'Push');
      expect(pushItem).to.not.be.undefined;
      expect(pushItem!.insertTextFormat).to.equal(InsertTextFormat.Snippet);
      expect(pushItem!.insertText).to.include('${1:');
    });

    it('no-arg methods have plain () in insert text', async () => {
      const doc = makeDocument([
        `arr = CreateObject("roArray")`,
        `arr.`,
      ].join('\n'));
      const items = await provider.provideCompletions(doc, { line: 1, character: 4 });
      const countItem = items.find((i) => i.label === 'Count');
      expect(countItem!.insertText).to.equal('Count()');
    });

    it('detail field contains the interface name', async () => {
      const doc = makeDocument([
        `arr = CreateObject("roArray")`,
        `arr.`,
      ].join('\n'));
      const items = await provider.provideCompletions(doc, { line: 1, character: 4 });
      const sortItem = items.find((i) => i.label === 'Sort');
      expect(sortItem!.detail).to.include('ifArraySort');
    });
  });

  // ── Default completions ───────────────────────────────────────────────────

  describe('default completions', () => {
    it('includes BrightScript built-ins', async () => {
      const doc = makeDocument(`Ab`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('Abs');
    });

    it('includes language keywords', async () => {
      const doc = makeDocument(`fo`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('for');
    });

    it('includes component names for CreateObject hints', async () => {
      const doc = makeDocument(`CreateObject("`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 14 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include.members(['roArray', 'roUrlTransfer', 'roDeviceInfo', 'roSGNode']);
    });
  });
});

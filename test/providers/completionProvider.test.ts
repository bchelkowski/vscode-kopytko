import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver/node';
import { BrightScriptCompletionProvider } from '../../src/server/providers/completionProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';
import { KopytkoModuleCatalog } from '../../src/server/kopytko/moduleCatalog';
import { WorkspaceFunctionIndex } from '../../src/server/utils/workspaceFunctionIndex';
import { FunctionDefinition } from '../../src/server/brightscript/functionIndex';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///workspace/app/components/Test.brs', 'brightscript', 1, content);
}

function makeResolver(opts: Partial<ConstructorParameters<typeof KopytkoImportResolver>[0]> = {}): KopytkoImportResolver {
  return new KopytkoImportResolver({
    workspaceFolders: ['/workspace'],
    sourceDir: 'app',
    resolveModules: true,
    ...opts,
  });
}

describe('BrightScriptCompletionProvider', () => {
  let provider: BrightScriptCompletionProvider;
  let fsStub: sinon.SinonStub;
  let readdirStub: sinon.SinonStub;

  beforeEach(() => {
    fsStub = sinon.stub(fsWrapper, 'existsSync').returns(false);
    readdirStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
    provider = new BrightScriptCompletionProvider(makeResolver());
  });

  afterEach(() => { sinon.restore(); invalidateAllCaches(); });

  // ── Kopytko annotation context ─────────────────────────────────────────────

  it('returns @import completions on a Kopytko annotation line', async () => {
    const doc = makeDocument(`' @`);
    const items = await provider.provideCompletions(doc, { line: 0, character: 3 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include('@import');
    expect(items.every((i) => i.kind === CompletionItemKind.Keyword)).to.be.true;
  });

  it('returns module names in @import … from context', async () => {
    readdirStub.withArgs('/workspace/node_modules').returns([{ name: '@dazn', isDirectory: true }]);
    readdirStub.withArgs('/workspace/node_modules/@dazn').returns([{ name: 'kopytko-framework', isDirectory: true }]);
    sinon.stub(fsWrapper, 'readFileSync')
      .withArgs('/workspace/node_modules/@dazn/kopytko-framework/package.json', 'utf-8')
      .returns(JSON.stringify({ kopytkoModuleDir: '' }));
    const doc = makeDocument(`' @import /foo.brs from `);
    const items = await provider.provideCompletions(doc, { line: 0, character: 24 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include('@dazn/kopytko-framework');
    expect(items.every((i) => i.kind === CompletionItemKind.Module)).to.be.true;
  });

  it('module completions are empty when no packages are installed', async () => {
    // existsSync returns false for all paths (outer stub) — no packages installed
    const doc = makeDocument(`' @import /foo.brs from `);
    const items = await provider.provideCompletions(doc, { line: 0, character: 24 });
    expect(items).to.be.empty;
  });

  it('triggers annotation completions on bare @ without apostrophe', async () => {
    const doc = makeDocument(`@`);
    const items = await provider.provideCompletions(doc, { line: 0, character: 1 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include('@import');
  });

  it('@import item textEdit inserts the full prefix ending with / and carries a retrigger command', async () => {
    const doc = makeDocument(`' @`);
    const items = await provider.provideCompletions(doc, { line: 0, character: 3 });
    const importItem = items.find((i) => i.label === '@import');
    expect(importItem!.textEdit).to.not.be.undefined;
    type Edit = { newText: string; range: { start: { character: number }; end: { character: number } } };
    const edit = importItem!.textEdit as Edit;
    expect(edit.newText).to.equal("' @import /");
    expect(importItem!.command).to.deep.include({ command: 'editor.action.triggerSuggest' });
  });

  it('textEdit for bare @ annotation replaces from @ preserving leading whitespace', async () => {
    const doc = makeDocument(`  @`);
    const items = await provider.provideCompletions(doc, { line: 0, character: 3 });
    const importItem = items.find((i) => i.label === '@import');
    type Edit = { range: { start: { character: number }; end: { character: number } }; newText: string };
    const edit = importItem!.textEdit as Edit;
    // edit starts AFTER the 2 spaces (preserves indentation)
    expect(edit.range.start.character).to.equal(2);
    expect(edit.range.end.character).to.equal(3);
    expect(edit.newText).to.match(/^' @import/);
  });

  it('annotation context includes exactly one per-installed-package import item (no duplicates)', async () => {
    readdirStub.withArgs('/workspace/node_modules').returns([{ name: '@dazn', isDirectory: true }]);
    readdirStub.withArgs('/workspace/node_modules/@dazn').returns([{ name: 'kopytko-framework', isDirectory: true }]);
    sinon.stub(fsWrapper, 'readFileSync')
      .withArgs('/workspace/node_modules/@dazn/kopytko-framework/package.json', 'utf-8')
      .returns(JSON.stringify({ kopytkoModuleDir: '' }));
    const doc = makeDocument(`' @`);
    const items = await provider.provideCompletions(doc, { line: 0, character: 3 });
    const pkgItems = items.filter((i) => i.label.includes('@dazn/kopytko-framework'));
    // Even though KOPYTKO_MODULES has 6 entries for this package, filesystem scan yields 1
    expect(pkgItems).to.have.length(1);
    expect(pkgItems[0].kind).to.equal(CompletionItemKind.Module);
    type Edit = { newText: string };
    const edit = pkgItems[0].textEdit as Edit;
    expect(edit.newText).to.include('@dazn/kopytko-framework');
    expect(edit.newText).to.match(/^' @import/);
    expect(pkgItems[0].command).to.deep.include({ command: 'editor.action.triggerSuggest' });
  });

  it('annotation context lists packages not in the catalog when they have kopytkoModuleDir', async () => {
    readdirStub.withArgs('/workspace/node_modules').returns([{ name: 'my-custom-kopytko-pkg', isDirectory: true }]);
    sinon.stub(fsWrapper, 'readFileSync')
      .withArgs('/workspace/node_modules/my-custom-kopytko-pkg/package.json', 'utf-8')
      .returns(JSON.stringify({ kopytkoModuleDir: 'src' }));
    const doc = makeDocument(`' @`);
    const items = await provider.provideCompletions(doc, { line: 0, character: 3 });
    const pkgItem = items.find((i) => i.label.includes('my-custom-kopytko-pkg'));
    expect(pkgItem).to.not.be.undefined;
    expect(pkgItem!.kind).to.equal(CompletionItemKind.Module);
  });

  it('annotation context does not include package items for uninstalled packages', async () => {
    // existsSync returns false (outer stub) — no packages installed
    const doc = makeDocument(`' @`);
    const items = await provider.provideCompletions(doc, { line: 0, character: 3 });
    expect(items.every((i) => i.kind === CompletionItemKind.Keyword)).to.be.true;
    expect(items).to.have.length(2); // @import + @mock
    expect(items.map(i => i.label)).to.include('@import');
    expect(items.map(i => i.label)).to.include('@mock');
  });

  // ── @import path completions ───────────────────────────────────────────────

  describe('@import path completions', () => {
    // readdirStub is declared and set up in the outer beforeEach (returns [] by default).
    // Individual tests configure it with .withArgs() for specific paths.

    // ── level-by-level navigation ────────────────────────────────────────────

    it('returns the immediate children of sourceDir (not recursive)', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'components', isDirectory: true },
        { name: 'Utils.brs', isDirectory: false },
      ]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('components/');
      expect(labels).to.include('Utils.brs');
      // Must NOT return deep paths — the old recursive format
      expect(labels.some((l) => l.includes('/components/'))).to.be.false;
    });

    it('returns CompletionItemKind.Folder for directories', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'components', isDirectory: true },
      ]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const dir = items.find((i) => i.label === 'components/');
      expect(dir).to.not.be.undefined;
      expect(dir!.kind).to.equal(CompletionItemKind.Folder);
    });

    it('directory items carry a re-trigger command so the next level opens automatically', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'components', isDirectory: true },
      ]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const dir = items.find((i) => i.label === 'components/');
      expect(dir!.command).to.deep.include({ command: 'editor.action.triggerSuggest' });
    });

    it('file items do NOT carry a re-trigger command', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'Utils.brs', isDirectory: false },
      ]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const file = items.find((i) => i.label === 'Utils.brs');
      expect(file!.command).to.be.undefined;
    });

    it('lists the children of the typed directory when navigating into a subfolder', async () => {
      readdirStub.withArgs('/workspace/app/components').returns([
        { name: 'Button.brs', isDirectory: false },
        { name: 'views', isDirectory: true },
      ]);
      const line = `' @import /components/`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('Button.brs');
      expect(labels).to.include('views/');
    });

    it('insertText for a file is just the file name (not the full path)', async () => {
      readdirStub.withArgs('/workspace/app/components').returns([
        { name: 'Button.brs', isDirectory: false },
      ]);
      const line = `' @import /components/`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const file = items.find((i) => i.label === 'Button.brs');
      expect(file!.insertText).to.equal('Button.brs');
    });

    it('insertText for a directory is just entryName/ (not the full path)', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'components', isDirectory: true },
      ]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const dir = items.find((i) => i.label === 'components/');
      expect(dir!.insertText).to.equal('components/');
    });

    it('filters by the name fragment typed after the last /', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'Alpha.brs', isDirectory: false },
        { name: 'Beta.brs', isDirectory: false },
      ]);
      const line = `' @import /Al`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('Alpha.brs');
      expect(labels).to.not.include('Beta.brs');
    });

    it('filter is case-insensitive', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'Alpha.brs', isDirectory: false },
      ]);
      const line = `' @import /al`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      expect(items.map((i) => i.label)).to.include('Alpha.brs');
    });

    it('does not include non-.brs files', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'Utils.brs', isDirectory: false },
        { name: 'Component.xml', isDirectory: false },
        { name: 'styles.css', isDirectory: false },
      ]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('Utils.brs');
      expect(labels).to.not.include('Component.xml');
      expect(labels).to.not.include('styles.css');
    });

    it('skips hidden entries (names starting with .)', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: '.hidden.brs', isDirectory: false },
        { name: '.git', isDirectory: true },
        { name: 'Visible.brs', isDirectory: false },
      ]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      const labels = items.map((i) => i.label);
      expect(labels).to.not.include('.hidden.brs');
      expect(labels).to.not.include('.git/');
      expect(labels).to.include('Visible.brs');
    });

    it('returns empty array when the directory is empty', async () => {
      readdirStub.withArgs('/workspace/app').returns([]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      expect(items).to.be.empty;
    });

    it('returns empty array when readdirTyped throws (directory not found)', async () => {
      readdirStub.throws(new Error('ENOENT'));
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      expect(items).to.be.empty;
    });

    it('directories sort before files', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'Alpha.brs', isDirectory: false },
        { name: 'zdir', isDirectory: true },
      ]);
      const line = `' @import /`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      expect(items[0].kind).to.equal(CompletionItemKind.Folder);
      expect(items[1].kind).to.equal(CompletionItemKind.File);
    });

    // ── textEdit range ───────────────────────────────────────────────────────

    it('textEdit.range covers only the name fragment after the last /, not the full path', async () => {
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'Utils.brs', isDirectory: false },
      ]);
      // Cursor in the middle of an existing path: `' @import /Uti|ls.brs`
      // nameStart = position of 'U' = 11 (after the '/')
      // range end = end of 'Utils.brs' = 20
      const line = `' @import /Utils.brs`;
      const cursorChar = `' @import /Uti`.length; // char 14
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: cursorChar });
      expect(items).to.have.length(1);
      type Edit = { range: { start: { character: number }; end: { character: number } }; newText: string };
      const edit = items[0].textEdit as Edit;
      // starts after the '/', not at it
      expect(edit.range.start.character).to.equal(`' @import /`.length); // 11
      expect(edit.range.end.character).to.equal(line.length);            // 20 — full name token
      // newText is just the file name — the '/' before it is already in the line
      expect(edit.newText).to.equal('Utils.brs');
    });

    // ── trigger guards ───────────────────────────────────────────────────────

    it('does not trigger on a plain annotation line (no path typed yet)', async () => {
      const line = `' @`;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      expect(items.some((i) => i.kind === CompletionItemKind.File || i.kind === CompletionItemKind.Folder)).to.be.false;
    });

    it('does not trigger when cursor is in the from-clause', async () => {
      const line = `' @import /foo.brs from `;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: line.length });
      expect(items.every((i) => i.kind === CompletionItemKind.Module)).to.be.true;
    });

    // ── external package (from clause) path completions ──────────────────────

    it('uses the package directory when from clause is present on the line', async () => {
      fsStub.withArgs('/workspace/node_modules/@dazn/kopytko-framework').returns(true);
      readdirStub.withArgs('/workspace/node_modules/@dazn/kopytko-framework').returns([
        { name: 'KopytkoFramework.brs', isDirectory: false },
      ]);
      // Line already has the `from` clause; cursor is in the path position
      const line = `' @import / from @dazn/kopytko-framework`;
      const cursorChar = `' @import /`.length;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: cursorChar });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('KopytkoFramework.brs');
      // Must NOT include items from sourceDir (/workspace/app)
      expect(readdirStub.calledWith('/workspace/node_modules/@dazn/kopytko-framework')).to.be.true;
      expect(readdirStub.calledWith('/workspace/app')).to.be.false;
    });

    it('respects kopytkoModuleDir when completing external package paths', async () => {
      fsStub.withArgs('/workspace/node_modules/@dazn/kopytko-framework').returns(true);
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs('/workspace/node_modules/@dazn/kopytko-framework/package.json', 'utf-8')
        .returns(JSON.stringify({ kopytkoModuleDir: 'dist' }));
      readdirStub.withArgs('/workspace/node_modules/@dazn/kopytko-framework/dist').returns([
        { name: 'KopytkoFramework.brs', isDirectory: false },
      ]);
      const line = `' @import / from @dazn/kopytko-framework`;
      const cursorChar = `' @import /`.length;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: cursorChar });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('KopytkoFramework.brs');
      expect(readdirStub.calledWith('/workspace/node_modules/@dazn/kopytko-framework/dist')).to.be.true;
    });

    it('returns empty when from package is not installed', async () => {
      // existsSync returns false (outer stub), so no package found
      readdirStub.withArgs('/workspace/app').returns([
        { name: 'Utils.brs', isDirectory: false },
      ]);
      const line = `' @import / from @unknown/package`;
      const cursorChar = `' @import /`.length;
      const doc = makeDocument(line);
      const items = await provider.provideCompletions(doc, { line: 0, character: cursorChar });
      expect(items).to.be.empty;
    });
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

    it('returns methods for inline CreateObject("roAppInfo").', async () => {
      const doc = makeDocument('sub init()\n  x = CreateObject("roAppInfo").\nend sub');
      // cursor after the dot
      const items = await provider.provideCompletions(doc, { line: 1, character: 38 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('GetVersion');
      expect(items.every((i) => i.kind === CompletionItemKind.Method)).to.be.true;
    });

    it('returns methods for inline CreateObject with extra args', async () => {
      const doc = makeDocument('sub init()\n  x = CreateObject("roArray", 0, true).\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 44 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('Push');
    });
  });

  // ── Type annotation completions (`as `) ─────────────────────────────────

  describe('type annotation completions (as context)', () => {
    it('returns primitive type names after "as "', async () => {
      const doc = makeDocument(`function foo(x as `);
      const items = await provider.provideCompletions(doc, { line: 0, character: 18 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include.members(['Boolean', 'Integer', 'String', 'Dynamic', 'Object', 'Void']);
    });

    it('includes Interface and LongInteger in type completions', async () => {
      const doc = makeDocument(`function foo() as `);
      const items = await provider.provideCompletions(doc, { line: 0, character: 18 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('Interface');
      expect(labels).to.include('LongInteger');
    });

    it('includes ro* component names as valid parameter type', async () => {
      const doc = makeDocument(`sub bar(arr as `);
      const items = await provider.provideCompletions(doc, { line: 0, character: 15 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include.members(['roArray', 'roSGNode', 'roUrlTransfer']);
    });

    it('triggers mid-word to support partial type already typed', async () => {
      const doc = makeDocument(`function foo(x as Int`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 21 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('Integer');
    });

    it('primitive type sort before component names', async () => {
      const doc = makeDocument(`function foo() as `);
      const items = await provider.provideCompletions(doc, { line: 0, character: 18 });
      const boolItem = items.find((i) => i.label === 'Boolean');
      const roArrayItem = items.find((i) => i.label === 'roArray');
      expect(boolItem).to.not.be.undefined;
      expect(roArrayItem).to.not.be.undefined;
      expect(boolItem!.sortText! < roArrayItem!.sortText!).to.be.true;
    });

    it('applies keyword casing to primitive type names', async () => {
      const doc = makeDocument(`function foo(x as `);
      const items = await provider.provideCompletions(
        doc,
        { line: 0, character: 18 },
        { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' }
      );
      const labels = items.map((i) => i.label);
      expect(labels).to.include('BOOLEAN');
      expect(labels).to.include('INTEGER');
    });

    it('does not trigger in a plain expression context', async () => {
      const doc = makeDocument(`x = something `);
      const items = await provider.provideCompletions(doc, { line: 0, character: 14 });
      // should fall through to default completions, not type completions
      const kinds = items.map((i) => i.kind);
      expect(kinds).to.not.include(CompletionItemKind.TypeParameter);
    });
  });

  // ── Kopytko export completions ────────────────────────────────────────────

  describe('Kopytko export completions (default context)', () => {
    let readFileStub: sinon.SinonStub;

    // Simulates @dazn/kopytko-framework installed with kopytkoModuleDir='' (root),
    // containing two .brs files — one with setState/getState, one with ThemeFacade.
    function setupInstalledPackage(): void {
      fsStub.withArgs('/workspace/node_modules/@dazn/kopytko-framework').returns(true);
      readdirStub.withArgs('/workspace/node_modules').returns([{ name: '@dazn', isDirectory: true }]);
      readdirStub.withArgs('/workspace/node_modules/@dazn').returns([{ name: 'kopytko-framework', isDirectory: true }]);
      readdirStub.withArgs('/workspace/node_modules/@dazn/kopytko-framework').returns([
        { name: 'Renderer.brs', isDirectory: false },
        { name: 'ThemeFacade.brs', isDirectory: false },
      ]);
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
      readFileStub
        .withArgs('/workspace/node_modules/@dazn/kopytko-framework/package.json', 'utf-8')
        .returns(JSON.stringify({ kopytkoModuleDir: '' }));
      readFileStub
        .withArgs('/workspace/node_modules/@dazn/kopytko-framework/Renderer.brs', 'utf-8')
        .returns('function setState(newState as Object)\nend function\nfunction getState() as Object\nend function');
      readFileStub
        .withArgs('/workspace/node_modules/@dazn/kopytko-framework/ThemeFacade.brs', 'utf-8')
        .returns('function ThemeFacade() as Object\nend function');

      // Rebuild provider with a scanned catalog
      const resolver = makeResolver();
      const catalog = new KopytkoModuleCatalog();
      catalog.scan('/workspace', resolver);
      provider = new BrightScriptCompletionProvider(resolver, catalog);
    }

    it('includes functions scanned from installed package .brs files', async () => {
      setupInstalledPackage();
      const doc = makeDocument(`setState`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 8 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('setState');
      expect(labels).to.include('getState');
      expect(labels).to.include('ThemeFacade');
    });

    it('Kopytko export items have CompletionItemKind.Function', async () => {
      setupInstalledPackage();
      const doc = makeDocument(`setState`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 8 });
      const item = items.find((i) => i.label === 'setState');
      expect(item).to.not.be.undefined;
      expect(item!.kind).to.equal(CompletionItemKind.Function);
    });

    it('carries data for auto-import resolution with correct importPath and npmPackage', async () => {
      setupInstalledPackage();
      const doc = makeDocument(`setState`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 8 });
      const item = items.find((i) => i.label === 'setState');
      expect(item).to.not.be.undefined;
      const data = item!.data as { kind: string; documentUri: string; importPath: string; npmPackage: string };
      expect(data.kind).to.equal('kopytkoExport');
      expect(data.npmPackage).to.equal('@dazn/kopytko-framework');
      expect(data.importPath).to.equal('/Renderer.brs');
      expect(data.documentUri).to.be.a('string').that.is.not.empty;
    });

    it('importPath for a nested file includes the subdirectory', async () => {
      fsStub.withArgs('/workspace/node_modules/@dazn/kopytko-utils').returns(true);
      readdirStub.withArgs('/workspace/node_modules').returns([{ name: '@dazn', isDirectory: true }]);
      readdirStub.withArgs('/workspace/node_modules/@dazn').returns([{ name: 'kopytko-utils', isDirectory: true }]);
      readdirStub.withArgs('/workspace/node_modules/@dazn/kopytko-utils').returns([
        { name: 'utils', isDirectory: true },
      ]);
      readdirStub.withArgs('/workspace/node_modules/@dazn/kopytko-utils/utils').returns([
        { name: 'getProperty.brs', isDirectory: false },
      ]);
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
      readFileStub
        .withArgs('/workspace/node_modules/@dazn/kopytko-utils/package.json', 'utf-8')
        .returns(JSON.stringify({ kopytkoModuleDir: '' }));
      readFileStub
        .withArgs('/workspace/node_modules/@dazn/kopytko-utils/utils/getProperty.brs', 'utf-8')
        .returns('function getProperty(obj as Object, key as String) as Dynamic\nend function');

      const resolver = makeResolver();
      const catalog = new KopytkoModuleCatalog();
      catalog.scan('/workspace', resolver);
      provider = new BrightScriptCompletionProvider(resolver, catalog);

      const doc = makeDocument(`getProperty`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 11 });
      const item = items.find((i) => i.label === 'getProperty');
      expect(item).to.not.be.undefined;
      const data = item!.data as { importPath: string; npmPackage: string };
      expect(data.importPath).to.equal('/utils/getProperty.brs');
      expect(data.npmPackage).to.equal('@dazn/kopytko-utils');
    });

    it('detail field is the package name', async () => {
      setupInstalledPackage();
      const doc = makeDocument(`setState`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 8 });
      const item = items.find((i) => i.label === 'setState');
      expect(item!.detail).to.equal('@dazn/kopytko-framework');
    });

    it('documentation contains the function signature', async () => {
      setupInstalledPackage();
      const doc = makeDocument(`setState`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 8 });
      const item = items.find((i) => i.label === 'setState');
      const docValue = (item!.documentation as { value: string }).value;
      expect(docValue).to.include('setState');
      expect(docValue).to.include('newState');
    });

    it('does not include exports when no Kopytko package is installed', async () => {
      // outer beforeEach: existsSync returns false, readdirTyped returns [] — no packages
      const doc = makeDocument(`setState`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 8 });
      const labels = items.map((i) => i.label);
      expect(labels).to.not.include('setState');
    });

    it('documentUri in data matches the document uri', async () => {
      setupInstalledPackage();
      const doc = makeDocument(`ThemeFacade`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 11 });
      const item = items.find((i) => i.label === 'ThemeFacade');
      expect(item).to.not.be.undefined;
      expect((item!.data as { documentUri: string }).documentUri).to.equal(doc.uri);
    });

    it('skips hidden files (names starting with .)', async () => {
      fsStub.withArgs('/workspace/node_modules/@dazn/kopytko-framework').returns(true);
      readdirStub.withArgs('/workspace/node_modules').returns([{ name: '@dazn', isDirectory: true }]);
      readdirStub.withArgs('/workspace/node_modules/@dazn').returns([{ name: 'kopytko-framework', isDirectory: true }]);
      readdirStub.withArgs('/workspace/node_modules/@dazn/kopytko-framework').returns([
        { name: '.hidden.brs', isDirectory: false },
        { name: 'Visible.brs', isDirectory: false },
      ]);
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
      readFileStub
        .withArgs('/workspace/node_modules/@dazn/kopytko-framework/package.json', 'utf-8')
        .returns(JSON.stringify({ kopytkoModuleDir: '' }));
      readFileStub
        .withArgs('/workspace/node_modules/@dazn/kopytko-framework/Visible.brs', 'utf-8')
        .returns('function visibleFn()\nend function');

      const resolver = makeResolver();
      const catalog = new KopytkoModuleCatalog();
      catalog.scan('/workspace', resolver);
      provider = new BrightScriptCompletionProvider(resolver, catalog);

      const doc = makeDocument(`visibleFn`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 9 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('visibleFn');
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

  // ── CreateObject string argument completions ──────────────────────────────

  describe('CreateObject string argument completions', () => {
    it('suggests component names inside CreateObject("")', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("ro")\nend sub');
      // cursor after "ro" inside the string: CreateObject("ro|")
      //   obj = CreateObject("ro")
      //   01234567890123456789012345
      // opening " at 21, r at 22, o at 23, closing " at 24
      const items = await provider.provideCompletions(doc, { line: 1, character: 24 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('roArray');
      expect(labels).to.include('roAssociativeArray');
    });

    it('provides textEdit that replaces only the string content', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("")\nend sub');
      // cursor between the two quotes: CreateObject("|")
      //   obj = CreateObject("")
      //   0         1         2
      //   0123456789012345678901234
      // opening " at 21, closing " at 22, cursor at 22 (between quotes)
      const items = await provider.provideCompletions(doc, { line: 1, character: 22 });
      const roArray = items.find((i) => i.label === 'roArray');
      expect(roArray).to.not.be.undefined;
      expect(roArray!.textEdit).to.not.be.undefined;
      const edit = roArray!.textEdit as { range: { start: { character: number }; end: { character: number } }; newText: string };
      expect(edit.newText).to.equal('roArray');
    });

    it('does not suggest component names outside CreateObject string', async () => {
      const doc = makeDocument('sub init()\n  x = "hello"\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 9 });
      // Component names should NOT appear in default completions
      const roArray = items.find((i) => i.label === 'roArray' && i.kind === CompletionItemKind.Class);
      expect(roArray).to.be.undefined;
    });

    it('suggests at cursor with partial text typed', async () => {
      const doc = makeDocument('sub init()\n  obj = CreateObject("roUrl")\nend sub');
      // cursor after "roUrl" inside the string: CreateObject("roUrl|")
      //   obj = CreateObject("roUrl")
      //   0123456789012345678901234567
      // opening " at 21, closing " at 27, cursor at 27 (before closing quote)
      const items = await provider.provideCompletions(doc, { line: 1, character: 27 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('roUrlTransfer');
    });
  });

  // ── Casing configuration ──────────────────────────────────────────────────

  // ── m.top. completions ────────────────────────────────────────────────────

  describe('m.top. completions', () => {
    let readdirSyncStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;

    beforeEach(() => {
      readdirSyncStub = sinon.stub(fsWrapper, 'readdirSync');
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
      // readdirTyped is already stubbed (returns []) by the outer beforeEach

      // Component XML that extends Group (native)
      readdirSyncStub.withArgs('/workspace/app/components').returns(['Test.xml']);
      readdirSyncStub.returns([]);
      readFileStub.withArgs('/workspace/app/components/Test.xml', 'utf-8').returns(`
        <component name="Test" extends="Group">
          <interface>
            <field id="items" type="array" />
            <function name="refresh" />
          </interface>
          <script type="text/brightscript" uri="Test.brs" />
        </component>`);
      fsStub.withArgs('/workspace/app/components/Test.brs').returns(true);
    });

    it('returns completions when cursor is at m.top.', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      expect(items.length).to.be.greaterThan(0);
    });

    it('includes component XML interface field', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('items');
    });

    it('includes component XML interface function', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      expect(items.map((i) => i.label)).to.include('refresh');
    });

    it('includes inherited Group fields (visible, opacity)', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('visible');
      expect(labels).to.include('opacity');
    });

    it('includes inherited Node fields (id, focusable)', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('id');
      expect(labels).to.include('focusable');
    });

    it('includes Node methods (observeFieldScoped, findNode)', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('observeFieldScoped');
      expect(labels).to.include('findNode');
    });

    it('still works when cursor has partial identifier after m.top.', async () => {
      const doc = makeDocument('sub init()\n  m.top.obs\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 11 });
      expect(items.map((i) => i.label)).to.include('observeFieldScoped');
    });

    it('method items have Snippet insert text format', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      const method = items.find((i) => i.label === 'observeFieldScoped');
      expect(method?.insertTextFormat).to.equal(InsertTextFormat.Snippet);
    });

    it('field items have Field kind', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      const field = items.find((i) => i.label === 'items');
      expect(field?.kind).to.equal(CompletionItemKind.Field);
    });

    it('method items have Method kind', async () => {
      const doc = makeDocument('sub init()\n  m.top.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 8 });
      const method = items.find((i) => i.label === 'observeFieldScoped');
      expect(method?.kind).to.equal(CompletionItemKind.Method);
    });

    it('does not return m.top completions for unrelated member access', async () => {
      // arr. should return empty (unknown type), not m.top items
      const doc = makeDocument('sub init()\n  arr.\nend sub');
      const items = await provider.provideCompletions(doc, { line: 1, character: 6 });
      expect(items.map((i) => i.label)).not.to.include('observeFieldScoped');
    });
  });

  describe('casing configuration', () => {
    it('upper-case applies to method labels and insert text', async () => {
      const doc = makeDocument(['arr = CreateObject("roArray")', 'arr.'].join('\n'));
      const items = await provider.provideCompletions(
        doc, { line: 1, character: 4 },
        { builtin: 'preserve', keyword: 'preserve', method: 'upper-case' }
      );
      const pushItem = items.find((i) => i.label === 'PUSH');
      expect(pushItem).to.not.be.undefined;
      expect(pushItem!.insertText).to.match(/^PUSH/);
    });

    it('lower-case applies to method labels and insert text', async () => {
      const doc = makeDocument(['arr = CreateObject("roArray")', 'arr.'].join('\n'));
      const items = await provider.provideCompletions(
        doc, { line: 1, character: 4 },
        { builtin: 'preserve', keyword: 'preserve', method: 'lower-case' }
      );
      const pushItem = items.find((i) => i.label === 'push');
      expect(pushItem).to.not.be.undefined;
      expect(pushItem!.insertText).to.match(/^push/);
    });

    it('lower-case on method preserves snippet parameter syntax', async () => {
      const doc = makeDocument(['arr = CreateObject("roArray")', 'arr.'].join('\n'));
      const items = await provider.provideCompletions(
        doc, { line: 1, character: 4 },
        { builtin: 'preserve', keyword: 'preserve', method: 'lower-case' }
      );
      const pushItem = items.find((i) => i.label === 'push');
      expect(pushItem!.insertText).to.equal('push(${1:a as Dynamic})');
    });

    it('upper-case applies to built-in labels', async () => {
      const doc = makeDocument(`Ab`);
      const items = await provider.provideCompletions(
        doc, { line: 0, character: 2 },
        { builtin: 'upper-case', keyword: 'preserve', method: 'preserve' }
      );
      const labels = items.map((i) => i.label);
      expect(labels).to.include('ABS');
      expect(labels).not.to.include('Abs');
    });

    it('lower-case applies to keyword labels', async () => {
      const doc = makeDocument(`fo`);
      const items = await provider.provideCompletions(
        doc, { line: 0, character: 2 },
        { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' }
      );
      const labels = items.map((i) => i.label);
      expect(labels).to.include('FOR');
    });

    it('preserve (default) preserves catalog casing', async () => {
      const doc = makeDocument(`Ab`);
      const items = await provider.provideCompletions(doc, { line: 0, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('Abs');
    });
  });

  // ── Test framework completions ────────────────────────────────────────────

  describe('test framework completions', () => {
    it('provides expect matchers after expect().', () => {
      const doc = TextDocument.create('file:///app/_tests/Foo.test.brs', 'brightscript', 1, '  return expect(result).');
      const items = provider.provideCompletions(doc, { line: 0, character: 24 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('toBe');
      expect(labels).to.include('toEqual');
      expect(labels).to.include('toHaveBeenCalled');
    });

    it('provides expect matchers after expect().not.', () => {
      const doc = TextDocument.create('file:///app/_tests/Foo.test.brs', 'brightscript', 1, '  return expect(value).not.');
      const items = provider.provideCompletions(doc, { line: 0, character: 27 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('toBe');
      expect(labels).to.include('toBeValid');
      expect(labels).to.not.include('not');
    });

    it('provides mockFunction methods after mockFunction().', () => {
      const doc = TextDocument.create('file:///app/_tests/Foo.test.brs', 'brightscript', 1, '  mockFunction("Svc.get").');
      const items = provider.provideCompletions(doc, { line: 0, character: 26 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('returnValue');
      expect(labels).to.include('resolvedValue');
      expect(labels).to.include('implementation');
      expect(labels).to.include('clear');
    });

    it('provides global test functions in default completions for test files', () => {
      const doc = TextDocument.create('file:///app/_tests/Foo.test.brs', 'brightscript', 1, '  ');
      const items = provider.provideCompletions(doc, { line: 0, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('it');
      expect(labels).to.include('test');
      expect(labels).to.include('beforeEach');
      expect(labels).to.include('expect');
      expect(labels).to.include('mockFunction');
      expect(labels).to.include('initKopytko');
    });

    it('does NOT provide test globals for non-test files', () => {
      const doc = TextDocument.create('file:///app/components/Foo.brs', 'brightscript', 1, '  ');
      const items = provider.provideCompletions(doc, { line: 0, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.not.include('it');
      expect(labels).to.not.include('beforeEach');
      expect(labels).to.not.include('mockFunction');
    });
  });

  // ── User-defined function completions ───────────────────────────────────

  describe('user-defined function completions', () => {
    let readFileStub: sinon.SinonStub;
    let _readdirSyncStub: sinon.SinonStub;

    beforeEach(() => {
      readFileStub = sinon.stub(fsWrapper, 'readFileSync');
      _readdirSyncStub = sinon.stub(fsWrapper, 'readdirSync').returns([]);
    });

    it('includes user-defined functions from the current file', () => {
      const doc = TextDocument.create('file:///app/components/Foo.brs', 'brightscript', 1,
        'function myHelper()\nend function\nsub init()\n  \nend sub');
      const items = provider.provideCompletions(doc, { line: 3, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('myHelper');
    });

    it('includes functions from @import chain', () => {
      fsStub.withArgs('/project/app/utils/helper.brs').returns(true);
      readFileStub.withArgs('/project/app/utils/helper.brs', 'utf-8')
        .returns('function helperFn()\nend function');

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      const prov = new BrightScriptCompletionProvider(resolver);
      const doc = TextDocument.create('file:///project/app/components/Foo.brs', 'brightscript', 1,
        "' @import /utils/helper.brs\nsub init()\n  \nend sub");
      const items = prov.provideCompletions(doc, { line: 2, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('helperFn');
    });
  });

  // ── Inner method completions (dot access) ──────────────────────────────

  describe('inner method completions', () => {
    it('suggests AA methods owned by the constructor function', () => {
      const doc = TextDocument.create('file:///app/components/Foo.brs', 'brightscript', 1, [
        'function MyClass()',
        '  prototype = {}',
        '  prototype.doStuff = function()',
        '  end function',
        '  prototype.getName = function()',
        '  end function',
        '  return prototype',
        'end function',
        'function OtherClass()',
        '  prototype = {}',
        '  prototype.unrelated = function()',
        '  end function',
        '  return prototype',
        'end function',
        'sub init()',
        '  obj = MyClass()',
        '  obj.',
        'end sub',
      ].join('\n'));
      const items = provider.provideCompletions(doc, { line: 16, character: 6 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('doStuff');
      expect(labels).to.include('getName');
      expect(labels).to.not.include('unrelated');
    });

    it('suggests methods for inline constructor calls: Something().', () => {
      const doc = TextDocument.create('file:///app/components/Foo.brs', 'brightscript', 1, [
        'function Something()',
        '  prototype = {}',
        '  prototype.doWork = function()',
        '  end function',
        '  prototype.getResult = function()',
        '  end function',
        '  return prototype',
        'end function',
        'sub init()',
        '  Something().',
        'end sub',
      ].join('\n'));
      const items = provider.provideCompletions(doc, { line: 9, character: 15 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('doWork');
      expect(labels).to.include('getResult');
    });
  });

  // ── Local variable completions ──────────────────────────────────────────

  describe('local variable completions', () => {
    it('includes function parameters', () => {
      const doc = TextDocument.create('file:///app/components/Foo.brs', 'brightscript', 1, [
        'function myFunc(name as String, count as Integer)',
        '  ',
        'end function',
      ].join('\n'));
      const items = provider.provideCompletions(doc, { line: 1, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('name');
      expect(labels).to.include('count');
    });

    it('includes local variable assignments before cursor', () => {
      const doc = TextDocument.create('file:///app/components/Foo.brs', 'brightscript', 1, [
        'sub init()',
        '  myVar = "hello"',
        '  result = 42',
        '  ',
        'end sub',
      ].join('\n'));
      const items = provider.provideCompletions(doc, { line: 3, character: 2 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('myVar');
      expect(labels).to.include('result');
    });

    it('includes for-loop iteration variables', () => {
      const doc = TextDocument.create('file:///app/components/Foo.brs', 'brightscript', 1, [
        'sub init()',
        '  for each item in m.items',
        '    ',
        '  end for',
        'end sub',
      ].join('\n'));
      const items = provider.provideCompletions(doc, { line: 2, character: 4 });
      const labels = items.map((i) => i.label);
      expect(labels).to.include('item');
    });
  });

  // ── source/ directory completions ──────────────────────────────────────────

  describe('source/ directory completions', () => {
    function makeSourceDirIndex(fns: FunctionDefinition[]): WorkspaceFunctionIndex {
      const idx = sinon.createStubInstance(WorkspaceFunctionIndex);
      idx.getSourceDirFunctions.returns(fns);
      return idx as unknown as WorkspaceFunctionIndex;
    }

    it('includes source/ functions in default completions', () => {
      const def: FunctionDefinition = {
        name: 'globalHelper',
        nameLower: 'globalhelper',
        signature: 'function globalHelper() as Void',
        filePath: '/project/app/source/Helpers.brs',
        line: 0,
        column: 0,
      };
      const idx = makeSourceDirIndex([def]);
      const p = new BrightScriptCompletionProvider(makeResolver(), undefined, idx);
      const doc = makeDocument('sub init()\n  g\nend sub');
      const items = p.provideCompletions(doc, { line: 1, character: 3 });
      const labels = items.map(i => i.label);
      expect(labels).to.include('globalHelper');
    });

    it('does not include source/ functions when no workspaceIndex is provided', () => {
      const p = new BrightScriptCompletionProvider(makeResolver());
      const doc = makeDocument('sub init()\nend sub');
      // Should not throw — and should return normal completions
      const items = p.provideCompletions(doc, { line: 0, character: 10 });
      expect(items).to.be.an('array');
    });

    it('deduplicates source/ functions already present in the @import chain', () => {
      const def: FunctionDefinition = {
        name: 'globalHelper',
        nameLower: 'globalhelper',
        signature: 'function globalHelper() as Void',
        filePath: '/workspace/app/source/Helpers.brs',
        line: 0,
        column: 0,
      };
      const idx = makeSourceDirIndex([def]);

      // Also make globalHelper appear in the import chain
      sinon.stub(fsWrapper, 'readFileSync')
        .withArgs('/workspace/app/utils.brs', 'utf-8')
        .returns('function globalHelper() as Void\nend function\n');
      fsStub.withArgs('/workspace/app/utils.brs').returns(true);

      const p = new BrightScriptCompletionProvider(makeResolver(), undefined, idx);
      const doc = TextDocument.create(
        'file:///workspace/app/components/Test.brs', 'brightscript', 1,
        ["' @import /utils.brs", 'sub init()', '  g', 'end sub'].join('\n'),
      );
      const items = p.provideCompletions(doc, { line: 2, character: 3 });
      const globalHelperItems = items.filter(i => (i.label as string).toLowerCase() === 'globalhelper');
      // Should appear exactly once (deduplication)
      expect(globalHelperItems.length).to.equal(1);
    });
  });
});

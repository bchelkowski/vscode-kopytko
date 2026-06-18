import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BrightScriptReferencesProvider } from '../../src/server/providers/referencesProvider';
import { WorkspaceFunctionIndex } from '../../src/server/utils/workspaceFunctionIndex';
import { clearFileParseCache } from '../../src/server/utils/fileParseCache';

function makeDocument(content: string, uri = 'file:///workspace/app/components/Test.brs'): TextDocument {
  return TextDocument.create(uri, 'brightscript', 1, content);
}

function makeParams(line: number, character: number, includeDeclaration = true) {
  return {
    textDocument: { uri: 'file:///workspace/app/components/Test.brs' },
    position: { line, character },
    context: { includeDeclaration },
    workDoneToken: undefined,
    partialResultToken: undefined,
  };
}

describe('BrightScriptReferencesProvider', () => {
  let readdirTypedStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let index: WorkspaceFunctionIndex;
  let provider: BrightScriptReferencesProvider;

  beforeEach(() => {
    readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped');
    readFileStub = sinon.stub(fsWrapper, 'readFileSync').returns('');
    sinon.stub(fsWrapper, 'existsSync').returns(false);
    readdirTypedStub.returns([]);
    index = new WorkspaceFunctionIndex();
    provider = new BrightScriptReferencesProvider(index);
  });

  /** Rebuild the workspace index after test-specific stubs are configured. */
  function rebuildIndex(): void {
    index.build(['/workspace']);
    provider = new BrightScriptReferencesProvider(index);
  }

  afterEach(() => {
    sinon.restore();
    clearFileParseCache();
  });

  it('returns empty array when cursor is on whitespace', () => {
    readdirTypedStub.withArgs('/workspace').returns([]);
    const doc = makeDocument('  ');
    const result = provider.provideReferences(doc, makeParams(0, 0));
    expect(result).to.be.empty;
  });

  it('returns empty array when workspace has no brs files', () => {
    readdirTypedStub.withArgs('/workspace').returns([]);
    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2));
    expect(result).to.be.empty;
  });

  it('finds references across workspace files', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'Foo.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/Foo.brs', 'utf-8').returns(
      'sub init()\n  doSomething()\nend sub\nsub doSomething()\nend sub'
    );
    rebuildIndex();

    const doc = makeDocument('doSomething()');
    const result = provider.provideReferences(doc, makeParams(0, 2));

    expect(result.length).to.be.greaterThan(0);
    expect(result.some((l) => l.uri.includes('Foo.brs'))).to.be.true;
  });

  it('always excludes the function definition line', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'Foo.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/Foo.brs', 'utf-8').returns(
      'sub myFunc()\nend sub\nmyFunc()'
    );
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2));

    const resultLines = result.map((l) => l.range.start.line);
    expect(resultLines).to.not.include(0); // definition line excluded
    expect(resultLines).to.include(2);     // call site included
  });

  it('excludes definition even when includeDeclaration is true', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'Bar.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/Bar.brs', 'utf-8').returns(
      'sub myFunc()\nend sub\nmyFunc()'
    );
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2, true));

    const resultLines = result.map((l) => l.range.start.line);
    expect(resultLines).to.not.include(0); // definition excluded regardless of flag
    expect(resultLines).to.include(2);
  });

  it('skips node_modules directories', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'node_modules', isDirectory: true },
      { name: 'Foo.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/Foo.brs', 'utf-8').returns('myFunc()');
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2));

    const uris = result.map((l) => l.uri);
    expect(uris.every((u) => !u.includes('node_modules'))).to.be.true;
  });

  it('skips hidden directories (starting with .)', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: '.git', isDirectory: true },
      { name: 'Foo.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/Foo.brs', 'utf-8').returns('myFunc()');
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2));

    expect(result.every((l) => !l.uri.includes('.git'))).to.be.true;
  });

  it('returns locations from multiple files', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'A.brs', isDirectory: false },
      { name: 'B.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/A.brs', 'utf-8').returns('myFunc()');
    readFileStub.withArgs('/workspace/B.brs', 'utf-8').returns('sub myFunc()\nend sub\nmyFunc()');
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2, true));

    const fileUris = new Set(result.map((l) => l.uri));
    expect(fileUris.size).to.equal(2);
  });

  it('finds multiple occurrences on the same line', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'C.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/C.brs', 'utf-8').returns(
      'if myFunc() then myFunc()'
    );
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2));

    const lineZero = result.filter((l) => l.range.start.line === 0);
    expect(lineZero).to.have.length(2);
  });

  it('recurses into subdirectories', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'components', isDirectory: true },
    ]);
    readdirTypedStub.withArgs('/workspace/components').returns([
      { name: 'Nested.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/components/Nested.brs', 'utf-8').returns('myFunc()');
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2));

    expect(result.some((l) => l.uri.includes('Nested.brs'))).to.be.true;
  });

  it('returns correct range start column for the match', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'D.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/D.brs', 'utf-8').returns('  myFunc()');
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2));

    expect(result).to.have.length(1);
    expect(result[0].range.start.character).to.equal(2);
    expect(result[0].range.end.character).to.equal(8);
  });

  it('is case-insensitive when scanning files', () => {
    readdirTypedStub.withArgs('/workspace').returns([
      { name: 'E.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/workspace/E.brs', 'utf-8').returns('MYFUNC()\nMyFunc()');
    rebuildIndex();

    const doc = makeDocument('myFunc()');
    const result = provider.provideReferences(doc, makeParams(0, 2));

    expect(result).to.have.length(2);
  });
});

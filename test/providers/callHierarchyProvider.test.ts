import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BrightScriptCallHierarchyProvider } from '../../src/server/providers/callHierarchyProvider';
import { WorkspaceFunctionIndex } from '../../src/server/utils/workspaceFunctionIndex';
import { clearFileParseCache } from '../../src/server/utils/fileParseCache';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string, uri = 'file:///workspace/Test.brs'): TextDocument {
  return TextDocument.create(uri, 'brightscript', 1, content);
}

function makePosition(line: number, character: number) {
  return { line, character };
}

describe('BrightScriptCallHierarchyProvider', () => {
  let readdirTypedStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let index: WorkspaceFunctionIndex;
  let provider: BrightScriptCallHierarchyProvider;

  beforeEach(() => {
    readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped');
    readFileStub = sinon.stub(fsWrapper, 'readFileSync').returns('');
    sinon.stub(fsWrapper, 'existsSync').returns(false);
    readdirTypedStub.returns([]);
    index = new WorkspaceFunctionIndex();
    provider = new BrightScriptCallHierarchyProvider(index);
  });

  function rebuildIndex(): void {
    index.build(['/workspace']);
    provider = new BrightScriptCallHierarchyProvider(index);
  }

  afterEach(() => {
    sinon.restore();
    clearFileParseCache();
    invalidateAllCaches();
  });

  // ── prepare ──────────────────────────────────────────────────────────────

  describe('prepare', () => {
    it('returns null when cursor is on whitespace', () => {
      readdirTypedStub.withArgs('/workspace').returns([]);
      rebuildIndex();
      const doc = makeDocument('  ');
      expect(provider.prepare(doc, makePosition(0, 0))).to.be.null;
    });

    it('returns null when word is not a known function', () => {
      readdirTypedStub.withArgs('/workspace').returns([]);
      rebuildIndex();
      const doc = makeDocument('unknownFunc()');
      expect(provider.prepare(doc, makePosition(0, 2))).to.be.null;
    });

    it('returns a CallHierarchyItem for a function declaration in the document', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'Test.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/Test.brs', 'utf-8').returns(
        'function doWork()\nend function'
      );
      rebuildIndex();

      const doc = makeDocument('function doWork()\nend function', 'file:///workspace/Test.brs');
      const result = provider.prepare(doc, makePosition(0, 10));

      expect(result).to.not.be.null;
      expect(result).to.have.length(1);
      expect(result![0].name).to.equal('doWork');
    });

    it('returns item with correct URI for workspace function', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'Util.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/Util.brs', 'utf-8').returns(
        'function helperFn()\nend function'
      );
      rebuildIndex();

      const doc = makeDocument('helperFn()');
      const result = provider.prepare(doc, makePosition(0, 2));

      expect(result).to.not.be.null;
      expect(result![0].name).to.equal('helperFn');
      expect(result![0].uri).to.include('Util.brs');
    });
  });

  // ── incomingCalls ─────────────────────────────────────────────────────────

  describe('incomingCalls', () => {
    it('returns empty array when no callers exist', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'A.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/A.brs', 'utf-8').returns(
        'function doWork()\nend function'
      );
      rebuildIndex();

      const item = {
        name: 'doWork', kind: 12, uri: 'file:///workspace/A.brs',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      };
      expect(provider.incomingCalls(item)).to.be.empty;
    });

    it('returns incoming calls with correct fromRanges', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'A.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/A.brs', 'utf-8').returns([
        'function doWork()',
        'end function',
        'sub caller()',
        '  doWork()',
        'end sub',
      ].join('\n'));
      rebuildIndex();

      const item = {
        name: 'doWork', kind: 12, uri: 'file:///workspace/A.brs',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      };
      const result = provider.incomingCalls(item);

      expect(result).to.have.length(1);
      expect(result[0].from.name).to.equal('caller');
      expect(result[0].fromRanges).to.have.length(1);
      expect(result[0].fromRanges[0].start.line).to.equal(3);
    });

    it('groups multiple call sites from the same caller', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'A.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/A.brs', 'utf-8').returns([
        'function doWork()',
        'end function',
        'sub caller()',
        '  doWork()',
        '  doWork()',
        'end sub',
      ].join('\n'));
      rebuildIndex();

      const item = {
        name: 'doWork', kind: 12, uri: 'file:///workspace/A.brs',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      };
      const result = provider.incomingCalls(item);

      expect(result).to.have.length(1);
      expect(result[0].fromRanges).to.have.length(2);
    });

    it('returns callers from multiple files', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'A.brs', isDirectory: false },
        { name: 'B.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/A.brs', 'utf-8').returns(
        'sub callerA()\n  doWork()\nend sub'
      );
      readFileStub.withArgs('/workspace/B.brs', 'utf-8').returns(
        'sub callerB()\n  doWork()\nend sub'
      );
      rebuildIndex();

      const item = {
        name: 'doWork', kind: 12, uri: 'file:///workspace/A.brs',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      };
      const result = provider.incomingCalls(item);

      expect(result).to.have.length(2);
      const callerNames = result.map(r => r.from.name);
      expect(callerNames).to.include('callerA');
      expect(callerNames).to.include('callerB');
    });
  });

  // ── outgoingCalls ─────────────────────────────────────────────────────────

  describe('outgoingCalls', () => {
    it('returns empty array when function has no outgoing calls', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'A.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/A.brs', 'utf-8').returns(
        'function doWork()\nend function'
      );
      rebuildIndex();

      const item = {
        name: 'doWork', kind: 12, uri: 'file:///workspace/A.brs',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      };
      expect(provider.outgoingCalls(item)).to.be.empty;
    });

    it('returns outgoing calls with correct fromRanges', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'A.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/A.brs', 'utf-8').returns([
        'sub init()',
        '  doWork()',
        '  doWork()',
        'end sub',
        'sub doWork()',
        'end sub',
      ].join('\n'));
      rebuildIndex();

      const item = {
        name: 'init', kind: 12, uri: 'file:///workspace/A.brs',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
      };
      const result = provider.outgoingCalls(item);

      expect(result).to.have.length(1);
      expect(result[0].to.name).to.equal('doWork');
      expect(result[0].fromRanges).to.have.length(2);
    });

    it('resolves callee definition URI from workspace index', () => {
      readdirTypedStub.withArgs('/workspace').returns([
        { name: 'A.brs', isDirectory: false },
        { name: 'Util.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/workspace/A.brs', 'utf-8').returns(
        'sub init()\n  helperFn()\nend sub'
      );
      readFileStub.withArgs('/workspace/Util.brs', 'utf-8').returns(
        'sub helperFn()\nend sub'
      );
      rebuildIndex();

      const item = {
        name: 'init', kind: 12, uri: 'file:///workspace/A.brs',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
      };
      const result = provider.outgoingCalls(item);

      expect(result).to.have.length(1);
      expect(result[0].to.uri).to.include('Util.brs');
    });
  });
});

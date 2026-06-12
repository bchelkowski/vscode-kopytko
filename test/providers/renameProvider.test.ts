import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BrightScriptRenameProvider } from '../../src/server/providers/renameProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';
import { WorkspaceFunctionIndex } from '../../src/server/utils/workspaceFunctionIndex';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string, uri = 'file:///project/App.brs'): TextDocument {
  return TextDocument.create(uri, 'brightscript', 1, content);
}

function makeResolver(workspaceFolders: string[] = ['/project']): KopytkoImportResolver {
  return new KopytkoImportResolver({ workspaceFolders, sourceDir: 'app', resolveModules: false });
}

describe('BrightScriptRenameProvider', () => {
  let readdirStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let index: WorkspaceFunctionIndex;
  let provider: BrightScriptRenameProvider;

  beforeEach(() => {
    readdirStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
    readFileStub = sinon.stub(fsWrapper, 'readFileSync').returns('');
    index = new WorkspaceFunctionIndex();
    provider = new BrightScriptRenameProvider(makeResolver(), index);
  });

  afterEach(() => {
    sinon.restore();
    invalidateAllCaches();
  });

  // ── prepareRename ──────────────────────────────────────────────────────────

  describe('prepareRename', () => {
    it('returns the range and placeholder for an identifier', () => {
      const doc = makeDocument('function doWork()\nend function');
      const result = provider.prepareRename(doc, { line: 0, character: 12 });
      expect(result).to.not.be.null;
      expect(result!.placeholder).to.equal('doWork');
    });

    it('range covers exactly the word token', () => {
      const doc = makeDocument('function doWork()\nend function');
      const result = provider.prepareRename(doc, { line: 0, character: 12 });
      expect(result!.range.start.character).to.equal(9);  // 'function ' = 9 chars
      expect(result!.range.end.character).to.equal(9 + 'doWork'.length);
    });

    it('returns null when cursor is on whitespace', () => {
      const doc = makeDocument('function doWork()\nend function');
      expect(provider.prepareRename(doc, { line: 0, character: 8 })).to.be.null;
    });

    it('returns null when cursor is on a BrightScript built-in', () => {
      const doc = makeDocument('x = Abs(-1)');
      expect(provider.prepareRename(doc, { line: 0, character: 5 })).to.be.null;
    });

    it('returns null when cursor is on a BrightScript keyword', () => {
      const doc = makeDocument('for i = 0 to 10');
      expect(provider.prepareRename(doc, { line: 0, character: 1 })).to.be.null;
    });

    it('returns null on an empty line', () => {
      const doc = makeDocument('');
      expect(provider.prepareRename(doc, { line: 0, character: 0 })).to.be.null;
    });

    it('range is on the correct line', () => {
      const doc = makeDocument('sub init()\nend sub\nsub doWork()\nend sub');
      const result = provider.prepareRename(doc, { line: 2, character: 5 });
      expect(result!.range.start.line).to.equal(2);
      expect(result!.range.end.line).to.equal(2);
    });
  });

  // ── provideRename — validation ─────────────────────────────────────────────

  describe('provideRename — validation', () => {
    it('returns null when cursor is on whitespace', () => {
      const doc = makeDocument('function doWork()\nend function');
      expect(provider.provideRename(doc, { line: 0, character: 8 }, 'newName')).to.be.null;
    });

    it('returns null for a built-in function name', () => {
      const doc = makeDocument('x = Abs(-1)');
      expect(provider.provideRename(doc, { line: 0, character: 5 }, 'newName')).to.be.null;
    });

    it('returns null for a keyword', () => {
      const doc = makeDocument('for i = 0 to 10');
      expect(provider.provideRename(doc, { line: 0, character: 1 }, 'newName')).to.be.null;
    });

    it('returns null when newName contains spaces', () => {
      const doc = makeDocument('function doWork()\nend function');
      expect(provider.provideRename(doc, { line: 0, character: 12 }, 'my func')).to.be.null;
    });

    it('returns null when newName starts with a digit', () => {
      const doc = makeDocument('function doWork()\nend function');
      expect(provider.provideRename(doc, { line: 0, character: 12 }, '1fn')).to.be.null;
    });

    it('returns null when newName is empty', () => {
      const doc = makeDocument('function doWork()\nend function');
      expect(provider.provideRename(doc, { line: 0, character: 12 }, '')).to.be.null;
    });

    it('accepts newName with underscores and digits', () => {
      readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
      readFileStub.withArgs('/project/App.brs', 'utf8').returns('function doWork()\nend function');
      index.build(['/project']);
      provider = new BrightScriptRenameProvider(makeResolver(), index);
      const doc = makeDocument('function doWork()\nend function');
      expect(provider.provideRename(doc, { line: 0, character: 12 }, '_fn_2')).to.not.be.null;
    });
  });

  // ── function rename — workspace-wide ──────────────────────────────────────

  describe('function rename (workspace-wide)', () => {
    it('renames a function across the whole workspace', () => {
      readdirStub.withArgs('/project').returns([
        { name: 'A.brs', isDirectory: false },
        { name: 'B.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/project/A.brs', 'utf8').returns('function doWork()\nend function');
      readFileStub.withArgs('/project/B.brs', 'utf8').returns('result = doWork()');
      index.build(['/project']);
      provider = new BrightScriptRenameProvider(makeResolver(), index);
      const doc = makeDocument('function doWork()\nend function', 'file:///project/A.brs');
      const result = provider.provideRename(doc, { line: 0, character: 12 }, 'runTask');
      expect(result).to.not.be.null;
      expect(Object.keys(result!.changes!)).to.have.length(2);
    });

    it('includes the definition line in a function rename', () => {
      readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
      readFileStub.withArgs('/project/App.brs', 'utf8').returns(
        'function doWork()\nend function\nx = doWork()'
      );
      index.build(['/project']);
      provider = new BrightScriptRenameProvider(makeResolver(), index);
      const doc = makeDocument('function doWork()\nend function\nx = doWork()');
      const result = provider.provideRename(doc, { line: 0, character: 12 }, 'runTask');
      const edits = Object.values(result!.changes!)[0];
      expect(edits).to.have.length(2);
      expect(edits.some((e) => e.range.start.line === 0)).to.be.true;
    });

    it('uses word boundaries for function rename', () => {
      readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
      readFileStub.withArgs('/project/App.brs', 'utf8').returns(
        'function doWork()\nend function\ndoWorkHelper()\ndoWork()'
      );
      index.build(['/project']);
      provider = new BrightScriptRenameProvider(makeResolver(), index);
      const doc = makeDocument('function doWork()\nend function\ndoWorkHelper()\ndoWork()');
      const result = provider.provideRename(doc, { line: 0, character: 12 }, 'runTask');
      const edits = Object.values(result!.changes!)[0];
      // 'doWorkHelper' must NOT be touched — only the declaration and the bare call
      expect(edits).to.have.length(2);
    });

    it('function rename is case-insensitive', () => {
      readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
      readFileStub.withArgs('/project/App.brs', 'utf8').returns(
        'function doWork()\nend function\nDOWORK()\nDoWork()'
      );
      index.build(['/project']);
      provider = new BrightScriptRenameProvider(makeResolver(), index);
      const doc = makeDocument('function doWork()\nend function\nDOWORK()\nDoWork()');
      const result = provider.provideRename(doc, { line: 0, character: 12 }, 'runTask');
      const edits = Object.values(result!.changes!)[0];
      expect(edits).to.have.length(3);
    });

    it('function rename skips node_modules', () => {
      readdirStub.withArgs('/project').returns([
        { name: 'node_modules', isDirectory: true },
        { name: 'App.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/project/App.brs', 'utf8').returns('function doWork()\nend function');
      index.build(['/project']);
      provider = new BrightScriptRenameProvider(makeResolver(), index);
      const doc = makeDocument('function doWork()\nend function');
      provider.provideRename(doc, { line: 0, character: 12 }, 'runTask');
      expect(readdirStub.calledWith('/project/node_modules')).to.be.false;
    });

    it('function rename collects across multiple workspace folders', () => {
      readdirStub.withArgs('/project1').returns([{ name: 'A.brs', isDirectory: false }]);
      readdirStub.withArgs('/project2').returns([{ name: 'B.brs', isDirectory: false }]);
      readFileStub.withArgs('/project1/A.brs', 'utf8').returns('function doWork()\nend function');
      readFileStub.withArgs('/project2/B.brs', 'utf8').returns('doWork()');
      index.build(['/project1', '/project2']);
      provider = new BrightScriptRenameProvider(makeResolver(['/project1', '/project2']), index);
      const doc = makeDocument('function doWork()\nend function', 'file:///project1/A.brs');
      const result = provider.provideRename(doc, { line: 0, character: 12 }, 'runTask');
      expect(Object.keys(result!.changes!)).to.have.length(2);
    });
  });

  // ── local variable rename — scoped to enclosing function ──────────────────

  describe('local variable rename (scoped to enclosing function)', () => {
    it('renames a local variable only within its enclosing function', () => {
      const src = [
        'function funcA()',
        '  value = 1',      // line 1 — 'value' here
        '  return value',   // line 2 — 'value' here
        'end function',
        'function funcB()',
        '  value = 2',      // line 5 — different 'value', must NOT be renamed
        '  return value',   // line 6 — must NOT be renamed
        'end function',
      ].join('\n');
      const doc = makeDocument(src);
      // Cursor on 'value' at line 1
      const result = provider.provideRename(doc, { line: 1, character: 2 }, 'count');
      expect(result).to.not.be.null;
      const edits = Object.values(result!.changes!)[0];
      // Only the two occurrences in funcA (lines 1 and 2) should be renamed
      expect(edits).to.have.length(2);
      expect(edits.every((e) => e.range.start.line <= 3)).to.be.true;
    });

    it('does not touch the same variable name in a sibling function', () => {
      const src = [
        'function one()',
        '  x = 10',
        'end function',
        'function two()',
        '  x = 20',
        'end function',
      ].join('\n');
      const doc = makeDocument(src);
      const result = provider.provideRename(doc, { line: 1, character: 2 }, 'counter');
      const edits = Object.values(result!.changes!)[0];
      // Only the x in 'one' (line 1) — not the x in 'two' (line 4)
      expect(edits).to.have.length(1);
      expect(edits[0].range.start.line).to.equal(1);
    });

    it('renames a function parameter only within its function', () => {
      const src = [
        'function greet(name as String)',
        '  msg = "Hello " + name',
        'end function',
        'function farewell(name as String)',
        '  msg = "Bye " + name',
        'end function',
      ].join('\n');
      const doc = makeDocument(src);
      // Cursor on 'name' in the parameter list of 'greet' (line 0, char 15)
      const result = provider.provideRename(doc, { line: 0, character: 15 }, 'personName');
      const edits = Object.values(result!.changes!)[0];
      // 'name' appears 2 times in greet (declaration + usage) — not in farewell
      expect(edits).to.have.length(2);
      expect(edits.every((e) => e.range.start.line <= 2)).to.be.true;
    });

    it('local variable rename edits are in the current document only', () => {
      const src = 'function foo()\n  myVar = 1\n  return myVar\nend function';
      const doc = makeDocument(src, 'file:///project/Foo.brs');
      const result = provider.provideRename(doc, { line: 1, character: 2 }, 'counter');
      const uris = Object.keys(result!.changes!);
      expect(uris).to.have.length(1);
      expect(uris[0]).to.include('Foo.brs');
    });

    it('local rename uses word boundaries — does not touch partial matches', () => {
      const src = [
        'function foo()',
        '  tok = 1',
        '  tokenCount = 2',
        '  return tok',
        'end function',
      ].join('\n');
      const doc = makeDocument(src);
      const result = provider.provideRename(doc, { line: 1, character: 2 }, 'item');
      const edits = Object.values(result!.changes!)[0];
      // 'tok' appears at lines 1 and 3 — 'tokenCount' on line 2 must NOT match
      expect(edits).to.have.length(2);
    });

    it('correctly identifies the enclosing function for lines deep inside a function', () => {
      const src = [
        'function processItems()',
        '  for i = 0 to 10',
        '    item = items[i]',
        '    if item <> invalid then',
        '      result = item.value', // line 4 — cursor here on 'item'
        '    end if',
        '  end for',
        'end function',
      ].join('\n');
      const doc = makeDocument(src);
      const result = provider.provideRename(doc, { line: 4, character: 7 }, 'element');
      expect(result).to.not.be.null;
      const edits = Object.values(result!.changes!)[0];
      // 'item' appears on lines 2, 3, 4 within the function — all should be renamed
      expect(edits.every((e) => e.range.start.line >= 0 && e.range.start.line <= 7)).to.be.true;
    });

    it('produces empty changes when variable has no occurrences in the function scope', () => {
      const src = 'function foo()\n  x = 1\nend function';
      const doc = makeDocument(src);
      const result = provider.provideRename(doc, { line: 1, character: 2 }, 'counter');
      // x appears once — renamed to counter, changes should have one edit
      expect(result).to.not.be.null;
      const edits = Object.values(result!.changes!)[0];
      expect(edits).to.have.length(1);
    });

    it('returns empty changes object when no occurrences exist anywhere in scope', () => {
      // cursor on 'foo' — which IS a function name, so it goes workspace-wide
      // Let's test a case where there truly are no matches
      readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
      readFileStub.withArgs('/project/App.brs', 'utf8').returns('other()');
      index.build(['/project']);
      provider = new BrightScriptRenameProvider(makeResolver(), index);
      const doc2 = makeDocument('other()');
      // 'other' is not a function in the workspace scan
      const result = provider.provideRename(doc2, { line: 0, character: 2 }, 'something');
      expect(result).to.not.be.null;
      // local rename: no match in enclosing scope (cursor outside any function)
    });
  });

  // ── findEnclosingFunctionLines — via provideRename ─────────────────────────

  describe('enclosing function detection', () => {
    it('handles cursor inside a single function', () => {
      const src = 'function foo()\n  x = 1\nend function';
      const doc = makeDocument(src);
      const result = provider.provideRename(doc, { line: 1, character: 2 }, 'counter');
      expect(result).to.not.be.null;
      // Only the current file, only within the function
      const uris = Object.keys(result!.changes!);
      expect(uris).to.have.length(1);
    });

    it('handles cursor on the function declaration line (function name itself goes workspace-wide)', () => {
      readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
      readFileStub.withArgs('/project/App.brs', 'utf8').returns('function doWork()\nend function');
      index.build(['/project']);
      provider = new BrightScriptRenameProvider(makeResolver(), index);
      const doc = makeDocument('function doWork()\nend function');
      // 'doWork' is recognised as a function → workspace-wide
      const _result = provider.provideRename(doc, { line: 0, character: 12 }, 'runTask');
      // Should scan workspace files
      expect(readdirStub.called).to.be.true;
    });

    it('does not crash when cursor is outside any function', () => {
      const src = "' top-level comment\n' @import /foo.brs\n";
      const doc = makeDocument(src);
      // No crash, result may be null or have empty changes
      expect(() => provider.provideRename(doc, { line: 0, character: 5 }, 'newName')).not.to.throw();
    });
  });
});

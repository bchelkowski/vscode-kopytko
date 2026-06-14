import { expect } from 'chai';
import * as sinon from 'sinon';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Location } from 'vscode-languageserver/node';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { BrightScriptDefinitionProvider } from '../../src/server/providers/definitionProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

const makeDocument = (content: string, uri = 'file:///project/app/main.brs') =>
  TextDocument.create(uri, 'brightscript', 1, content);

const makeResolver = () =>
  new KopytkoImportResolver({
    workspaceFolders: ['/project'],
    sourceDir: 'app',
    resolveModules: false,
  });

describe('BrightScriptDefinitionProvider', () => {
  let existsStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let readdirStub: sinon.SinonStub;
  let provider: BrightScriptDefinitionProvider;

  beforeEach(() => {
    existsStub = sinon.stub(fsWrapper, 'existsSync');
    readFileStub = sinon.stub(fsWrapper, 'readFileSync');
    readdirStub = sinon.stub(fsWrapper, 'readdirSync');
    existsStub.returns(false);
    readdirStub.returns([]);
    provider = new BrightScriptDefinitionProvider(makeResolver());
  });

  afterEach(() => {
    sinon.restore();
    invalidateAllCaches();
  });

  // ── @import navigation ────────────────────────────────────────────────────

  describe('@import line navigation', () => {
    it('navigates to an internal imported file', async () => {
      const doc = makeDocument("' @import /utils/helper.brs");
      existsStub.withArgs('/project/app/utils/helper.brs').returns(true);

      const result = await provider.provideDefinition(doc, { line: 0, character: 15 });
      expect(result).to.not.be.null;
      expect((result as Location).uri).to.include('helper.brs');
    });

    it('returns null when @import path cannot be resolved', async () => {
      const doc = makeDocument("' @import /missing.brs");
      existsStub.returns(false);

      const result = await provider.provideDefinition(doc, { line: 0, character: 10 });
      expect(result).to.be.null;
    });
  });

  // ── function definition in same file ─────────────────────────────────────

  describe('function definition in same file', () => {
    it('navigates to a function defined in the same file', async () => {
      const doc = makeDocument([
        'function doWork()',
        '  return 1',
        'end function',
        '',
        'doWork()',
      ].join('\n'));

      const result = await provider.provideDefinition(doc, { line: 4, character: 2 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.range.start.line).to.equal(0);
    });

    it('navigates to a sub defined later in the same file', async () => {
      const doc = makeDocument([
        'doSomething()',
        '',
        'sub doSomething()',
        'end sub',
      ].join('\n'));

      const result = await provider.provideDefinition(doc, { line: 0, character: 4 });
      const loc = result as Location;
      expect(loc.range.start.line).to.equal(2);
    });

    it('is case-insensitive for function lookup', async () => {
      const doc = makeDocument([
        'function MyFunc()',
        'end function',
        '',
        'myfunc()',
      ].join('\n'));

      const result = await provider.provideDefinition(doc, { line: 3, character: 3 });
      expect(result).to.not.be.null;
    });

    it('returns null when word is not a known function', async () => {
      const doc = makeDocument('unknownIdent()');
      const result = await provider.provideDefinition(doc, { line: 0, character: 4 });
      expect(result).to.be.null;
    });

    it('returns null when cursor is on whitespace', async () => {
      const doc = makeDocument('function foo()\nend function\n');
      const result = await provider.provideDefinition(doc, { line: 2, character: 0 });
      expect(result).to.be.null;
    });
  });

  // ── function definition in @imported file ────────────────────────────────

  describe('function definition in @imported file', () => {
    it('navigates to a function defined in an imported file', async () => {
      const doc = makeDocument([
        "' @import /utils/helper.brs",
        '',
        'helperFn()',
      ].join('\n'));

      existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
      readFileStub.withArgs('/project/app/utils/helper.brs', 'utf-8').returns(
        'function helperFn()\nend function'
      );

      const result = await provider.provideDefinition(doc, { line: 2, character: 4 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.uri).to.include('helper.brs');
      expect(loc.range.start.line).to.equal(0);
    });
  });

  // ── function definition in XML sibling file ───────────────────────────────

  describe('function definition in XML sibling file', () => {
    it('navigates to a function defined in a sibling brs file from shared XML', async () => {
      const doc = makeDocument(
        'siblingFn()',
        'file:///dir/App.view.brs',
      );

      readdirStub.withArgs('/dir').returns(['App.view.xml']);
      readFileStub.withArgs('/dir/App.view.xml', 'utf-8').returns(
        `<script type="text/brightscript" uri="App.view.brs" />
         <script type="text/brightscript" uri="App.template.brs" />`
      );
      existsStub.withArgs('/dir/App.view.brs').returns(true);
      existsStub.withArgs('/dir/App.template.brs').returns(true);
      readFileStub.withArgs('/dir/App.template.brs', 'utf-8').returns(
        'function siblingFn()\nend function'
      );

      const resolver = new KopytkoImportResolver({
        workspaceFolders: ['/project'],
        sourceDir: 'app',
        resolveModules: false,
      });
      const p = new BrightScriptDefinitionProvider(resolver);
      const result = await p.provideDefinition(doc, { line: 0, character: 4 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.uri).to.include('App.template.brs');
      expect(loc.range.start.line).to.equal(0);
    });
  });

  // ── function definition in pattern-based sibling file ────────────────────

  describe('function definition in pattern-based sibling file', () => {
    it('navigates to a function defined in a sibling file matched by siblingPatterns', async () => {
      const doc = TextDocument.create('file:///dir/Foo.component.brs', 'brightscript', 1, 'templateSetup()');

      readdirStub.withArgs('/dir').returns([]);
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      readFileStub.withArgs('/dir/Foo.template.brs', 'utf-8').returns(
        'function templateSetup()\nend function'
      );

      const p = new BrightScriptDefinitionProvider(makeResolver());
      const siblingPatterns = [['*.component.brs', '*.template.brs']];
      const result = await p.provideDefinition(doc, { line: 0, character: 4 }, siblingPatterns);
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.uri).to.include('Foo.template.brs');
      expect(loc.range.start.line).to.equal(0);
    });

    it('returns null when sibling patterns are empty and function is only in the sibling', async () => {
      const doc = TextDocument.create('file:///dir/Foo.component.brs', 'brightscript', 1, 'templateSetup()');

      readdirStub.returns([]);
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      readFileStub.withArgs('/dir/Foo.template.brs', 'utf-8').returns(
        'function templateSetup()\nend function'
      );

      const p = new BrightScriptDefinitionProvider(makeResolver());
      const result = await p.provideDefinition(doc, { line: 0, character: 4 });
      expect(result).to.be.null;
    });
  });

  // ── AA inner method go-to-definition ─────────────────────────────────────

  describe('AA inner method go-to-definition', () => {
    it('navigates to an inner method defined in the same file', async () => {
      const doc = makeDocument([
        'function createCounter() as Object',  // line 0
        '  this = {}',                          // line 1
        '  this.increment = function()',        // line 2
        '  end function',                       // line 3
        '  return this',                        // line 4
        'end function',                         // line 5
        '',                                     // line 6
        'sub init()',                           // line 7
        '  counter = createCounter()',          // line 8
        '  counter.increment()',                // line 9 — cursor here
        'end sub',                              // line 10
      ].join('\n'));

      // cursor on "increment" in "counter.increment()"
      // "  counter." = 10 chars, "increment" starts at column 10
      const result = await provider.provideDefinition(doc, { line: 9, character: 12 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.range.start.line).to.equal(2);
      // "  this." = 7 chars → "increment" starts at column 7
      expect(loc.range.start.character).to.equal(7);
    });

    it('navigates to an inner method defined in an imported file', async () => {
      const doc = makeDocument([
        "' @import /utils/counter.brs",
        '',
        'counter.increment()',
      ].join('\n'));

      existsStub.withArgs('/project/app/utils/counter.brs').returns(true);
      readFileStub.withArgs('/project/app/utils/counter.brs', 'utf-8').returns([
        'function createCounter() as Object',
        '  this = {}',
        '  this.increment = function()',
        '  end function',
        '  return this',
        'end function',
      ].join('\n'));

      // cursor on "increment" in "counter.increment()"
      const result = await provider.provideDefinition(doc, { line: 2, character: 10 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.uri).to.include('counter.brs');
      expect(loc.range.start.line).to.equal(2);
    });

    it('cursor on the method name in the assignment line navigates to itself', async () => {
      const doc = makeDocument([
        'function createObj() as Object',   // line 0
        '  this = {}',                       // line 1
        '  this.run = function()',           // line 2 — cursor on "run"
        '  end function',                    // line 3
        '  return this',                     // line 4
        'end function',                      // line 5
      ].join('\n'));

      // "  this." = 7 chars, "run" starts at column 7
      const result = await provider.provideDefinition(doc, { line: 2, character: 8 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.range.start.line).to.equal(2);
      expect(loc.range.start.character).to.equal(7);
    });

    it('falls through to top-level function when dot-preceded word has no inner method match', async () => {
      // m.doWork() where doWork is a top-level function (common BrightScript pattern)
      const doc = makeDocument([
        'function doWork()',
        'end function',
        '',
        'sub init()',
        '  m.doWork()',  // line 4 — cursor on "doWork"
        'end sub',
      ].join('\n'));

      const result = await provider.provideDefinition(doc, { line: 4, character: 5 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.range.start.line).to.equal(0);
    });

    it('returns null when dot-preceded word matches neither inner method nor top-level function', async () => {
      const doc = makeDocument([
        'sub init()',
        '  obj.unknownMethod()',
        'end sub',
      ].join('\n'));

      const result = await provider.provideDefinition(doc, { line: 1, character: 8 });
      expect(result).to.be.null;
    });

    it('navigates to an inline AA literal method (colon syntax)', async () => {
      const doc = makeDocument([
        'function createObj() as Object',  // line 0
        '  return {',                       // line 1
        '    getValue: function() as Integer',  // line 2 ← definition
        '      return 1',
        '    end function',
        '  }',
        'end function',
        '',
        'sub init()',
        '  obj.getValue()',                 // line 9 — cursor on "getValue"
        'end sub',
      ].join('\n'));

      // cursor on "getValue" in "  obj.getValue()"
      // "  obj." = 6 chars, "getValue" at column 6
      const result = await provider.provideDefinition(doc, { line: 9, character: 8 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.range.start.line).to.equal(2);
      // "    getValue" → name starts at column 4
      expect(loc.range.start.character).to.equal(4);
    });

    it('navigates to the correct method when two classes share the same method name', async () => {
      const doc = makeDocument([
        'function ClassA() as Object',           // line 0
        '  this = {}',                            // line 1
        '  this.c = function() as Boolean',      // line 2  ← ClassA.c
        '    return true',
        '  end function',
        '  return this',
        'end function',
        '',
        'function ClassB() as Object',           // line 8
        '  this = {}',                            // line 9
        '  this.c = function() as Boolean',      // line 10 ← ClassB.c
        '    return false',
        '  end function',
        '  return this',
        'end function',
        '',
        'sub init()',                             // line 16
        '  a = ClassA()',                         // line 17
        '  a.c()',                                // line 18 ← cursor on "c"
        'end sub',
      ].join('\n'));

      // "  a." = 4 chars → "c" at column 4
      const result = await provider.provideDefinition(doc, { line: 18, character: 4 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      // Must navigate to ClassA.c (line 2), NOT ClassB.c (line 10)
      expect(loc.range.start.line).to.equal(2);
    });

    it('returns all matching methods when receiver type cannot be inferred', async () => {
      const doc = makeDocument([
        'function ClassA() as Object',
        '  this = {}',
        '  this.c = function() as Boolean',  // ClassA.c
        '  end function',
        '  return this',
        'end function',
        '',
        'function ClassB() as Object',
        '  this = {}',
        '  this.c = function() as Boolean',  // ClassB.c
        '  end function',
        '  return this',
        'end function',
        '',
        'sub init()',
        '  x.c()',  // line 15 — no "x = ..." assignment visible
        'end sub',
      ].join('\n'));

      // cursor on "c" in "  x.c()"
      const result = await provider.provideDefinition(doc, { line: 15, character: 4 });
      // Both methods returned since type cannot be inferred
      expect(result).to.be.an('array').with.length(2);
    });

    it('is case-insensitive for inner method lookup', async () => {
      const doc = makeDocument([
        'function createObj() as Object',
        '  this = {}',
        '  this.getValue = function() as Integer',
        '  end function',
        '  return this',
        'end function',
        '',
        'sub init()',
        '  obj.GETVALUE()',  // line 8 — upper-cased call
        'end sub',
      ].join('\n'));

      const result = await provider.provideDefinition(doc, { line: 8, character: 7 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.range.start.line).to.equal(2);
    });
  });

  // ── deduplication: same function via @import + XML sibling ───────────────

  describe('deduplication via multiple resolution paths', () => {
    it('returns a single result when a function is reachable via both @import and XML sibling', async () => {
      // Foo.view.brs imports helper.brs AND Foo.view.xml lists helper.brs as a sibling script
      const doc = makeDocument(
        [
          "' @import /utils/helper.brs",
          '',
          'helperFn()',
        ].join('\n'),
        'file:///project/app/components/Foo/Foo.view.brs',
      );

      existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
      readFileStub.withArgs('/project/app/utils/helper.brs', 'utf-8').returns(
        'function helperFn()\nend function'
      );

      // XML sibling: Foo.view.xml lists both Foo.view.brs and helper.brs
      readdirStub.withArgs('/project/app/components/Foo').returns(['Foo.view.xml']);
      readFileStub.withArgs('/project/app/components/Foo/Foo.view.xml', 'utf-8').returns(
        '<script type="text/brightscript" uri="Foo.view.brs" />\n' +
        '<script type="text/brightscript" uri="pkg:/utils/helper.brs" />'
      );
      existsStub.withArgs('/project/app/components/Foo/Foo.view.brs').returns(true);

      const p = new BrightScriptDefinitionProvider(makeResolver());
      const result = await p.provideDefinition(doc, { line: 2, character: 4 });

      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.uri).to.include('helper.brs');
      // Must return a single Location, not an array
      expect(result).to.not.be.an('array');
    });

    it('returns a single result when an inner method is reachable via both @import and XML sibling', async () => {
      // Foo.view.brs imports counter.brs AND Foo.view.xml lists counter.brs as a sibling
      const doc = makeDocument(
        [
          "' @import /utils/counter.brs",
          '',
          'counter.increment()',
        ].join('\n'),
        'file:///project/app/components/Foo/Foo.view.brs',
      );

      const counterText = [
        'function createCounter() as Object',
        '  this = {}',
        '  this.increment = function()',
        '  end function',
        '  return this',
        'end function',
      ].join('\n');

      existsStub.withArgs('/project/app/utils/counter.brs').returns(true);
      readFileStub.withArgs('/project/app/utils/counter.brs', 'utf-8').returns(counterText);

      readdirStub.withArgs('/project/app/components/Foo').returns(['Foo.view.xml']);
      readFileStub.withArgs('/project/app/components/Foo/Foo.view.xml', 'utf-8').returns(
        '<script type="text/brightscript" uri="Foo.view.brs" />\n' +
        '<script type="text/brightscript" uri="pkg:/utils/counter.brs" />'
      );
      existsStub.withArgs('/project/app/components/Foo/Foo.view.brs').returns(true);

      const p = new BrightScriptDefinitionProvider(makeResolver());
      const result = await p.provideDefinition(doc, { line: 2, character: 10 });

      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.uri).to.include('counter.brs');
      expect(loc.range.start.line).to.equal(2);
      // Must be a single Location, not duplicated
      expect(result).to.not.be.an('array');
    });

    it('returns a single result when a function is reachable via both @import and pattern sibling', async () => {
      const doc = makeDocument(
        [
          "' @import /utils/helper.brs",
          '',
          'helperFn()',
        ].join('\n'),
        'file:///dir/Foo.component.brs',
      );

      existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
      readFileStub.withArgs('/project/app/utils/helper.brs', 'utf-8').returns(
        'function helperFn()\nend function'
      );

      // Pattern sibling: Foo.template.brs also imports helper.brs
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      readFileStub.withArgs('/dir/Foo.template.brs', 'utf-8').returns(
        "' @import /utils/helper.brs\n"
      );
      readdirStub.returns([]);

      const p = new BrightScriptDefinitionProvider(makeResolver());
      const siblingPatterns = [['*.component.brs', '*.template.brs']];
      const result = await p.provideDefinition(doc, { line: 2, character: 4 }, siblingPatterns);

      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.uri).to.include('helper.brs');
      expect(result).to.not.be.an('array');
    });

    it('deduplicates inner method locations returned for dot-preceded calls', async () => {
      // Simulates the case where the same inner method is found via multiple resolution paths
      // The definition provider's deduplicateLocations ensures a single Location is returned
      const doc = makeDocument([
        'function ClassA() as Object',           // line 0
        '  this = {}',                            // line 1
        '  this.run = function() as Boolean',    // line 2
        '  end function',
        '  return this',
        'end function',
        '',
        'sub init()',
        '  a.run()',                              // line 8 — cursor on "run"
        'end sub',
      ].join('\n'));

      const result = await provider.provideDefinition(doc, { line: 8, character: 4 });
      expect(result).to.not.be.null;
      const loc = result as Location;
      expect(loc.range.start.line).to.equal(2);
      // Should be a single Location, not an array
      expect(result).to.not.be.an('array');
    });
  });
});

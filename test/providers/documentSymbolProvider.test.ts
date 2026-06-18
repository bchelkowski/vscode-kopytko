import { expect } from 'chai';
import { SymbolKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BrightScriptDocumentSymbolProvider } from '../../src/server/providers/documentSymbolProvider';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///workspace/app/components/Test.brs', 'brightscript', 1, content);
}

describe('BrightScriptDocumentSymbolProvider', () => {
  let provider: BrightScriptDocumentSymbolProvider;

  beforeEach(() => {
    provider = new BrightScriptDocumentSymbolProvider();
  });

  // Provider reads getCachedLines(); clear the shared cache between tests.
  afterEach(() => invalidateAllCaches());

  it('returns empty array for a file with no function or sub definitions', () => {
    const doc = makeDocument([
      `x = 1`,
      `print x`,
    ].join('\n'));
    expect(provider.provideDocumentSymbols(doc)).to.be.empty;
  });

  it('returns one symbol for a single function', () => {
    const doc = makeDocument([
      `function greet(name as String) as String`,
      `  return "hello " + name`,
      `end function`,
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols).to.have.length(1);
    expect(symbols[0].name).to.equal('greet');
  });

  it('returns one symbol for a sub definition', () => {
    const doc = makeDocument([
      `sub init()`,
      `  m.label = "hello"`,
      `end sub`,
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols).to.have.length(1);
    expect(symbols[0].name).to.equal('init');
  });

  it('returns symbols for all functions and subs', () => {
    const doc = makeDocument([
      `sub init()`,
      `end sub`,
      ``,
      `function getValue() as Integer`,
      `  return 42`,
      `end function`,
      ``,
      `sub cleanup()`,
      `end sub`,
    ].join('\n'));
    const names = provider.provideDocumentSymbols(doc).map((s) => s.name);
    expect(names).to.deep.equal(['init', 'getValue', 'cleanup']);
  });

  it('all symbols have SymbolKind.Function', () => {
    const doc = makeDocument([
      `sub foo()`,
      `end sub`,
      `function bar() as String`,
      `end function`,
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols.every((s) => s.kind === SymbolKind.Function)).to.be.true;
  });

  it('is case-insensitive for function/sub keywords', () => {
    const doc = makeDocument([
      `FUNCTION UpperFunc()`,
      `END FUNCTION`,
      `Sub MixedSub()`,
      `End Sub`,
    ].join('\n'));
    const names = provider.provideDocumentSymbols(doc).map((s) => s.name);
    expect(names).to.include('UpperFunc');
    expect(names).to.include('MixedSub');
  });

  // ── selectionRange ────────────────────────────────────────────────────────

  it('selectionRange covers exactly the function name', () => {
    const doc = makeDocument(`function greet(name as String) as String\n  return "hi"\nend function`);
    const symbol = provider.provideDocumentSymbols(doc)[0];
    // "function " = 9 chars → name starts at column 9
    expect(symbol.selectionRange.start.line).to.equal(0);
    expect(symbol.selectionRange.start.character).to.equal(9);  // after "function "
    expect(symbol.selectionRange.end.character).to.equal(9 + 'greet'.length);
  });

  it('selectionRange start.character equals column of name in sub declaration', () => {
    const doc = makeDocument(`sub init()\nend sub`);
    const symbol = provider.provideDocumentSymbols(doc)[0];
    // "sub " = 4 chars → name starts at column 4
    expect(symbol.selectionRange.start.character).to.equal(4);
    expect(symbol.selectionRange.end.character).to.equal(4 + 'init'.length);
  });

  it('selectionRange accounts for leading whitespace on indented declarations', () => {
    const doc = makeDocument(`  function helper() as Void\n  end function`);
    const symbol = provider.provideDocumentSymbols(doc)[0];
    // "  function " = 11 chars
    expect(symbol.selectionRange.start.character).to.equal(11);
    expect(symbol.selectionRange.end.character).to.equal(11 + 'helper'.length);
  });

  // ── range ─────────────────────────────────────────────────────────────────

  it('range starts at the beginning of the declaration line', () => {
    const doc = makeDocument([
      `function foo()`,
      `  return 1`,
      `end function`,
    ].join('\n'));
    const symbol = provider.provideDocumentSymbols(doc)[0];
    expect(symbol.range.start.line).to.equal(0);
    expect(symbol.range.start.character).to.equal(0);
  });

  it('range for a single function extends to the end of the document', () => {
    const lines = [
      `function foo()`,
      `  return 1`,
      `end function`,
    ];
    const doc = makeDocument(lines.join('\n'));
    const symbol = provider.provideDocumentSymbols(doc)[0];
    const lastLine = lines.length - 1;
    expect(symbol.range.end.line).to.equal(lastLine);
    expect(symbol.range.end.character).to.equal(lines[lastLine].length);
  });

  it('range for the first function ends just before the next function starts', () => {
    const doc = makeDocument([
      `function foo()`,   // line 0
      `  return 1`,       // line 1
      `end function`,     // line 2
      ``,                 // line 3  ← last line of foo's range
      `function bar()`,   // line 4
      `  return 2`,
      `end function`,
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols).to.have.length(2);
    // foo's range ends at line 3 (blank line before bar)
    expect(symbols[0].range.end.line).to.equal(3);
  });

  it('consecutive symbols have non-overlapping ranges', () => {
    const doc = makeDocument([
      `sub a()`,
      `end sub`,
      `sub b()`,
      `end sub`,
      `sub c()`,
      `end sub`,
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    for (let i = 0; i < symbols.length - 1; i++) {
      expect(symbols[i].range.end.line).to.be.lessThan(symbols[i + 1].range.start.line);
    }
  });

  // ── detail ────────────────────────────────────────────────────────────────

  it('detail contains the parameter list', () => {
    const doc = makeDocument(`function add(a as Integer, b as Integer) as Integer\n  return a + b\nend function`);
    const symbol = provider.provideDocumentSymbols(doc)[0];
    expect(symbol.detail).to.equal('(a as Integer, b as Integer) as Integer');
  });

  it('detail for a no-arg sub is "()"', () => {
    const doc = makeDocument(`sub init()\nend sub`);
    expect(provider.provideDocumentSymbols(doc)[0].detail).to.equal('()');
  });

  it('detail for a no-return function contains only the params', () => {
    const doc = makeDocument(`function foo(x as String)\nend function`);
    expect(provider.provideDocumentSymbols(doc)[0].detail).to.equal('(x as String)');
  });

  // ── inner methods (AA method assignments) ─────────────────────────────────

  it('top-level function with no inner methods has empty children array', () => {
    const doc = makeDocument([
      `function greet() as String`,
      `  return "hi"`,
      `end function`,
    ].join('\n'));
    const symbol = provider.provideDocumentSymbols(doc)[0];
    expect(symbol.children).to.be.an('array').that.is.empty;
  });

  it('inner method assignment becomes a child of the enclosing function', () => {
    const doc = makeDocument([
      `function createCounter() as Object`,   // line 0
      `  this = {}`,                           // line 1
      `  this.increment = function()`,         // line 2
      `    m.count++`,                         // line 3
      `  end function`,                        // line 4
      `  return this`,                         // line 5
      `end function`,                          // line 6
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols).to.have.length(1);
    expect(symbols[0].children).to.have.length(1);
    expect(symbols[0].children![0].name).to.equal('increment');
  });

  it('inner method child has SymbolKind.Method', () => {
    const doc = makeDocument([
      `function createCounter() as Object`,
      `  this = {}`,
      `  this.increment = function()`,
      `  end function`,
      `  return this`,
      `end function`,
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.kind).to.equal(SymbolKind.Method);
  });

  it('inner method selectionRange covers the method name only', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  this = {}`,
      `  this.getValue = function() as Integer`,
      `  end function`,
      `  return this`,
      `end function`,
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    // Line 2: "  this.getValue = function() as Integer"
    //          0123456789...
    // "getValue" starts at index 7 (after "  this.")
    const assignmentLine = `  this.getValue = function() as Integer`;
    const expectedStart = assignmentLine.indexOf('getValue');
    expect(child.selectionRange.start.line).to.equal(2);
    expect(child.selectionRange.start.character).to.equal(expectedStart);
    expect(child.selectionRange.end.character).to.equal(expectedStart + 'getValue'.length);
  });

  it('inner method range ends at the matching end function line', () => {
    const doc = makeDocument([
      `function createObj() as Object`,   // line 0
      `  this = {}`,                       // line 1
      `  this.run = function()`,           // line 2
      `    print "running"`,               // line 3
      `  end function`,                    // line 4
      `  return this`,                     // line 5
      `end function`,                      // line 6
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.range.start.line).to.equal(2);
    expect(child.range.end.line).to.equal(4);
  });

  it('inner method detail contains params and return type', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  this = {}`,
      `  this.add = function(a as Integer, b as Integer) as Integer`,
      `    return a + b`,
      `  end function`,
      `  return this`,
      `end function`,
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.detail).to.equal('(a as Integer, b as Integer) as Integer');
  });

  it('inner method detail with no return type contains only params', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  this = {}`,
      `  this.reset = sub()`,
      `  end sub`,
      `  return this`,
      `end function`,
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.detail).to.equal('()');
  });

  it('multiple inner methods all become children of the same parent', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  this = {}`,
      `  this.methodA = function()`,
      `  end function`,
      `  this.methodB = sub(x as Integer)`,
      `  end sub`,
      `  this.methodC = function() as String`,
      `  end function`,
      `  return this`,
      `end function`,
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols).to.have.length(1);
    const names = symbols[0].children!.map((c) => c.name);
    expect(names).to.deep.equal(['methodA', 'methodB', 'methodC']);
  });

  it('inner methods are assigned to the correct parent when multiple top-level functions exist', () => {
    const doc = makeDocument([
      `function createA() as Object`,   // line 0
      `  this = {}`,                     // line 1
      `  this.foo = function()`,         // line 2
      `  end function`,                  // line 3
      `  return this`,                   // line 4
      `end function`,                    // line 5
      ``,                                // line 6
      `function createB() as Object`,   // line 7
      `  this = {}`,                     // line 8
      `  this.bar = sub()`,              // line 9
      `  end sub`,                       // line 10
      `  return this`,                   // line 11
      `end function`,                    // line 12
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols).to.have.length(2);
    expect(symbols[0].children!.map((c) => c.name)).to.deep.equal(['foo']);
    expect(symbols[1].children!.map((c) => c.name)).to.deep.equal(['bar']);
  });

  it('comment lines are not treated as inner method assignments', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  this = {}`,
      `  ' this.commented = function()`,
      `  ' end function`,
      `  return this`,
      `end function`,
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols[0].children).to.be.empty;
  });

  it('handles nested function bodies inside inner methods without misattributing end function', () => {
    const doc = makeDocument([
      `function createObj() as Object`,   // line 0
      `  this = {}`,                       // line 1
      `  this.outer = function()`,         // line 2
      `    inner = function()`,            // line 3
      `      print "nested"`,              // line 4
      `    end function`,                  // line 5  ← belongs to inner, depth=2→1
      `  end function`,                    // line 6  ← belongs to outer, depth=1→0
      `  return this`,                     // line 7
      `end function`,                      // line 8
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.name).to.equal('outer');
    expect(child.range.end.line).to.equal(6);
  });

  // ── inline AA literal pattern (key: function) ─────────────────────────────

  it('inline AA method (colon syntax) becomes a child of enclosing function', () => {
    const doc = makeDocument([
      `function createObj() as Object`,   // line 0
      `  return {`,                        // line 1
      `    run: function()`,               // line 2
      `      print "running"`,             // line 3
      `    end function`,                  // line 4
      `  }`,                              // line 5
      `end function`,                      // line 6
    ].join('\n'));
    const symbols = provider.provideDocumentSymbols(doc);
    expect(symbols).to.have.length(1);
    expect(symbols[0].children).to.have.length(1);
    expect(symbols[0].children![0].name).to.equal('run');
  });

  it('inline AA method has SymbolKind.Method', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  return {`,
      `    run: function()`,
      `    end function`,
      `  }`,
      `end function`,
    ].join('\n'));
    expect(provider.provideDocumentSymbols(doc)[0].children![0].kind).to.equal(SymbolKind.Method);
  });

  it('inline AA method selectionRange starts at the method name column', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  return {`,
      `    getValue: function() as Integer`,   // line 2: "    getValue" → name at col 4
      `      return 1`,
      `    end function`,
      `  }`,
      `end function`,
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.selectionRange.start.line).to.equal(2);
    expect(child.selectionRange.start.character).to.equal(4);
    expect(child.selectionRange.end.character).to.equal(4 + 'getValue'.length);
  });

  it('inline AA method range ends at the matching end function line', () => {
    const doc = makeDocument([
      `function createObj() as Object`,   // line 0
      `  return {`,                        // line 1
      `    run: function()`,               // line 2
      `      print "x"`,                   // line 3
      `    end function`,                  // line 4
      `  }`,                              // line 5
      `end function`,                      // line 6
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.range.start.line).to.equal(2);
    expect(child.range.end.line).to.equal(4);
  });

  it('inline AA method detail contains params and return type', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  return {`,
      `    add: function(a as Integer, b as Integer) as Integer`,
      `      return a + b`,
      `    end function`,
      `  }`,
      `end function`,
    ].join('\n'));
    expect(provider.provideDocumentSymbols(doc)[0].children![0].detail)
      .to.equal('(a as Integer, b as Integer) as Integer');
  });

  it('inline AA method using sub keyword is also detected', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  return {`,
      `    reset: sub()`,
      `    end sub`,
      `  }`,
      `end function`,
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.name).to.equal('reset');
    expect(child.detail).to.equal('()');
  });

  it('mixed dot-assignment and colon methods in same function are both children', () => {
    const doc = makeDocument([
      `function createObj() as Object`,
      `  this = {`,
      `    colonMethod: function()`,
      `    end function`,
      `  }`,
      `  this.dotMethod = function()`,
      `  end function`,
      `  return this`,
      `end function`,
    ].join('\n'));
    const names = provider.provideDocumentSymbols(doc)[0].children!.map((c) => c.name);
    expect(names).to.include('colonMethod');
    expect(names).to.include('dotMethod');
  });

  it('depth tracking handles colon-pattern nested methods without misattributing end function', () => {
    const doc = makeDocument([
      `function createObj() as Object`,   // line 0
      `  return {`,                        // line 1
      `    outer: function()`,             // line 2
      `      inner = {`,                   // line 3
      `        nested: function()`,        // line 4  ← colon depth++
      `          return 1`,                // line 5
      `        end function`,              // line 6  ← depth-- (nested)
      `      }`,                          // line 7
      `    end function`,                  // line 8  ← depth-- (outer) → 0
      `  }`,                              // line 9
      `end function`,                      // line 10
    ].join('\n'));
    const child = provider.provideDocumentSymbols(doc)[0].children![0];
    expect(child.name).to.equal('outer');
    expect(child.range.end.line).to.equal(8);
  });

  // ── Test case symbols ────────────────────────────────────────────────────

  describe('test case symbols in test files', () => {
    it('parses it() calls as child symbols', () => {
      const doc = TextDocument.create('file:///app/_tests/Foo.test.brs', 'brightscript', 1, [
        'function TestSuite__Foo() as Object',
        '  ts = KopytkoTestSuite()',
        '  ts.name = "Foo"',
        '',
        '  it("should do something", function () as String',
        '    return expect(1).toBe(1)',
        '  end function)',
        '',
        '  it("should handle edge case", function () as String',
        '    return expect(true).toBeTrue()',
        '  end function)',
        '',
        '  return ts',
        'end function',
      ].join('\n'));

      const symbols = provider.provideDocumentSymbols(doc);
      expect(symbols).to.have.lengthOf(1);
      expect(symbols[0].name).to.equal('TestSuite__Foo');

      const children = symbols[0].children!;
      expect(children.length).to.be.greaterThanOrEqual(2);
      const testNames = children.map(c => c.name);
      expect(testNames).to.include('should do something');
      expect(testNames).to.include('should handle edge case');
    });

    it('parses test() and itEach() calls', () => {
      const doc = TextDocument.create('file:///app/_tests/Bar.test.brs', 'brightscript', 1, [
        'function TestSuite__Bar() as Object',
        '  ts = KopytkoTestSuite()',
        '  ts.name = "Bar"',
        '',
        '  test("returns correct value", function () as String',
        '    return expect(sum(1, 2)).toBe(3)',
        '  end function)',
        '',
        '  itEach([{a: 1}, {a: 2}], "works with ${a}", function (params as Object) as String',
        '    return expect(params.a).toBeValid()',
        '  end function)',
        '',
        '  return ts',
        'end function',
      ].join('\n'));

      const symbols = provider.provideDocumentSymbols(doc);
      const children = symbols[0].children!;
      const testNames = children.map(c => c.name);
      expect(testNames).to.include('returns correct value');
      expect(testNames).to.include('works with ${a}');
    });

    it('does NOT parse test cases in non-test files', () => {
      const doc = TextDocument.create('file:///app/components/Foo.brs', 'brightscript', 1, [
        'function init()',
        '  it("this is not a test", function () as String',
        '    return ""',
        '  end function)',
        'end function',
      ].join('\n'));

      const symbols = provider.provideDocumentSymbols(doc);
      const children = symbols[0].children ?? [];
      const testNames = children.map(c => c.name);
      expect(testNames).to.not.include('this is not a test');
    });
  });
});

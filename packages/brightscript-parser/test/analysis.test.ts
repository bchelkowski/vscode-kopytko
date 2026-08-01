import { expect } from 'chai';
import {
  parse, inferTypesFromAst, getVariableType, getVariableTypeInScope,
  buildScopes, findScopeAtLine,
  buildCallGraph, analyzeContext, getSymbolInfo,
  findNodeAtPosition, findTokenAtPosition, getWordAtPosition, escapeRegex,
  buildPositionIndex, findTokenAtPositionIndexed, findNodeAtPositionIndexed,
  buildSymbolIndex,
  parseXmlScriptUris, parseXmlInterface, parseXmlExtends, parseXmlComponentName,
  tokenizeXmlInterfaceElements,
  findComponent, findBuiltin, getComponentMethods, matchesGlob, findMatchingGlob,
  inferNumericLiteralType, isNumericLiteral,
  applyCasing, resolveKeywordCasing, DEFAULT_CASING_CONFIG, getKeywordCategory,
  TokenKind,
} from '../src/index.js';

describe('Type Inference', () => {
  it('infers CreateObject types', () => {
    const r = parse('function foo()\n  x = CreateObject("roUrlTransfer")\nend function');
    const types = inferTypesFromAst(r.root);
    expect(getVariableType(types, 'x')).to.equal('roUrlTransfer');
  });

  it('infers parameter type annotations', () => {
    const r = parse('function foo(a as Integer, b as String)\nend function');
    const types = inferTypesFromAst(r.root);
    expect(getVariableType(types, 'a')).to.equal('Integer');
    expect(getVariableType(types, 'b')).to.equal('String');
  });

  it('infers literal types', () => {
    const r = parse('function foo()\n  x = 42\n  y = "hello"\n  z = true\nend function');
    const types = inferTypesFromAst(r.root);
    expect(getVariableType(types, 'x')).to.equal('Integer');
    expect(getVariableType(types, 'y')).to.equal('String');
    expect(getVariableType(types, 'z')).to.equal('Boolean');
  });

  it('infers m.field types', () => {
    const r = parse('sub init()\n  m.url = CreateObject("roUrlTransfer")\n  m.count = 0\nend sub');
    const types = inferTypesFromAst(r.root);
    expect(getVariableType(types, 'url')).to.equal('roUrlTransfer');
    expect(getVariableType(types, 'count')).to.equal('Integer');
  });

  it('prefers CreateObject over literal', () => {
    const r = parse('function foo()\n  x = 1\n  x = CreateObject("roArray", 5, true)\nend function');
    const types = inferTypesFromAst(r.root);
    expect(getVariableType(types, 'x')).to.equal('roArray');
  });

  it('infers a return-type binding from a same-file function call', () => {
    const r = parse('function makeThing() as String\n  return "x"\nend function\nsub main()\n  y = makeThing()\nend sub');
    const types = inferTypesFromAst(r.root);
    expect(getVariableType(types, 'y')).to.equal('String');
  });

  it('infers a designator binding from an identifier suffix', () => {
    const r = parse('sub main()\n  total% = 1\nend sub');
    const types = inferTypesFromAst(r.root);
    expect(getVariableType(types, 'total%')).to.equal('Integer');
  });

  it('infers a designator type on a parameter with no `as` clause', () => {
    const r = parse('sub main(name$)\nend sub');
    const types = inferTypesFromAst(r.root);
    expect(getVariableType(types, 'name$')).to.equal('String');
  });

  describe('getVariableTypeInScope', () => {
    it('does not let two functions\' same-named locals collide', () => {
      const src = [
        'sub a()',
        '  x = CreateObject("roUrlTransfer")',
        'end sub',
        'sub b()',
        '  x = 42',
        'end sub',
      ].join('\n');
      const r = parse(src);
      const types = inferTypesFromAst(r.root);
      const fileScope = buildScopes(r.root);

      const scopeA = fileScope.children[0];
      const scopeB = fileScope.children[1];
      expect(scopeA.ownerName).to.equal('a');
      expect(scopeB.ownerName).to.equal('b');

      expect(getVariableTypeInScope(types, 'x', scopeA)).to.equal('roUrlTransfer');
      expect(getVariableTypeInScope(types, 'x', scopeB)).to.equal('Integer');
    });

    it('resolves a local using the line at the call site via findScopeAtLine', () => {
      const src = [
        'sub a()',
        '  x = "in a"',
        'end sub',
        'sub b()',
        '  x = 7',
        '  y = x',
        'end sub',
      ].join('\n');
      const r = parse(src);
      const types = inferTypesFromAst(r.root);
      const fileScope = buildScopes(r.root);
      const scopeAtLine5 = findScopeAtLine(fileScope, 5); // `y = x` inside sub b()
      expect(getVariableTypeInScope(types, 'x', scopeAtLine5)).to.equal('Integer');
    });

    it('never resolves an m-context field for a plain variable lookup', () => {
      const src = 'sub init()\n  count = "local"\n  m.count = 1\nend sub';
      const r = parse(src);
      const types = inferTypesFromAst(r.root);
      const fileScope = buildScopes(r.root);
      const initScope = fileScope.children[0];
      // Without scope-awareness this could return 'Integer' from m.count —
      // the whole point of scopeOwner is that it can't.
      expect(getVariableTypeInScope(types, 'count', initScope)).to.equal('String');
    });

    it('sees an outer function\'s locals from a nested function expression (closure)', () => {
      const src = [
        'sub outer()',
        '  x = CreateObject("roArray", 0, true)',
        '  inner = function()',
        '    y = x',
        '  end function',
        'end sub',
      ].join('\n');
      const r = parse(src);
      const types = inferTypesFromAst(r.root);
      const fileScope = buildScopes(r.root);
      const outerScope = fileScope.children[0];
      const innerScope = outerScope.children[0];
      expect(getVariableTypeInScope(types, 'x', innerScope)).to.equal('roArray');
    });

    it('returns undefined for a name with no in-scope binding', () => {
      const r = parse('sub a()\n  x = 1\nend sub\nsub b()\nend sub');
      const types = inferTypesFromAst(r.root);
      const fileScope = buildScopes(r.root);
      expect(getVariableTypeInScope(types, 'x', fileScope.children[1])).to.be.undefined;
      expect(getVariableTypeInScope(types, 'doesNotExist', fileScope.children[0])).to.be.undefined;
    });
  });
});

describe('Call Graph', () => {
  it('collects function declarations', () => {
    const r = parse('function foo()\nend function\nsub bar()\nend sub');
    const cg = buildCallGraph(r.root);
    expect(cg.functions.has('foo')).to.be.true;
    expect(cg.functions.has('bar')).to.be.true;
    expect(cg.functions.get('bar')!.isSub).to.be.true;
  });

  it('collects call sites', () => {
    const r = parse('function foo()\n  bar(1, 2)\nend function\nsub bar(a, b)\nend sub');
    const cg = buildCallGraph(r.root);
    const calls = cg.findCallees('foo');
    expect(calls).to.have.length(1);
    expect(calls[0].calleeName).to.equal('bar');
    expect(calls[0].argCount).to.equal(2);
  });

  it('finds callers of a function', () => {
    const r = parse('function a()\n  c()\nend function\nfunction b()\n  c()\nend function\nsub c()\nend sub');
    const cg = buildCallGraph(r.root);
    const callers = cg.findCallers('c');
    expect(callers).to.have.length(2);
  });

  it('detects method calls', () => {
    const r = parse('function foo()\n  obj.doWork()\nend function');
    const cg = buildCallGraph(r.root);
    const calls = cg.findCallees('foo');
    expect(calls[0].isMethodCall).to.be.true;
    expect(calls[0].receiver).to.equal('obj');
  });

  it('records param types and return type', () => {
    const r = parse('function add(a as Integer, b as Integer) as Integer\n  return a + b\nend function');
    const cg = buildCallGraph(r.root);
    const fn = cg.functions.get('add')!;
    expect(fn.paramTypes).to.deep.equal(['Integer', 'Integer']);
    expect(fn.returnType).to.equal('Integer');
  });

  it('attributes calls after nested functions to the enclosing scope', () => {
    const r = parse([
      'function outer()',
      '  beforeCall()',
      '  function inner()',
      '    innerCall()',
      '  end function',
      '  afterCall()',
      'end function',
      'topCall()',
    ].join('\n'));
    const cg = buildCallGraph(r.root);

    expect(cg.findCallers('beforeCall')[0].enclosingFunction).to.equal('outer');
    expect(cg.findCallers('innerCall')[0].enclosingFunction).to.equal('inner');
    expect(cg.findCallers('afterCall')[0].enclosingFunction).to.equal('outer');
    expect(cg.findCallers('topCall')[0].enclosingFunction).to.equal('');
    expect(cg.findCallees('outer').map(c => c.calleeName)).to.deep.equal(['beforecall', 'aftercall']);
  });
});

describe('Context Analysis', () => {
  it('collects m.field assignments', () => {
    const r = parse('sub init()\n  m.url = CreateObject("roUrlTransfer")\n  m.count = 0\nend sub');
    const ctx = analyzeContext(r.root);
    const fields = ctx.getAllFields();
    expect(fields.map(f => f.name)).to.include('url');
    expect(fields.map(f => f.name)).to.include('count');
  });

  it('tracks which function assigned each field', () => {
    const r = parse('sub init()\n  m.x = 1\nend sub\nsub update()\n  m.y = 2\nend sub');
    const ctx = analyzeContext(r.root);
    expect(ctx.getFieldsInFunction('init').map(f => f.name)).to.deep.equal(['x']);
    expect(ctx.getFieldsInFunction('update').map(f => f.name)).to.deep.equal(['y']);
  });

  it('detects function bindings to AAs', () => {
    const r = parse('sub init()\n  obj.handler = myCallback\nend sub');
    const ctx = analyzeContext(r.root);
    expect(ctx.functionBindings).to.have.length(1);
    expect(ctx.functionBindings[0].aaName).to.equal('obj');
    expect(ctx.functionBindings[0].functionName).to.equal('mycallback');
  });

  it('detects an inline function assigned via dot (obj.method = function() ... end function)', () => {
    // Mixed-case enclosing function name — enclosingFunction must preserve
    // original casing (it's a display name), unlike the internal lowercased
    // functionStack used for scope/lookup purposes elsewhere in this module.
    const src = 'sub Init()\n  obj.onLoad = function()\n    return 1\n  end function\nend sub';
    const r = parse(src);
    const ctx = analyzeContext(r.root);
    expect(ctx.dotAssignedFunctions).to.have.length(1);
    const f = ctx.dotAssignedFunctions[0];
    expect(f.aaName).to.equal('obj');
    expect(f.fieldName).to.equal('onLoad');
    expect(f.enclosingFunction).to.equal('Init');
  });

  it('detects an inline AA-literal function with line/column/enclosingFunction', () => {
    const src = 'sub Init()\n  obj = {\n    onLoad: function()\n      return 1\n    end function\n  }\nend sub';
    const r = parse(src);
    const ctx = analyzeContext(r.root);
    expect(ctx.inlineAAFunctions).to.have.length(1);
    const f = ctx.inlineAAFunctions[0];
    expect(f.aaFieldName).to.equal('onload');
    expect(f.aaFieldNameOriginal).to.equal('onLoad');
    expect(f.enclosingFunction).to.equal('Init');
  });

  it('strips quotes from a quoted AA-literal function key', () => {
    const src = 'obj = {\n  "onLoad": function()\n  end function\n}';
    const r = parse(src);
    const ctx = analyzeContext(r.root);
    expect(ctx.inlineAAFunctions[0].aaFieldNameOriginal).to.equal('onLoad');
  });

  it('detects an inline function assigned to m (the standard SceneGraph event-handler pattern)', () => {
    const src = 'sub init()\n  m.onKeyEvent = function(key, press)\n    return true\n  end function\nend sub';
    const r = parse(src);
    const ctx = analyzeContext(r.root);
    expect(ctx.dotAssignedFunctions).to.have.length(1);
    expect(ctx.dotAssignedFunctions[0].aaName).to.equal('m');
    expect(ctx.dotAssignedFunctions[0].fieldName).to.equal('onKeyEvent');
  });

  it('does not confuse a dot-assigned inline function with a named-function binding', () => {
    const src = 'sub init()\n  a.handler = existingFn\n  b.handler = function()\n  end function\nend sub';
    const r = parse(src);
    const ctx = analyzeContext(r.root);
    expect(ctx.functionBindings).to.have.length(1);
    expect(ctx.functionBindings[0].aaName).to.equal('a');
    expect(ctx.dotAssignedFunctions).to.have.length(1);
    expect(ctx.dotAssignedFunctions[0].aaName).to.equal('b');
  });

  it('infers simple types for m fields', () => {
    const r = parse('sub init()\n  m.name = "test"\n  m.active = true\nend sub');
    const ctx = analyzeContext(r.root);
    const nameField = ctx.getAllFields().find(f => f.name === 'name');
    expect(nameField?.typeName).to.equal('String');
    const activeField = ctx.getAllFields().find(f => f.name === 'active');
    expect(activeField?.typeName).to.equal('Boolean');
  });

  it('attributes fields after nested functions to the enclosing or global scope', () => {
    const r = parse([
      'sub outer()',
      '  m.before = 1',
      '  function inner()',
      '    m.inner = 2',
      '  end function',
      '  m.after = 3',
      'end sub',
      'm.top = 4',
    ].join('\n'));
    const ctx = analyzeContext(r.root);
    const fieldsByName = new Map(ctx.getAllFields().map(f => [f.name, f.assignedInFunction]));

    expect(fieldsByName.get('before')).to.equal('outer');
    expect(fieldsByName.get('inner')).to.equal('inner');
    expect(fieldsByName.get('after')).to.equal('outer');
    expect(fieldsByName.get('top')).to.equal('');
    expect(ctx.getFieldsInFunction('outer').map(f => f.name)).to.deep.equal(['before', 'after']);
  });

  it("infers 'aa' invocationStyle for a function bound as an AA field", () => {
    const r = parse('function myCallback()\n  return 1\nend function\nsub init()\n  obj.handler = myCallback\nend sub');
    const ctx = analyzeContext(r.root);
    const fc = ctx.getFunctionContext('myCallback');
    expect(fc).to.exist;
    expect(fc!.invocationStyle).to.equal('aa');
    expect(fc!.aaOwner).to.equal('obj');
  });

  it("infers 'standalone' invocationStyle for a directly-called bare function", () => {
    const r = parse('function helper()\n  return 1\nend function\nsub main()\n  x = helper()\nend sub');
    const ctx = analyzeContext(r.root);
    expect(ctx.getFunctionContext('helper')!.invocationStyle).to.equal('standalone');
  });

  it("falls back to 'unknown' when a function is never called in-file (e.g. an XML-bound component callback)", () => {
    const r = parse('sub init()\n  m.top.text = "hi"\nend sub');
    const ctx = analyzeContext(r.root);
    expect(ctx.getFunctionContext('init')!.invocationStyle).to.equal('unknown');
  });

  it('does not confuse a method call (obj.helper()) with a standalone call', () => {
    const r = parse('function helper()\n  return 1\nend function\nsub main()\n  x = obj.helper()\nend sub');
    const ctx = analyzeContext(r.root);
    expect(ctx.getFunctionContext('helper')!.invocationStyle).to.equal('unknown');
  });
});

describe('Symbol Info', () => {
  it('gets info for user-defined function', () => {
    const r = parse('function add(a as Integer, b as Integer) as Integer\n  return a + b\nend function');
    const info = getSymbolInfo('add', r.root);
    expect(info).to.exist;
    expect(info!.kind).to.equal('function');
    expect(info!.signature).to.contain('add');
    expect(info!.params).to.deep.equal(['a', 'b']);
    expect(info!.returnType).to.equal('Integer');
  });

  it('gets info for builtin function', () => {
    const info = getSymbolInfo('Len', parse('x = 1').root);
    expect(info).to.exist;
    expect(info!.kind).to.equal('builtin');
    expect(info!.description).to.exist;
    expect(info!.docsUrl).to.exist;
  });

  it('collects references', () => {
    const r = parse('function foo()\n  return 1\nend function\nx = foo()\ny = foo()');
    const info = getSymbolInfo('foo', r.root);
    expect(info!.references.length).to.be.greaterThanOrEqual(2);
  });

  it('returns null for unknown symbol', () => {
    const info = getSymbolInfo('nonexistent', parse('x = 1').root);
    expect(info).to.be.null;
  });

  it('finds a method call (obj.add()) as a reference, not just bare identifiers', () => {
    const r = parse('function add(a, b)\n  return a + b\nend function\nsub main()\n  x = obj.add(1, 2)\nend sub');
    const info = getSymbolInfo('add', r.root);
    expect(info!.references.length).to.equal(1);
  });

  it('does not count an @attr access as a reference', () => {
    const r = parse('function width(n)\n  return n\nend function\nx = node@width');
    const info = getSymbolInfo('width', r.root);
    // node@width is an XML attribute access, not a call to the `width` function.
    expect(info!.references.length).to.equal(0);
  });
});

describe('Position Utilities', () => {
  it('finds token at position', () => {
    const r = parse('x = 42');
    const token = findTokenAtPosition(r.root, 0, 0);
    expect(token).to.exist;
    expect(token!.text).to.equal('x');
  });

  it('finds token in the middle of a line', () => {
    const r = parse('x = 42');
    const token = findTokenAtPosition(r.root, 0, 4);
    expect(token).to.exist;
    expect(token!.text).to.equal('42');
  });

  it('finds node at position', () => {
    const r = parse('x = 42');
    const result = findNodeAtPosition(r.root, 0, 0);
    expect(result).to.exist;
    expect(result!.token?.text).to.equal('x');
  });

  it('getWordAtPosition extracts identifier', () => {
    const result = getWordAtPosition('  myVariable = 42', 5);
    expect(result).to.exist;
    expect(result!.word).to.equal('myVariable');
    expect(result!.start).to.equal(2);
    expect(result!.end).to.equal(12);
  });

  it('getWordAtPosition returns null for non-identifier', () => {
    expect(getWordAtPosition('x = 42', 2)).to.be.null; // on space
  });

  it('escapeRegex escapes special chars', () => {
    expect(escapeRegex('a.b*c')).to.equal('a\\.b\\*c');
  });

  it('findNodeAtPosition resolves a position inside a leading-trivia comment', () => {
    const r = parse('  \' @import foo.brs\nx = 1');
    // Column 5 lands inside "@import" in the tick comment on line 0.
    const result = findNodeAtPosition(r.root, 0, 5);
    expect(result).to.exist;
    expect(result!.trivia).to.exist;
    expect(result!.trivia!.text).to.equal("' @import foo.brs");
  });

  it('findNodeAtPosition resolves a position inside a trailing-trivia comment', () => {
    const r = parse("x = 1 ' trailing note");
    // Column 9 lands inside "trailing" in the same-line comment after `1`.
    const result = findNodeAtPosition(r.root, 0, 9);
    expect(result).to.exist;
    expect(result!.trivia).to.exist;
    expect(result!.trivia!.text).to.equal("' trailing note");
  });

  it('findNodeAtPosition returns no trivia hit outside any comment', () => {
    const r = parse('x = 1');
    const result = findNodeAtPosition(r.root, 0, 0);
    expect(result).to.exist;
    expect(result!.trivia).to.be.undefined;
  });

  it('SyntaxNode exposes line/column of its first token', () => {
    const r = parse('x = 1\ny = 2');
    const secondStmt = r.root.childNodes[1];
    expect(secondStmt.line).to.equal(1);
    expect(secondStmt.column).to.equal(0);
  });
});

describe('Indexed position lookups', () => {
  const src = [
    'function add(a, b)',
    '  ' + "' a helper comment",
    '  return a + b',
    'end function',
  ].join('\n');

  it('findTokenAtPositionIndexed agrees with findTokenAtPosition', () => {
    const r = parse(src);
    const index = buildPositionIndex(r.root);
    // Every token position in the file should agree between both lookups.
    for (const t of index.tokens) {
      const direct = findTokenAtPosition(r.root, t.line, t.column);
      const indexed = findTokenAtPositionIndexed(index, t.line, t.column);
      expect(indexed?.pos, `token "${t.text}" at ${t.line}:${t.column}`).to.equal(direct?.pos);
    }
  });

  it('findNodeAtPositionIndexed returns the same ancestor chain as findNodeAtPosition', () => {
    const r = parse(src);
    const index = buildPositionIndex(r.root);
    // Column of `a + b`'s `a` on line 2 ("  return a + b").
    const line = 2, column = 9;
    const direct = findNodeAtPosition(r.root, line, column);
    const indexed = findNodeAtPositionIndexed(index, line, column);
    expect(indexed).to.exist;
    expect(indexed!.token?.text).to.equal(direct!.token?.text);
    expect(indexed!.ancestors.map(a => a.kind)).to.deep.equal(direct!.ancestors.map(a => a.kind));
  });

  it('findNodeAtPositionIndexed resolves a leading-trivia comment like findNodeAtPosition does', () => {
    const r = parse(src);
    const index = buildPositionIndex(r.root);
    // Column inside "helper" in the comment on line 1.
    const line = 1, column = 6;
    const direct = findNodeAtPosition(r.root, line, column);
    const indexed = findNodeAtPositionIndexed(index, line, column);
    expect(indexed?.trivia?.text).to.equal(direct?.trivia?.text);
    expect(indexed?.trivia?.text).to.equal("' a helper comment");
  });

  it('findNodeAtPositionIndexed returns null off the end of the file', () => {
    const r = parse('x = 1');
    const index = buildPositionIndex(r.root);
    expect(findNodeAtPositionIndexed(index, 99, 0)).to.be.null;
  });

  it('buildSymbolIndex finds a function by name in O(1)', () => {
    const r = parse('function add(a, b)\n  return a + b\nend function\nfunction subtract(a, b)\n  return a - b\nend function');
    const index = buildSymbolIndex(r.root);
    expect(index.functions.has('add')).to.be.true;
    expect(index.functions.has('subtract')).to.be.true;
    expect(index.functions.get('add')?.kind).to.exist;
    expect(index.functions.has('nonexistent')).to.be.false;
  });

  it('buildSymbolIndex finds a nested named function too', () => {
    const r = parse('sub outer()\n  function inner()\n    return 1\n  end function\nend sub');
    const index = buildSymbolIndex(r.root);
    expect(index.functions.has('outer')).to.be.true;
    expect(index.functions.has('inner')).to.be.true;
  });
});

describe('XML Parsing', () => {
  it('extracts script URIs', () => {
    const xml = '<component><script type="text/brightscript" uri="pkg:/components/Foo.brs"/><script type="text/brightscript" uri="Bar.brs"/></component>';
    const uris = parseXmlScriptUris(xml);
    expect(uris).to.deep.equal(['pkg:/components/Foo.brs', 'Bar.brs']);
  });

  it('parses interface fields', () => {
    const xml = '<component><interface><field id="title" type="string"/><field id="count" type="integer"/></interface></component>';
    const iface = parseXmlInterface(xml);
    expect(iface.fields).to.have.length(2);
    expect(iface.fields[0].name).to.equal('title');
    expect(iface.fields[0].type).to.equal('string');
  });

  it('parses interface functions', () => {
    const xml = '<component><interface><function name="doWork"/></interface></component>';
    const iface = parseXmlInterface(xml);
    expect(iface.functions).to.have.length(1);
    expect(iface.functions[0].name).to.equal('doWork');
  });

  it('parses extends attribute', () => {
    expect(parseXmlExtends('<component name="MyScreen" extends="Group">')).to.equal('Group');
    expect(parseXmlExtends('<component name="Foo">')).to.be.null;
  });

  it('parses component name', () => {
    expect(parseXmlComponentName('<component name="MyScreen" extends="Group">')).to.equal('MyScreen');
  });
});

describe('tokenizeXmlInterfaceElements', () => {
  it('tokenizes fields and functions in document order with correct keys', () => {
    const xml = '<component><interface><field id="title" type="string"/><function name="doWork"/></interface></component>';
    const result = tokenizeXmlInterfaceElements(xml)!;
    expect(result).to.not.be.null;
    expect(result.items).to.have.length(2);
    expect(result.items[0].element).to.deep.equal({ kind: 'field', key: 'title', text: '<field id="title" type="string"/>' });
    expect(result.items[1].element).to.deep.equal({ kind: 'function', key: 'doWork', text: '<function name="doWork"/>' });
  });

  it('folds a preceding comment and blank lines into the following element\'s chunk', () => {
    const xml = [
      '<component><interface>',
      '  <!-- the title field -->',
      '  <field id="title" type="string"/>',
      '</interface></component>',
    ].join('\n');
    const result = tokenizeXmlInterfaceElements(xml)!;
    expect(result.items).to.have.length(1);
    expect(result.items[0].chunk).to.equal('\n  <!-- the title field -->\n  <field id="title" type="string"/>');
  });

  it('folds a same-line trailing comment backward into the *preceding* element\'s chunk, not the next one\'s', () => {
    const xml = [
      '<component><interface>',
      '  <field id="title" type="string"/> <!-- trailing comment about title -->',
      '  <field id="count" type="integer"/>',
      '</interface></component>',
    ].join('\n');
    const result = tokenizeXmlInterfaceElements(xml)!;
    expect(result.items).to.have.length(2);
    expect(result.items[0].chunk).to.equal('\n  <field id="title" type="string"/> <!-- trailing comment about title -->');
    expect(result.items[1].chunk).to.equal('\n  <field id="count" type="integer"/>');
  });

  it('captures trailing whitespace/comments after the last element separately', () => {
    const xml = '<component><interface><field id="title" type="string"/>\n  <!-- trailing -->\n</interface></component>';
    const result = tokenizeXmlInterfaceElements(xml)!;
    expect(result.items).to.have.length(1);
    expect(result.trailingText).to.equal('\n  <!-- trailing -->\n');
  });

  it('supports an open/close pair with only whitespace between as an empty element', () => {
    const xml = '<component><interface><field id="title" type="string"></field></interface></component>';
    const result = tokenizeXmlInterfaceElements(xml)!;
    expect(result.items).to.have.length(1);
    expect(result.items[0].element.text).to.equal('<field id="title" type="string"></field>');
  });

  it('returns null when there is no <interface> block', () => {
    expect(tokenizeXmlInterfaceElements('<component name="Foo"></component>')).to.be.null;
  });

  it('returns null when the <interface> block is unterminated', () => {
    expect(tokenizeXmlInterfaceElements('<component><interface><field id="title" type="string"/>')).to.be.null;
  });

  it('returns null when a field is missing its id attribute', () => {
    expect(tokenizeXmlInterfaceElements('<component><interface><field type="string"/></interface></component>')).to.be.null;
  });

  it('returns null when unexpected content (a text node) appears between elements', () => {
    const xml = '<component><interface><field id="title" type="string"/>some text<function name="doWork"/></interface></component>';
    expect(tokenizeXmlInterfaceElements(xml)).to.be.null;
  });

  it('returns innerStart/innerEnd offsets that bound the interface block\'s inner content', () => {
    const xml = '<component><interface><field id="title" type="string"/></interface></component>';
    const result = tokenizeXmlInterfaceElements(xml)!;
    expect(xml.slice(result.innerStart, result.innerEnd)).to.equal('<field id="title" type="string"/>');
  });
});

describe('Catalogs', () => {
  it('finds known component', () => {
    expect(findComponent('roArray')).to.exist;
    expect(findComponent('roUrlTransfer')).to.exist;
    expect(findComponent('roNonExistent')).to.be.undefined;
  });

  it('finds builtin function', () => {
    expect(findBuiltin('len')).to.exist;
    expect(findBuiltin('Len')).to.exist;
    expect(findBuiltin('nonexistent')).to.be.undefined;
  });

  it('infers numeric literal type', () => {
    expect(inferNumericLiteralType('255')).to.equal('Integer');
    expect(inferNumericLiteralType('&HFF')).to.equal('Integer');
    expect(inferNumericLiteralType('2.01')).to.equal('Float');
    expect(inferNumericLiteralType('1.23D-12')).to.equal('Double');
    expect(inferNumericLiteralType('123&')).to.equal('LongInteger');
  });

  it('isNumericLiteral checks validity', () => {
    expect(isNumericLiteral('255')).to.be.true;
    expect(isNumericLiteral('hello')).to.be.false;
  });

  it('glob matching works', () => {
    expect(matchesGlob('/components/Foo.brs', '/components/*.brs')).to.be.true;
    expect(matchesGlob('/components/sub/Foo.brs', '/components/**/*.brs')).to.be.true;
    expect(matchesGlob('/other/Foo.brs', '/components/*.brs')).to.be.false;
  });

  it('casing transforms work', () => {
    expect(applyCasing('myFunc', 'upper-case')).to.equal('MYFUNC');
    expect(applyCasing('myFunc', 'lower-case')).to.equal('myfunc');
    expect(applyCasing('myFunc', 'capitalize')).to.equal('Myfunc');
    expect(applyCasing('myFunc', 'preserve')).to.equal('myFunc');
  });

  it('keyword categories are correct', () => {
    expect(getKeywordCategory('integer')).to.equal('type');
    expect(getKeywordCategory('true')).to.equal('literal');
    expect(getKeywordCategory('and')).to.equal('logicOperator');
    expect(getKeywordCategory('mod')).to.equal('mathOperator');
    expect(getKeywordCategory('if')).to.equal('keyword');
  });

  // ifDateTime shipped with fabricated method names — AsLongMilliseconds,
  // AsLongSeconds, FromLongSeconds, GetISOString, GetLocalDateTime,
  // GetLocalTime and a GetDayOfYear that does not exist at all. Roku's real
  // convention is a trailing `Long` (AsMillisecondsLong) and a `To`/`From`
  // prefix pair (ToISOString). Pin the exact surface against
  // https://developer.roku.com/dev/docs/ifdatetime so it cannot drift back.
  it('ifDateTime matches the documented Roku surface exactly', () => {
    const documented = [
      'Mark', 'ToLocalTime', 'GetTimeZoneOffset',
      'AsSeconds', 'AsSecondsLong', 'FromSeconds', 'FromSecondsLong',
      'ToISOString', 'FromISO8601String',
      'asDateStringLoc', 'asTimeStringLoc', 'AsDateString', 'AsDateStringNoParam',
      'AsMillisecondsLong',
      'GetWeekday', 'GetYear', 'GetMonth', 'GetDayOfMonth', 'GetHours',
      'GetMinutes', 'GetSeconds', 'GetMilliseconds', 'GetLastDayOfMonth', 'GetDayOfWeek',
    ].map((n) => n.toLowerCase()).sort();

    const actual = getComponentMethods('roDateTime').map((m) => m.name.toLowerCase()).sort();
    expect(actual).to.deep.equal(documented);
  });

  // A full sweep of all 80 interfaces against the live Roku docs (2026-07-28)
  // removed 51 fabricated or misfiled methods across 21 interfaces. These are
  // the names that were invented — none appears on any Roku page. They read as
  // plausible, which is exactly why they survived: a wrong completion is worse
  // than a missing one because the user trusts it.
  it('rejects the fabricated method names found in the catalog audit', () => {
    const fabricated: [string, string][] = [
      ['roAppInfo', 'GetSubtitle'],
      ['roAssociativeArray', 'Values'],
      ['roAudioPlayer', 'GetPlayheadPosition'],
      ['roChannelStore', 'GetPurchaseList'],
      ['roDeviceInfo', 'GetFirmwareVersion'],
      ['roDeviceInfo', 'GetMemoryLevel'],
      ['roDeviceInfo', 'GetHDMIStatus'],
      ['roFileSystem', 'MoveFile'],
      ['roFileSystem', 'GetFreeSpace'],
      ['roPath', 'GetExtension'],
      ['roPath', 'GetFilename'],
      ['roString', 'ToUpper'],
      ['roString', 'ToLower'],
      ['roString', 'InstrRev'],
      ['roXMLElement', 'GetChildByName'],
      ['roXMLElement', 'AddChild'],
    ];
    for (const [component, method] of fabricated) {
      const found = getComponentMethods(component).some((m) => m.name.toLowerCase() === method.toLowerCase());
      expect(found, `${component}.${method} is not a real Roku method`).to.be.false;
    }
  });

  // Removing a method from the interface that wrongly owned it must not remove
  // it from the component, which reaches it through the correct interface.
  it('keeps methods reachable through the interface that really declares them', () => {
    const reachable: [string, string][] = [
      ['roString', 'IsEmpty'],        // ifString, not ifStringOps
      ['roString', 'ToStr'],          // ifToStr, not ifString
      ['roXMLList', 'Count'],         // ifArray, not ifXMLList
      ['roList', 'IsEmpty'],          // ifEnum, not ifList
      ['roUrlTransfer', 'AddHeader'], // ifHttpAgent, not ifUrlTransfer
      ['roUrlTransfer', 'EnableCookies'],
      ['roUrlTransfer', 'SetCertificatesFile'],
    ];
    for (const [component, method] of reachable) {
      const found = getComponentMethods(component).some((m) => m.name.toLowerCase() === method.toLowerCase());
      expect(found, `${component}.${method} should still be offered`).to.be.true;
    }
  });

  // Follow-up to the sweep above: two pre-existing tests elsewhere in the repo
  // (test/brightscript/components.test.ts, test/providers/completionProvider.test.ts)
  // asserted GetResponseCode was a method of roUrlTransfer. It is real, but
  // belongs to roUrlEvent -- the object an async request delivers via the
  // message port on completion, which the catalog never modeled at all until
  // this fix. Confirmed by fetching the roUrlEvent component page directly.
  it('does not put roUrlEvent response methods on roUrlTransfer, and adds roUrlEvent', () => {
    const transferNames = getComponentMethods('roUrlTransfer').map((m) => m.name.toLowerCase());
    for (const wrong of ['GetResponseCode', 'GetResponseHeaders', 'GetResponseHeadersArray']) {
      expect(transferNames, `roUrlTransfer should not offer ${wrong}`).to.not.include(wrong.toLowerCase());
    }

    const eventNames = getComponentMethods('roUrlEvent').map((m) => m.name);
    expect(eventNames).to.include.members([
      'GetInt', 'GetResponseCode', 'GetFailureReason', 'GetString',
      'GetSourceIdentity', 'GetResponseHeaders', 'GetTargetIpAddress', 'GetResponseHeadersArray',
    ]);
  });

  it('ifDateTime exposes millisecond and second epoch getters as LongInteger', () => {
    const byName = new Map(getComponentMethods('roDateTime').map((m) => [m.name.toLowerCase(), m]));

    // The bug that started this: completion offered `AsLongMilliseconds`.
    expect(byName.has('aslongmilliseconds'), 'AsLongMilliseconds is not a real method').to.be.false;
    expect(byName.has('aslongseconds'), 'AsLongSeconds is not a real method').to.be.false;
    expect(byName.has('getisostring'), 'GetISOString is not a real method').to.be.false;

    expect(byName.get('asmillisecondslong')?.returnType).to.equal('LongInteger');
    expect(byName.get('assecondslong')?.returnType).to.equal('LongInteger');
    expect(byName.get('fromiso8601string')?.returnType).to.equal('Void');
  });
});

describe('Type Designator Variables', () => {
  it('a$ and a are different variables', () => {
    const r = parse('function foo()\n  a$ = "hello"\n  a = 42\nend function');
    const { buildScopes, resolve } = require('../src/index.js');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(fnScope.declarations.has('a$')).to.be.true;
    expect(fnScope.declarations.has('a')).to.be.true;
    expect(resolve('a$', fnScope)?.name).to.equal('a$');
    expect(resolve('a', fnScope)?.name).to.equal('a');
  });

  it('using a when only a& defined is undefined', () => {
    const r = parse('function foo()\n  a& = 123\n  print a\nend function');
    const { buildScopes, resolve } = require('../src/index.js');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(resolve('a&', fnScope)).to.exist;
    expect(resolve('a', fnScope)).to.be.undefined;
  });

  it('all designators create separate variables', () => {
    const r = parse('function foo()\n  x = 1\n  x$ = "s"\n  x% = 2\n  x! = 3.0\n  x# = 4.0\n  x& = 5\nend function');
    const { buildScopes } = require('../src/index.js');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(fnScope.declarations.size).to.equal(6);
  });
});

describe('Reference.isWrite', () => {
  const { buildScopes } = require('../src/index.js');

  function refsFor(name: string, src: string) {
    const scope = buildScopes(require('../src/index.js').parse(src).root);
    const fnScope = scope.children[0];
    return fnScope.references.filter((r: any) => r.nameLower === name.toLowerCase());
  }

  it('marks plain = assignment LHS as isWrite=true', () => {
    const refs = refsFor('x', 'function f()\n  x = 1\nend function');
    expect(refs.length).to.equal(1);
    expect(refs[0].isWrite).to.be.true;
  });

  it('marks read reference as isWrite=false', () => {
    const refs = refsFor('x', 'function f()\n  x = 1\n  print x\nend function');
    const readRef = refs.find((r: any) => !r.isWrite);
    expect(readRef).to.exist;
    expect(readRef!.isWrite).to.be.false;
  });

  it('marks compound += assignment LHS as isWrite=false (read-write)', () => {
    const refs = refsFor('x', 'function f()\n  x = 0\n  x += 1\nend function');
    const compoundRef = refs.find((r: any) => r.line === 2);
    expect(compoundRef).to.exist;
    expect(compoundRef!.isWrite).to.be.false;
  });

  it('does not mark non-identifier LHS (index access) as a write', () => {
    const refs = refsFor('arr', 'function f()\n  arr = []\n  arr[0] = 1\nend function');
    // arr in arr[0]=1 is a read (we read arr to get the array object)
    const readRef = refs.find((r: any) => r.line === 2);
    expect(readRef!.isWrite).to.be.false;
  });

  it('second plain = assignment to same variable is also isWrite=true', () => {
    const refs = refsFor('x', 'function f()\n  x = 1\n  x = 2\nend function');
    expect(refs.every((r: any) => r.isWrite)).to.be.true;
    expect(refs.length).to.equal(2);
  });

  it('= used as comparison operator (BinaryExpression) is isWrite=false', () => {
    // "if x = 1" — = is a comparison here, not assignment
    const refs = refsFor('x', 'function f()\n  x = 0\n  if x = 1 then print x\n  end if\nend function');
    const comparisonRef = refs.find((r: any) => r.line === 2 && !r.isWrite);
    expect(comparisonRef).to.exist;
    expect(comparisonRef!.isWrite).to.be.false;
  });

  it('for-each iterator has isWrite=true reference at the for-each line', () => {
    const refs = refsFor('item', 'function f()\n  for each item in items\n    print item\n  end for\nend function');
    const writeRef = refs.find((r: any) => r.isWrite);
    expect(writeRef).to.exist;
    expect(writeRef!.line).to.equal(1); // line of "for each item in items"
  });

  it('for counter has isWrite=true reference at the for line', () => {
    const refs = refsFor('i', 'function f()\n  for i = 0 to 10\n    print i\n  end for\nend function');
    const writeRef = refs.find((r: any) => r.isWrite);
    expect(writeRef).to.exist;
    expect(writeRef!.line).to.equal(1);
  });

  it('re-used for-each iterator in second loop produces a second isWrite=true reference', () => {
    const src = 'function f()\n  for each item in a\n  end for\n  for each item in b\n    print item\n  end for\nend function';
    const refs = refsFor('item', src);
    const writeRefs = refs.filter((r: any) => r.isWrite);
    expect(writeRefs.length).to.equal(2); // one per for-each
    expect(writeRefs[0].line).to.equal(1); // first for-each
    expect(writeRefs[1].line).to.equal(3); // second for-each
  });
});

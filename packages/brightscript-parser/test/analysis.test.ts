import { expect } from 'chai';
import {
  parse, inferTypesFromAst, getVariableType,
  buildCallGraph, analyzeContext, getSymbolInfo,
  findNodeAtPosition, findTokenAtPosition, getWordAtPosition, escapeRegex,
  parseXmlScriptUris, parseXmlInterface, parseXmlExtends, parseXmlComponentName,
  findComponent, findBuiltin, matchesGlob, findMatchingGlob,
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
});

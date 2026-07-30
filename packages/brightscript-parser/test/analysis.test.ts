import { expect } from 'chai';
import {
  parse, inferTypesFromAst, getVariableType,
  buildCallGraph, analyzeContext, getSymbolInfo,
  findNodeAtPosition, findTokenAtPosition, getWordAtPosition, escapeRegex,
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

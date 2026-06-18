import { expect } from 'chai';
import { parse } from 'kopytko-brightscript-parser';
import { lintFile, DEFAULT_LINTER_CONFIG } from '../src/index';
import { createMockContext } from './helpers';
import type { LinterConfig } from '../src/config';

describe('linter — lintFile', () => {
  it('returns no diagnostics for an empty file', () => {
    const context = createMockContext();
    const diags = lintFile('/project/src/empty.brs', '', context, DEFAULT_LINTER_CONFIG);
    expect(diags).to.be.an('array').that.is.empty;
  });

  it('returns no diagnostics for a clean file', () => {
    const content = [
      'function sayHello(name as String) as Void',
      '  print "Hello " + name',
      'end function',
    ].join('\n');

    const context = createMockContext();
    const diags = lintFile('/project/src/hello.brs', content, context, DEFAULT_LINTER_CONFIG);
    expect(diags).to.be.an('array').that.is.empty;
  });

  it('returns multiple diagnostics for a file with several issues', () => {
    const content = [
      "' @import utils/Relative.brs",
      'function doWork(unused)',
      '  throw 42',
      '  obj = CreateObject("roFakeComponent")',
      '  return result,',
      'end function',
    ].join('\n');

    const context = createMockContext();
    const diags = lintFile('/project/src/messy.brs', content, context, DEFAULT_LINTER_CONFIG);

    const codes = diags.map(d => d.code);
    expect(codes).to.include('import/path-not-absolute');
    expect(codes).to.include('throw/invalid-value');
    expect(codes).to.include('createobject/unknown-component');
    expect(codes).to.include('syntax/trailing-comma');
    expect(codes).to.include('identifier/unused-parameter');
  });

  it('uses a supplied preParseResult instead of re-parsing the content', () => {
    const messy = [
      "' @import utils/Relative.brs",            // import/path-not-absolute — import-based
      'sub doWork()',
      '  obj = CreateObject("roFakeComponent")', // createobject/unknown-component — AST-based
      'end sub',
    ].join('\n');

    // A clean CST from unrelated source. If lintFile honours preParseResult, the
    // AST-based rules walk THIS tree (no bad CreateObject) and stay silent, while
    // the import rule still inspects the messy content's @import lines.
    const cleanParse = parse('sub clean()\nend sub');

    const diags = lintFile('/project/src/mixed.brs', messy, createMockContext(), DEFAULT_LINTER_CONFIG, undefined, cleanParse);
    const codes = diags.map(d => d.code);

    expect(codes).to.not.include('createobject/unknown-component'); // AST rule used the supplied parse
    expect(codes).to.include('import/path-not-absolute');           // import rule used the messy content
  });

  it('produces the same diagnostics with or without a matching preParseResult', () => {
    const content = [
      "' @import utils/Relative.brs",
      'sub doWork()',
      '  obj = CreateObject("roFakeComponent")',
      'end sub',
    ].join('\n');

    const without = lintFile('/project/src/same.brs', content, createMockContext(), DEFAULT_LINTER_CONFIG);
    const withParse = lintFile('/project/src/same.brs', content, createMockContext(), DEFAULT_LINTER_CONFIG, undefined, parse(content));

    expect(withParse.map(d => d.code).sort()).to.deep.equal(without.map(d => d.code).sort());
  });

  it('excludes diagnostics for disabled rules', () => {
    const content = [
      "' @import utils/Relative.brs",
      'function doWork()',
      '  throw 42',
      'end function',
    ].join('\n');

    const config: LinterConfig = {
      ...DEFAULT_LINTER_CONFIG,
      rules: {
        ...DEFAULT_LINTER_CONFIG.rules,
        'import/path-not-absolute': 'off',
        'throw/invalid-value': 'off',
      },
    };

    const context = createMockContext();
    const diags = lintFile('/project/src/partial.brs', content, context, config);

    const codes = diags.map(d => d.code);
    expect(codes).not.to.include('import/path-not-absolute');
    expect(codes).not.to.include('throw/invalid-value');
  });

  it('returns diagnostics with correct file path', () => {
    const content = [
      'function doWork()',
      '  throw 42',
      'end function',
    ].join('\n');

    const context = createMockContext();
    const diags = lintFile('/project/src/myfile.brs', content, context, DEFAULT_LINTER_CONFIG);

    for (const d of diags) {
      expect(d.filePath).to.equal('/project/src/myfile.brs');
    }
  });

  it('handles test file structure checks through lintFile', () => {
    const content = [
      'function TestSuite__MyComponent()',
      '  ts = {}',
      'end function',
    ].join('\n');

    const context = createMockContext({
      isTestFile: () => true,
    });

    const diags = lintFile('/project/src/MyComponent.test.brs', content, context, DEFAULT_LINTER_CONFIG);
    const testDiags = diags.filter(d => d.code === 'test/missing-return-ts');
    expect(testDiags).to.have.lengthOf(1);
  });

  it('each diagnostic has required fields', () => {
    const content = [
      "' @import utils/Relative.brs",
      'function doWork()',
      '  throw 42',
      'end function',
    ].join('\n');

    const context = createMockContext();
    const diags = lintFile('/project/src/check.brs', content, context, DEFAULT_LINTER_CONFIG);

    expect(diags.length).to.be.greaterThan(0);
    for (const d of diags) {
      expect(d).to.have.property('code').that.is.a('string');
      expect(d).to.have.property('message').that.is.a('string');
      expect(d).to.have.property('severity').that.is.a('string');
      expect(d).to.have.property('line').that.is.a('number');
      expect(d).to.have.property('column').that.is.a('number');
      expect(d).to.have.property('filePath').that.is.a('string');
    }
  });

  it('does not flag functions from @mock implementation files as undefined', () => {
    // Simulates a test file calling a function defined in _mocks/*.mock.brs
    // (e.g. TotalRekallService() from _mocks/TotalRekallService.mock.brs)
    // The context builder (buildKnownFunctions) adds these to knownFuncNames
    const content = [
      "' @mock /components/Bar.brs",
      'function TestSuite__Foo()',
      '  myBar = Bar()',
      '  return ts',
      'end function',
    ].join('\n');

    const context = createMockContext({
      isTestFile: () => true,
      knownFuncNames: new Set(['bar', 'testsuite__foo']),
    });

    const diags = lintFile('/project/src/_tests/Foo.test.brs', content, context, DEFAULT_LINTER_CONFIG);
    const undef = diags.filter(d => d.code === 'identifier/undefined-function');
    expect(undef).to.be.empty;
  });
});
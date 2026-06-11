import { expect } from 'chai';
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
      'function sayHello(name)',
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
});

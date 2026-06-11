import { expect } from 'chai';
import { checkTestFileStructure } from '../../src/rules/testRules';
import { createRuleContext } from '../helpers';
import { DEFAULT_RULE_CONFIG } from '../../src/config';

describe('testRules — checkTestFileStructure', () => {
  it('returns no diagnostics for a non-test file', () => {
    const content = [
      'function doWork()',
      '  print "hello"',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      filePath: '/project/src/Component.brs',
    });

    const diags = checkTestFileStructure(ctx);
    expect(diags).to.be.empty;
  });

  it('returns no diagnostics for a valid test file with TestSuite__ and return ts', () => {
    const content = [
      'function TestSuite__MyComponent()',
      '  ts = {}',
      '  ts.name = "MyComponent"',
      '  return ts',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      filePath: '/project/src/MyComponent.test.brs',
    });

    const diags = checkTestFileStructure(ctx);
    expect(diags.filter(d => d.code === 'test/missing-return-ts')).to.be.empty;
  });

  it('reports test/missing-return-ts for TestSuite__ without return ts', () => {
    const content = [
      'function TestSuite__MyComponent()',
      '  ts = {}',
      '  ts.name = "MyComponent"',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      filePath: '/project/src/MyComponent.test.brs',
    });

    const diags = checkTestFileStructure(ctx);
    const missing = diags.filter(d => d.code === 'test/missing-return-ts');
    expect(missing).to.have.lengthOf(1);
    expect(missing[0].severity).to.equal('warning');
    expect(missing[0].message).to.include('return ts');
  });

  it('reports test/missing-mock-annotation for mockFunction targeting unknown function', () => {
    const mockFileContent = [
      'function helperFunc()',
      '  return 1',
      'end function',
    ].join('\n');

    const content = [
      "' @mock /utils/Helper.brs",
      'function TestSuite__MyComponent()',
      '  ts = {}',
      '  mockFunction("unknownFunc")',
      '  return ts',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      filePath: '/project/src/MyComponent.test.brs',
      lintContextOverrides: {
        isTestFile: () => true,
        resolveImportPath: (path: string) => {
          if (path === '/utils/Helper.brs') return '/project/src/utils/Helper.brs';
          return null;
        },
        readFile: (path: string) => {
          if (path === '/project/src/utils/Helper.brs') return mockFileContent;
          return null;
        },
      },
    });

    const diags = checkTestFileStructure(ctx);
    const mockAnnotation = diags.filter(d => d.code === 'test/missing-mock-annotation');
    expect(mockAnnotation).to.have.lengthOf(1);
    expect(mockAnnotation[0].severity).to.equal('warning');
    expect(mockAnnotation[0].message).to.include('unknownFunc');
  });

  it('does not report test/missing-mock-annotation for mockFunction targeting known function', () => {
    const mockFileContent = [
      'function helperFunc()',
      '  return 1',
      'end function',
    ].join('\n');

    const content = [
      "' @mock /utils/Helper.brs",
      'function TestSuite__MyComponent()',
      '  ts = {}',
      '  mockFunction("helperFunc")',
      '  return ts',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      filePath: '/project/src/MyComponent.test.brs',
      lintContextOverrides: {
        isTestFile: () => true,
        resolveImportPath: (path: string) => {
          if (path === '/utils/Helper.brs') return '/project/src/utils/Helper.brs';
          return null;
        },
        readFile: (path: string) => {
          if (path === '/project/src/utils/Helper.brs') return mockFileContent;
          return null;
        },
      },
    });

    const diags = checkTestFileStructure(ctx);
    const mockAnnotation = diags.filter(d => d.code === 'test/missing-mock-annotation');
    expect(mockAnnotation).to.be.empty;
  });

  it('does not report when both test rules are turned off', () => {
    const content = [
      'function TestSuite__MyComponent()',
      '  ts = {}',
      'end function',
    ].join('\n');

    const config = {
      ...DEFAULT_RULE_CONFIG,
      'test/missing-mock-annotation': 'off' as const,
      'test/missing-return-ts': 'off' as const,
    };

    const ctx = createRuleContext(content, {
      filePath: '/project/src/MyComponent.test.brs',
      config,
    });

    const diags = checkTestFileStructure(ctx);
    expect(diags).to.be.empty;
  });

  it('does not report missing-return-ts when there is no TestSuite__ function', () => {
    const content = [
      'function helper()',
      '  return 1',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      filePath: '/project/src/helper.test.brs',
    });

    const diags = checkTestFileStructure(ctx);
    expect(diags.filter(d => d.code === 'test/missing-return-ts')).to.be.empty;
  });
});

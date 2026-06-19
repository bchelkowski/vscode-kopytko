import { expect } from 'chai';
import {
  checkCreateObjectArgsAst,
  checkThrowStatementsAst,
  checkLoopFlowControlAst,
  checkMissingTypeAnnotationsAst,
  checkTrailingCommaAst,
  checkShadowedBuiltinsAst,
  checkShadowedFunctionsAst,
  checkUnusedParametersAst,
  checkUnusedVariablesAst,
  checkWrongArgCountAst,
  checkUndefinedCallsAst,
  checkUndefinedVariablesAst,
  checkObserverCallbacksAst,
  checkTestFileStructureAst,
  checkImportsAst,
  checkDeadFunctionsAst,
} from '../../src/rules/astRules';
import type { RuleContext, LintDiagnostic } from '../../src/types';
import type { LintContext } from '../../src/context';

// We need to require parse from the installed package
const { parse } = require('kopytko-brightscript-parser');

/** Builds a minimal RuleContext from source code. */
function makeCtx(source: string, configOverrides: Record<string, string> = {}): RuleContext {
  const lines = source.split(/\r?\n/);
  const parseResult = parse(source);
  const defaultConfig: Record<string, string> = {
    'createobject/unknown-component': 'warning',
    'throw/invalid-value': 'warning',
    'throw/missing-message': 'warning',
    'syntax/flow-outside-loop': 'error',
    'syntax/trailing-comma': 'error',
    'type/missing-return-type': 'warning',
    'type/missing-param-type': 'warning',
    ...configOverrides,
  };
  return {
    filePath: '/test/file.brs',
    lines,
    imports: [],
    config: defaultConfig,
    lintContext: { knownFuncNames: new Set() } as unknown as LintContext,
    parseResult,
  };
}

function codes(diagnostics: LintDiagnostic[]): string[] {
  return diagnostics.map(d => d.code);
}

describe('AST-based lint rules', () => {
  describe('checkCreateObjectArgsAst', () => {
    it('reports unknown component', () => {
      const ctx = makeCtx('x = CreateObject("roFakeComponent")');
      const diags = checkCreateObjectArgsAst(ctx);
      expect(codes(diags)).to.include('createobject/unknown-component');
    });

    it('does not report known component', () => {
      const ctx = makeCtx('x = CreateObject("roArray", 5, true)');
      const diags = checkCreateObjectArgsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('ignores roSGNode', () => {
      const ctx = makeCtx('x = CreateObject("roSGNode", "ContentNode")');
      const diags = checkCreateObjectArgsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('does not match CreateObject inside strings', () => {
      const ctx = makeCtx('x = "CreateObject(""roFake"")"');
      const diags = checkCreateObjectArgsAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkThrowStatementsAst', () => {
    it('reports numeric throw value', () => {
      const ctx = makeCtx('throw 42');
      const diags = checkThrowStatementsAst(ctx);
      expect(codes(diags)).to.include('throw/invalid-value');
    });

    it('reports array throw value', () => {
      const ctx = makeCtx('throw [1, 2]');
      const diags = checkThrowStatementsAst(ctx);
      expect(codes(diags)).to.include('throw/invalid-value');
    });

    it('reports AA without message', () => {
      const ctx = makeCtx('throw { number: -1 }');
      const diags = checkThrowStatementsAst(ctx);
      expect(codes(diags)).to.include('throw/missing-message');
    });

    it('allows string throw', () => {
      const ctx = makeCtx('throw "error message"');
      const diags = checkThrowStatementsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('allows AA with message', () => {
      const ctx = makeCtx('throw { message: "error", number: -1 }');
      const diags = checkThrowStatementsAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkLoopFlowControlAst', () => {
    it('reports exit for outside for loop', () => {
      const ctx = makeCtx('function foo()\n  exit for\nend function');
      const diags = checkLoopFlowControlAst(ctx);
      expect(codes(diags)).to.include('syntax/flow-outside-loop');
    });

    it('reports exit while outside while loop', () => {
      const ctx = makeCtx('function foo()\n  exit while\nend function');
      const diags = checkLoopFlowControlAst(ctx);
      expect(codes(diags)).to.include('syntax/flow-outside-loop');
    });

    it('reports continue for outside for loop', () => {
      const ctx = makeCtx('function foo()\n  continue for\nend function');
      const diags = checkLoopFlowControlAst(ctx);
      expect(codes(diags)).to.include('syntax/flow-outside-loop');
    });

    it('allows exit for inside for loop', () => {
      const ctx = makeCtx('function foo()\n  for i = 1 to 10\n    exit for\n  end for\nend function');
      const diags = checkLoopFlowControlAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('allows exit while inside while loop', () => {
      const ctx = makeCtx('function foo()\n  while true\n    exit while\n  end while\nend function');
      const diags = checkLoopFlowControlAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('allows continue for inside for each', () => {
      const ctx = makeCtx('function foo()\n  for each item in list\n    continue for\n  end for\nend function');
      const diags = checkLoopFlowControlAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('reports exit for inside nested function (scope boundary)', () => {
      const ctx = makeCtx('function foo()\n  for i = 1 to 10\n    cb = function()\n      exit for\n    end function\n  end for\nend function');
      const diags = checkLoopFlowControlAst(ctx);
      expect(codes(diags)).to.include('syntax/flow-outside-loop');
    });
  });

  describe('checkMissingTypeAnnotationsAst', () => {
    it('reports missing return type on function', () => {
      const ctx = makeCtx('function foo()\n  return 1\nend function');
      const diags = checkMissingTypeAnnotationsAst(ctx);
      expect(codes(diags)).to.include('type/missing-return-type');
    });

    it('does not report return type on sub', () => {
      const ctx = makeCtx('sub foo()\nend sub');
      const diags = checkMissingTypeAnnotationsAst(ctx);
      expect(codes(diags)).not.to.include('type/missing-return-type');
    });

    it('allows function with return type', () => {
      const ctx = makeCtx('function foo() as Integer\n  return 1\nend function');
      const diags = checkMissingTypeAnnotationsAst(ctx);
      expect(codes(diags)).not.to.include('type/missing-return-type');
    });

    it('reports missing param type', () => {
      const ctx = makeCtx('function foo(a, b)\n  return a + b\nend function');
      const diags = checkMissingTypeAnnotationsAst(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.have.length(2);
    });

    it('allows param with type annotation', () => {
      const ctx = makeCtx('function foo(a as Integer, b as Integer) as Integer\n  return a + b\nend function');
      const diags = checkMissingTypeAnnotationsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('checks anonymous function params', () => {
      const ctx = makeCtx('cb = function(x)\n  return x\nend function');
      const diags = checkMissingTypeAnnotationsAst(ctx);
      expect(codes(diags)).to.include('type/missing-param-type');
    });

    it('respects off config', () => {
      const ctx = makeCtx('function foo(a)\n  return a\nend function', {
        'type/missing-return-type': 'off',
        'type/missing-param-type': 'off',
      });
      const diags = checkMissingTypeAnnotationsAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkTrailingCommaAst', () => {
    it('allows return without trailing comma', () => {
      const ctx = makeCtx('function foo()\n  return 1\nend function');
      const diags = checkTrailingCommaAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('skips files with parse errors (trailing comma causes parse error)', () => {
      // The parser itself reports an error for `return 1,` — the AST rule
      // correctly skips files with parse errors. The regex-based rule handles this case.
      const ctx = makeCtx('function foo()\n  return 1,\nend function');
      const diags = checkTrailingCommaAst(ctx);
      expect(diags).to.have.length(0); // skipped due to parse errors
    });
  });

  describe('checkShadowedBuiltinsAst', () => {
    it('reports parameter shadowing builtin', () => {
      const ctx = makeCtx('function foo(len)\n  return len\nend function', { 'identifier/shadows-builtin': 'error' });
      const diags = checkShadowedBuiltinsAst(ctx);
      expect(codes(diags)).to.include('identifier/shadows-builtin');
    });

    it('reports variable shadowing builtin', () => {
      const ctx = makeCtx('function foo()\n  len = 5\nend function', { 'identifier/shadows-builtin': 'error' });
      const diags = checkShadowedBuiltinsAst(ctx);
      expect(codes(diags)).to.include('identifier/shadows-builtin');
    });

    it('does not report function declarations', () => {
      const ctx = makeCtx('function myFunc()\nend function', { 'identifier/shadows-builtin': 'error' });
      const diags = checkShadowedBuiltinsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('does not report non-builtin names', () => {
      const ctx = makeCtx('function foo(myParam)\n  return myParam\nend function', { 'identifier/shadows-builtin': 'error' });
      const diags = checkShadowedBuiltinsAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkShadowedFunctionsAst', () => {
    function makeCtxWithKnown(source: string, knownFuncNames: Set<string>, configOverrides: Record<string, string> = {}): RuleContext {
      return { ...makeCtx(source, configOverrides), lintContext: { knownFuncNames } as unknown as LintContext };
    }

    it('reports parameter that shadows a local function', () => {
      const src = [
        'function myHelper() as Integer',
        '  return 1',
        'end function',
        '',
        'function foo(myHelper as Integer) as Integer',
        '  return myHelper',
        'end function',
      ].join('\n');
      const ctx = makeCtx(src, { 'identifier/shadows-function': 'error' });
      const diags = checkShadowedFunctionsAst(ctx);
      expect(codes(diags)).to.include('identifier/shadows-function');
      expect(diags[0].message).to.contain('myHelper');
    });

    it('reports variable that shadows a local function', () => {
      const src = [
        'function myHelper() as Integer',
        '  return 1',
        'end function',
        '',
        'function foo()',
        '  myHelper = 42',
        'end function',
      ].join('\n');
      const ctx = makeCtx(src, { 'identifier/shadows-function': 'error' });
      const diags = checkShadowedFunctionsAst(ctx);
      expect(codes(diags)).to.include('identifier/shadows-function');
    });

    it('reports parameter that shadows an imported function', () => {
      const src = 'function foo(importedHelper as Integer) as Integer\n  return importedHelper\nend function';
      const ctx = makeCtxWithKnown(src, new Set(['importedhelper']), { 'identifier/shadows-function': 'error' });
      const diags = checkShadowedFunctionsAst(ctx);
      expect(codes(diags)).to.include('identifier/shadows-function');
    });

    it('reports variable that shadows an imported function', () => {
      const src = 'function foo()\n  importedHelper = 42\nend function';
      const ctx = makeCtxWithKnown(src, new Set(['importedhelper']), { 'identifier/shadows-function': 'error' });
      const diags = checkShadowedFunctionsAst(ctx);
      expect(codes(diags)).to.include('identifier/shadows-function');
    });

    it('does not flag function declarations themselves', () => {
      const src = 'function myHelper()\n  return 1\nend function';
      const ctx = makeCtx(src, { 'identifier/shadows-function': 'error' });
      const diags = checkShadowedFunctionsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('does not flag unrelated names', () => {
      const src = [
        'function myHelper() as Integer',
        '  return 1',
        'end function',
        '',
        'function foo(otherParam as Integer) as Integer',
        '  return otherParam',
        'end function',
      ].join('\n');
      const ctx = makeCtx(src, { 'identifier/shadows-function': 'error' });
      const diags = checkShadowedFunctionsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('respects off config', () => {
      const src = [
        'function myHelper() as Integer',
        '  return 1',
        'end function',
        '',
        'function foo(myHelper as Integer) as Integer',
        '  return myHelper',
        'end function',
      ].join('\n');
      const ctx = makeCtx(src, { 'identifier/shadows-function': 'off' });
      const diags = checkShadowedFunctionsAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkUnusedParametersAst', () => {
    it('reports unused parameter', () => {
      const ctx = makeCtx('function foo(a, b)\n  return a\nend function', { 'identifier/unused-parameter': 'hint' });
      const diags = checkUnusedParametersAst(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-parameter');
      expect(unused).to.have.length(1);
      expect(unused[0].message).to.contain('b');
    });

    it('does not report used parameters', () => {
      const ctx = makeCtx('function foo(a, b)\n  return a + b\nend function', { 'identifier/unused-parameter': 'hint' });
      const diags = checkUnusedParametersAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('skips parameters prefixed with _', () => {
      const ctx = makeCtx('function foo(_unused)\n  return 1\nend function', { 'identifier/unused-parameter': 'hint' });
      const diags = checkUnusedParametersAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('checks anonymous function params', () => {
      const ctx = makeCtx('cb = function(x, y)\n  return x\nend function', { 'identifier/unused-parameter': 'hint' });
      const diags = checkUnusedParametersAst(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-parameter');
      expect(unused).to.have.length(1);
      expect(unused[0].message).to.contain('y');
    });
  });

  describe('checkUnusedVariablesAst', () => {
    it('reports unused variable', () => {
      const ctx = makeCtx('function foo()\n  x = 1\n  return 2\nend function', { 'identifier/unused-variable': 'warning' });
      const diags = checkUnusedVariablesAst(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.length(1);
      expect(unused[0].message).to.contain('x');
    });

    it('does not report used variables', () => {
      const ctx = makeCtx('function foo()\n  x = 1\n  return x\nend function', { 'identifier/unused-variable': 'warning' });
      const diags = checkUnusedVariablesAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('skips variables prefixed with _', () => {
      const ctx = makeCtx('function foo()\n  _temp = 1\nend function', { 'identifier/unused-variable': 'warning' });
      const diags = checkUnusedVariablesAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('reports unused for variable', () => {
      const ctx = makeCtx('function foo()\n  for i = 1 to 10\n  end for\nend function', { 'identifier/unused-variable': 'warning' });
      const diags = checkUnusedVariablesAst(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.length(1);
      expect(unused[0].message).to.contain('i');
    });
  });

  describe('checkWrongArgCountAst', () => {
    it('reports too few arguments to builtin', () => {
      const ctx = makeCtx('x = Len()', { 'identifier/wrong-arg-count': 'error' });
      const diags = checkWrongArgCountAst(ctx);
      expect(codes(diags)).to.include('identifier/wrong-arg-count');
    });

    it('does not report correct arg count', () => {
      const ctx = makeCtx('x = Len("hello")', { 'identifier/wrong-arg-count': 'error' });
      const diags = checkWrongArgCountAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('does not report non-builtin calls', () => {
      const ctx = makeCtx('x = myFunc()', { 'identifier/wrong-arg-count': 'error' });
      const diags = checkWrongArgCountAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkUndefinedCallsAst', () => {
    it('reports call to undefined function', () => {
      const ctx = makeCtx('x = unknownFunc()', { 'identifier/undefined-function': 'error' });
      const diags = checkUndefinedCallsAst(ctx);
      expect(codes(diags)).to.include('identifier/undefined-function');
    });

    it('does not report builtin calls', () => {
      const ctx = makeCtx('x = Len("hello")', { 'identifier/undefined-function': 'error' });
      const diags = checkUndefinedCallsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('does not report calls to known functions', () => {
      const ctx = makeCtx('x = myKnownFunc()');
      ctx.lintContext = { knownFuncNames: new Set(['myknownfunc']) } as unknown as LintContext;
      (ctx.config as Record<string, string>)['identifier/undefined-function'] = 'error';
      const diags = checkUndefinedCallsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('does not report calls inside strings', () => {
      const ctx = makeCtx('x = "unknownFunc()"', { 'identifier/undefined-function': 'error' });
      const diags = checkUndefinedCallsAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkUndefinedVariablesAst', () => {
    it('reports undefined variable', () => {
      const ctx = makeCtx('function foo()\n  return undefinedVar\nend function', { 'identifier/undefined-variable': 'error' });
      const diags = checkUndefinedVariablesAst(ctx);
      expect(codes(diags)).to.include('identifier/undefined-variable');
    });

    it('does not report declared variables', () => {
      const ctx = makeCtx('function foo()\n  x = 1\n  return x\nend function', { 'identifier/undefined-variable': 'error' });
      const diags = checkUndefinedVariablesAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('does not report parameters', () => {
      const ctx = makeCtx('function foo(a)\n  return a\nend function', { 'identifier/undefined-variable': 'error' });
      const diags = checkUndefinedVariablesAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('does not report m', () => {
      const ctx = makeCtx('function foo()\n  return m\nend function', { 'identifier/undefined-variable': 'error' });
      const diags = checkUndefinedVariablesAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkObserverCallbacksAst', () => {
    it('reports undefined observer callback', () => {
      const ctx = makeCtx('m.top.observeField("field", "unknownCallback")');
      (ctx.config as Record<string, string>)['callback/undefined-observer-callback'] = 'error';
      const diags = checkObserverCallbacksAst(ctx);
      expect(codes(diags)).to.include('callback/undefined-observer-callback');
    });

    it('does not report known callback', () => {
      const ctx = makeCtx('m.top.observeField("field", "myCallback")');
      ctx.lintContext = { knownFuncNames: new Set(['mycallback']) } as unknown as LintContext;
      (ctx.config as Record<string, string>)['callback/undefined-observer-callback'] = 'error';
      const diags = checkObserverCallbacksAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('checkTestFileStructureAst', () => {
    it('reports missing return ts in test suite', () => {
      const ctx = makeCtx('function TestSuite__MyTest()\n  ts = {}\nend function');
      ctx.lintContext = {
        ...ctx.lintContext,
        isTestFile: () => true,
        resolveImportPath: () => null,
        readFile: () => null,
      } as unknown as LintContext;
      (ctx.config as Record<string, string>)['test/missing-return-ts'] = 'warning';
      const diags = checkTestFileStructureAst(ctx);
      expect(codes(diags)).to.include('test/missing-return-ts');
    });

    it('does not report when return ts present', () => {
      const ctx = makeCtx('function TestSuite__MyTest()\n  ts = {}\n  return ts\nend function');
      ctx.lintContext = {
        ...ctx.lintContext,
        isTestFile: () => true,
        resolveImportPath: () => null,
        readFile: () => null,
      } as unknown as LintContext;
      (ctx.config as Record<string, string>)['test/missing-return-ts'] = 'warning';
      const diags = checkTestFileStructureAst(ctx);
      expect(codes(diags)).not.to.include('test/missing-return-ts');
    });

    it('skips non-test files', () => {
      const ctx = makeCtx('function foo()\nend function');
      ctx.lintContext = { ...ctx.lintContext, isTestFile: () => false } as unknown as LintContext;
      (ctx.config as Record<string, string>)['test/missing-return-ts'] = 'warning';
      const diags = checkTestFileStructureAst(ctx);
      expect(diags).to.have.length(0);
    });
  });
});

  describe('source directory flat scope', () => {
    it('skips undefined-function in /source/ files', () => {
      const ctx = makeCtx('unknownFunc()');
      ctx.filePath = '/project/source/utils.brs';
      (ctx.config as Record<string, string>)['identifier/undefined-function'] = 'error';
      const { checkUndefinedCallsAst } = require('../../src/rules/astRules');
      const diags = checkUndefinedCallsAst(ctx);
      expect(diags).to.have.length(0);
    });

    it('still checks undefined-variable in /source/ files (variables are function-local)', () => {
      const ctx = makeCtx('function foo()\n  return unknownVar\nend function');
      ctx.filePath = '/project/source/main.brs';
      (ctx.config as Record<string, string>)['identifier/undefined-variable'] = 'error';
      const { checkUndefinedVariablesAst } = require('../../src/rules/astRules');
      const diags = checkUndefinedVariablesAst(ctx);
      expect(diags).to.have.length(1);
      expect(diags[0].code).to.equal('identifier/undefined-variable');
    });

    it('still checks /components/ files', () => {
      const ctx = makeCtx('unknownFunc()');
      ctx.filePath = '/project/components/MyScreen.brs';
      (ctx.config as Record<string, string>)['identifier/undefined-function'] = 'error';
      const { checkUndefinedCallsAst } = require('../../src/rules/astRules');
      const diags = checkUndefinedCallsAst(ctx);
      expect(codes(diags)).to.include('identifier/undefined-function');
    });
  });

  describe('generated modules', () => {
    it('does not report unresolved for generated paths', () => {
      const ctx = makeCtx("' @import /generated/file\nprint 1");
      ctx.imports = [{ raw: "' @import /generated/file", importPath: '/generated/file', line: 1, isMock: false }];
      ctx.lintContext = {
        ...ctx.lintContext,
        resolveImportPath: () => null,
        generatedPaths: ['/generated/*'],
        generatedModules: [],
        isTestFile: () => false,
        getSiblingFiles: () => [],
        getTestSiblings: () => [],
        parseImports: () => [],
        readFile: () => null,
      } as any;
      (ctx.config as Record<string, string>)['import/unresolved'] = 'warning';
      const { checkImportsAst } = require('../../src/rules/astRules');
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/unresolved');
    });
  });

  describe('@ XML attribute operator', () => {
    it('does not flag @ attribute access as error', () => {
      const ctx = makeCtx('function foo(node)\n  w = node@width\n  return w\nend function');
      (ctx.config as Record<string, string>)['identifier/undefined-variable'] = 'error';
      const { checkUndefinedVariablesAst } = require('../../src/rules/astRules');
      const diags = checkUndefinedVariablesAst(ctx);
      expect(diags).to.have.length(0);
    });
  });

  describe('import/unused', () => {
    function makeImportCtx(
      source: string,
      importedFuncNames: string[],
      lintContextOverrides: Partial<LintContext> = {},
    ): RuleContext {
      const ctx = makeCtx(source, { 'import/unused': 'warning' });
      ctx.imports = [{ raw: "' @import /utils/dep.brs", importPath: '/utils/dep.brs', line: 1, isMock: false }];
      ctx.lintContext = {
        knownFuncNames: new Set(),
        parseImports: () => [],
        resolveImportPath: () => '/resolved/dep.brs',
        importExists: () => true,
        readFile: () => null,
        parseFunctionsFromFile: () => importedFuncNames,
        getSiblingFiles: () => [],
        getTestSiblings: () => [],
        isTestFile: () => false,
        generatedPaths: [],
        generatedModules: [],
        siblingPatterns: [],
        ...lintContextOverrides,
      } as LintContext;
      return ctx;
    }

    it('flags unused import', () => {
      const ctx = makeImportCtx("' @import /utils/dep.brs\nfunction foo()\n  return 1\nend function", ['unusedFunc']);
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).to.include('import/unused');
    });

    it('does not flag import when function is called directly', () => {
      const ctx = makeImportCtx("' @import /utils/dep.brs\nfunction foo()\n  myFunc()\nend function", ['myFunc']);
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/unused');
    });

    it('does not flag import when function is used as a value (not called)', () => {
      const ctx = makeImportCtx("' @import /utils/dep.brs\nfunction foo()\n  callback = myFunc\nend function", ['myFunc']);
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/unused');
    });

    it('does not flag PromiseResolve import when .resolvedValue() appears in the same file', () => {
      const source = "' @import /utils/dep.brs\nfunction test()\n  m.mock = mockFunction(\"x\").resolvedValue(1)\nend function";
      const ctx = makeImportCtx(source, ['PromiseResolve'], { isTestFile: () => true });
      ctx.filePath = '/project/test/MyTest.test.brs';
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/unused');
    });

    it('does not flag PromiseResolve import when .resolvedValue() appears only in a sibling file', () => {
      const source = "' @import /utils/dep.brs\nfunction TestSuite__MyTest()\n  ts = {}\n  return ts\nend function";
      const siblingContent = "function TestSuite__MyTest__part()\n  x = mockFunction(\"x\").resolvedValue(1)\nend function";
      const ctx = makeImportCtx(source, ['PromiseResolve'], {
        isTestFile: () => true,
        getSiblingFiles: () => ['/project/test/TestSuite__MyTest__part.test.brs'],
        readFile: () => siblingContent,
      });
      ctx.filePath = '/project/test/TestSuite__MyTest.test.brs';
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/unused');
    });

    it('does not flag PromiseReject import when .rejectedValue() appears only in a test sibling file', () => {
      const source = "' @import /utils/dep.brs\nfunction TestSuite__MyTest()\n  ts = {}\n  return ts\nend function";
      const siblingContent = "function TestSuite__MyTest__part()\n  x = mockFunction(\"x\").rejectedValue({message:\"err\"})\nend function";
      const ctx = makeImportCtx(source, ['PromiseReject'], {
        isTestFile: () => true,
        getTestSiblings: () => ['/project/test/TestSuite__MyTest__part.test.brs'],
        readFile: () => siblingContent,
      });
      ctx.filePath = '/project/test/TestSuite__MyTest.test.brs';
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/unused');
    });
  });

  describe('import/missing-promise-deps', () => {
    function makePromiseDepsCtx(
      source: string,
      imports: { importPath: string }[] = [],
      lintContextOverrides: Partial<LintContext> = {},
    ): RuleContext {
      const ctx = makeCtx(source, { 'import/missing-promise-deps': 'warning' });
      ctx.filePath = '/project/test/MyTest.test.brs';
      ctx.imports = imports.map(imp => ({
        raw: `' @import ${imp.importPath}`,
        importPath: imp.importPath,
        line: 1,
        isMock: false,
      }));
      ctx.lintContext = {
        knownFuncNames: new Set(),
        parseImports: (text: string) => {
          const matches = [...text.matchAll(/' @import (\S+)/g)];
          return matches.map(m => ({ raw: m[0], importPath: m[1].trim(), line: 1, isMock: false }));
        },
        resolveImportPath: () => null,
        importExists: () => false,
        readFile: () => null,
        parseFunctionsFromFile: () => [],
        getSiblingFiles: () => [],
        getTestSiblings: () => [],
        isTestFile: () => true,
        generatedPaths: [],
        generatedModules: [],
        siblingPatterns: [],
        ...lintContextOverrides,
      } as LintContext;
      return ctx;
    }

    it('reports missing PromiseResolve import when .resolvedValue() is used', () => {
      const ctx = makePromiseDepsCtx(
        "function test()\n  x = mockFunction(\"fn\").resolvedValue(1)\nend function",
      );
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).to.include('import/missing-promise-deps');
      expect(diags.find(d => d.code === 'import/missing-promise-deps')!.message).to.contain('PromiseResolve');
    });

    it('reports missing PromiseReject import when .rejectedValue() is used', () => {
      const ctx = makePromiseDepsCtx(
        "function test()\n  x = mockFunction(\"fn\").rejectedValue({message:\"err\"})\nend function",
      );
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).to.include('import/missing-promise-deps');
      expect(diags.find(d => d.code === 'import/missing-promise-deps')!.message).to.contain('PromiseReject');
    });

    it('does not report when PromiseResolve.brs is imported', () => {
      const ctx = makePromiseDepsCtx(
        "' @import /components/promise/PromiseResolve.brs from @dazn/kopytko-utils\nfunction test()\n  x = mockFunction(\"fn\").resolvedValue(1)\nend function",
        [{ importPath: '/components/promise/PromiseResolve.brs' }],
      );
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/missing-promise-deps');
    });

    it('does not report when PromiseResolve is imported in a sibling file', () => {
      const siblingContent = "' @import /components/promise/PromiseResolve.brs from @dazn/kopytko-utils\n";
      const ctx = makePromiseDepsCtx(
        "function test()\n  x = mockFunction(\"fn\").resolvedValue(1)\nend function",
        [],
        {
          getSiblingFiles: () => ['/project/test/TestSuite__MyTest.test.brs'],
          readFile: () => siblingContent,
        },
      );
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/missing-promise-deps');
    });

    it('does not report in non-test files', () => {
      const ctx = makePromiseDepsCtx(
        "function test()\n  x = mockFunction(\"fn\").resolvedValue(1)\nend function",
        [],
        { isTestFile: () => false },
      );
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/missing-promise-deps');
    });

    it('does not report when rule is off', () => {
      const ctx = makePromiseDepsCtx(
        "function test()\n  x = mockFunction(\"fn\").resolvedValue(1)\nend function",
      );
      (ctx.config as Record<string, string>)['import/missing-promise-deps'] = 'off';
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/missing-promise-deps');
    });
  });

  describe('import/build-generated', () => {
    function makeGeneratedCtx(configOverrides: Record<string, string> = {}): RuleContext {
      const ctx = makeCtx("' @import /generated/Api.brs\nprint 1", {
        'import/build-generated': 'info',
        'import/unresolved': 'error',
        ...configOverrides,
      });
      ctx.imports = [{ raw: "' @import /generated/Api.brs", importPath: '/generated/Api.brs', line: 1, isMock: false }];
      ctx.lintContext = {
        ...ctx.lintContext,
        resolveImportPath: () => null,
        generatedPaths: ['/generated/*'],
        generatedModules: [],
        isTestFile: () => false,
        getSiblingFiles: () => [],
        getTestSiblings: () => [],
        parseImports: () => [],
        readFile: () => null,
        parseFunctionsFromFile: () => [],
      } as any;
      return ctx;
    }

    it('emits diagnostic with default info severity', () => {
      const ctx = makeGeneratedCtx();
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).to.include('import/build-generated');
      expect(diags.find(d => d.code === 'import/build-generated')!.severity).to.equal('info');
    });

    it('respects configured warning severity', () => {
      const ctx = makeGeneratedCtx({ 'import/build-generated': 'warning' });
      const diags = checkImportsAst(ctx);
      expect(diags.find(d => d.code === 'import/build-generated')!.severity).to.equal('warning');
    });

    it('suppresses diagnostic when rule is off', () => {
      const ctx = makeGeneratedCtx({ 'import/build-generated': 'off' });
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).not.to.include('import/build-generated');
    });

    it('falls through to import/unresolved when rule is off', () => {
      const ctx = makeGeneratedCtx({ 'import/build-generated': 'off', 'import/unresolved': 'error' });
      const diags = checkImportsAst(ctx);
      expect(codes(diags)).to.include('import/unresolved');
    });
  });

  describe('checkDeadFunctionsAst', () => {
    function makeDeadCtx(
      source: string,
      calledNames: Set<string> | undefined,
      opts: { filePath?: string; configOverrides?: Record<string, string> } = {},
    ): RuleContext {
      const filePath = opts.filePath ?? '/test/components/Button.brs';
      const lines = source.split(/\r?\n/);
      const parseResult = parse(source);
      const config: Record<string, string> = {
        'identifier/unused-function': 'hint',
        ...opts.configOverrides,
      };
      return {
        filePath,
        lines,
        imports: [],
        config,
        lintContext: {
          knownFuncNames: new Set(),
          calledWorkwideFuncNames: calledNames,
          isTestFile: (fp: string) => fp.includes('.test.') || fp.includes('spec'),
        } as unknown as LintContext,
        parseResult,
      };
    }

    it('reports identifier/unused-function on an uncalled top-level function', () => {
      const src = 'function unusedFn()\nend function\n';
      const ctx = makeDeadCtx(src, new Set<string>());
      const diags = checkDeadFunctionsAst(ctx);
      expect(codes(diags)).to.include('identifier/unused-function');
      expect(diags[0].message).to.include('unusedFn');
    });

    it('does not report a function that is in calledWorkwideFuncNames', () => {
      const src = 'function myFn()\nend function\n';
      const ctx = makeDeadCtx(src, new Set(['myfn']));
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('returns [] when calledWorkwideFuncNames is undefined (CLI mode)', () => {
      const src = 'function unusedFn()\nend function\n';
      const ctx = makeDeadCtx(src, undefined);
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('returns [] when rule is off', () => {
      const src = 'function unusedFn()\nend function\n';
      const ctx = makeDeadCtx(src, new Set<string>(), { configOverrides: { 'identifier/unused-function': 'off' } });
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('does not report init', () => {
      const src = 'sub init()\nend sub\n';
      const ctx = makeDeadCtx(src, new Set<string>());
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('does not report onKeyEvent', () => {
      const src = 'function onKeyEvent(key as String, press as Boolean) as Boolean\n  return false\nend function\n';
      const ctx = makeDeadCtx(src, new Set<string>());
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('does not report functions starting with _ (private convention)', () => {
      const src = 'sub _privateHelper()\nend sub\n';
      const ctx = makeDeadCtx(src, new Set<string>());
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('does not report functions in a source/ directory', () => {
      const src = 'function globalUtil()\nend function\n';
      const ctx = makeDeadCtx(src, new Set<string>(), { filePath: '/workspace/app/source/Utils.brs' });
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('does not report functions in a test file', () => {
      const src = 'function TestSuite()\nend function\n';
      const ctx = makeDeadCtx(src, new Set<string>(), { filePath: '/test/Button.test.brs' });
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('diagnostic range points at the function name token', () => {
      const src = 'function myDeadFn()\nend function\n';
      const ctx = makeDeadCtx(src, new Set<string>());
      const diags = checkDeadFunctionsAst(ctx);
      expect(diags).to.have.length(1);
      expect(diags[0].line).to.equal(0);
      expect(diags[0].column).to.be.greaterThan(0);
      expect(diags[0].endColumn).to.equal(diags[0].column + 'myDeadFn'.length);
    });

    it('does not flag anonymous FunctionExpression values', () => {
      const src = [
        'sub init()',
        '  m.onClick = function()',
        '    print "clicked"',
        '  end function',
        'end sub',
      ].join('\n');
      const ctx = makeDeadCtx(src, new Set<string>());
      expect(checkDeadFunctionsAst(ctx)).to.have.length(0);
    });

    it('reports multiple unused functions', () => {
      const src = [
        'function unusedA()',
        'end function',
        'function unusedB()',
        'end function',
        'function usedC()',
        'end function',
      ].join('\n');
      const ctx = makeDeadCtx(src, new Set(['usedc']));
      const diags = checkDeadFunctionsAst(ctx);
      expect(diags).to.have.length(2);
      expect(codes(diags)).to.deep.equal(['identifier/unused-function', 'identifier/unused-function']);
      expect(diags.map(d => d.message)).to.satisfy((msgs: string[]) =>
        msgs.some(m => m.includes('unusedA')) && msgs.some(m => m.includes('unusedB')),
      );
    });
  });

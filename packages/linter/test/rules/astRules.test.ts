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
  checkLoopVariableLeakAst,
  checkDuplicateFunctionsAst,
  checkMtopFieldAccessAst,
  checkUnreachableCodeAst,
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

  // ─── checkLoopVariableLeakAst ─────────────────────────────────────────────

  describe('checkLoopVariableLeakAst', () => {
    function makeLeakCtx(source: string): RuleContext {
      return makeCtx(source, { 'identifier/loop-variable-leak': 'warning' });
    }

    it('warns when for-loop counter is used after the loop', () => {
      const src = [
        'function test()',
        '  for i = 0 to 10',
        '  end for',
        '  print i',
        'end function',
      ].join('\n');
      const diags = checkLoopVariableLeakAst(makeLeakCtx(src));
      expect(codes(diags)).to.include('identifier/loop-variable-leak');
      expect(diags[0].line).to.equal(3);
    });

    it('warns when variable first assigned inside for-loop body is used after', () => {
      const src = [
        'function test()',
        '  for i = 0 to 10',
        '    result = i * 2',
        '  end for',
        '  return result',
        'end function',
      ].join('\n');
      const diags = checkLoopVariableLeakAst(makeLeakCtx(src));
      expect(codes(diags)).to.include('identifier/loop-variable-leak');
      expect(diags[0].line).to.equal(4);
    });

    it('warns when for-each iterator is used after the loop', () => {
      const src = [
        'function test()',
        '  for each item in myList',
        '    process(item)',
        '  end for',
        '  return item',
        'end function',
      ].join('\n');
      const diags = checkLoopVariableLeakAst(makeLeakCtx(src));
      expect(codes(diags)).to.include('identifier/loop-variable-leak');
      expect(diags[0].line).to.equal(4);
    });

    it('warns when while-loop variable leaks outside', () => {
      const src = [
        'function test()',
        '  while true',
        '    value = computeValue()',
        '    if value > 0 then exit while',
        '  end while',
        '  return value',
        'end function',
      ].join('\n');
      const diags = checkLoopVariableLeakAst(makeLeakCtx(src));
      expect(codes(diags)).to.include('identifier/loop-variable-leak');
    });

    it('warns when inner loop variable leaks to enclosing function scope', () => {
      const src = [
        'function test()',
        '  for i = 0 to 3',
        '    for j = 0 to 3',
        '      cell = grid[i][j]',
        '    end for',
        '  end for',
        '  print cell',
        'end function',
      ].join('\n');
      const diags = checkLoopVariableLeakAst(makeLeakCtx(src));
      expect(codes(diags)).to.include('identifier/loop-variable-leak');
    });

    it('warns when inner-loop variable is used between inner and outer loop ends (innermost-range fix)', () => {
      // With find()-based outer-loop matching (the bug), references between inner
      // and outer loop ends are invisible because outerLoop.endLine is used.
      // The innermost-range fix ensures inner loop's endLine is used instead.
      const src = [
        'function test()',
        '  for i = 0 to 3',       // outer: lines 1-6
        '    for j = 0 to 3',     // inner: lines 2-5
        '      cell = grid[i][j]', // cell defined in inner loop, line 3
        '    end for',
        '    print cell',          // line 5 — after inner loop, inside outer loop
        '  end for',
        'end function',
      ].join('\n');
      const diags = checkLoopVariableLeakAst(makeLeakCtx(src));
      expect(codes(diags)).to.include('identifier/loop-variable-leak');
    });

    it('does not warn when variable is defined BEFORE the loop', () => {
      const src = [
        'function test()',
        '  result = 0',
        '  for i = 0 to 10',
        '    result += i',
        '  end for',
        '  return result',
        'end function',
      ].join('\n');
      expect(checkLoopVariableLeakAst(makeLeakCtx(src))).to.have.length(0);
    });

    it('does not warn when variable is used only inside the loop', () => {
      const src = [
        'function test()',
        '  for i = 0 to 10',
        '    temp = i * 2',
        '    print temp',
        '  end for',
        'end function',
      ].join('\n');
      expect(checkLoopVariableLeakAst(makeLeakCtx(src))).to.have.length(0);
    });

    it('does not warn when for-each variable is used only inside body', () => {
      const src = [
        'function test()',
        '  for each x in items',
        '    print x',
        '  end for',
        'end function',
      ].join('\n');
      expect(checkLoopVariableLeakAst(makeLeakCtx(src))).to.have.length(0);
    });

    it('returns empty when rule is off', () => {
      const src = [
        'function test()',
        '  for i = 0 to 5',
        '  end for',
        '  print i',
        'end function',
      ].join('\n');
      expect(checkLoopVariableLeakAst(makeCtx(src, { 'identifier/loop-variable-leak': 'off' }))).to.have.length(0);
    });

    it('does not descend into FunctionExpression locals — no-closure boundary', () => {
      const src = [
        'function test()',
        '  callback = function()',
        '    local = 1',
        '    print local',
        '  end function',
        '  callback()',
        'end function',
      ].join('\n');
      expect(checkLoopVariableLeakAst(makeLeakCtx(src))).to.have.length(0);
    });
  });

  // ─── checkDuplicateFunctionsAst ───────────────────────────────────────────

  describe('checkDuplicateFunctionsAst', () => {
    function makeDupCtx(
      source: string,
      known: string[] = [],
      ancestors?: string[],
    ): RuleContext {
      const ctx = makeCtx(source, { 'identifier/duplicate-function': 'error' });
      ctx.lintContext = {
        ...ctx.lintContext,
        knownFuncNames: new Set(known),
        ancestorFuncNames: ancestors !== undefined ? new Set(ancestors) : undefined,
      } as unknown as LintContext;
      return ctx;
    }

    it('reports error when function name collides with an imported function', () => {
      const src = 'function Helper() as Void\nend function';
      const diags = checkDuplicateFunctionsAst(makeDupCtx(src, ['helper']));
      expect(codes(diags)).to.include('identifier/duplicate-function');
      expect(diags[0].message).to.include('Helper');
    });

    it('reports error when two functions have the same name in the same file', () => {
      const src = [
        'function Duplicate() as Void',
        'end function',
        'function duplicate() as Void',
        'end function',
      ].join('\n');
      const diags = checkDuplicateFunctionsAst(makeDupCtx(src));
      expect(codes(diags)).to.include('identifier/duplicate-function');
      expect(diags.some((d: import('../../src/types').LintDiagnostic) => d.message.toLowerCase().includes('duplicate'))).to.be.true;
    });

    it('does not report when function name is unique', () => {
      const src = 'function MySpecificLogic() as Void\nend function';
      expect(checkDuplicateFunctionsAst(makeDupCtx(src, ['otherFunc']))).to.have.length(0);
    });

    it('does not false-positive when knownFuncNames includes own-file functions (regression)', () => {
      // In extension mode, knownFuncNames includes the current file's own functions.
      // externalFuncNames is set to only external functions (empty when no imports),
      // so the rule must NOT flag a function as a duplicate of itself.
      const src = 'function myFunc() as Void\nend function';
      const ctx = makeCtx(src, { 'identifier/duplicate-function': 'error' });
      ctx.lintContext = {
        ...ctx.lintContext,
        knownFuncNames: new Set(['myfunc']),  // includes own-file fn (as in extension mode)
        externalFuncNames: new Set(),          // no external imports → empty external set
        ancestorFuncNames: undefined,
      } as unknown as LintContext;
      expect(checkDuplicateFunctionsAst(ctx)).to.have.length(0);
    });

    it('does not report when function overrides an ancestor', () => {
      const src = 'function onInit() as Void\nend function';
      expect(checkDuplicateFunctionsAst(makeDupCtx(src, ['oninit'], ['oninit']))).to.have.length(0);
    });

    it('reports when collision exists and ancestorFuncNames is not set', () => {
      const src = 'function helper() as Void\nend function';
      expect(codes(checkDuplicateFunctionsAst(makeDupCtx(src, ['helper'], undefined)))).to.include('identifier/duplicate-function');
    });

    it('does not report when rule is off', () => {
      const ctx = makeCtx('function Helper() as Void\nend function', { 'identifier/duplicate-function': 'off' });
      ctx.lintContext = { ...ctx.lintContext, knownFuncNames: new Set(['helper']) } as unknown as LintContext;
      expect(checkDuplicateFunctionsAst(ctx)).to.have.length(0);
    });

    // ── Regression tests for ancestor-override in extension mode ──

    it('regression (extension mode): ancestor-override exempt via externalFuncNames + ancestorFuncNames', () => {
      // Scenario: UserMessageTerms.template.brs defines render(); Kopytko base also defines
      // render() which ends up in externalFuncNames via the ancestor chain. ancestorFuncNames
      // must exempt it so the file's override is not flagged as a cross-scope duplicate.
      const src = 'function render() as Object\n  return {}\nend function';
      const ctx = makeCtx(src, { 'identifier/duplicate-function': 'error' });
      ctx.lintContext = {
        ...ctx.lintContext,
        knownFuncNames: new Set(['render']),
        externalFuncNames: new Set(['render']), // Kopytko base render appears as external
        ancestorFuncNames: new Set(['render']), // it's an ancestor → must be exempted
      } as unknown as LintContext;
      expect(checkDuplicateFunctionsAst(ctx)).to.have.length(0);
    });

    it('regression (extension mode): import collision flagged while ancestor override is exempt', () => {
      // 'render' is an ancestor function (can be overridden, no warning needed).
      // 'helper' is an import collision (real duplicate, must still be flagged).
      const src = [
        'function helper() as Void',
        'end function',
        'function render() as Object',
        '  return {}',
        'end function',
      ].join('\n');
      const ctx = makeCtx(src, { 'identifier/duplicate-function': 'error' });
      ctx.lintContext = {
        ...ctx.lintContext,
        knownFuncNames: new Set(['helper', 'render']),
        externalFuncNames: new Set(['helper', 'render']),
        ancestorFuncNames: new Set(['render']), // only 'render' is ancestored, not 'helper'
      } as unknown as LintContext;
      const diags = checkDuplicateFunctionsAst(ctx);
      expect(codes(diags)).to.include('identifier/duplicate-function');
      expect(diags).to.have.length(1);
      expect(diags[0].message).to.include('helper'); // 'render' is protected, 'helper' is not
    });
  });

  // ─── import/unused scope-aware fix ────────────────────────────────────────

  describe('import/unused — scope-aware local-shadow fix', () => {
    function makeImportCtxFor(source: string, importedFuncs: string[]): RuleContext {
      const ctx = makeCtx(source, { 'import/unused': 'warning' });
      ctx.imports = [{
        raw: "' @import /utils/helper.brs",
        importPath: '/utils/helper.brs',
        line: 1,
        isMock: false,
      }];
      ctx.lintContext = {
        knownFuncNames: new Set(),
        calledWorkwideFuncNames: undefined,
        parseImports: () => [],
        resolveImportPath: () => '/resolved/helper.brs',
        importExists: () => true,
        readFile: () => null,
        parseFunctionsFromFile: () => importedFuncs,
        getSiblingFiles: () => [],
        getTestSiblings: () => [],
        isTestFile: () => false,
        generatedPaths: [],
        generatedModules: [],
        siblingPatterns: [],
      } as unknown as LintContext;
      return ctx;
    }

    it('does NOT flag import/unused when the imported function is genuinely called', () => {
      const src = [
        "' @import /utils/helper.brs",
        'sub doSomething()',
        '  result = helper()',
        'end sub',
      ].join('\n');
      expect(codes(checkImportsAst(makeImportCtxFor(src, ['helper'])))).to.not.include('import/unused');
    });

    it('DOES flag import/unused when a local variable shadows the imported function name', () => {
      const src = [
        "' @import /utils/helper.brs",
        'sub doSomething()',
        '  helper = { value: 1 }',
        '  print helper.value',
        'end sub',
      ].join('\n');
      expect(codes(checkImportsAst(makeImportCtxFor(src, ['helper'])))).to.include('import/unused');
    });

    it('DOES flag import/unused when a parameter shadows the imported function name', () => {
      const src = [
        "' @import /utils/helper.brs",
        'sub doSomething(helper as String)',
        '  print helper',
        'end sub',
      ].join('\n');
      expect(codes(checkImportsAst(makeImportCtxFor(src, ['helper'])))).to.include('import/unused');
    });

    it('does NOT flag import/unused when function is used as a value (callback pointer)', () => {
      const src = [
        "' @import /utils/helper.brs",
        'sub doSomething()',
        '  observer = helper',
        'end sub',
      ].join('\n');
      expect(codes(checkImportsAst(makeImportCtxFor(src, ['helper'])))).to.not.include('import/unused');
    });
  });

  // ─── checkMtopFieldAccessAst ──────────────────────────────────────────────

  describe('checkMtopFieldAccessAst', () => {
    function makeMtopCtx(source: string, validFields: string[] | null): RuleContext {
      const fieldSet = validFields ? new Set(validFields.map((f: string) => f.toLowerCase())) : null;
      const ctx = makeCtx(source, { 'mtop/undefined-field': 'warning' });
      ctx.lintContext = {
        ...ctx.lintContext,
        getMtopFields: () => fieldSet,
      } as unknown as LintContext;
      return ctx;
    }

    it('warns when writing to an undeclared m.top field', () => {
      const src = 'sub init()\n  m.top.nonExistentField = "hello"\nend sub';
      const diags = checkMtopFieldAccessAst(makeMtopCtx(src, ['title', 'opacity']));
      expect(codes(diags)).to.include('mtop/undefined-field');
      expect(diags[0].message).to.include('nonExistentField');
    });

    it('warns when reading from an undeclared m.top field', () => {
      const src = 'function getVal()\n  return m.top.typoField\nend function';
      const diags = checkMtopFieldAccessAst(makeMtopCtx(src, ['title']));
      expect(codes(diags)).to.include('mtop/undefined-field');
    });

    it('does not warn when accessing a declared XML interface field', () => {
      const src = 'sub init()\n  m.top.title = "Hello"\nend sub';
      expect(checkMtopFieldAccessAst(makeMtopCtx(src, ['title', 'opacity']))).to.have.length(0);
    });

    it('does not warn when accessing an inherited ancestor field', () => {
      const src = 'sub init()\n  m.top.opacity = 1.0\nend sub';
      expect(checkMtopFieldAccessAst(makeMtopCtx(src, ['title', 'opacity', 'boundingRect']))).to.have.length(0);
    });

    it('is case-insensitive for field names', () => {
      const src = 'sub init()\n  m.top.Title = "hello"\nend sub';
      expect(checkMtopFieldAccessAst(makeMtopCtx(src, ['title']))).to.have.length(0);
    });

    it('skips when getMtopFields is not provided', () => {
      const src = 'sub init()\n  m.top.anything = 1\nend sub';
      expect(checkMtopFieldAccessAst(makeCtx(src, { 'mtop/undefined-field': 'warning' }))).to.have.length(0);
    });

    it('skips when getMtopFields returns null (no companion XML)', () => {
      expect(checkMtopFieldAccessAst(makeMtopCtx('sub init()\n  m.top.anything = 1\nend sub', null))).to.have.length(0);
    });

    it('does not warn when rule is off', () => {
      const fieldSet = new Set(['title']);
      const ctx = makeCtx('sub init()\n  m.top.undeclared = 1\nend sub', { 'mtop/undefined-field': 'off' });
      ctx.lintContext = { ...ctx.lintContext, getMtopFields: () => fieldSet } as unknown as LintContext;
      expect(checkMtopFieldAccessAst(ctx)).to.have.length(0);
    });
  });

  // ─── checkUnreachableCodeAst ──────────────────────────────────────────────

  describe('checkUnreachableCodeAst', () => {
    function makeUnreachCtx(source: string): RuleContext {
      return makeCtx(source, { 'syntax/unreachable-code': 'warning' });
    }

    it('warns on code after return in a function body', () => {
      const src = [
        'function getValue() as Integer',
        '  return 42',
        '  print "unreachable"',
        'end function',
      ].join('\n');
      const diags = checkUnreachableCodeAst(makeUnreachCtx(src));
      expect(codes(diags)).to.include('syntax/unreachable-code');
      expect(diags[0].line).to.equal(2);
    });

    it('warns on code after throw', () => {
      const src = [
        'function fail()',
        '  throw { message: "bad" }',
        '  doSomething()',
        'end function',
      ].join('\n');
      const diags = checkUnreachableCodeAst(makeUnreachCtx(src));
      expect(codes(diags)).to.include('syntax/unreachable-code');
    });

    it('warns only on the FIRST unreachable statement, not subsequent ones', () => {
      const src = [
        'function test()',
        '  return 1',
        '  x = 2',
        '  y = 3',
        'end function',
      ].join('\n');
      const diags = checkUnreachableCodeAst(makeUnreachCtx(src));
      expect(diags).to.have.length(1);
      expect(diags[0].line).to.equal(2);
    });

    it('warns on unreachable code after exit for', () => {
      const src = [
        'function test()',
        '  for i = 0 to 10',
        '    exit for',
        '    doSomething()',
        '  end for',
        'end function',
      ].join('\n');
      const diags = checkUnreachableCodeAst(makeUnreachCtx(src));
      expect(codes(diags)).to.include('syntax/unreachable-code');
      expect(diags[0].line).to.equal(3);
    });

    it('warns on unreachable code after exit while', () => {
      const src = [
        'function test()',
        '  while true',
        '    exit while',
        '    doMore()',
        '  end while',
        'end function',
      ].join('\n');
      const diags = checkUnreachableCodeAst(makeUnreachCtx(src));
      expect(codes(diags)).to.include('syntax/unreachable-code');
    });

    it('warns on unreachable code inside an if-branch', () => {
      const src = [
        'function test()',
        '  if x = 1 then',
        '    return "yes"',
        '    doCleanup()',
        '  end if',
        '  return "no"',
        'end function',
      ].join('\n');
      const diags = checkUnreachableCodeAst(makeUnreachCtx(src));
      expect(codes(diags)).to.include('syntax/unreachable-code');
      expect(diags[0].line).to.equal(3);
    });

    it('does not warn when return is the last statement', () => {
      const src = [
        'function getValue() as Integer',
        '  x = computeX()',
        '  return x',
        'end function',
      ].join('\n');
      expect(checkUnreachableCodeAst(makeUnreachCtx(src))).to.have.length(0);
    });

    it('does not warn when branches each return but no dead code within', () => {
      const src = [
        'function getValue(flag as Boolean) as Integer',
        '  if flag then',
        '    return 1',
        '  else',
        '    return 2',
        '  end if',
        'end function',
      ].join('\n');
      expect(checkUnreachableCodeAst(makeUnreachCtx(src))).to.have.length(0);
    });

    it('does not warn when exit for is last in a loop body', () => {
      const src = [
        'function test()',
        '  for i = 0 to 10',
        '    if i = 5 then exit for',
        '  end for',
        'end function',
      ].join('\n');
      expect(checkUnreachableCodeAst(makeUnreachCtx(src))).to.have.length(0);
    });

    it('warns on code after stop', () => {
      const src = [
        'function test()',
        '  stop',
        '  print "unreachable"',
        'end function',
      ].join('\n');
      const diags = checkUnreachableCodeAst(makeUnreachCtx(src));
      expect(codes(diags)).to.include('syntax/unreachable-code');
    });

    it('does not warn when rule is off', () => {
      const src = [
        'function test()',
        '  return 1',
        '  print "dead"',
        'end function',
      ].join('\n');
      expect(checkUnreachableCodeAst(makeCtx(src, { 'syntax/unreachable-code': 'off' }))).to.have.length(0);
    });
  });

import { expect } from 'chai';
import {
  checkCreateObjectArgsAst,
  checkThrowStatementsAst,
  checkLoopFlowControlAst,
  checkMissingTypeAnnotationsAst,
  checkTrailingCommaAst,
  checkShadowedBuiltinsAst,
  checkUnusedParametersAst,
  checkUnusedVariablesAst,
  checkWrongArgCountAst,
  checkUndefinedCallsAst,
  checkUndefinedVariablesAst,
  checkObserverCallbacksAst,
  checkTestFileStructureAst,
} from '../../src/rules/astRules';
import type { RuleContext, LintDiagnostic } from '../../src/types';
import type { LintContext } from '../../src/context';

// We need to require parse from the installed package
const { parse } = require('brightscript-parser');

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

    it('skips undefined-variable in /source/ files', () => {
      const ctx = makeCtx('function foo()\n  return unknownVar\nend function');
      ctx.filePath = '/project/source/main.brs';
      (ctx.config as Record<string, string>)['identifier/undefined-variable'] = 'error';
      const { checkUndefinedVariablesAst } = require('../../src/rules/astRules');
      const diags = checkUndefinedVariablesAst(ctx);
      expect(diags).to.have.length(0);
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

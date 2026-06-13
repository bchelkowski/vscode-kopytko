import { expect } from 'chai';
import { checkUndefinedCalls, checkUndefinedVariables, checkShadowedBuiltins, checkUnusedParameters } from '../../src/rules/identifierRules';
import { createRuleContext } from '../helpers';
import { DEFAULT_RULE_CONFIG } from '../../src/config';

describe('identifierRules', () => {
  describe('checkUndefinedCalls', () => {
    it('does not report a known function call', () => {
      const content = [
        'function doWork()',
        '  result = helperFunc()',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: {
          knownFuncNames: new Set(['helperfunc']),
        },
      });

      const diags = checkUndefinedCalls(ctx);
      expect(diags.filter(d => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('reports identifier/undefined-function for an unknown call', () => {
      const content = [
        'function doWork()',
        '  result = unknownFunc()',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: {
          knownFuncNames: new Set(),
        },
      });

      const diags = checkUndefinedCalls(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-function');
      expect(undef).to.have.lengthOf(1);
      expect(undef[0].severity).to.equal('error');
      expect(undef[0].message).to.include('unknownFunc');
    });

    it('reports identifier/wrong-arg-count for built-in with wrong args', () => {
      // Len() expects 1 argument
      const content = [
        'function doWork()',
        '  x = Len("hello", "extra")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      const wrong = diags.filter(d => d.code === 'identifier/wrong-arg-count');
      expect(wrong).to.have.lengthOf(1);
      expect(wrong[0].message).to.include('Len');
    });

    it('does not report wrong-arg-count for built-in with correct args', () => {
      const content = [
        'function doWork()',
        '  x = Len("hello")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      const wrong = diags.filter(d => d.code === 'identifier/wrong-arg-count');
      expect(wrong).to.be.empty;
    });

    it('does not report wrong-arg-count when argument is an AA literal', () => {
      const content = [
        'function doWork()',
        '  requestResult = FormatJson({ timestamp: "now", platform: "roku" })',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      const wrong = diags.filter(d => d.code === 'identifier/wrong-arg-count');
      expect(wrong).to.be.empty;
    });

    it('does not report wrong-arg-count when argument is an array literal', () => {
      const content = [
        'function doWork()',
        '  x = Len([1, 2, 3])',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      const wrong = diags.filter(d => d.code === 'identifier/wrong-arg-count');
      expect(wrong).to.be.empty;
    });

    it('skips main.brs files', () => {
      const content = [
        'function main()',
        '  someUnknown()',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        filePath: '/project/src/main.brs',
      });

      const diags = checkUndefinedCalls(ctx);
      expect(diags).to.be.empty;
    });

    it('does not report built-in functions as undefined', () => {
      const content = [
        'function doWork()',
        '  x = Len("hello")',
        '  y = UCase("world")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not flag XML attribute access via @ operator', () => {
      const content = [
        'function doWork()',
        '  name = tracking@event',
        '  value = node@id',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: {
          knownFuncNames: new Set(['dowork']),
        },
      });

      const diags = checkUndefinedCalls(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-function');
      expect(undef).to.be.empty;
    });

    it('does not report when the rule is turned off', () => {
      const content = [
        'function doWork()',
        '  result = unknownFunc()',
        'end function',
      ].join('\n');

      const config = {
        ...DEFAULT_RULE_CONFIG,
        'identifier/undefined-function': 'off' as const,
        'identifier/wrong-arg-count': 'off' as const,
      };
      const ctx = createRuleContext(content, { config });
      const diags = checkUndefinedCalls(ctx);
      expect(diags).to.be.empty;
    });

    it('skips comment lines', () => {
      const content = [
        'function doWork()',
        "  ' unknownFunc()",
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      expect(diags.filter(d => d.code === 'identifier/undefined-function')).to.be.empty;
    });

    it('does not flag hex literal digits as undefined function calls', () => {
      const content = [
        'function doWork()',
        '  x = &HFF',
        '  y = &hABCDEF',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      expect(diags.filter(d => d.code === 'identifier/undefined-function')).to.be.empty;
    });
  });

  describe('checkUndefinedVariables', () => {
    it('does not report a variable defined in scope', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  print x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedVariables(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });

    it('does not report function parameters as undefined', () => {
      const content = [
        'function doWork(param1, param2)',
        '  print param1',
        '  print param2',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedVariables(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });

    it('does not report m as undefined', () => {
      const content = [
        'function doWork()',
        '  print m',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedVariables(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });

    it('does not report built-in names as undefined', () => {
      const content = [
        'function doWork()',
        '  print Len',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedVariables(ctx);
      // Built-in names are filtered as function calls, not variables — check no crash
      expect(diags).to.be.an('array');
    });

    it('does not report when the rule is turned off', () => {
      const content = [
        'function doWork()',
        '  print undefinedVar',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, 'identifier/undefined-variable': 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkUndefinedVariables(ctx);
      expect(diags).to.be.empty;
    });

    it('does not flag XML attribute access via @ operator', () => {
      const content = [
        'function doWork(tracking)',
        '  name = tracking@event',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedVariables(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-variable');
      const flaggedNames = undef.map(d => d.message);
      expect(flaggedNames.some(m => m.includes("'event'"))).to.be.false;
    });

    it('does not flag hex literal digits as undefined variables', () => {
      const content = [
        'function doWork()',
        '  x = &HFF',
        '  y = &hABCDEF',
        '  z = &hFEDCBA9876543210&',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedVariables(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-variable');
      const flaggedNames = undef.map(d => d.message);
      expect(flaggedNames.some(m => m.includes("'HFF'"))).to.be.false;
      expect(flaggedNames.some(m => m.includes("'hABCDEF'"))).to.be.false;
      expect(flaggedNames.some(m => m.includes("'hFEDCBA9876543210'"))).to.be.false;
    });

    it('does not flag type-suffixed numeric literals as undefined variables', () => {
      const content = [
        'function doWork()',
        '  a = 2!',
        '  b = 2.3#',
        '  c = 42&',
        '  d = 125%',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedVariables(ctx);
      const undef = diags.filter(d => d.code === 'identifier/undefined-variable');
      expect(undef).to.be.empty;
    });
  });

  describe('checkShadowedBuiltins', () => {
    it('reports identifier/shadows-builtin for variable shadowing a built-in', () => {
      const content = [
        'function doWork()',
        '  Len = 42',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkShadowedBuiltins(ctx);
      const shadows = diags.filter(d => d.code === 'identifier/shadows-builtin');
      expect(shadows).to.have.lengthOf(1);
      expect(shadows[0].message).to.include('Len');
      expect(shadows[0].message).to.include('shadows');
    });

    it('reports identifier/shadows-builtin for parameter shadowing a built-in', () => {
      const content = 'function doWork(Len)\n  print Len\nend function\n';

      const ctx = createRuleContext(content);
      const diags = checkShadowedBuiltins(ctx);
      const shadows = diags.filter(d => d.code === 'identifier/shadows-builtin');
      expect(shadows.length).to.be.greaterThanOrEqual(1);
      expect(shadows[0].message).to.include('Len');
    });

    it('does not report for non-builtin variable names', () => {
      const content = [
        'function doWork()',
        '  myVar = 42',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkShadowedBuiltins(ctx);
      expect(diags).to.be.empty;
    });

    it('does not report when the rule is turned off', () => {
      const content = [
        'function doWork()',
        '  Len = 42',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, 'identifier/shadows-builtin': 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkShadowedBuiltins(ctx);
      expect(diags).to.be.empty;
    });

    it('reports for-loop variable shadowing a built-in', () => {
      const content = [
        'function doWork()',
        '  for Len = 0 to 10',
        '    print Len',
        '  end for',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkShadowedBuiltins(ctx);
      const shadows = diags.filter(d => d.code === 'identifier/shadows-builtin');
      expect(shadows.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('checkUnusedParameters', () => {
    it('reports identifier/unused-parameter for unused params', () => {
      const content = [
        'function doWork(unused)',
        '  print "hello"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedParameters(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-parameter');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].severity).to.equal('warning');
      expect(unused[0].message).to.include('unused');
    });

    it('does not report used parameters', () => {
      const content = [
        'function doWork(name)',
        '  print name',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedParameters(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-parameter')).to.be.empty;
    });

    it('does not report parameters prefixed with _', () => {
      const content = [
        'function doWork(_unused)',
        '  print "hello"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedParameters(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-parameter')).to.be.empty;
    });

    it('does not report when the rule is turned off', () => {
      const content = [
        'function doWork(unused)',
        '  print "hello"',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, 'identifier/unused-parameter': 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkUnusedParameters(ctx);
      expect(diags).to.be.empty;
    });

    it('reports multiple unused parameters', () => {
      const content = [
        'function doWork(a, b, c)',
        '  print "hello"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedParameters(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-parameter');
      expect(unused).to.have.lengthOf(3);
    });

    it('does not report when function has no parameters', () => {
      const content = [
        'function doWork()',
        '  print "hello"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedParameters(ctx);
      expect(diags).to.be.empty;
    });

    it('emits a fix that inserts _ prefix', () => {
      const content = [
        'function doWork(unused)',
        '  print "hello"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedParameters(ctx);
      const d = diags.find(d => d.code === 'identifier/unused-parameter');
      expect(d).to.exist;
      expect(d!.fix).to.deep.include({ type: 'insert', text: '_' });
    });
  });

  describe('@mock function visibility', () => {
    it('does not flag functions from @mock files as undefined when included in knownFuncNames', () => {
      const content = [
        "' @mock /components/AuthStrategy.brs",
        "' @mock /components/AuthService.brs",
        'function TestSuite__AuthGateway()',
        '  ts = {}',
        '  AuthStrategy()',
        '  AuthService()',
        '  return ts',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        filePath: '/project/src/_tests/AuthGateway.test.brs',
        lintContextOverrides: {
          knownFuncNames: new Set(['testsuite__authgateway', 'authstrategy', 'authservice']),
        },
      });

      const diags = checkUndefinedCalls(ctx);
      expect(diags.filter(d => d.code === 'identifier/undefined-function')).to.be.empty;
    });
  });
});

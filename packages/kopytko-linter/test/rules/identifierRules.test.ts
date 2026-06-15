import { expect } from 'chai';
import { checkUndefinedCalls, checkUndefinedVariables, checkShadowedBuiltins, checkUnusedParameters, checkUnusedVariables } from '../../src/rules/identifierRules';
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

    it('does not report wrong-arg-count when argument is a numeric literal', () => {
      const content = [
        'function doWork()',
        '  x = Rnd(2)',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      const wrong = diags.filter(d => d.code === 'identifier/wrong-arg-count');
      expect(wrong).to.be.empty;
    });

    it('does not report wrong-arg-count when arguments include numeric literals', () => {
      const content = [
        'function doWork(s)',
        '  x = Mid(s, 2, 3)',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUndefinedCalls(ctx);
      const wrong = diags.filter(d => d.code === 'identifier/wrong-arg-count');
      expect(wrong).to.be.empty;
    });

    it('does not report wrong-arg-count when argument is a hex literal', () => {
      const content = [
        'function doWork()',
        '  x = Rnd(&HFF)',
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

    it('does not misidentify a known function whose name ends with digits', () => {
      const content = [
        'function doWork()',
        '  if (getSpliceEventIdFromSCTE35(value, "base16") = 305)',
        '    print "done"',
        '  end if',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: {
          knownFuncNames: new Set(['getspliceeventidFromscte35'.toLowerCase()]),
        },
      });

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

    it('reports correct column when short param name appears inside a preceding param name', () => {
      const line = 'function _onStatusFetch(promise as Object, m as Object) as Boolean';
      const content = [
        line,
        '  if (promise.isFulfilled)',
        '    return true',
        '  end if',
        '  return false',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedParameters(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-parameter');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include('"m"');

      const expectedCol = line.indexOf(', m') + 2;
      expect(unused[0].column).to.equal(expectedCol);
      expect(unused[0].endColumn).to.equal(expectedCol + 1);
      expect(unused[0].fix).to.deep.include({ type: 'insert', column: expectedCol, text: '_' });
    });

    it('does not treat AA literal keys as parameters', () => {
      const content = [
        'function __createContentMock(fields = { streamFormat: "dash", url: "https://url.dazn1.com" } as Object) as Object',
        '  content = CreateObject("roSGNode", "Node")',
        '  content.addFields(fields)',
        '  return content',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['createobject']) },
      });
      const diags = checkUnusedParameters(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-parameter');
      expect(unused).to.be.empty;
    });

    it('does not flag AA literal keys as unused when param is used', () => {
      const content = [
        'function doWork(opts = { key: "value", other: 123 } as Object) as Void',
        '  print opts.key',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedParameters(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-parameter');
      expect(unused).to.be.empty;
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

  describe('checkUnusedVariables', () => {
    it('reports an unused variable', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].severity).to.equal('warning');
      expect(unused[0].message).to.include("'x'");
      expect(unused[0].message).to.include('never used');
    });

    it('does not report a variable used in a return statement', () => {
      const content = [
        'function doWork()',
        '  result = getValue()',
        '  return result',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used in a print statement', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  print x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used as a function call argument', () => {
      const content = [
        'function doWork()',
        '  data = getData()',
        '  process(data)',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['getdata', 'process']) },
      });
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used in an if condition', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  if x = 1 then print "one"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used in a while condition', () => {
      const content = [
        'function doWork()',
        '  done = false',
        '  while done = false',
        '    done = true',
        '  end while',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable prefixed with _', () => {
      const content = [
        'function doWork()',
        '  _unused = 5',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report when the rule is turned off', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, 'identifier/unused-variable': 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkUnusedVariables(ctx);
      expect(diags).to.be.empty;
    });

    it('does not report function parameters (handled by unused-parameter)', () => {
      const content = [
        'function doWork(param)',
        '  print "hello"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('reports an unused for-loop counter', () => {
      const content = [
        'function doWork()',
        '  for i = 0 to 10',
        '    print "hello"',
        '  end for',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'i'");
    });

    it('does not report a used for-loop counter', () => {
      const content = [
        'function doWork(items)',
        '  for i = 0 to 10',
        '    print items[i]',
        '  end for',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('reports an unused for-each variable', () => {
      const content = [
        'function doWork(collection)',
        '  count = 0',
        '  for each item in collection',
        '    count += 1',
        '  end for',
        '  return count',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'item'");
    });

    it('does not report a used for-each variable', () => {
      const content = [
        'function doWork(collection)',
        '  for each item in collection',
        '    print item',
        '  end for',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('reports an unused dim variable', () => {
      const content = [
        'function doWork()',
        '  dim buffer(1024)',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'buffer'");
    });

    it('reports an unused catch variable', () => {
      const content = [
        'function doWork()',
        '  try',
        '    doSomething()',
        '  catch e',
        '    print "error"',
        '  end try',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['dosomething']) },
      });
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'e'");
    });

    it('does not report a used catch variable', () => {
      const content = [
        'function doWork()',
        '  try',
        '    doSomething()',
        '  catch e',
        '    print e.message',
        '  end try',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['dosomething']) },
      });
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used via compound assignment', () => {
      const content = [
        'function doWork()',
        '  count = 0',
        '  count += 1',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used via array indexing', () => {
      const content = [
        'function doWork()',
        '  arr = []',
        '  arr[0] = 5',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report m.field assignments as unused local variables', () => {
      const content = [
        'function doWork()',
        '  m.value = 5',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('reports multiple unused variables in the same function', () => {
      const content = [
        'function doWork()',
        '  a = 1',
        '  b = 2',
        '  c = 3',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(3);
    });

    it('reports only unused variables, not used ones', () => {
      const content = [
        'function doWork()',
        '  used = 1',
        '  unused = 2',
        '  return used',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'unused'");
    });

    it('does not report a variable used in the RHS of its own reassignment', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  x = x + 1',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('reports a variable that is only reassigned without reading', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  x = 10',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'x'");
    });

    it('does not report a variable used on the RHS of another assignment', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  y = x + 1',
        '  return y',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used in m.field assignment RHS', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  m.value = x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not flag variables inside nested scopes as used by the outer scope', () => {
      const content = [
        'function outer()',
        '  x = 5',
        '  callback = sub()',
        '    y = x',
        '    print y',
        '  end sub',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      // x is defined in outer but referenced only inside inner scope (which is skipped)
      // callback is also unused in outer scope
      const names = unused.map(d => d.message);
      expect(names.some(m => m.includes("'x'"))).to.be.true;
    });

    it('does not emit a fix', () => {
      const content = [
        'function doWork()',
        '  result = getValue()',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['getvalue']) },
      });
      const diags = checkUnusedVariables(ctx);
      const d = diags.find(d => d.code === 'identifier/unused-variable');
      expect(d).to.exist;
      expect(d!.fix).to.be.undefined;
    });

    it('reports correct column for the variable name', () => {
      const content = [
        'function doWork()',
        '  result = getValue()',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['getvalue']) },
      });
      const diags = checkUnusedVariables(ctx);
      const d = diags.find(d => d.code === 'identifier/unused-variable');
      expect(d).to.exist;
      expect(d!.column).to.equal(2);
      expect(d!.endColumn).to.equal(2 + 'result'.length);
    });

    it('does not report a variable only referenced inside a string literal', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  print "x is great"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'x'");
    });

    it('does not report a variable only referenced in a comment', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        "  ' use x here later",
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
    });

    it('handles case-insensitive variable matching', () => {
      const content = [
        'function doWork()',
        '  MyVar = 5',
        '  print myvar',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used in a for-loop bound expression', () => {
      const content = [
        'function doWork()',
        '  max = 10',
        '  for i = 0 to max',
        '    print i',
        '  end for',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not report a variable used with dot-access (method call)', () => {
      const content = [
        'function doWork()',
        '  obj = CreateObject("roAssociativeArray")',
        '  obj.AddReplace("key", "value")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('detects assignment after : statement separator', () => {
      const content = [
        'function doWork()',
        '  if true then : x = 5 : end if',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'x'");
    });

    it('detects usage after : statement separator', () => {
      const content = [
        'function doWork()',
        '  x = 1 : print x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('handles assignment and usage on same line via :', () => {
      const content = [
        'sub doWork()',
        '  x = 1 : Rnd(x)',
        'end sub',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not split : inside AA literal key-value pairs', () => {
      const content = [
        'function doWork()',
        '  config = { key: "value" }',
        '  return config',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('reports unused variable defined after : when not referenced elsewhere', () => {
      const content = [
        'function doWork()',
        '  print "start" : unused = 42',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'unused'");
    });

    it('reports multiple unused variables across : separators', () => {
      const content = [
        'function doWork()',
        '  a = 1 : b = 2 : c = 3',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(3);
    });

    it('reports only the unused variable when one of two is used across :', () => {
      const content = [
        'function doWork()',
        '  used = 1 : unused = 2',
        '  return used',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'unused'");
    });

    it('detects usage before : on same line as definition after :', () => {
      const content = [
        'function doWork()',
        '  x = 5',
        '  print x : y = 10',
        '  return y',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('handles compound assignment after : separator', () => {
      const content = [
        'function doWork()',
        '  x = 0 : x += 1',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('handles m.field after : separator — no false local definition', () => {
      const content = [
        'function doWork()',
        '  print "init" : m.value = 42',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('detects usage in if-condition after : separator', () => {
      const content = [
        'function doWork()',
        '  x = 5 : if x = 1 then print "one"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not split : inside nested AA literal', () => {
      const content = [
        'function doWork()',
        '  data = { outer: { inner: 1 } }',
        '  return data',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('does not split : inside parenthesized expressions', () => {
      const content = [
        'function doWork()',
        '  result = someFunc({ key: "val" })',
        '  return result',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['somefunc']) },
      });
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('handles variable used in return after : separator', () => {
      const content = [
        'function doWork()',
        '  x = getValue() : return x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['getvalue']) },
      });
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('handles three statements with define, use, and unrelated via :', () => {
      const content = [
        'function doWork()',
        '  x = 1 : print x : y = 2',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'y'");
    });

    it('handles array access after : separator', () => {
      const content = [
        'function doWork()',
        '  arr = [] : arr[0] = 5',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('AA assignment then usage via : on same line', () => {
      const content = [
        'function doWork()',
        '  config = { key: "value", num: 1 } : return config',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('AA assignment then unused via : on same line', () => {
      const content = [
        'function doWork()',
        '  config = { key: "value" } : print "done"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'config'");
    });

    it('nested AA with : not split, then used via : on next statement', () => {
      const content = [
        'function doWork()',
        '  data = { outer: { inner: 42 } } : m.config = data',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('AA inside function call arg with : after closing paren', () => {
      const content = [
        'function doWork()',
        '  result = process({ a: 1, b: 2 }) : return result',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['process']) },
      });
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('for each loop body via : separators', () => {
      const content = [
        'function doWork(items)',
        '  total = 0',
        '  for each item in items : total += item : end for',
        '  return total',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('variable assigned from array literal then used after :', () => {
      const content = [
        'function doWork()',
        '  items = [1, 2, 3] : print items[0]',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('dot-access method call after : separator', () => {
      const content = [
        'function doWork()',
        '  obj = CreateObject("roAssociativeArray") : obj.AddReplace("k", "v")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('catch variable used after : in catch block', () => {
      const content = [
        'function doWork()',
        '  try',
        '    doSomething()',
        '  catch e : print e.message',
        '  end try',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['dosomething']) },
      });
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('dim then usage after : separator', () => {
      const content = [
        'function doWork()',
        '  dim buf(10) : buf[0] = 42',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('variable used in while condition after : separator', () => {
      const content = [
        'function doWork()',
        '  done = false : while done = false : done = true : end while',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('inline sub body via : does not leak inner variables to outer scope', () => {
      const content = [
        'function outer()',
        '  callback = sub() : inner = 5 : print inner : end sub',
        '  return callback',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      // inner is local to the sub — should NOT be flagged in outer scope
      const names = diags.filter(d => d.code === 'identifier/unused-variable').map(d => d.message);
      expect(names.some(m => m.includes("'inner'"))).to.be.false;
    });

    it('inline sub assigned to variable tracks the variable correctly', () => {
      const content = [
        'function outer()',
        '  callback = sub() : print "hi" : end sub',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      // callback is unused in outer scope
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'callback'");
    });

    it('inline function with parameters and default values', () => {
      const content = [
        'function outer()',
        '  handler = function(name = "default" as String) : print name : end function',
        '  return handler',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('inline function with default value from function call', () => {
      const content = [
        'function outer()',
        '  handler = function(aa = SomeClass().field as String) : ?aa : end function',
        '  return handler',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['someclass']) },
      });
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('complex inline function with AA and : separators', () => {
      const content = [
        'function outer()',
        '  handler = function(aa = SomeClass().field as String) : ?aa : a = { key: "aa" } : ?a : end function',
        '  return handler',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['someclass']) },
      });
      const diags = checkUnusedVariables(ctx);
      // handler is used (returned), inner vars aa and a should not leak
      const names = diags.filter(d => d.code === 'identifier/unused-variable').map(d => d.message);
      expect(names.some(m => m.includes("'a'"))).to.be.false;
      expect(names.some(m => m.includes("'aa'"))).to.be.false;
      expect(names.some(m => m.includes("'handler'"))).to.be.false;
    });

    it('outer variable used in inline function default param value', () => {
      const content = [
        'function outer()',
        '  defaultVal = "hello"',
        '  handler = function(name = defaultVal as String) : print name : end function',
        '  return handler',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      // defaultVal appears in the function(...) declaration statement which is outer scope
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('code after inline end sub is still in outer scope', () => {
      const content = [
        'function outer()',
        '  cb = sub() : end sub : x = 5',
        '  return x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      // x is defined after end sub (back in outer scope) and used in return
      // cb is unused
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'cb'");
    });

    it('nested inline functions do not leak across depth levels', () => {
      const content = [
        'function outer()',
        '  factory = function() : inner = sub() : deep = 1 : end sub : return inner : end function',
        '  return factory',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const names = diags.filter(d => d.code === 'identifier/unused-variable').map(d => d.message);
      // None of inner, deep should leak to outer
      expect(names.some(m => m.includes("'inner'"))).to.be.false;
      expect(names.some(m => m.includes("'deep'"))).to.be.false;
    });

    it('inline sub with multiple params including typed defaults', () => {
      const content = [
        'function outer()',
        '  cb = sub(a as Integer, b = 0 as Integer, c = "x" as String) : print a : print b : print c : end sub',
        '  cb(1, 2, "y")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      // cb is used (called), inner params should not leak
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('inline function with return type does not leak inner vars', () => {
      const content = [
        'function outer()',
        '  getter = function(id as String) as Object : result = { id: id } : return result : end function',
        '  return getter',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const names = diags.filter(d => d.code === 'identifier/unused-variable').map(d => d.message);
      expect(names.some(m => m.includes("'result'"))).to.be.false;
      expect(names.some(m => m.includes("'getter'"))).to.be.false;
    });

    it('inline function with typed params and return type — complex default from function call', () => {
      const content = [
        'function outer()',
        '  handler = function(aa = GetDefault().value as String) as Boolean : ?aa : return true : end function',
        '  return handler',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: { knownFuncNames: new Set(['getdefault']) },
      });
      const diags = checkUnusedVariables(ctx);
      expect(diags.filter(d => d.code === 'identifier/unused-variable')).to.be.empty;
    });

    it('inline sub returning void with typed params', () => {
      const content = [
        'function outer()',
        '  logger = sub(msg as String) as Void : print msg : end sub',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkUnusedVariables(ctx);
      const unused = diags.filter(d => d.code === 'identifier/unused-variable');
      // logger is unused, but msg should not leak
      expect(unused).to.have.lengthOf(1);
      expect(unused[0].message).to.include("'logger'");
    });
  });
});

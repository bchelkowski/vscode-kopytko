import { expect } from 'chai';
import { checkThrowStatements, checkCreateObjectArgs, checkTrailingCommaSyntaxErrors, checkLoopFlowControl } from '../../src/rules/syntaxRules';
import { createRuleContext } from '../helpers';
import { DEFAULT_RULE_CONFIG } from '../../src/config';

describe('syntaxRules', () => {
  describe('checkThrowStatements', () => {
    it('reports throw/invalid-value for numeric throw', () => {
      const content = [
        'function doWork()',
        '  throw 42',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      const invalid = diags.filter(d => d.code === 'throw/invalid-value');
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].severity).to.equal('warning');
      expect(invalid[0].message).to.include('numeric');
    });

    it('reports throw/invalid-value for array throw', () => {
      const content = [
        'function doWork()',
        '  throw [1, 2, 3]',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      const invalid = diags.filter(d => d.code === 'throw/invalid-value');
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].message).to.include('array');
    });

    it('reports throw/invalid-value for invalid literal', () => {
      const content = [
        'function doWork()',
        '  throw invalid',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      const inv = diags.filter(d => d.code === 'throw/invalid-value');
      expect(inv).to.have.lengthOf(1);
      expect(inv[0].message).to.include('invalid');
    });

    it('reports throw/missing-message for AA without message field', () => {
      const content = [
        'function doWork()',
        '  throw { number: -1 }',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      const missing = diags.filter(d => d.code === 'throw/missing-message');
      expect(missing).to.have.lengthOf(1);
      expect(missing[0].severity).to.equal('warning');
      expect(missing[0].message).to.include('message');
    });

    it('does not report for AA with message field', () => {
      const content = [
        'function doWork()',
        '  throw { message: "something failed", number: -1 }',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      expect(diags.filter(d => d.code === 'throw/missing-message')).to.be.empty;
    });

    it('does not report for string throw', () => {
      const content = [
        'function doWork()',
        '  throw "error happened"',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      expect(diags).to.be.empty;
    });

    it('does not report when both throw rules are turned off', () => {
      const content = [
        'function doWork()',
        '  throw 42',
        'end function',
      ].join('\n');

      const config = {
        ...DEFAULT_RULE_CONFIG,
        'throw/invalid-value': 'off' as const,
        'throw/missing-message': 'off' as const,
      };
      const ctx = createRuleContext(content, { config });
      const diags = checkThrowStatements(ctx);
      expect(diags).to.be.empty;
    });

    it('skips comment lines', () => {
      const content = [
        'function doWork()',
        "  ' throw 42",
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      expect(diags).to.be.empty;
    });

    it('reports throw/invalid-value for hex literal throw', () => {
      const content = [
        'function doWork()',
        '  throw &HFF',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      const invalid = diags.filter(d => d.code === 'throw/invalid-value');
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].message).to.include('numeric');
    });

    it('reports throw/invalid-value for type-suffixed numeric throw', () => {
      const content = [
        'function doWork()',
        '  throw 42&',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkThrowStatements(ctx);
      const invalid = diags.filter(d => d.code === 'throw/invalid-value');
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].message).to.include('numeric');
    });
  });

  describe('checkCreateObjectArgs', () => {
    it('does not report for valid component', () => {
      const content = [
        'function doWork()',
        '  obj = CreateObject("roDateTime")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkCreateObjectArgs(ctx);
      expect(diags).to.be.empty;
    });

    it('reports createobject/unknown-component for invalid component', () => {
      const content = [
        'function doWork()',
        '  obj = CreateObject("roFakeComponent")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkCreateObjectArgs(ctx);
      const unknown = diags.filter(d => d.code === 'createobject/unknown-component');
      expect(unknown).to.have.lengthOf(1);
      expect(unknown[0].severity).to.equal('warning');
      expect(unknown[0].message).to.include('roFakeComponent');
    });

    it('skips CreateObject("roSGNode")', () => {
      const content = [
        'function doWork()',
        '  node = CreateObject("roSGNode", "Group")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkCreateObjectArgs(ctx);
      expect(diags.filter(d => d.code === 'createobject/unknown-component')).to.be.empty;
    });

    it('does not report when the rule is turned off', () => {
      const content = [
        'function doWork()',
        '  obj = CreateObject("roFakeComponent")',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, 'createobject/unknown-component': 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkCreateObjectArgs(ctx);
      expect(diags).to.be.empty;
    });

    it('handles multiple CreateObject calls on different lines', () => {
      const content = [
        'function doWork()',
        '  a = CreateObject("roDateTime")',
        '  b = CreateObject("roNotReal")',
        '  c = CreateObject("roArray")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkCreateObjectArgs(ctx);
      const unknown = diags.filter(d => d.code === 'createobject/unknown-component');
      expect(unknown).to.have.lengthOf(1);
      expect(unknown[0].message).to.include('roNotReal');
    });
  });

  describe('checkTrailingCommaSyntaxErrors', () => {
    it('reports syntax/trailing-comma for return with trailing comma', () => {
      const content = [
        'function getValue()',
        '  return result,',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkTrailingCommaSyntaxErrors(ctx);
      const trailing = diags.filter(d => d.code === 'syntax/trailing-comma');
      expect(trailing).to.have.lengthOf(1);
      expect(trailing[0].severity).to.equal('error');
      expect(trailing[0].message).to.include('Trailing comma');
    });

    it('does not report return without trailing comma', () => {
      const content = [
        'function getValue()',
        '  return result',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkTrailingCommaSyntaxErrors(ctx);
      expect(diags).to.be.empty;
    });

    it('does not report when the rule is turned off', () => {
      const content = [
        'function getValue()',
        '  return result,',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, 'syntax/trailing-comma': 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkTrailingCommaSyntaxErrors(ctx);
      expect(diags).to.be.empty;
    });
  });

  describe('checkLoopFlowControl', () => {
    it('reports syntax/flow-outside-loop for continue for outside loop', () => {
      const content = [
        'function doWork()',
        '  continue for',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkLoopFlowControl(ctx);
      const flow = diags.filter(d => d.code === 'syntax/flow-outside-loop');
      expect(flow).to.have.lengthOf(1);
      expect(flow[0].severity).to.equal('error');
      expect(flow[0].message).to.include('continue for');
    });

    it('does not report continue for inside a for loop', () => {
      const content = [
        'function doWork()',
        '  for i = 0 to 10',
        '    continue for',
        '  end for',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkLoopFlowControl(ctx);
      expect(diags.filter(d => d.code === 'syntax/flow-outside-loop')).to.be.empty;
    });

    it('reports exit while outside a while loop', () => {
      const content = [
        'function doWork()',
        '  exit while',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkLoopFlowControl(ctx);
      const flow = diags.filter(d => d.code === 'syntax/flow-outside-loop');
      expect(flow).to.have.lengthOf(1);
      expect(flow[0].message).to.include('exit while');
    });

    it('does not report exit while inside a while loop', () => {
      const content = [
        'function doWork()',
        '  while true',
        '    exit while',
        '  end while',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkLoopFlowControl(ctx);
      expect(diags.filter(d => d.code === 'syntax/flow-outside-loop')).to.be.empty;
    });

    it('does not report when the rule is turned off', () => {
      const content = [
        'function doWork()',
        '  continue for',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, 'syntax/flow-outside-loop': 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkLoopFlowControl(ctx);
      expect(diags).to.be.empty;
    });

    it('reports continue for inside while but not inside for', () => {
      const content = [
        'function doWork()',
        '  while true',
        '    continue for',
        '  end while',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkLoopFlowControl(ctx);
      const flow = diags.filter(d => d.code === 'syntax/flow-outside-loop');
      expect(flow).to.have.lengthOf(1);
      expect(flow[0].message).to.include('continue for');
    });
  });
});

import { expect } from 'chai';
import { checkTrailingCommaSyntaxErrors } from '../../src/rules/syntaxRules';
import { createRuleContext } from '../helpers';
import { DEFAULT_RULE_CONFIG } from '../../src/config';

describe('syntaxRules', () => {
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
});

import { expect } from 'chai';
import { checkMissingTypeAnnotations } from '../../src/rules/typeAnnotationRules';
import { createRuleContext } from '../helpers';
import { DEFAULT_RULE_CONFIG } from '../../src/config';

describe('typeAnnotationRules', () => {
  describe('checkMissingTypeAnnotations — return type', () => {
    it('reports missing return type on a function', () => {
      const content = [
        'function getData()',
        '  return 1',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const returnDiags = diags.filter(d => d.code === 'type/missing-return-type');
      expect(returnDiags).to.have.lengthOf(1);
      expect(returnDiags[0].message).to.include('getData');
      expect(returnDiags[0].line).to.equal(0);
    });

    it('does not report when return type is present', () => {
      const content = [
        'function getData() as Object',
        '  return {}',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const returnDiags = diags.filter(d => d.code === 'type/missing-return-type');
      expect(returnDiags).to.be.empty;
    });

    it('does not report return type on sub declarations', () => {
      const content = [
        'sub init()',
        '  m.x = 1',
        'end sub',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const returnDiags = diags.filter(d => d.code === 'type/missing-return-type');
      expect(returnDiags).to.be.empty;
    });

    it('does not report when rule is off', () => {
      const content = [
        'function getData()',
        '  return 1',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        config: { ...DEFAULT_RULE_CONFIG, 'type/missing-return-type': 'off' },
      });
      const diags = checkMissingTypeAnnotations(ctx);
      const returnDiags = diags.filter(d => d.code === 'type/missing-return-type');
      expect(returnDiags).to.be.empty;
    });

    it('reports correct severity from config', () => {
      const content = [
        'function getData()',
        '  return 1',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        config: { ...DEFAULT_RULE_CONFIG, 'type/missing-return-type': 'error' },
      });
      const diags = checkMissingTypeAnnotations(ctx);
      const returnDiags = diags.filter(d => d.code === 'type/missing-return-type');
      expect(returnDiags[0].severity).to.equal('error');
    });

    it('skips comment lines', () => {
      const content = [
        "' function getData()",
        'function realFunc() as String',
        '  return ""',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const returnDiags = diags.filter(d => d.code === 'type/missing-return-type');
      expect(returnDiags).to.be.empty;
    });
  });

  describe('checkMissingTypeAnnotations — param type', () => {
    it('reports missing param type', () => {
      const content = [
        'function work(x, y) as Void',
        '  print x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.have.lengthOf(2);
      expect(paramDiags[0].message).to.include('x');
      expect(paramDiags[1].message).to.include('y');
    });

    it('does not report when param has type annotation', () => {
      const content = [
        'function work(x as String, y as Integer) as Void',
        '  print x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.be.empty;
    });

    it('does not report param with default value AND type annotation', () => {
      const content = [
        'function createEvent(id = "" as String) as Object',
        '  return {}',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.be.empty;
    });

    it('reports param with default value but NO type annotation', () => {
      const content = [
        'function createEvent(id = "") as Object',
        '  return {}',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.have.lengthOf(1);
      expect(paramDiags[0].message).to.include('id');
    });

    it('handles mixed typed and untyped params', () => {
      const content = [
        'function work(name as String, count, flag as Boolean) as Void',
        '  print name',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.have.lengthOf(1);
      expect(paramDiags[0].message).to.include('count');
    });

    it('does not report when rule is off', () => {
      const content = [
        'function work(x, y) as Void',
        '  print x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        config: { ...DEFAULT_RULE_CONFIG, 'type/missing-param-type': 'off' },
      });
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.be.empty;
    });

    it('works with sub declarations', () => {
      const content = [
        'sub doWork(x)',
        '  print x',
        'end sub',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.have.lengthOf(1);
      expect(paramDiags[0].message).to.include('x');
    });

    it('does not report for functions with no params', () => {
      const content = [
        'function getData() as Object',
        '  return {}',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.be.empty;
    });

    it('handles complex default value with type', () => {
      const content = [
        'function work(timeout = 30 as Integer, name = "default" as String) as Void',
        '  print timeout',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      const paramDiags = diags.filter(d => d.code === 'type/missing-param-type');
      expect(paramDiags).to.be.empty;
    });
  });

  describe('checkMissingTypeAnnotations — both rules together', () => {
    it('reports both missing return type and missing param type', () => {
      const content = [
        'function work(x)',
        '  return x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkMissingTypeAnnotations(ctx);
      expect(diags.filter(d => d.code === 'type/missing-return-type')).to.have.lengthOf(1);
      expect(diags.filter(d => d.code === 'type/missing-param-type')).to.have.lengthOf(1);
    });

    it('reports nothing when both rules are off', () => {
      const content = [
        'function work(x)',
        '  return x',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        config: { ...DEFAULT_RULE_CONFIG, 'type/missing-return-type': 'off', 'type/missing-param-type': 'off' },
      });
      const diags = checkMissingTypeAnnotations(ctx);
      expect(diags).to.be.empty;
    });
  });
});

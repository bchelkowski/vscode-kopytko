import { expect } from 'chai';
import { checkObserverCallbacks, checkEventCallbacks } from '../../src/rules/callbackRules';
import { createRuleContext } from '../helpers';
import { DEFAULT_RULE_CONFIG } from '../../src/config';

describe('callbackRules', () => {
  // ---------------------------------------------------------------------------
  // checkObserverCallbacks
  // ---------------------------------------------------------------------------

  describe('checkObserverCallbacks', () => {
    const code = 'callback/undefined-observer-callback';

    it('does not report when callback function is in knownFuncNames', () => {
      const content = [
        'function init()',
        '  m.top.observeFieldScoped("focusedChild", "onFocusChanged")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: {
          knownFuncNames: new Set(['onfocuschanged']),
        },
      });

      const diags = checkObserverCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('does not report when callback function is defined in the same file', () => {
      const content = [
        'function init()',
        '  m.top.observeFieldScoped("focusedChild", "onFocusChanged")',
        'end function',
        '',
        'sub onFocusChanged()',
        'end sub',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('reports for an unknown callback function', () => {
      const content = [
        'function init()',
        '  m.top.observeFieldScoped("focusedChild", "onFocusChanged")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      const found = diags.filter(d => d.code === code);
      expect(found).to.have.lengthOf(1);
      expect(found[0].message).to.include('onFocusChanged');
      expect(found[0].line).to.equal(1);
    });

    it('works for observeField (non-scoped variant)', () => {
      const content = [
        'function init()',
        '  m.top.observeField("focusedChild", "onFocusChanged")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      const found = diags.filter(d => d.code === code);
      expect(found).to.have.lengthOf(1);
      expect(found[0].message).to.include('onFocusChanged');
    });

    it('does not report for unobserveField calls', () => {
      const content = [
        'function cleanup()',
        '  m.top.unobserveField("focusedChild")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('does not report for unobserveFieldScoped calls', () => {
      const content = [
        'function cleanup()',
        '  m.top.unobserveFieldScoped("focusedChild")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('does not report when rule is off', () => {
      const content = [
        'function init()',
        '  m.top.observeFieldScoped("focusedChild", "onFocusChanged")',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, [code]: 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkObserverCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('does not report for comment lines', () => {
      const content = [
        'function init()',
        "  ' m.top.observeFieldScoped(\"focusedChild\", \"onFocusChanged\")",
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('does not report when the call is in a trailing comment', () => {
      const content = [
        "function init()",
        "  x = 1 ' m.top.observeFieldScoped(\"field\", \"handler\")",
        "end function",
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('handles multiple observeField calls on separate lines', () => {
      const content = [
        'function init()',
        '  m.top.observeFieldScoped("field1", "handler1")',
        '  m.top.observeFieldScoped("field2", "handler2")',
        'end function',
        '',
        'sub handler1()',
        'end sub',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      const found = diags.filter(d => d.code === code);
      expect(found).to.have.lengthOf(1);
      expect(found[0].message).to.include('handler2');
    });

    it('handles node variable observeField (not just m.top)', () => {
      const content = [
        'function init()',
        '  button.observeFieldScoped("buttonSelected", "onSelect")',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkObserverCallbacks(ctx);
      const found = diags.filter(d => d.code === code);
      expect(found).to.have.lengthOf(1);
      expect(found[0].message).to.include('onSelect');
    });
  });

  // ---------------------------------------------------------------------------
  // checkEventCallbacks
  // ---------------------------------------------------------------------------

  describe('checkEventCallbacks', () => {
    const code = 'callback/undefined-event-callback';

    it('does not report when event callback is in knownFuncNames', () => {
      const content = [
        'function render() as Object',
        '  return {',
        '    name: "Button",',
        '    events: {',
        '      buttonSelected: "_onButtonSelected",',
        '    },',
        '  }',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content, {
        lintContextOverrides: {
          knownFuncNames: new Set(['_onbuttonselected']),
        },
      });

      const diags = checkEventCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('does not report when event callback is defined in the same file', () => {
      const content = [
        'function render() as Object',
        '  return {',
        '    name: "Button",',
        '    events: {',
        '      buttonSelected: "_onButtonSelected",',
        '    },',
        '  }',
        'end function',
        '',
        'sub _onButtonSelected()',
        'end sub',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkEventCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('reports for an unknown event callback', () => {
      const content = [
        'function render() as Object',
        '  return {',
        '    name: "Button",',
        '    events: {',
        '      buttonSelected: "_onButtonSelected",',
        '    },',
        '  }',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkEventCallbacks(ctx);
      const found = diags.filter(d => d.code === code);
      expect(found).to.have.lengthOf(1);
      expect(found[0].message).to.include('_onButtonSelected');
      expect(found[0].line).to.equal(4);
    });

    it('handles multiple events in one block', () => {
      const content = [
        'function render() as Object',
        '  return {',
        '    name: "Button",',
        '    events: {',
        '      buttonSelected: "_onButtonSelected",',
        '      focusPercent: "_onFocusPercentChanged",',
        '    },',
        '  }',
        'end function',
        '',
        'sub _onButtonSelected()',
        'end sub',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkEventCallbacks(ctx);
      const found = diags.filter(d => d.code === code);
      expect(found).to.have.lengthOf(1);
      expect(found[0].message).to.include('_onFocusPercentChanged');
    });

    it('does not report when rule is off', () => {
      const content = [
        'function render() as Object',
        '  return {',
        '    events: {',
        '      buttonSelected: "_onButtonSelected",',
        '    },',
        '  }',
        'end function',
      ].join('\n');

      const config = { ...DEFAULT_RULE_CONFIG, [code]: 'off' as const };
      const ctx = createRuleContext(content, { config });
      const diags = checkEventCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('does not false-positive on non-events AA keys', () => {
      const content = [
        'function render() as Object',
        '  return {',
        '    props: {',
        '      text: "someString",',
        '    },',
        '  }',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkEventCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('does not report for comment lines inside events block', () => {
      const content = [
        'function render() as Object',
        '  return {',
        '    events: {',
        "      ' buttonSelected: \"_onButtonSelected\",",
        '    },',
        '  }',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkEventCallbacks(ctx);
      expect(diags.filter(d => d.code === code)).to.be.empty;
    });

    it('handles events block on a single line', () => {
      const content = [
        'function render() as Object',
        '  return {',
        '    events: { buttonSelected: "_onSelect" },',
        '  }',
        'end function',
      ].join('\n');

      const ctx = createRuleContext(content);
      const diags = checkEventCallbacks(ctx);
      const found = diags.filter(d => d.code === code);
      expect(found).to.have.lengthOf(1);
      expect(found[0].message).to.include('_onSelect');
    });
  });
});

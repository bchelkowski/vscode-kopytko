import { expect } from 'chai';
import { applyCasing, applyCasingWithOverrides, applySnippetCasing, CasingOption } from '../../src/server/brightscript/casingUtils';

describe('casingUtils', () => {
  describe('applyCasing', () => {
    const cases: Array<[CasingOption, string, string]> = [
      // NoChange — identity
      ['NoChange',   'CreateObject',  'CreateObject'],
      ['NoChange',   'push',          'push'],
      ['NoChange',   'for',           'for'],

      // UpperCase
      ['UpperCase',  'CreateObject',  'CREATEOBJECT'],
      ['UpperCase',  'push',          'PUSH'],
      ['UpperCase',  'for',           'FOR'],

      // LowerCase
      ['LowerCase',  'CreateObject',  'createobject'],
      ['LowerCase',  'PUSH',          'push'],
      ['LowerCase',  'for',           'for'],

      // Capitalize — first letter up, everything else down (no word splitting)
      ['Capitalize', 'CreateObject',  'Createobject'],
      ['Capitalize', 'push',          'Push'],
      ['Capitalize', 'for',           'For'],
      ['Capitalize', 'PUSH',          'Push'],

      // PascalCase — split on uppercase boundaries, capitalise each word
      ['PascalCase', 'CreateObject',  'CreateObject'],
      ['PascalCase', 'setUrl',        'SetUrl'],
      ['PascalCase', 'push',          'Push'],
      ['PascalCase', 'for',           'For'],
      ['PascalCase', 'GetToString',   'GetToString'],

      // CamelCase — split on uppercase boundaries, first word lowercase
      ['CamelCase',  'CreateObject',  'createObject'],
      ['CamelCase',  'SetUrl',        'setUrl'],
      ['CamelCase',  'Push',          'push'],
      ['CamelCase',  'for',           'for'],
      ['CamelCase',  'GetToString',   'getToString'],
    ];

    for (const [option, input, expected] of cases) {
      it(`${option}: "${input}" → "${expected}"`, () => {
        expect(applyCasing(input, option)).to.equal(expected);
      });
    }

    it('handles empty string without throwing', () => {
      for (const opt of ['NoChange', 'UpperCase', 'LowerCase', 'Capitalize', 'PascalCase', 'CamelCase'] as CasingOption[]) {
        expect(() => applyCasing('', opt)).not.to.throw();
        expect(applyCasing('', opt)).to.equal('');
      }
    });

    it('handles single character', () => {
      expect(applyCasing('a', 'UpperCase')).to.equal('A');
      expect(applyCasing('A', 'LowerCase')).to.equal('a');
      expect(applyCasing('a', 'Capitalize')).to.equal('A');
      expect(applyCasing('a', 'PascalCase')).to.equal('A');
      expect(applyCasing('A', 'CamelCase')).to.equal('a');
    });

    it('PascalCase and CamelCase differ only on the first word', () => {
      expect(applyCasing('GetToString', 'PascalCase')).to.equal('GetToString');
      expect(applyCasing('GetToString', 'CamelCase')).to.equal('getToString');
    });
  });

  describe('applySnippetCasing', () => {
    it('NoChange leaves snippet unchanged', () => {
      expect(applySnippetCasing('Push(${1:a as Dynamic})', 'NoChange'))
        .to.equal('Push(${1:a as Dynamic})');
    });

    it('LowerCase applies only to method name, not parameters', () => {
      expect(applySnippetCasing('Push(${1:a as Dynamic})', 'LowerCase'))
        .to.equal('push(${1:a as Dynamic})');
    });

    it('UpperCase applies only to method name', () => {
      expect(applySnippetCasing('SetUrl(${1:url as String})', 'UpperCase'))
        .to.equal('SETURL(${1:url as String})');
    });

    it('CamelCase applies only to method name', () => {
      expect(applySnippetCasing('SetUrl(${1:url as String})', 'CamelCase'))
        .to.equal('setUrl(${1:url as String})');
    });

    it('PascalCase applies only to method name', () => {
      expect(applySnippetCasing('setUrl(${1:url as String})', 'PascalCase'))
        .to.equal('SetUrl(${1:url as String})');
    });

    it('Capitalize applies only to method name', () => {
      expect(applySnippetCasing('GetToString()', 'Capitalize'))
        .to.equal('Gettostring()');
    });

    it('works for no-arg snippets', () => {
      expect(applySnippetCasing('Count()', 'LowerCase')).to.equal('count()');
      expect(applySnippetCasing('Count()', 'CamelCase')).to.equal('count()');
      expect(applySnippetCasing('Count()', 'PascalCase')).to.equal('Count()');
    });

    it('works for snippets without parentheses (keywords)', () => {
      expect(applySnippetCasing('for', 'UpperCase')).to.equal('FOR');
      expect(applySnippetCasing('for', 'PascalCase')).to.equal('For');
    });
  });

  // ── applyCasingWithOverrides ──────────────────────────────────────────────

  describe('applyCasingWithOverrides', () => {
    it('returns exact override when match found', () => {
      const exact = { 'invalid': 'Invalid', 'getglobalaa': 'GetGlobalAA' };
      expect(applyCasingWithOverrides('invalid', 'LowerCase', exact)).to.equal('Invalid');
      expect(applyCasingWithOverrides('GETGLOBALAA', 'LowerCase', exact)).to.equal('GetGlobalAA');
    });

    it('falls back to casing rule when no exact match', () => {
      const exact = { 'invalid': 'Invalid' };
      expect(applyCasingWithOverrides('createobject', 'PascalCase', exact)).to.equal('Createobject');
    });

    it('works with empty exact map', () => {
      expect(applyCasingWithOverrides('push', 'UpperCase', {})).to.equal('PUSH');
    });

    it('works with undefined exact map', () => {
      expect(applyCasingWithOverrides('push', 'UpperCase')).to.equal('PUSH');
    });

    it('exact override key matching is case-insensitive', () => {
      const exact = { 'myfunction': 'myFunction' };
      expect(applyCasingWithOverrides('MyFunction', 'LowerCase', exact)).to.equal('myFunction');
      expect(applyCasingWithOverrides('MYFUNCTION', 'LowerCase', exact)).to.equal('myFunction');
    });
  });
});

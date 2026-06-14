import { expect } from 'chai';
import { applyCasing, applyCasingWithOverrides, CasingOption } from '../src/casing';

describe('casing', () => {
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

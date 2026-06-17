import { expect } from 'chai';
import { applyCasing, applyCasingWithOverrides, CasingOption } from '../src/casing';

describe('casing', () => {
  describe('applyCasing', () => {
    const cases: Array<[CasingOption, string, string]> = [
      // preserve — identity
      ['preserve',   'CreateObject',  'CreateObject'],
      ['preserve',   'push',          'push'],
      ['preserve',   'for',           'for'],

      // upper-case
      ['upper-case',  'CreateObject',  'CREATEOBJECT'],
      ['upper-case',  'push',          'PUSH'],
      ['upper-case',  'for',           'FOR'],

      // lower-case
      ['lower-case',  'CreateObject',  'createobject'],
      ['lower-case',  'PUSH',          'push'],
      ['lower-case',  'for',           'for'],

      // Capitalize — first letter up, everything else down (no word splitting)
      ['capitalize', 'CreateObject',  'Createobject'],
      ['capitalize', 'push',          'Push'],
      ['capitalize', 'for',           'For'],
      ['capitalize', 'PUSH',          'Push'],

      // pascal-case — split on uppercase boundaries, capitalise each word
      ['pascal-case', 'CreateObject',  'CreateObject'],
      ['pascal-case', 'setUrl',        'SetUrl'],
      ['pascal-case', 'push',          'Push'],
      ['pascal-case', 'for',           'For'],
      ['pascal-case', 'GetToString',   'GetToString'],

      // camel-case — split on uppercase boundaries, first word lowercase
      ['camel-case',  'CreateObject',  'createObject'],
      ['camel-case',  'SetUrl',        'setUrl'],
      ['camel-case',  'Push',          'push'],
      ['camel-case',  'for',           'for'],
      ['camel-case',  'GetToString',   'getToString'],
    ];

    for (const [option, input, expected] of cases) {
      it(`${option}: "${input}" → "${expected}"`, () => {
        expect(applyCasing(input, option)).to.equal(expected);
      });
    }

    it('handles empty string without throwing', () => {
      for (const opt of ['preserve', 'upper-case', 'lower-case', 'capitalize', 'pascal-case', 'camel-case'] as CasingOption[]) {
        expect(() => applyCasing('', opt)).not.to.throw();
        expect(applyCasing('', opt)).to.equal('');
      }
    });

    it('handles single character', () => {
      expect(applyCasing('a', 'upper-case')).to.equal('A');
      expect(applyCasing('A', 'lower-case')).to.equal('a');
      expect(applyCasing('a', 'capitalize')).to.equal('A');
      expect(applyCasing('a', 'pascal-case')).to.equal('A');
      expect(applyCasing('A', 'camel-case')).to.equal('a');
    });

    it('pascal-case and camel-case differ only on the first word', () => {
      expect(applyCasing('GetToString', 'pascal-case')).to.equal('GetToString');
      expect(applyCasing('GetToString', 'camel-case')).to.equal('getToString');
    });
  });

  // ── applyCasingWithOverrides ──────────────────────────────────────────────

  describe('applyCasingWithOverrides', () => {
    it('returns exact override when match found', () => {
      const exact = { 'invalid': 'Invalid', 'getglobalaa': 'GetGlobalAA' };
      expect(applyCasingWithOverrides('invalid', 'lower-case', exact)).to.equal('Invalid');
      expect(applyCasingWithOverrides('GETGLOBALAA', 'lower-case', exact)).to.equal('GetGlobalAA');
    });

    it('falls back to casing rule when no exact match', () => {
      const exact = { 'invalid': 'Invalid' };
      expect(applyCasingWithOverrides('createobject', 'pascal-case', exact)).to.equal('Createobject');
    });

    it('works with empty exact map', () => {
      expect(applyCasingWithOverrides('push', 'upper-case', {})).to.equal('PUSH');
    });

    it('works with undefined exact map', () => {
      expect(applyCasingWithOverrides('push', 'upper-case')).to.equal('PUSH');
    });

    it('exact override key matching is case-insensitive', () => {
      const exact = { 'myfunction': 'myFunction' };
      expect(applyCasingWithOverrides('MyFunction', 'lower-case', exact)).to.equal('myFunction');
      expect(applyCasingWithOverrides('MYFUNCTION', 'lower-case', exact)).to.equal('myFunction');
    });
  });
});

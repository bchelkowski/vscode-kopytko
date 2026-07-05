import { expect } from 'chai';
import { EcpKeys, LIT_PREFIX, charToLitKey, isValidEcpKey, textToLitKeys } from '../../src/ecp/keys';

describe('EcpKeys / Lit_ encoding', () => {
  describe('textToLitKeys', () => {
    it('keeps unreserved ASCII characters literal', () => {
      expect(textToLitKeys('roku')).to.deep.equal(['Lit_r', 'Lit_o', 'Lit_k', 'Lit_u']);
    });

    it('percent-encodes a space', () => {
      expect(textToLitKeys('a b')).to.deep.equal(['Lit_a', 'Lit_%20', 'Lit_b']);
    });

    it('percent-encodes UTF-8 multi-byte characters (euro sign example from the ECP docs)', () => {
      expect(textToLitKeys('€')).to.deep.equal(['Lit_%E2%82%AC']);
    });

    it('percent-encodes URL-reserved ASCII characters', () => {
      expect(textToLitKeys('a/b?c#d&e')).to.deep.equal([
        'Lit_a', 'Lit_%2F', 'Lit_b', 'Lit_%3F', 'Lit_c', 'Lit_%23', 'Lit_d', 'Lit_%26', 'Lit_e',
      ]);
    });

    it('keeps surrogate pairs together — one key per code point, not per UTF-16 unit', () => {
      const keys = textToLitKeys('😀');
      expect(keys).to.have.length(1);
      expect(keys[0]).to.equal('Lit_%F0%9F%98%80');
    });

    it('returns an empty array for an empty string', () => {
      expect(textToLitKeys('')).to.deep.equal([]);
    });

    it('handles mixed ASCII and non-ASCII text in order', () => {
      expect(textToLitKeys('zażółć')).to.deep.equal([
        'Lit_z', 'Lit_a', 'Lit_%C5%BC', 'Lit_%C3%B3', 'Lit_%C5%82', 'Lit_%C4%87',
      ]);
    });
  });

  describe('charToLitKey', () => {
    it('prefixes with Lit_', () => {
      expect(charToLitKey('r')).to.equal('Lit_r');
      expect(charToLitKey('€')).to.equal('Lit_%E2%82%AC');
    });
  });

  describe('isValidEcpKey', () => {
    it('accepts every named key', () => {
      for (const key of Object.values(EcpKeys)) {
        expect(isValidEcpKey(key), key).to.equal(true);
      }
    });

    it('accepts Lit_-prefixed keys', () => {
      expect(isValidEcpKey('Lit_r')).to.equal(true);
      expect(isValidEcpKey('Lit_%E2%82%AC')).to.equal(true);
    });

    it('rejects unknown named keys and case mismatches', () => {
      expect(isValidEcpKey('home')).to.equal(false);
      expect(isValidEcpKey('NotAKey')).to.equal(false);
      expect(isValidEcpKey('')).to.equal(false);
    });
  });

  it('LIT_PREFIX matches the ECP literal prefix', () => {
    expect(LIT_PREFIX).to.equal('Lit_');
  });
});

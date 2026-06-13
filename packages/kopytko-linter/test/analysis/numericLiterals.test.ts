import { expect } from 'chai';
import {
  inferNumericLiteralType,
  isNumericLiteral,
  stripNumericLiterals,
} from '../../src/analysis/numericLiterals';

describe('numericLiterals', () => {

  describe('inferNumericLiteralType', () => {
    it('returns Integer for plain decimal', () => {
      expect(inferNumericLiteralType('255')).to.equal('Integer');
    });

    it('returns Integer for hex with &H prefix', () => {
      expect(inferNumericLiteralType('&HFF')).to.equal('Integer');
    });

    it('returns Integer for hex with &h prefix', () => {
      expect(inferNumericLiteralType('&hff')).to.equal('Integer');
    });

    it('returns Float for decimal point', () => {
      expect(inferNumericLiteralType('2.01')).to.equal('Float');
    });

    it('returns Float for E exponent', () => {
      expect(inferNumericLiteralType('1.23456E+30')).to.equal('Float');
    });

    it('returns Float for ! suffix', () => {
      expect(inferNumericLiteralType('2!')).to.equal('Float');
    });

    it('returns Double for D exponent', () => {
      expect(inferNumericLiteralType('1.23456789D-12')).to.equal('Double');
    });

    it('returns Double for # suffix', () => {
      expect(inferNumericLiteralType('2.3#')).to.equal('Double');
    });

    it('returns LongInteger for & suffix', () => {
      expect(inferNumericLiteralType('9876543210&')).to.equal('LongInteger');
    });

    it('returns LongInteger for hex with trailing &', () => {
      expect(inferNumericLiteralType('&hFEDCBA9876543210&')).to.equal('LongInteger');
    });

    it('returns undefined for non-numeric string', () => {
      expect(inferNumericLiteralType('hello')).to.be.undefined;
    });
  });

  describe('isNumericLiteral', () => {
    it('returns true for numeric literals', () => {
      expect(isNumericLiteral('255')).to.be.true;
      expect(isNumericLiteral('&HFF')).to.be.true;
    });

    it('returns false for non-numeric strings', () => {
      expect(isNumericLiteral('abc')).to.be.false;
    });
  });

  describe('stripNumericLiterals', () => {
    it('replaces hex literals with spaces', () => {
      const result = stripNumericLiterals('x = &HFF');
      expect(result).to.equal('x =     ');
    });

    it('preserves character offsets', () => {
      const input = 'if x = &HFF then';
      const result = stripNumericLiterals(input);
      expect(result.length).to.equal(input.length);
    });
  });
});

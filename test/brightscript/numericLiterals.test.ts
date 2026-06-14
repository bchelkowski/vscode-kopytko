import { expect } from 'chai';
import {
  inferNumericLiteralType,
  isNumericLiteral,
  stripNumericLiterals,
} from '../../src/server/brightscript/numericLiterals';

describe('numericLiterals', () => {

  // ── inferNumericLiteralType ─────────────────────────────────────────────────

  describe('inferNumericLiteralType', () => {

    // Integer — plain decimal
    it('returns Integer for a plain decimal number', () => {
      expect(inferNumericLiteralType('255')).to.equal('Integer');
    });

    it('returns Integer for zero', () => {
      expect(inferNumericLiteralType('0')).to.equal('Integer');
    });

    it('returns Integer for a negative integer', () => {
      expect(inferNumericLiteralType('-42')).to.equal('Integer');
    });

    it('returns Integer for a number with % suffix', () => {
      expect(inferNumericLiteralType('125%')).to.equal('Integer');
    });

    // Integer — hex
    it('returns Integer for a hex literal with uppercase H', () => {
      expect(inferNumericLiteralType('&HFF')).to.equal('Integer');
    });

    it('returns Integer for a hex literal with lowercase h', () => {
      expect(inferNumericLiteralType('&hFF')).to.equal('Integer');
    });

    it('returns Integer for a hex literal with mixed case digits', () => {
      expect(inferNumericLiteralType('&HaBcDeF')).to.equal('Integer');
    });

    // Float — decimal point
    it('returns Float for a number with a decimal point', () => {
      expect(inferNumericLiteralType('2.01')).to.equal('Float');
    });

    it('returns Float for a number starting with a decimal point', () => {
      expect(inferNumericLiteralType('.5')).to.equal('Float');
    });

    // Float — E exponent
    it('returns Float for a number with E exponent', () => {
      expect(inferNumericLiteralType('1.23456E+30')).to.equal('Float');
    });

    it('returns Float for a number with lowercase e exponent', () => {
      expect(inferNumericLiteralType('1.5e10')).to.equal('Float');
    });

    it('returns Float for a number with E- exponent', () => {
      expect(inferNumericLiteralType('5E-3')).to.equal('Float');
    });

    // Float — ! suffix
    it('returns Float for a number with ! suffix', () => {
      expect(inferNumericLiteralType('2!')).to.equal('Float');
    });

    it('returns Float for a decimal number with ! suffix', () => {
      expect(inferNumericLiteralType('3.14!')).to.equal('Float');
    });

    // Double — D exponent
    it('returns Double for a number with D exponent', () => {
      expect(inferNumericLiteralType('1.23456789D-12')).to.equal('Double');
    });

    it('returns Double for a number with uppercase D exponent', () => {
      expect(inferNumericLiteralType('5D+3')).to.equal('Double');
    });

    // Double — # suffix
    it('returns Double for a number with # suffix', () => {
      expect(inferNumericLiteralType('2.3#')).to.equal('Double');
    });

    it('returns Double for an integer with # suffix', () => {
      expect(inferNumericLiteralType('125#')).to.equal('Double');
    });

    // Double — 10+ digits
    it('returns Double for a number with 10 or more digits', () => {
      expect(inferNumericLiteralType('1234567890')).to.equal('Double');
    });

    it('returns Double for a number with more than 10 digits', () => {
      expect(inferNumericLiteralType('12345678901234')).to.equal('Double');
    });

    // LongInteger — & suffix on decimal
    it('returns LongInteger for a decimal number with & suffix', () => {
      expect(inferNumericLiteralType('9876543210&')).to.equal('LongInteger');
    });

    it('returns LongInteger for a small number with & suffix', () => {
      expect(inferNumericLiteralType('42&')).to.equal('LongInteger');
    });

    // LongInteger — hex with & suffix
    it('returns LongInteger for a hex literal with & suffix', () => {
      expect(inferNumericLiteralType('&hFEDCBA9876543210&')).to.equal('LongInteger');
    });

    it('returns LongInteger for an uppercase hex literal with & suffix', () => {
      expect(inferNumericLiteralType('&HABCDEF&')).to.equal('LongInteger');
    });

    // Non-numeric values
    it('returns undefined for a string', () => {
      expect(inferNumericLiteralType('hello')).to.be.undefined;
    });

    it('returns undefined for an empty string', () => {
      expect(inferNumericLiteralType('')).to.be.undefined;
    });

    it('returns undefined for a boolean-like string', () => {
      expect(inferNumericLiteralType('true')).to.be.undefined;
    });

    it('returns undefined for a string with spaces around a number', () => {
      expect(inferNumericLiteralType(' 255 ')).to.equal('Integer');
    });
  });

  // ── isNumericLiteral ───────────────────────────────────────────────────────

  describe('isNumericLiteral', () => {
    it('returns true for valid numeric literals', () => {
      expect(isNumericLiteral('255')).to.be.true;
      expect(isNumericLiteral('&HFF')).to.be.true;
      expect(isNumericLiteral('2.01')).to.be.true;
      expect(isNumericLiteral('2!')).to.be.true;
      expect(isNumericLiteral('2.3#')).to.be.true;
      expect(isNumericLiteral('42&')).to.be.true;
    });

    it('returns false for non-numeric values', () => {
      expect(isNumericLiteral('hello')).to.be.false;
      expect(isNumericLiteral('')).to.be.false;
      expect(isNumericLiteral('true')).to.be.false;
    });
  });

  // ── stripNumericLiterals ───────────────────────────────────────────────────

  describe('stripNumericLiterals', () => {
    it('replaces hex literals with zeros', () => {
      const result = stripNumericLiterals('x = &HFF');
      expect(result).to.equal('x = 0000');
    });

    it('replaces decimal integers with zeros', () => {
      const result = stripNumericLiterals('x = 255');
      expect(result).to.equal('x = 000');
    });

    it('replaces hex LongInteger with zeros', () => {
      const input = 'x = &hFEDCBA9876543210&';
      const result = stripNumericLiterals(input);
      expect(result.length).to.equal(input.length);
      expect(result).to.not.include('&h');
      expect(result).to.equal('x = ' + '0'.repeat(input.length - 4));
    });

    it('replaces float literals with zeros', () => {
      const result = stripNumericLiterals('x = 2.01');
      expect(result).to.equal('x = 0000');
    });

    it('replaces type-suffixed numbers with zeros', () => {
      const result = stripNumericLiterals('x = 2!');
      expect(result).to.equal('x = 00');
    });

    it('preserves character offsets', () => {
      const input = 'if x = &HFF then';
      const result = stripNumericLiterals(input);
      expect(result.length).to.equal(input.length);
    });

    it('handles multiple numeric literals on one line', () => {
      const result = stripNumericLiterals('arr = [1, &HFF, 2.3]');
      expect(result).to.not.include('&HFF');
    });
  });
});

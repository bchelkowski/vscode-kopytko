import { expect } from 'chai';
import {
  BRIGHTSCRIPT_BUILTINS,
  BRIGHTSCRIPT_KEYWORDS,
  findBuiltin,
} from '../../src/server/brightscript/builtins';

describe('BrightScript builtins', () => {
  describe('BRIGHTSCRIPT_BUILTINS', () => {
    it('contains at least the core math functions', () => {
      const mathFns = BRIGHTSCRIPT_BUILTINS.filter((b) => b.category === 'math');
      const names = mathFns.map((b) => b.name);
      expect(names).to.include.members(['Abs', 'Sin', 'Cos', 'Sqr', 'Rnd']);
    });

    it('contains core string functions', () => {
      const strFns = BRIGHTSCRIPT_BUILTINS.filter((b) => b.category === 'string');
      const names = strFns.map((b) => b.name);
      expect(names).to.include.members(['Len', 'Left', 'Right', 'Mid', 'UCase', 'LCase']);
    });

    it('every entry has a non-empty name, signature, and description', () => {
      for (const b of BRIGHTSCRIPT_BUILTINS) {
        expect(b.name, 'name').to.be.a('string').that.is.not.empty;
        expect(b.signature, `signature for ${b.name}`).to.be.a('string').that.is.not.empty;
        expect(b.description, `description for ${b.name}`).to.be.a('string').that.is.not.empty;
      }
    });

    it('has no duplicate names', () => {
      const names = BRIGHTSCRIPT_BUILTINS.map((b) => b.name.toLowerCase());
      const unique = new Set(names);
      expect(unique.size).to.equal(names.length);
    });
  });

  describe('findBuiltin', () => {
    it('finds a built-in by exact name', () => {
      const result = findBuiltin('Abs');
      expect(result).to.not.be.undefined;
      expect(result!.name).to.equal('Abs');
    });

    it('is case-insensitive', () => {
      const lower = findBuiltin('abs');
      const upper = findBuiltin('ABS');
      expect(lower).to.not.be.undefined;
      expect(upper).to.not.be.undefined;
      expect(lower!.name).to.equal(upper!.name);
    });

    it('returns undefined for unknown identifiers', () => {
      expect(findBuiltin('nonExistentFunction')).to.be.undefined;
    });

    it('finds CreateObject', () => {
      const result = findBuiltin('createobject');
      expect(result).to.not.be.undefined;
      expect(result!.category).to.equal('utility');
    });
  });

  describe('BRIGHTSCRIPT_KEYWORDS', () => {
    it('contains fundamental language keywords', () => {
      expect(BRIGHTSCRIPT_KEYWORDS).to.include.members([
        'function', 'sub', 'if', 'for', 'while', 'return', 'end', 'true', 'false', 'invalid',
      ]);
    });

    it('has no duplicates', () => {
      const unique = new Set(BRIGHTSCRIPT_KEYWORDS);
      expect(unique.size).to.equal(BRIGHTSCRIPT_KEYWORDS.length);
    });
  });
});

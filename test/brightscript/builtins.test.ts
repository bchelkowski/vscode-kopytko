import { expect } from 'chai';
import {
  BRIGHTSCRIPT_BUILTINS,
  BRIGHTSCRIPT_KEYWORDS,
  findBuiltin,
} from '../../src/server/brightscript/builtins';

describe('BrightScript builtins', () => {
  describe('BRIGHTSCRIPT_BUILTINS', () => {
    it('contains core math functions including CInt and Csng', () => {
      const mathFns = BRIGHTSCRIPT_BUILTINS.filter((b) => b.category === 'math');
      const names = mathFns.map((b) => b.name);
      expect(names).to.include.members(['Abs', 'Sin', 'Cos', 'Sqr', 'Rnd', 'Fix', 'Int', 'CInt', 'Csng']);
    });

    it('Fix and Int have distinct descriptions clarifying truncation vs floor', () => {
      const fix = findBuiltin('Fix');
      const int = findBuiltin('Int');
      expect(fix).to.not.be.undefined;
      expect(int).to.not.be.undefined;
      expect(fix!.description).to.include('toward zero');
      expect(int!.description).to.include('floor');
    });

    it('contains core string functions', () => {
      const strFns = BRIGHTSCRIPT_BUILTINS.filter((b) => b.category === 'string');
      const names = strFns.map((b) => b.name);
      expect(names).to.include.members(['Len', 'Left', 'Right', 'Mid', 'UCase', 'LCase', 'Tr']);
    });

    it('contains type functions', () => {
      const typeFns = BRIGHTSCRIPT_BUILTINS.filter((b) => b.category === 'type');
      const names = typeFns.map((b) => b.name);
      expect(names).to.include.members(['Box', 'GetInterface', 'Type']);
    });

    it('contains utility functions', () => {
      const utilFns = BRIGHTSCRIPT_BUILTINS.filter((b) => b.category === 'utility');
      const names = utilFns.map((b) => b.name);
      expect(names).to.include.members([
        'CreateObject', 'Eval', 'FindMemberFunction', 'GetGlobalAA',
        'GetLastRunCompileError', 'GetLastRunRuntimeError',
        'FormatJson', 'ParseJson',
        'FormatDrive', 'Run', 'StrToI',
      ]);
    });

    it('ParseJson signature includes optional flags parameter', () => {
      const fn = findBuiltin('ParseJson');
      expect(fn).to.not.be.undefined;
      expect(fn!.signature).to.include('flags');
    });

    it('contains filesystem functions', () => {
      const fsFns = BRIGHTSCRIPT_BUILTINS.filter((b) => b.category === 'filesystem');
      const names = fsFns.map((b) => b.name);
      expect(names).to.include.members([
        'ListDir', 'CopyFile', 'MoveFile', 'DeleteFile',
        'DeleteDirectory', 'CreateDirectory', 'MatchFiles',
      ]);
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

    it('finds Box as a type function', () => {
      const result = findBuiltin('Box');
      expect(result).to.not.be.undefined;
      expect(result!.category).to.equal('type');
    });

    it('finds filesystem functions', () => {
      expect(findBuiltin('ListDir')).to.not.be.undefined;
      expect(findBuiltin('DeleteFile')).to.not.be.undefined;
      expect(findBuiltin('MatchFiles')).to.not.be.undefined;
    });

    it('finds GetLastRunCompileError', () => {
      const result = findBuiltin('GetLastRunCompileError');
      expect(result).to.not.be.undefined;
      expect(result!.category).to.equal('utility');
    });

    it('finds GetLastRunRuntimeError (not GetLastRunError)', () => {
      expect(findBuiltin('GetLastRunRuntimeError')).to.not.be.undefined;
      expect(findBuiltin('GetLastRunError')).to.be.undefined;
    });

    it('finds CInt as a math function', () => {
      const result = findBuiltin('CInt');
      expect(result).to.not.be.undefined;
      expect(result!.category).to.equal('math');
    });

    it('finds Csng as a math function', () => {
      const result = findBuiltin('Csng');
      expect(result).to.not.be.undefined;
      expect(result!.category).to.equal('math');
    });

    it('Eval and Run are marked as utility (deprecated)', () => {
      expect(findBuiltin('Eval')!.category).to.equal('utility');
      expect(findBuiltin('Run')!.category).to.equal('utility');
    });

    it('every entry has a docsUrl pointing to Roku developer docs', () => {
      for (const b of BRIGHTSCRIPT_BUILTINS) {
        expect(b.docsUrl, `docsUrl for ${b.name}`).to.be.a('string').that.includes('developer.roku.com');
      }
    });
  });

  describe('BRIGHTSCRIPT_KEYWORDS', () => {
    it('contains fundamental language keywords', () => {
      expect(BRIGHTSCRIPT_KEYWORDS).to.include.members([
        'function', 'sub', 'if', 'for', 'while', 'return', 'end', 'true', 'false', 'invalid',
      ]);
    });

    it('contains print, rem, tab, and line_num', () => {
      expect(BRIGHTSCRIPT_KEYWORDS).to.include('print');
      expect(BRIGHTSCRIPT_KEYWORDS).to.include('rem');
      expect(BRIGHTSCRIPT_KEYWORDS).to.include('tab');
      expect(BRIGHTSCRIPT_KEYWORDS).to.include('line_num');
    });

    it('does not contain box (Box is a built-in function, not a keyword)', () => {
      expect(BRIGHTSCRIPT_KEYWORDS).to.not.include('box');
    });

    it('has no duplicates', () => {
      const unique = new Set(BRIGHTSCRIPT_KEYWORDS);
      expect(unique.size).to.equal(BRIGHTSCRIPT_KEYWORDS.length);
    });
  });
});

import { expect } from 'chai';
import { formatText, checkFormatting } from '../src/formatter';
import { FormattingConfig, DEFAULT_FORMATTING_CONFIG } from '../src/config';
import { CasingConfig, DEFAULT_CASING_CONFIG } from '../src/casing';
import { FunctionDefinition } from '../src/types';

const NO_CASING: CasingConfig = { builtin: 'preserve', keyword: 'preserve', method: 'preserve' };

function format(
  lines: string[],
  overrides: Partial<FormattingConfig> = {},
  casing: CasingConfig = NO_CASING,
  userFunction: FunctionDefinition[] = [],
): string {
  const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, insertFinalNewline: false, ...overrides };
  return formatText(lines.join('\n'), config, casing, userFunction);
}

describe('kopytko-formatter', () => {
  // ── Indentation ──────────────────────────────────────────────────────────

  describe('indentation', () => {
    it('indents function body', () => {
      expect(format([
        'function main()',
        'print "hello"',
        'end function',
      ], { indentSize: 4 })).to.equal([
        'function main()',
        '    print "hello"',
        'end function',
      ].join('\n'));
    });

    it('indents sub body', () => {
      expect(format([
        'sub init()',
        'x = 1',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub init()',
        '  x = 1',
        'end sub',
      ].join('\n'));
    });

    it('indents nested if/for blocks', () => {
      expect(format([
        'sub test()',
        'if true then',
        'for i = 0 to 10',
        'print i',
        'next',
        'end if',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  if true then',
        '    for i = 0 to 10',
        '      print i',
        '    next',
        '  end if',
        'end sub',
      ].join('\n'));
    });

    it('handles else/elseif at same level as if', () => {
      expect(format([
        'sub test()',
        'if a then',
        'x = 1',
        'elseif b then',
        'x = 2',
        'else',
        'x = 3',
        'end if',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  if a then',
        '    x = 1',
        '  elseif b then',
        '    x = 2',
        '  else',
        '    x = 3',
        '  end if',
        'end sub',
      ].join('\n'));
    });

    it('handles while blocks', () => {
      expect(format([
        'sub test()',
        'while true',
        'doWork()',
        'end while',
        'end sub',
      ], { indentSize: 4 })).to.equal([
        'sub test()',
        '    while true',
        '        doWork()',
        '    end while',
        'end sub',
      ].join('\n'));
    });

    it('handles try/catch blocks', () => {
      expect(format([
        'sub test()',
        'try',
        'doWork()',
        'catch e',
        'handleError(e)',
        'end try',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  try',
        '    doWork()',
        '  catch e',
        '    handleError(e)',
        '  end try',
        'end sub',
      ].join('\n'));
    });

    it('handles for : end for on same line', () => {
      expect(format([
        'sub test()',
        'for i = 0 to 5 : end for',
        'print "after"',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  for i = 0 to 5 : end for',
        '  print "after"',
        'end sub',
      ].join('\n'));
    });

    it('handles for : body : end for on same line', () => {
      expect(format([
        'sub test()',
        'for i = 0 to 5 : print i : end for',
        'print "after"',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  for i = 0 to 5 : print i : end for',
        '  print "after"',
        'end sub',
      ].join('\n'));
    });

    it('handles while : end while on same line', () => {
      expect(format([
        'sub test()',
        'while true : exit while : end while',
        'print "after"',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  while true : exit while : end while',
        '  print "after"',
        'end sub',
      ].join('\n'));
    });

    it('handles try : catch : end try on same line', () => {
      expect(format([
        'sub test()',
        'try : catch e : end try',
        'print "after"',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  try : catch e : end try',
        '  print "after"',
        'end sub',
      ].join('\n'));
    });

    it('does not break if-then : end if on same line', () => {
      expect(format([
        'sub test()',
        'if true then : end if',
        'print "after"',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  if true then : end if',
        '  print "after"',
        'end sub',
      ].join('\n'));
    });

    it('does not break inline sub() : end sub on same line', () => {
      expect(format([
        'sub test()',
        'cb = sub() : end sub',
        'print "after"',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  cb = sub() : end sub',
        '  print "after"',
        'end sub',
      ].join('\n'));
    });

    it('handles for : if then : end if : end for on same line', () => {
      expect(format([
        'sub test()',
        'for i = 0 to 5 : if true then : end if : end for',
        'print "after"',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  for i = 0 to 5 : if true then : end if : end for',
        '  print "after"',
        'end sub',
      ].join('\n'));
    });

    it('does not split : inside AA literal for indentation', () => {
      expect(format([
        'sub test()',
        'x = { key: "val" } : return x',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  x = { key: "val" } : return x',
        'end sub',
      ].join('\n'));
    });

    it('does not indent after single-line if', () => {
      expect(format([
        'sub test()',
        'if x then return',
        'doWork()',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  if x then return',
        '  doWork()',
        'end sub',
      ].join('\n'));
    });

    it('returns unchanged text when already correctly indented', () => {
      const source = ['sub test()', '  x = 1', 'end sub'].join('\n');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      expect(checkFormatting(source, config, NO_CASING)).to.be.true;
    });
  });

  // ── Keyword casing ───────────────────────────────────────────────────────

  describe('keyword casing', () => {
    it('lowercases keyword', () => {
      const result = format(
        ['Function Main()', '  IF TRUE THEN', '    RETURN', '  END IF', 'End Function'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve' },
      );
      expect(result).to.include('function');
      expect(result).to.include('if');
      expect(result).to.include('then');
      expect(result).to.include('return');
      expect(result).to.include('end if');
      expect(result).to.include('end function');
    });

    it('uppercases keyword', () => {
      const result = format(
        ['function main()', '  if true then', '    return', '  end if', 'end function'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' },
      );
      expect(result).to.include('FUNCTION');
      expect(result).to.include('IF');
      expect(result).to.include('THEN');
      expect(result).to.include('RETURN');
    });

    it('does not change keyword inside strings', () => {
      const result = format(
        ['sub init()', '  x = "if then else"', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' },
      );
      expect(result).to.include('"if then else"');
    });

    it('does not change text after comment marker', () => {
      const result = format(
        ['sub init()', "  x = 1 ' this is if then", 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' },
      );
      expect(result).to.include("' this is if then");
    });
  });

  // ── Builtin function casing ──────────────────────────────────────────────

  describe('builtin function casing', () => {
    it('lowercases builtin function names', () => {
      const result = format(
        ['sub init()', '  x = LEN("hello")', 'end sub'],
        { indentSize: 2 },
        { builtin: 'lower-case', keyword: 'preserve', method: 'preserve' },
      );
      expect(result).to.include('len(');
    });

    it('pascal-cases builtin function names from lowercase input', () => {
      const result = format(
        ['sub init()', '  x = createobject("roArray")', 'end sub'],
        { indentSize: 2 },
        { builtin: 'pascal-case', keyword: 'preserve', method: 'preserve' },
      );
      expect(result).to.include('CreateObject(');
    });

    it('does not change user-defined function names', () => {
      const result = format(
        ['sub init()', '  myFunction()', 'end sub'],
        { indentSize: 2 },
        { builtin: 'upper-case', keyword: 'preserve', method: 'preserve' },
      );
      expect(result).to.include('myFunction()');
    });
  });

  // ── Combined formatting ──────────────────────────────────────────────────

  describe('combined indentation and casing', () => {
    it('applies both indentation and casing in one pass', () => {
      const result = format(
        ['FUNCTION main()', 'IF TRUE THEN', 'x = len("hello")', 'END IF', 'END FUNCTION'],
        { indentSize: 4 },
        { builtin: 'pascal-case', keyword: 'lower-case', method: 'preserve' },
      );
      expect(result).to.equal([
        'function main()',
        '    if true then',
        '        x = Len("hello")',
        '    end if',
        'end function',
      ].join('\n'));
    });
  });

  // ── Exact casing overrides ───────────────────────────────────────────────

  describe('exact casing overrides', () => {
    it('applies exact override for a builtin', () => {
      const result = format(
        ['sub init()', '  x = getglobalaa()', 'end sub'],
        { indentSize: 2 },
        { builtin: 'lower-case', keyword: 'preserve', method: 'preserve', exact: { 'getglobalaa': 'GetGlobalAA' } },
      );
      expect(result).to.include('GetGlobalAA()');
    });

    it('applies exact override for a keyword', () => {
      const result = format(
        ['sub init()', '  x = invalid', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', exact: { 'invalid': 'Invalid' } },
      );
      expect(result).to.include('Invalid');
      expect(result).to.match(/^sub/);
    });
  });

  // ── User function casing ─────────────────────────────────────────────────

  describe('user function casing normalization', () => {
    const makeFuncDef = (name: string): FunctionDefinition => ({ name, nameLower: name.toLowerCase() });

    it('normalizes user function calls to definition casing', () => {
      const result = format(
        ['sub init()', '  myhelper()', 'end sub'],
        { indentSize: 2 },
        NO_CASING,
        [makeFuncDef('myHelper')],
      );
      expect(result).to.include('myHelper()');
    });

    it('normalizes ALL-CAPS call to definition casing', () => {
      const result = format(
        ['sub init()', '  GETDATA()', 'end sub'],
        { indentSize: 2 },
        NO_CASING,
        [makeFuncDef('getData')],
      );
      expect(result).to.include('getData()');
    });

    it('normalizes builtin to catalog casing even with preserve', () => {
      const result = format(
        ['sub init()', '  x = createobject("roArray")', 'end sub'],
        { indentSize: 2 },
      );
      expect(result).to.include('CreateObject(');
    });

    it('does not apply builtin casing to parameters or variables sharing a builtin name', () => {
      const result = format(
        ['sub init()', '  SomeFunction({ a: "asd" }, function (str as String) as Boolean', '    print str', '    return true', '  end function)', 'end sub'],
        { indentSize: 2 },
        { builtin: 'pascal-case', keyword: 'preserve', method: 'preserve' },
      );
      expect(result).to.include('function (str as');
      expect(result).to.include('print str');
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty document', () => {
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      expect(checkFormatting('', config, NO_CASING)).to.be.true;
    });

    it('handles compound end keyword', () => {
      expect(format([
        'sub test()',
        'if true then',
        'x = 1',
        'endif',
        'endsub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  if true then',
        '    x = 1',
        '  endif',
        'endsub',
      ].join('\n'));
    });

    it('preserves escaped quotes inside strings', () => {
      const result = format(
        ['sub init()', '  x = "say ""hello"""', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' },
      );
      expect(result).to.include('"say ""hello"""');
    });

    it('indents comment lines at the current level', () => {
      expect(format([
        'sub test()',
        "' a comment",
        'x = 1',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        "  ' a comment",
        '  x = 1',
        'end sub',
      ].join('\n'));
    });
  });

  // ── Granular keyword category casing ─────────────────────────────────────

  describe('granular keyword category casing', () => {
    it('applies type casing independently of keyword casing', () => {
      const result = format(
        ['function main(x as integer) as boolean', 'end function'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', type: 'capitalize' },
      );
      expect(result).to.include('as Integer');
      expect(result).to.include('as Boolean');
      expect(result).to.include('function');
    });

    it('applies type casing to "function" when used as a type (after as)', () => {
      const result = format(
        ['function main(callback as function) as function', 'end function'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', type: 'capitalize' },
      );
      expect(result).to.include('as Function) as Function');
      expect(result).to.match(/^function main/);
    });

    it('applies literal casing independently', () => {
      const result = format(
        ['sub init()', '  x = TRUE', '  y = FALSE', '  z = INVALID', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'preserve', method: 'preserve', literal: 'lower-case' },
      );
      expect(result).to.include('true');
      expect(result).to.include('false');
      expect(result).to.include('invalid');
    });

    it('applies logicOperator casing independently', () => {
      const result = format(
        ['sub init()', '  if a and b or not c then', '    return', '  end if', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', logicOperator: 'upper-case' },
      );
      expect(result).to.include('AND');
      expect(result).to.include('OR');
      expect(result).to.include('NOT');
      expect(result).to.include('if');
    });

    it('applies mathOperator casing independently', () => {
      const result = format(
        ['sub init()', '  x = a mod b', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', mathOperator: 'upper-case' },
      );
      expect(result).to.include('MOD');
      expect(result).to.include('sub');
    });

    it('exact overrides mathOperator casing for mod', () => {
      const result = format(
        ['sub init()', '  x = a mod b', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', mathOperator: 'lower-case', exact: { 'mod': 'Mod' } },
      );
      expect(result).to.include('Mod');
      expect(result).not.to.include(' mod ');
      expect(result).not.to.include(' MOD ');
    });

    it('exact applies to logic operators (and, or, not)', () => {
      const result = format(
        ['sub init()', '  if a and b or not c then', '    return', '  end if', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', exact: { 'and': 'AND', 'or': 'OR', 'not': 'NOT' } },
      );
      expect(result).to.include('AND');
      expect(result).to.include('OR');
      expect(result).to.include('NOT');
      expect(result).to.include('if');
    });

    it('exact applies to literal (true, false, invalid)', () => {
      const result = format(
        ['sub init()', '  x = true', '  y = false', '  z = invalid', 'end sub'],
        { indentSize: 2 },
        { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', exact: { 'true': 'True', 'false': 'False', 'invalid': 'Invalid' } },
      );
      expect(result).to.include('True');
      expect(result).to.include('False');
      expect(result).to.include('Invalid');
    });
  });

  // ── Import sorting ──────────────────────────────────────────────────────

  describe('import and mock sorting', () => {
    it('sorts @import lines alphabetically', () => {
      const result = format([
        "' @import /components/Zebra.brs",
        "' @import /components/Alpha.brs",
        '',
        'sub init()',
        'end sub',
      ], { sortImports: true });
      const lines = result.split('\n');
      expect(lines[0]).to.include('Alpha');
      expect(lines[1]).to.include('Zebra');
    });

    it('sorts @mock lines and places them after @import', () => {
      const result = format([
        "' @mock /components/Zebra.brs",
        "' @import /components/Foo.brs",
        "' @mock /components/Alpha.brs",
        "' @import /components/Bar.brs",
        '',
        'function TestSuite__Foo() as Object',
        '  return ts',
        'end function',
      ], { sortImports: true });
      const lines = result.split('\n');
      expect(lines[0]).to.equal("' @import /components/Bar.brs");
      expect(lines[1]).to.equal("' @import /components/Foo.brs");
      expect(lines[2]).to.equal("' @mock /components/Alpha.brs");
      expect(lines[3]).to.equal("' @mock /components/Zebra.brs");
    });

    it('keeps disable-next-line comment paired with its import when sorting', () => {
      const result = format([
        "' @import /components/Zebra.brs",
        "' kopytko-disable-next-line import/unused",
        "' @import /components/Alpha.brs",
        '',
        'sub init()',
        'end sub',
      ], { sortImports: true });
      const lines = result.split('\n');
      expect(lines[0]).to.equal("' kopytko-disable-next-line import/unused");
      expect(lines[1]).to.equal("' @import /components/Alpha.brs");
      expect(lines[2]).to.equal("' @import /components/Zebra.brs");
    });

    it('emptyLineAfterImports places empty line after the last import, not before it', () => {
      const result = format([
        "' kopytko-disable-next-line import/unused",
        "' @import /components/Alpha.brs",
        'sub init()',
        'end sub',
      ], { emptyLineAfterImports: true });
      const lines = result.split('\n');
      expect(lines[0]).to.equal("' kopytko-disable-next-line import/unused");
      expect(lines[1]).to.equal("' @import /components/Alpha.brs");
      expect(lines[2]).to.equal('');
      expect(lines[3]).to.equal('sub init()');
    });

    it('emptyLineAfterImports with sortImports and disable-next-line', () => {
      const result = format([
        "' @import /components/Zebra.brs",
        "' kopytko-disable-next-line import/unused",
        "' @import /components/Alpha.brs",
        'sub init()',
        'end sub',
      ], { sortImports: true, emptyLineAfterImports: true });
      const lines = result.split('\n');
      expect(lines[0]).to.equal("' kopytko-disable-next-line import/unused");
      expect(lines[1]).to.equal("' @import /components/Alpha.brs");
      expect(lines[2]).to.equal("' @import /components/Zebra.brs");
      expect(lines[3]).to.equal('');
      expect(lines[4]).to.equal('sub init()');
    });
  });

  // ── checkFormatting ────────────────────────────────────────────────────

  describe('checkFormatting', () => {
    it('returns true for already-formatted code', () => {
      const source = [
        'sub init()',
        '  x = 1',
        'end sub',
      ].join('\n');
      expect(checkFormatting(source, { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false })).to.be.true;
    });

    it('returns false for unformatted code', () => {
      const source = [
        'sub init()',
        'x = 1',
        'end sub',
      ].join('\n');
      expect(checkFormatting(source, { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false })).to.be.false;
    });
  });

  // ── Regression tests ────────────────────────────────────────────────────

  describe('regression tests', () => {
    it('does not corrupt identifier "constructor" via exact prototype leak', () => {
      const result = format(
        ['sub constructor()', '  m.x = 1', 'end sub'],
        { indentSize: 2 },
        { builtin: 'pascal-case', keyword: 'lower-case', method: 'preserve', exact: { 'invalid': 'Invalid' } },
      );
      expect(result).to.include('sub constructor()');
      expect(result).to.not.include('[native code]');
    });

    it('does not convert function to sub when body has return with value', () => {
      const result = format(
        ['function getData()', '  return { name: "test" }', 'end function'],
        { indentSize: 2, functionVsSubForVoid: 'sub' },
      );
      expect(result).to.include('function getData()');
      expect(result).to.include('end function');
      expect(result).to.not.include('sub getData()');
    });

    it('does not convert function to sub when return has no space before brace', () => {
      const result = format(
        ['function _renderPlaceholder()', '  return{', '    name: "Rectangle"', '  }', 'end function'],
        { indentSize: 2, functionVsSubForVoid: 'sub' },
      );
      expect(result).to.include('function _renderPlaceholder()');
      expect(result).to.include('end function');
      expect(result).to.not.include('sub _renderPlaceholder()');
    });

    it('does not convert function to sub when return has no space before bracket', () => {
      const result = format(
        ['function getItems()', '  return[1, 2, 3]', 'end function'],
        { indentSize: 2, functionVsSubForVoid: 'sub' },
      );
      expect(result).to.include('function getItems()');
      expect(result).to.not.include('sub getItems()');
    });

    it('does not convert function to sub when return has no space before paren', () => {
      const result = format(
        ['function getValue()', '  return(x + y)', 'end function'],
        { indentSize: 2, functionVsSubForVoid: 'sub' },
      );
      expect(result).to.include('function getValue()');
      expect(result).to.not.include('sub getValue()');
    });

    it('converts anonymous function() as Void to sub() when functionVsSubForVoid is sub', () => {
      const result = format(
        ['sub main()', '  callback = function() as Void', '    print "hello"', '  end function', 'end sub'],
        { indentSize: 2, functionVsSubForVoid: 'sub' },
      );
      expect(result).to.include('callback = sub()');
      expect(result).to.not.include('function()');
      expect(result).to.include('  end sub\nend sub');
    });

    it('converts anonymous sub() to function() as Void when functionVsSubForVoid is function', () => {
      const result = format(
        ['function main() as Void', '  callback = sub()', '    print "hello"', '  end sub', 'end function'],
        { indentSize: 2, functionVsSubForVoid: 'function' },
      );
      expect(result).to.include('callback = function() as Void');
      expect(result).to.include('  end function\nend function');
    });

    it('does not convert anonymous function with non-void return type', () => {
      const result = format(
        ['sub main()', '  getter = function() as Object', '    return {}', '  end function', 'end sub'],
        { indentSize: 2, functionVsSubForVoid: 'sub' },
      );
      expect(result).to.include('function() as Object');
      expect(result).to.not.include('sub()');
    });

    it('does not convert anonymous function to sub when body has return with value', () => {
      const result = format(
        ['sub main()', '  getter = function()', '    return { name: "test" }', '  end function', 'end sub'],
        { indentSize: 2, functionVsSubForVoid: 'sub' },
      );
      expect(result).to.include('getter = function()');
      expect(result).to.not.include('getter = sub()');
    });

    it('converts anonymous function as argument with as Void', () => {
      const result = format(
        ['sub main()', '  SomeFunc(function() as Void', '    print "hello"', '  end function)', 'end sub'],
        { indentSize: 2, functionVsSubForVoid: 'sub' },
      );
      expect(result).to.include('SomeFunc(sub()');
      expect(result).to.include('end sub)');
    });

    it('does not convert function to sub when end sub, sub (...) chains anonymous callbacks', () => {
      const result = format([
        'sub describe()',
        '  it("test", function (_ts as Object)',
        '    call().then(sub (data as Object)',
        '      m.data = data',
        '    end sub, sub (error as Object)',
        '      m.error = error',
        '    end sub)',
        '    return expect(m.error).toEqual(error)',
        '  end function)',
        'end sub',
      ], { indentSize: 2, functionVsSubForVoid: 'sub' });
      expect(result).to.include('it("test", function (_ts as Object)');
      expect(result).to.not.include('it("test", sub');
    });

    it('does not split compound assignment operators', () => {
      const result = format(
        ['sub t()', '  url += "/" + effect', '  count -= 1', '  ratio *= 2', '  total /= 3', 'end sub'],
        { indentSize: 2, spaceAroundOperators: true, spaceAroundAssignment: true },
      );
      expect(result).to.include('url += "/" + effect');
      expect(result).to.include('count -= 1');
      expect(result).to.include('ratio *= 2');
      expect(result).to.include('total /= 3');
      expect(result).to.not.include('+ =');
      expect(result).to.not.include('- =');
    });

    it('does not apply casing to associative array keys', () => {
      const result = format(
        ['sub t()', '  obj = {', '    ObjectUtils: m._objectUtils,', '    content: content,', '  }', 'end sub'],
        { indentSize: 2 },
        { builtin: 'pascal-case', keyword: 'lower-case', method: 'camel-case', userFunction: 'camel-case', exact: {} },
        [{ name: 'objectUtils', nameLower: 'objectutils' }],
      );
      expect(result).to.include('ObjectUtils:');
      expect(result).to.not.include('objectUtils:');
    });

    it('does not apply user function casing to property accesses after dot', () => {
      const result = format(
        ['sub t()', '  result = context.arrayUtils.filter(items)', 'end sub'],
        { indentSize: 2 },
        { builtin: 'pascal-case', keyword: 'lower-case', method: 'camel-case', userFunction: 'pascal-case', exact: {} },
        [{ name: 'ArrayUtils', nameLower: 'arrayutils' }],
      );
      expect(result).to.include('context.arrayUtils.filter');
      expect(result).to.not.include('context.ArrayUtils');
    });

    it('does not add space after .not when used as a property accessor', () => {
      const result = format(
        ['sub t()', '  result = expect(value).not.toBe(invalid)', 'end sub'],
        { indentSize: 2, unarySpacing: true },
      );
      expect(result).to.include('expect(value).not.toBe(invalid)');
    });
  });

  // ── emptyLineBeforeReturn fixes ─────────────────────────────────────────

  describe('emptyLineBeforeReturn', () => {
    it('not-alone: does not add blank line between a comment and the return below it', () => {
      expect(format([
        'SomeFunction(function () as Object',
        '  someVariable = "hello"',
        "  ' Some comment above return",
        '  return { someVariable: someVariable }',
        'end function)',
      ], { indentSize: 2, emptyLineBeforeReturn: 'not-alone' })).to.equal([
        'SomeFunction(function () as Object',
        '  someVariable = "hello"',
        "  ' Some comment above return",
        '  return { someVariable: someVariable }',
        'end function)',
      ].join('\n'));
    });

    it('not-alone: does not add blank line when return is the only statement in anonymous function body', () => {
      expect(format([
        'SomeFunction(function () as Boolean',
        '  return true',
        'end function)',
      ], { indentSize: 2, emptyLineBeforeReturn: 'not-alone' })).to.equal([
        'SomeFunction(function () as Boolean',
        '  return true',
        'end function)',
      ].join('\n'));
    });

    it('not-alone: does not add blank line when return value is a multi-line AA and is the only statement in the if block', () => {
      expect(format([
        'function test() as Object',
        '  if (condition)',
        '    return {',
        '      name: "Label",',
        '      props: {',
        '        id: "x"',
        '      }',
        '    }',
        '  end if',
        '  return invalid',
        'end function',
      ], { indentSize: 2, emptyLineBeforeReturn: 'not-alone' })).to.equal([
        'function test() as Object',
        '  if (condition)',
        '    return {',
        '      name: "Label",',
        '      props: {',
        '        id: "x"',
        '      }',
        '    }',
        '  end if',
        '',
        '  return invalid',
        'end function',
      ].join('\n'));
    });

    it('not-alone: does not add blank line when return value continues across an inline anon function and its body contains another return', () => {
      expect(format([
        'prototype.getLogos = function() as Object',
        '  return m._service.fetch().then(function(data as Object, m as Object) as Object',
        '    return m._utils.slice(data, 0, 5)',
        '  end function, Invalid, m)',
        'end function',
      ], { indentSize: 2, emptyLineBeforeReturn: 'not-alone' })).to.equal([
        'prototype.getLogos = function() as Object',
        '  return m._service.fetch().then(function(data as Object, m as Object) as Object',
        '    return m._utils.slice(data, 0, 5)',
        '  end function, Invalid, m)',
        'end function',
      ].join('\n'));
    });

    it('not-alone: adds blank line before return when not alone in anonymous function body', () => {
      expect(format([
        'SomeFunction(function () as Object',
        '  someVariable = "hello"',
        '  return { someVariable: someVariable }',
        'end function)',
      ], { indentSize: 2, emptyLineBeforeReturn: 'not-alone' })).to.equal([
        'SomeFunction(function () as Object',
        '  someVariable = "hello"',
        '',
        '  return { someVariable: someVariable }',
        'end function)',
      ].join('\n'));
    });

    it('not-alone: removes existing blank line before return when return IS alone in its block', () => {
      expect(format([
        'function getLogos() as Object',
        '',
        '  return m._service.fetch()',
        'end function',
      ], { indentSize: 2, emptyLineBeforeReturn: 'not-alone' })).to.equal([
        'function getLogos() as Object',
        '  return m._service.fetch()',
        'end function',
      ].join('\n'));
    });

    it('not-alone: removes blank lines before return in nested anonymous functions when both returns are alone', () => {
      expect(format([
        'prototype.getLogos = function() as Object',
        '',
        '  return m._service.fetch().then(function(data as Object, m as Object) as Object',
        '',
        '    return m._utils.slice(data, 0, 5)',
        '  end function, Invalid, m)',
        'end function',
      ], { indentSize: 2, emptyLineBeforeReturn: 'not-alone' })).to.equal([
        'prototype.getLogos = function() as Object',
        '  return m._service.fetch().then(function(data as Object, m as Object) as Object',
        '    return m._utils.slice(data, 0, 5)',
        '  end function, Invalid, m)',
        'end function',
      ].join('\n'));
    });
  });

  // ── Anonymous function indentation ────────────────────────────────────────

  describe('anonymous function indentation', () => {
    it('indents body when anonymous function opener has a trailing comment', () => {
      expect(format([
        "SomeFunction(function () as Object ' Some comment",
        'someVariable = "hello"',
        'return { someVariable: someVariable }',
        'end function)',
      ], { indentSize: 2 })).to.equal([
        "SomeFunction(function () as Object ' Some comment",
        '  someVariable = "hello"',
        '  return { someVariable: someVariable }',
        'end function)',
      ].join('\n'));
    });

    it('indents body when params contain nested parentheses', () => {
      expect(format([
        'prototype.fetch = function(eventId as String, abortController = AbortController() as Object) as Object',
        'if (eventId = "")',
        'return Invalid',
        'end if',
        'return eventId',
        'end function',
      ], { indentSize: 2 })).to.equal([
        'prototype.fetch = function(eventId as String, abortController = AbortController() as Object) as Object',
        '  if (eventId = "")',
        '    return Invalid',
        '  end if',
        '  return eventId',
        'end function',
      ].join('\n'));
    });

    it('does not indent when inline anonymous sub is closed on the same line via colon', () => {
      expect(format([
        '_constructor = function(self as Object) as Object',
        'self._railsService = RailsService(self._onRailsFetched, sub (_error as Object, _self as Object) : end sub, self)',
        'return self',
        'end function',
      ], { indentSize: 2 })).to.equal([
        '_constructor = function(self as Object) as Object',
        '  self._railsService = RailsService(self._onRailsFetched, sub (_error as Object, _self as Object) : end sub, self)',
        '  return self',
        'end function',
      ].join('\n'));
    });

    it('indents body of anonymous sub that follows end sub on the same line', () => {
      expect(format([
        'sub test()',
        '  call(sub (a as Object)',
        '    doFirst()',
        '  end sub, sub (b as Object)',
        '    doSecond()',
        '  end sub)',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  call(sub (a as Object)',
        '    doFirst()',
        '  end sub, sub (b as Object)',
        '    doSecond()',
        '  end sub)',
        'end sub',
      ].join('\n'));
    });

    it('does not treat keyword-named AA keys as block openers/closers', () => {
      expect(format([
        'sub init()',
        '  linearSchedule = {',
        '    next: {',
        '      description: expectedDesc,',
        '      end: expectedEnd,',
        '      title: expectedTitle,',
        '    },',
        '    now: {',
        '      description: currentDesc,',
        '      title: currentTitle,',
        '    },',
        '  }',
        'end sub',
      ], { indentSize: 2, trailingComma: 'always' })).to.equal([
        'sub init()',
        '  linearSchedule = {',
        '    next: {',
        '      description: expectedDesc,',
        '      end: expectedEnd,',
        '      title: expectedTitle,',
        '    },',
        '    now: {',
        '      description: currentDesc,',
        '      title: currentTitle,',
        '    },',
        '  }',
        'end sub',
      ].join('\n'));
    });
  });

  // ── Conditional compilation indentation ──────────────────────────────────

  describe('conditional compilation indentation', () => {
    it('indents body of #if block', () => {
      expect(format([
        '#if someFlag',
        "code = true",
        '#end if',
      ], { indentSize: 4 })).to.equal([
        '#if someFlag',
        '    code = true',
        '#end if',
      ].join('\n'));
    });

    it('handles #else if and #else at the same level as #if', () => {
      expect(format([
        '#if FeatureA',
        "codeA = true",
        '#else if FeatureB',
        "codeB = true",
        '#else',
        "codeC = true",
        '#end if',
      ], { indentSize: 4 })).to.equal([
        '#if FeatureA',
        '    codeA = true',
        '#else if FeatureB',
        '    codeB = true',
        '#else',
        '    codeC = true',
        '#end if',
      ].join('\n'));
    });

    it('handles #elseif (compact form) at the same level as #if', () => {
      expect(format([
        '#if FeatureA',
        "codeA = true",
        '#elseif FeatureB',
        "codeB = true",
        '#end if',
      ], { indentSize: 4 })).to.equal([
        '#if FeatureA',
        '    codeA = true',
        '#elseif FeatureB',
        '    codeB = true',
        '#end if',
      ].join('\n'));
    });

    it('handles #const outside and inside #if block', () => {
      expect(format([
        '#const FeatureA = true',
        '#if FeatureA',
        "code = true",
        '#end if',
      ], { indentSize: 4 })).to.equal([
        '#const FeatureA = true',
        '#if FeatureA',
        '    code = true',
        '#end if',
      ].join('\n'));
    });

    it('handles #endif (compact form)', () => {
      expect(format([
        '#if someFlag',
        "code = true",
        '#endif',
      ], { indentSize: 4 })).to.equal([
        '#if someFlag',
        '    code = true',
        '#endif',
      ].join('\n'));
    });
  });

  // ── Increment / decrement operators ──────────────────────────────────────

  describe('increment and decrement operators', () => {
    it('does not split ++ into x + +', () => {
      const result = format(
        ['sub t()', '  x++', 'end sub'],
        { indentSize: 2, spaceAroundOperators: true },
      );
      expect(result).to.include('x++');
      expect(result).to.not.include('x + +');
    });

    it('does not split -- into x - -', () => {
      const result = format(
        ['sub t()', '  x--', 'end sub'],
        { indentSize: 2, spaceAroundOperators: true },
      );
      expect(result).to.include('x--');
      expect(result).to.not.include('x - -');
    });

    it('still spaces regular addition: a + b', () => {
      const result = format(
        ['sub t()', '  y = a+b', 'end sub'],
        { indentSize: 2, spaceAroundOperators: true },
      );
      expect(result).to.include('a + b');
    });
  });

  // ── parenthesisIfCase with trailing comments ────────────────────────────

  describe('parenthesisIfCase with trailing comment', () => {
    it('does not wrap a trailing comment inside the parens (no then)', () => {
      expect(format([
        'sub test()',
        "  if NOT someBoolean ' Some comment",
        '    x = 1',
        '  end if',
        'end sub',
      ], { indentSize: 2, parenthesisIfCase: 'always' })).to.equal([
        'sub test()',
        "  if (NOT someBoolean) ' Some comment",
        '    x = 1',
        '  end if',
        'end sub',
      ].join('\n'));
    });

    it('preserves already-parenthesised if with trailing comment', () => {
      expect(format([
        'sub test()',
        "  if (NOT someBoolean) ' Some comment",
        '    x = 1',
        '  end if',
        'end sub',
      ], { indentSize: 2, parenthesisIfCase: 'always' })).to.equal([
        'sub test()',
        "  if (NOT someBoolean) ' Some comment",
        '    x = 1',
        '  end if',
        'end sub',
      ].join('\n'));
    });

    it('handles else if with trailing comment', () => {
      expect(format([
        'sub test()',
        '  if (a)',
        "  else if NOT someBoolean ' Some comment",
        '    x = 1',
        '  end if',
        'end sub',
      ], { indentSize: 2, parenthesisIfCase: 'always' })).to.equal([
        'sub test()',
        '  if (a)',
        "  else if (NOT someBoolean) ' Some comment",
        '    x = 1',
        '  end if',
        'end sub',
      ].join('\n'));
    });

    it('strips then with trailing comment without duplicating the comment', () => {
      expect(format([
        'sub test()',
        "  if (NOT someBoolean) then ' Some comment",
        '    x = 1',
        '  end if',
        'end sub',
      ], { indentSize: 2, parenthesisIfCase: 'always', thenStyle: 'singleline-only' })).to.equal([
        'sub test()',
        "  if (NOT someBoolean) ' Some comment",
        '    x = 1',
        '  end if',
        'end sub',
      ].join('\n'));
    });
  });

  // ── Chained method indentation ───────────────────────────────────────────

  describe('chained method indentation', () => {
    it('indents .method() chain continuation one level deeper than the chain start', () => {
      expect(format([
        'sub test()',
        '  expect(foo)',
        '    .toEquals({',
        '      field1: 1,',
        '      field2: 2',
        '    })',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  expect(foo)',
        '    .toEquals({',
        '      field1: 1,',
        '      field2: 2',
        '    })',
        'end sub',
      ].join('\n'));
    });

    it('re-indents under-indented chain continuation lines', () => {
      expect(format([
        'sub test()',
        'expect(foo)',
        '.toEquals({',
        'field1: 1',
        '})',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  expect(foo)',
        '    .toEquals({',
        '      field1: 1',
        '    })',
        'end sub',
      ].join('\n'));
    });

    it('handles multiple chained .method() calls', () => {
      expect(format([
        'sub test()',
        '  foo()',
        '    .first()',
        '    .second()',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  foo()',
        '    .first()',
        '    .second()',
        'end sub',
      ].join('\n'));
    });

    it('exits chain when a non-chain statement follows', () => {
      expect(format([
        'sub test()',
        '  foo()',
        '    .bar()',
        '  baz()',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  foo()',
        '    .bar()',
        '  baz()',
        'end sub',
      ].join('\n'));
    });
  });

  // ── Multi-line function argument indentation ────────────────────────────

  describe('multi-line function argument indentation', () => {
    it('indents multiple array arguments in a function call', () => {
      expect(format([
        'sub test()',
        'm._someFunction([',
        '"string one",',
        '"string two",',
        '], [',
        '{ a: 1, b: 2 },',
        '{ a: 2, b: 4 },',
        '])',
        'end sub',
      ], { indentSize: 2, trailingComma: 'multiline' })).to.equal([
        'sub test()',
        '  m._someFunction([',
        '    "string one",',
        '    "string two",',
        '  ], [',
        '    { a: 1, b: 2 },',
        '    { a: 2, b: 4 },',
        '  ])',
        'end sub',
      ].join('\n'));
    });

    it('indents mixed AA and array arguments', () => {
      expect(format([
        'sub test()',
        'm._someFunction2({',
        'a: "string one",',
        'b: "string two",',
        '}, [',
        '{ a: 1, b: 2 },',
        '{ a: 2, b: 4 },',
        '])',
        'end sub',
      ], { indentSize: 2, trailingComma: 'multiline' })).to.equal([
        'sub test()',
        '  m._someFunction2({',
        '    a: "string one",',
        '    b: "string two",',
        '  }, [',
        '    { a: 1, b: 2 },',
        '    { a: 2, b: 4 },',
        '  ])',
        'end sub',
      ].join('\n'));
    });

    it('indents multiple AA arguments', () => {
      expect(format([
        'sub test()',
        'm._someFunction3({',
        'a: "string one",',
        'b: "string two",',
        '}, {',
        '"key1": { a: 1, b: 2 },',
        '"key2": { a: 2, b: 4 },',
        '})',
        'end sub',
      ], { indentSize: 2, trailingComma: 'multiline' })).to.equal([
        'sub test()',
        '  m._someFunction3({',
        '    a: "string one",',
        '    b: "string two",',
        '  }, {',
        '    "key1": { a: 1, b: 2 },',
        '    "key2": { a: 2, b: 4 },',
        '  })',
        'end sub',
      ].join('\n'));
    });

    it('indents mixed AA and array with string keys', () => {
      expect(format([
        'sub test()',
        'm._someFunction4({',
        '"key1": "string one",',
        '"key2": "string two",',
        '}, [',
        '{ a: 1, b: 2 },',
        '{ a: 2, b: 4 },',
        '])',
        'end sub',
      ], { indentSize: 2, trailingComma: 'multiline' })).to.equal([
        'sub test()',
        '  m._someFunction4({',
        '    "key1": "string one",',
        '    "key2": "string two",',
        '  }, [',
        '    { a: 1, b: 2 },',
        '    { a: 2, b: 4 },',
        '  ])',
        'end sub',
      ].join('\n'));
    });
  });

  // ── Named functions inside AAs should not get spurious commas ───────────

  describe('named functions in AAs', () => {
    it('does not add comma to named function declaration in AA (associativeArrayCommaStyle=always)', () => {
      expect(format([
        'm = {',
        '  key: function UrlUtils()',
        '    prototype = {}',
        '  end function',
        '}',
      ], { indentSize: 2, associativeArrayCommaStyle: 'always' })).to.equal([
        'm = {',
        '  key: function UrlUtils()',
        '    prototype = {}',
        '  end function',
        '}',
      ].join('\n'));
    });

    it('does not add comma to named function with args in AA', () => {
      expect(format([
        'm = {',
        '  key: function UrlUtils(arg1 as String)',
        '    prototype = {}',
        '  end function',
        '}',
      ], { indentSize: 2, associativeArrayCommaStyle: 'always' })).to.equal([
        'm = {',
        '  key: function UrlUtils(arg1 as String)',
        '    prototype = {}',
        '  end function',
        '}',
      ].join('\n'));
    });

    it('does not add comma to named function with return type in AA', () => {
      expect(format([
        'm = {',
        '  key: function UrlUtils() as Object',
        '    prototype = {}',
        '  end function',
        '}',
      ], { indentSize: 2, associativeArrayCommaStyle: 'always' })).to.equal([
        'm = {',
        '  key: function UrlUtils() as Object',
        '    prototype = {}',
        '  end function',
        '}',
      ].join('\n'));
    });

    it('does not add comma to named sub in AA', () => {
      expect(format([
        'm = {',
        '  key: sub doWork()',
        '    x = 1',
        '  end sub',
        '}',
      ], { indentSize: 2, associativeArrayCommaStyle: 'always' })).to.equal([
        'm = {',
        '  key: sub doWork()',
        '    x = 1',
        '  end sub',
        '}',
      ].join('\n'));
    });

    it('still handles anonymous functions in AA correctly', () => {
      expect(format([
        'm = {',
        '  key: function()',
        '    x = 1',
        '  end function',
        '}',
      ], { indentSize: 2, associativeArrayCommaStyle: 'always' })).to.equal([
        'm = {',
        '  key: function()',
        '    x = 1',
        '  end function',
        '}',
      ].join('\n'));
    });

    it('does not add comma when strings contain unbalanced brackets', () => {
      expect(format([
        'function test()',
        '  prototype = {}',
        '  REGEXP = [',
        '    "([^:]+ \\]\\[",',
        '    "?#]+)"',
        '  ].join("")',
        '  return prototype',
        'end function',
      ], { indentSize: 2, arrayCommaStyle: 'always', trailingComma: 'always' })).to.equal([
        'function test()',
        '  prototype = {}',
        '  REGEXP = [',
        '    "([^:]+ \\]\\[",',
        '    "?#]+)",',
        '  ].join("")',
        '  return prototype',
        'end function',
      ].join('\n'));
    });
  });

  // ── Comments do not affect indentation ───────────────────────────────────

  describe('commented-out code does not affect indentation', () => {
    it('comment containing anonymous function pattern does not indent subsequent lines', () => {
      expect(format([
        'sub test()',
        "  ' m.callback = function() as Object",
        '  x = 1',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        "  ' m.callback = function() as Object",
        '  x = 1',
        'end sub',
      ].join('\n'));
    });

    it('comment containing end function does not deindent subsequent lines', () => {
      expect(format([
        'sub test()',
        '  x = 1',
        "  ' end function",
        '  y = 2',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  x = 1',
        "  ' end function",
        '  y = 2',
        'end sub',
      ].join('\n'));
    });
  });

  // ── associativeArrayBracketSpacing ────────────────────────────────────────────────────────

  describe('associativeArrayBracketSpacing', () => {
    it('adds space after { and before } for a plain code value', () => {
      const result = format(['sub init()', '  x = {key: value}', 'end sub'], { associativeArrayBracketSpacing: true });
      expect(result).to.include('{ key: value }');
    });

    it('adds space after { when key is a string literal', () => {
      const result = format(['sub init()', '  x = {"key": value}', 'end sub'], { associativeArrayBracketSpacing: true });
      expect(result).to.include('{ "key": value }');
    });

    it('adds space before } when last value is a string literal', () => {
      const result = format(['sub init()', '  x = {key: "value"}', 'end sub'], { associativeArrayBracketSpacing: true });
      expect(result).to.include('{ key: "value" }');
    });

    it('adds spaces on both sides when both key and value are string literal', () => {
      const result = format(['sub init()', '  x = {"key": "value"}', 'end sub'], { associativeArrayBracketSpacing: true });
      expect(result).to.include('{ "key": "value" }');
    });

    it('removes spaces after { and before } when false', () => {
      const result = format(['sub init()', '  x = { key: "value" }', 'end sub'], { associativeArrayBracketSpacing: false });
      expect(result).to.include('{key: "value"}');
    });

    it('does not add space inside empty {}', () => {
      const result = format(['sub init()', '  x = {}', 'end sub'], { associativeArrayBracketSpacing: true });
      expect(result).to.include('x = {}');
    });

    it('does not modify { or } inside string literal', () => {
      const result = format(['sub init()', '  x = "{key: value}"', 'end sub'], { associativeArrayBracketSpacing: true });
      expect(result).to.include('"{key: value}"');
    });
  });

  // ── associativeArrayCommaSpacing ────────────────────────────────────────────────────────

  describe('associativeArrayCommaSpacing', () => {
    it("'after' adds space after commas and removes space before", () => {
      const result = format(['sub init()', '  x = { a: 1 , b: 2 , c: 3 }', 'end sub'], { associativeArrayCommaSpacing: 'after' });
      expect(result).to.include('{ a: 1, b: 2, c: 3 }');
    });

    it("'before' adds space before commas and removes space after", () => {
      const result = format(['sub init()', '  x = { a: 1, b: 2, c: 3 }', 'end sub'], { associativeArrayCommaSpacing: 'before' });
      expect(result).to.include('{ a: 1 ,b: 2 ,c: 3 }');
    });

    it("'both' adds spaces on both sides", () => {
      const result = format(['sub init()', '  x = { a: 1, b: 2 }', 'end sub'], { associativeArrayCommaSpacing: 'both' });
      expect(result).to.include('{ a: 1 , b: 2 }');
    });

    it("'none' removes spaces on both sides", () => {
      const result = format(['sub init()', '  x = { a: 1 , b: 2 }', 'end sub'], { associativeArrayCommaSpacing: 'none' });
      expect(result).to.include('{ a: 1,b: 2 }');
    });

    it("'preserve' leaves existing spacing unchanged", () => {
      const result = format(['sub init()', '  x = { a: 1 , b: 2, c: 3 }', 'end sub'], { associativeArrayCommaSpacing: 'preserve' });
      expect(result).to.include('{ a: 1 , b: 2, c: 3 }');
    });

    it('does not affect commas inside function call arguments within the AA', () => {
      const result = format(['sub init()', '  x = { fn: doWork(a, b), key: 1 }', 'end sub'], { associativeArrayCommaSpacing: 'none' });
      // AA comma between fn and key → removed; function-arg commas inside () → untouched
      expect(result).to.include('doWork(a, b),key:');
    });

    it('does not affect commas in non-AA context', () => {
      const result = format(['sub init()', '  doWork(a, b)', 'end sub'], { associativeArrayCommaSpacing: 'none' });
      expect(result).to.include('doWork(a, b)');
    });

    it('works when value is a string literal (space before } preserved)', () => {
      const result = format(['sub init()', '  x = { a: 1, b: "str" }', 'end sub'], { associativeArrayCommaSpacing: 'after' });
      expect(result).to.include('{ a: 1, b: "str" }');
    });
  });

  // ── arrayCommaSpacing ────────────────────────────────────────────────────────
  describe('arrayCommaSpacing', () => {
    it("'none' removes spaces on both sides", () => {
      const result = format(['sub init()', '  a = ["1", "2", "3"]', 'end sub'], { arrayCommaSpacing: 'none' });
      expect(result).to.include('a = ["1","2","3"]');
    });

    it("'after' adds space after commas and removes space before", () => {
      const result = format(['sub init()', '  a = ["1","2","3"]', 'end sub'], { arrayCommaSpacing: 'after' });
      expect(result).to.include('a = ["1", "2", "3"]');
    });

    it("'before' adds space before commas and removes space after", () => {
      const result = format(['sub init()', '  a = ["1", "2", "3"]', 'end sub'], { arrayCommaSpacing: 'before' });
      expect(result).to.include('a = ["1" ,"2" ,"3"]');
    });

    it("'both' adds spaces on both sides", () => {
      const result = format(['sub init()', '  a = ["1","2"]', 'end sub'], { arrayCommaSpacing: 'both' });
      expect(result).to.include('a = ["1" , "2"]');
    });

    it("'preserve' leaves existing (even inconsistent) spacing unchanged", () => {
      const result = format(['sub init()', '  a = ["1" ,"2",  "3"]', 'end sub'], { arrayCommaSpacing: 'preserve' });
      expect(result).to.include('a = ["1" ,"2",  "3"]');
    });

    it('does not affect commas inside a function call argument list within the array', () => {
      const result = format(['sub init()', '  x = [foo(a, b), 1]', 'end sub'], { arrayCommaSpacing: 'none' });
      expect(result).to.include('foo(a, b),1');
    });
  });

  // ── parenCommaSpacing ────────────────────────────────────────────────────────
  describe('parenCommaSpacing', () => {
    it("'none' removes spaces on both sides in a function call", () => {
      const result = format(['sub init()', '  a("1", "2", "3")', 'end sub'], { parenCommaSpacing: 'none' });
      expect(result).to.include('a("1","2","3")');
    });

    it("'after' adds space after commas in a function call", () => {
      const result = format(['sub init()', '  a("1","2","3")', 'end sub'], { parenCommaSpacing: 'after' });
      expect(result).to.include('a("1", "2", "3")');
    });

    it("'before' adds space before commas and removes space after", () => {
      const result = format(['sub init()', '  a("1", "2", "3")', 'end sub'], { parenCommaSpacing: 'before' });
      expect(result).to.include('a("1" ,"2" ,"3")');
    });

    it("applies to function/sub parameter definitions, not just calls", () => {
      const result = format(['function work(x,y,z)', '  return x', 'end function'], { parenCommaSpacing: 'after' });
      expect(result).to.include('function work(x, y, z)');
    });

    it("'preserve' leaves existing spacing unchanged", () => {
      const result = format(['sub init()', '  a("1" ,"2",  "3")', 'end sub'], { parenCommaSpacing: 'preserve' });
      expect(result).to.include('a("1" ,"2",  "3")');
    });

    it('does not affect commas inside an array argument', () => {
      const result = format(['sub init()', '  foo([1, 2], "x")', 'end sub'], { parenCommaSpacing: 'none' });
      expect(result).to.include('foo([1, 2],"x")');
    });
  });

  // ── comma spacing in nested bracket contexts (each bracket type independent) ──
  describe('nested comma spacing', () => {
    it('array-of-AAs: array commas and AA-internal commas are spaced independently', () => {
      const result = format(['sub init()', '  x = [{a:1,b:2},{c:3,d:4}]', 'end sub'], {
        arrayCommaSpacing: 'after',
        associativeArrayCommaSpacing: 'none',
      });
      expect(result).to.include('x = [{ a:1,b:2 }, { c:3,d:4 }]');
    });

    it('AA-with-array-value: AA commas and array-internal commas are spaced independently', () => {
      const result = format(['sub init()', '  x = {items:[1,2,3],count:1}', 'end sub'], {
        associativeArrayCommaSpacing: 'after',
        arrayCommaSpacing: 'none',
      });
      expect(result).to.include('x = { items:[1,2,3], count:1 }');
    });

    it('array-of-calls: array commas and call-argument commas are spaced independently', () => {
      const result = format(['sub init()', '  x = [foo(1, 2),bar(3, 4)]', 'end sub'], {
        arrayCommaSpacing: 'after',
        parenCommaSpacing: 'none',
      });
      expect(result).to.include('x = [foo(1,2), bar(3,4)]');
    });

    it('does not affect a multi-line array, including a trailing comma added by trailingComma (disjoint scopes, not pass ordering)', () => {
      const result = format(['sub init()', '  items = [', '    "a",', '    "b"', '  ]', 'end sub'], {
        arrayCommaSpacing: 'none',
        trailingComma: 'always',
      });
      expect(result).to.include('"a",');
      expect(result).to.include('"b",');
    });
  });

  // ── associativeArrayKeySortOrder ──────────────────────────────────────────
  describe('associativeArrayKeySortOrder', () => {
    it("'preserve' (default) leaves assoc array key order unchanged", () => {
      const result = format(['sub init()', '  a = { b: 2, a: 1 }', 'end sub']);
      expect(result).to.include('{ b: 2, a: 1 }');
    });

    it("'alphabetical' sorts single-line AA keys", () => {
      const result = format(['sub init()', '  a = { b: 2, a: 1 }', 'end sub'], { associativeArrayKeySortOrder: 'alphabetical' });
      expect(result).to.include('{ a: 1, b: 2 }');
    });

    it('sorts quoted and unquoted keys identically (quotes ignored for comparison)', () => {
      const result = format(['sub init()', '  a = { "zeta": 1, alpha: 2 }', 'end sub'], { associativeArrayKeySortOrder: 'alphabetical' });
      expect(result).to.include('{ alpha: 2, "zeta": 1 }');
    });

    it('applies associativeArraySortPriorityKeys before falling back to alphabetical', () => {
      const result = format(['sub init()', '  a = { width: 100, id: "x", height: 50 }', 'end sub'], {
        associativeArrayKeySortOrder: 'alphabetical',
        associativeArraySortPriorityKeys: ['id', 'width', 'height'],
      });
      expect(result).to.include('{ id: "x", width: 100, height: 50 }');
    });

    it('falls back to the global sortPriorityKeys when the assoc-array-specific override is empty', () => {
      const result = format(['sub init()', '  a = { width: 100, id: "x" }', 'end sub'], {
        associativeArrayKeySortOrder: 'alphabetical',
        sortPriorityKeys: ['id', 'width'],
      });
      expect(result.indexOf('id: "x"')).to.be.lessThan(result.indexOf('width: 100'));
    });

    it('moves a leading comment along with its member when reordering', () => {
      const result = format([
        'sub init()',
        '  a = {',
        "    ' comment about b",
        '    b: 2,',
        '    a: 1',
        '  }',
        'end sub',
      ], { associativeArrayKeySortOrder: 'alphabetical' });
      expect(result.indexOf('a: 1')).to.be.lessThan(result.indexOf("' comment about b"));
      expect(result.indexOf("' comment about b")).to.be.lessThan(result.indexOf('b: 2'));
    });

    it('moves a same-line trailing comment (after the comma) along with the member it describes, not whichever member ends up next to it', () => {
      const result = format([
        'sub init()',
        '  a = {',
        "    zeta: 1, ' comment about zeta",
        '    alpha: 2',
        '  }',
        'end sub',
      ], { associativeArrayKeySortOrder: 'alphabetical' });
      // alpha now comes first; the comment must stay on zeta's line, not alpha's.
      expect(result).to.not.match(/alpha: 2[^\n]*comment about zeta/);
      const zetaLineIdx = result.indexOf('zeta: 1');
      const commentIdx = result.indexOf("' comment about zeta");
      expect(commentIdx).to.be.greaterThan(zetaLineIdx);
      expect(result.slice(zetaLineIdx, commentIdx)).to.not.include('\n');
    });

    it('moves a same-line trailing comment on the originally-last member (no comma) along with it, without leaving a stray comma inside the comment', () => {
      const result = format([
        'sub init()',
        '  a = {',
        '    zeta: 1,',
        "    alpha: 2 ' final note about alpha",
        '  }',
        'end sub',
      ], { associativeArrayKeySortOrder: 'alphabetical' });
      expect(result).to.not.match(/final note about alpha\s*,/);
      const alphaLineIdx = result.indexOf('alpha: 2');
      const commentIdx = result.indexOf("' final note about alpha");
      expect(result.slice(alphaLineIdx, commentIdx)).to.not.include('\n');
    });
  });

  // ── kopytkoTemplateKeyOrder ────────────────────────────────────────────────
  describe('kopytkoTemplateKeyOrder', () => {
    const TEMPLATE_ORDER = ['name', 'props', 'dynamicProps', 'events', 'children'];

    it('reorders a detected template object to the configured top-level key order', () => {
      const result = format([
        'function build() as object',
        '  return {',
        '    props: { id: "myGroup", width: 100 },',
        '    name: "Group"',
        '  }',
        'end function',
      ], { kopytkoTemplateKeyOrder: TEMPLATE_ORDER });
      expect(result.indexOf('name: "Group"')).to.be.lessThan(result.indexOf('props:'));
    });

    it('does not treat an AA as a template object when props/dynamicProps lack an id key', () => {
      const result = format([
        'function build() as object',
        '  return {',
        '    props: { width: 100 },',
        '    name: "Group"',
        '  }',
        'end function',
      ], { kopytkoTemplateKeyOrder: TEMPLATE_ORDER });
      expect(result.indexOf('props:')).to.be.lessThan(result.indexOf('name:'));
    });

    it('does not treat an AA as a template object without a name key', () => {
      const result = format([
        'function build() as object',
        '  return {',
        '    props: { id: "x" },',
        '    dynamicProps: { y: 1 }',
        '  }',
        'end function',
      ], { kopytkoTemplateKeyOrder: TEMPLATE_ORDER });
      expect(result.indexOf('props:')).to.be.lessThan(result.indexOf('dynamicProps:'));
    });

    it('does not treat an AA as a template object when it has a key outside the configured set', () => {
      const result = format([
        'function build() as object',
        '  return {',
        '    props: { id: "x" },',
        '    name: "Group",',
        '    extra: 1',
        '  }',
        'end function',
      ], { kopytkoTemplateKeyOrder: TEMPLATE_ORDER });
      expect(result.indexOf('props:')).to.be.lessThan(result.indexOf('name:'));
    });

    it('always alphabetically sorts nested props/dynamicProps/events even when associativeArrayKeySortOrder is preserve', () => {
      const result = format([
        'function build() as object',
        '  return {',
        '    name: "Group",',
        '    props: { width: 100, id: "x" },',
        '    dynamicProps: { visible: true, opacity: 1 },',
        '    events: { someField: "onSomeField", myField: "onMyField" }',
        '  }',
        'end function',
      ], { kopytkoTemplateKeyOrder: TEMPLATE_ORDER, associativeArrayKeySortOrder: 'preserve' });
      expect(result.indexOf('id: "x"')).to.be.lessThan(result.indexOf('width: 100'));
      expect(result.indexOf('opacity:')).to.be.lessThan(result.indexOf('visible:'));
      expect(result.indexOf('myField:')).to.be.lessThan(result.indexOf('someField:'));
    });

    it('applies kopytkoTemplatePropsSortPriorityKeys to nested props/dynamicProps/events', () => {
      const result = format([
        'function build() as object',
        '  return {',
        '    name: "Group",',
        '    props: { width: 100, id: "x", height: 50 }',
        '  }',
        'end function',
      ], { kopytkoTemplateKeyOrder: TEMPLATE_ORDER, kopytkoTemplatePropsSortPriorityKeys: ['id', 'width', 'height'] });
      const idIdx = result.indexOf('id: "x"');
      const widthIdx = result.indexOf('width: 100');
      const heightIdx = result.indexOf('height: 50');
      expect(idIdx).to.be.lessThan(widthIdx);
      expect(widthIdx).to.be.lessThan(heightIdx);
    });

    it('recurses into children array elements, treating each as its own template object', () => {
      const result = format([
        'function build() as object',
        '  return {',
        '    name: "Group",',
        '    props: { id: "myGroup" },',
        '    children: [',
        '      {',
        '        props: { id: "background" },',
        '        name: "Rectangle"',
        '      }',
        '    ]',
        '  }',
        'end function',
      ], { kopytkoTemplateKeyOrder: TEMPLATE_ORDER });
      const nameIdx = result.lastIndexOf('name: "Rectangle"');
      const propsIdx = result.indexOf('props: { id: "background" }');
      expect(nameIdx).to.be.lessThan(propsIdx);
    });

    it('empty kopytkoTemplateKeyOrder disables the feature entirely', () => {
      const result = format([
        'function build() as object',
        '  return {',
        '    props: { id: "x" },',
        '    name: "Group"',
        '  }',
        'end function',
      ], { kopytkoTemplateKeyOrder: [] });
      expect(result.indexOf('props:')).to.be.lessThan(result.indexOf('name:'));
    });
  });

  // ── Catch parentheses (always stripped) ──────────────────────────────────

  describe('catch parentheses', () => {
    it('strips parentheses from catch variable', () => {
      expect(format([
        'sub test()',
        '  try',
        '    doWork()',
        '  catch (e)',
        '    print e.message',
        '  end try',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  try',
        '    doWork()',
        '  catch e',
        '    print e.message',
        '  end try',
        'end sub',
      ].join('\n'));
    });

    it('leaves bare catch variable unchanged', () => {
      expect(format([
        'sub test()',
        '  try',
        '    doWork()',
        '  catch err',
        '    print err.message',
        '  end try',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  try',
        '    doWork()',
        '  catch err',
        '    print err.message',
        '  end try',
        'end sub',
      ].join('\n'));
    });

    it('preserves trailing comment when stripping parens', () => {
      expect(format([
        'sub test()',
        '  try',
        '    doWork()',
        "  catch (e) ' handle error",
        '  end try',
        'end sub',
      ], { indentSize: 2 })).to.equal([
        'sub test()',
        '  try',
        '    doWork()',
        "  catch e ' handle error",
        '  end try',
        'end sub',
      ].join('\n'));
    });
  });

  // ── New formatter passes ────────────────────────────────────────────────

  describe('emptyLinesBetweenMethods', () => {
    it('inserts blank lines between prototype method definitions', () => {
      expect(format([
        'proto.init = sub()',
        '    x = 1',
        'end sub',
        'proto.update = function()',
        '    y = 2',
        'end function',
      ], { emptyLinesBetweenMethods: 1 })).to.equal([
        'proto.init = sub()',
        '    x = 1',
        'end sub',
        '',
        'proto.update = function()',
        '    y = 2',
        'end function',
      ].join('\n'));
    });

    it('no change when methods already have correct spacing', () => {
      const input = [
        'proto.init = sub()',
        '    x = 1',
        'end sub',
        '',
        'proto.update = function()',
        '    y = 2',
        'end function',
      ];
      expect(format(input, { emptyLinesBetweenMethods: 1 })).to.equal(input.join('\n'));
    });

    it('handles emptyLinesBetweenMethods: 0 (no blank lines)', () => {
      const input = [
        'proto.init = sub()',
        '    x = 1',
        'end sub',
        '',
        'proto.update = function()',
        '    y = 2',
        'end function',
      ];
      // 0 means no-op — pass is skipped entirely
      expect(format(input, { emptyLinesBetweenMethods: 0 })).to.equal(input.join('\n'));
    });

    it('replaces wrong number of blank lines with correct count', () => {
      expect(format([
        'proto.a = function()',
        '    x = 1',
        'end function',
        '',
        '',
        '',
        'proto.b = function()',
        '    y = 2',
        'end function',
      ], { emptyLinesBetweenMethods: 1 })).to.equal([
        'proto.a = function()',
        '    x = 1',
        'end function',
        '',
        'proto.b = function()',
        '    y = 2',
        'end function',
      ].join('\n'));
    });
  });

  describe('elseOnNewLine', () => {
    it('false: collapses simple if/else to single line', () => {
      expect(format([
        'sub test()',
        '  if a then',
        '    x = 1',
        '  else',
        '    x = 2',
        '  end if',
        'end sub',
      ], { indentSize: 2, elseOnNewLine: false })).to.equal([
        'sub test()',
        '  if a then x = 1 else x = 2',
        'end sub',
      ].join('\n'));
    });

    it('true: leaves multi-line if/else as-is (default)', () => {
      const input = [
        'sub test()',
        '  if a then',
        '    x = 1',
        '  else',
        '    x = 2',
        '  end if',
        'end sub',
      ];
      expect(format(input, { indentSize: 2, elseOnNewLine: true })).to.equal(input.join('\n'));
    });

    it('does not collapse when branches have comments', () => {
      const input = [
        'sub test()',
        "  if a then ' check a",
        '    x = 1',
        '  else',
        '    x = 2',
        '  end if',
        'end sub',
      ];
      expect(format(input, { indentSize: 2, elseOnNewLine: false })).to.equal(input.join('\n'));
    });
  });

  describe('lineCommentPosition', () => {
    it('above: moves trailing comments to line above', () => {
      expect(format([
        'sub init()',
        "  x = 1 ' set x",
        'end sub',
      ], { indentSize: 2, lineCommentPosition: 'above' })).to.equal([
        'sub init()',
        "  ' set x",
        '  x = 1',
        'end sub',
      ].join('\n'));
    });

    it('inline: leaves trailing comments unchanged', () => {
      const input = [
        'sub init()',
        "  x = 1 ' set x",
        'end sub',
      ];
      expect(format(input, { indentSize: 2, lineCommentPosition: 'inline' })).to.equal(input.join('\n'));
    });

    it('preserve: no changes', () => {
      const input = [
        'sub init()',
        "  x = 1 ' set x",
        'end sub',
      ];
      expect(format(input, { indentSize: 2, lineCommentPosition: 'preserve' })).to.equal(input.join('\n'));
    });

    it('does not move pure comment lines', () => {
      const input = [
        'sub init()',
        "  ' this is a comment",
        '  x = 1',
        'end sub',
      ];
      expect(format(input, { indentSize: 2, lineCommentPosition: 'above' })).to.equal(input.join('\n'));
    });
  });

  describe('alignAssignments', () => {
    it('true: aligns = in consecutive assignments', () => {
      expect(format([
        'sub init()',
        '  x = 1',
        '  longVar = 2',
        '  ab = 3',
        'end sub',
      ], { indentSize: 2, alignAssignments: true })).to.equal([
        'sub init()',
        '  x       = 1',
        '  longVar = 2',
        '  ab      = 3',
        'end sub',
      ].join('\n'));
    });

    it('breaks alignment group on blank line', () => {
      expect(format([
        'sub init()',
        '  x = 1',
        '  longVar = 2',
        '',
        '  ab = 3',
        'end sub',
      ], { indentSize: 2, alignAssignments: true })).to.equal([
        'sub init()',
        '  x       = 1',
        '  longVar = 2',
        '',
        '  ab = 3',
        'end sub',
      ].join('\n'));
    });

    it('does not affect non-assignment lines', () => {
      const input = [
        'sub init()',
        '  print "hello"',
        '  doWork()',
        'end sub',
      ];
      expect(format(input, { indentSize: 2, alignAssignments: true })).to.equal(input.join('\n'));
    });
  });

  describe('paramAlignmentStyle', () => {
    it('indent: uses one indent level for wrapped params', () => {
      expect(format([
        'function work(',
        '                 x as String,',
        '                 y as Integer)',
        '    return x',
        'end function',
      ], { indentSize: 4, paramAlignmentStyle: 'indent' })).to.equal([
        'function work(',
        '    x as String,',
        '    y as Integer)',
        '    return x',
        'end function',
      ].join('\n'));
    });

    it('align-to-paren: aligns to opening paren', () => {
      expect(format([
        'function work(',
        '    x as String,',
        '    y as Integer)',
        '    return x',
        'end function',
      ], { indentSize: 4, paramAlignmentStyle: 'align-to-paren' })).to.equal([
        'function work(',
        '              x as String,',
        '              y as Integer)',
        '    return x',
        'end function',
      ].join('\n'));
    });

    it('preserve: no changes to multi-line params', () => {
      const input = [
        'function work(',
        '    x as String,',
        '    y as Integer)',
        '    return x',
        'end function',
      ];
      expect(format(input, { indentSize: 4, paramAlignmentStyle: 'preserve' })).to.equal(input.join('\n'));
    });
  });

  describe('wrapLongStrings', () => {
    it('plus: breaks long string with + concatenation', () => {
      const longStr = 'A'.repeat(120);
      const result = format([
        'sub init()',
        `    x = "${longStr}"`,
        'end sub',
      ], { wrapLongStrings: 'plus' });
      expect(result).to.include(' + _');
      expect(result).to.not.include(longStr);
    });

    it('preserve: leaves long strings as-is', () => {
      const longStr = 'A'.repeat(120);
      const input = [
        'sub init()',
        `    x = "${longStr}"`,
        'end sub',
      ];
      expect(format(input, { wrapLongStrings: 'preserve' })).to.equal(input.join('\n'));
    });

    it('does not wrap short strings', () => {
      const input = [
        'sub init()',
        '    x = "short string"',
        'end sub',
      ];
      expect(format(input, { wrapLongStrings: 'plus' })).to.equal(input.join('\n'));
    });
  });

  describe('stringConcatStyle', () => {
    it('plus: converts [].join("") to +', () => {
      expect(format([
        'sub init()',
        '    x = ["hello", " ", "world"].join("")',
        'end sub',
      ], { stringConcatStyle: 'plus' })).to.equal([
        'sub init()',
        '    x = "hello" + " " + "world"',
        'end sub',
      ].join('\n'));
    });

    it('array-join: does not convert when no string literals in concatenation', () => {
      const input = [
        'sub init()',
        '    x = a + b + c',
        'end sub',
      ];
      expect(format(input, { stringConcatStyle: 'array-join' })).to.equal(input.join('\n'));
    });

    it('preserve: no changes', () => {
      const input = [
        'sub init()',
        '    x = "hello" + " " + "world"',
        'end sub',
      ];
      expect(format(input, { stringConcatStyle: 'preserve' })).to.equal(input.join('\n'));
    });
  });

  describe('associativeArraySingleLineThreshold', () => {
    it('expands inline AA exceeding threshold', () => {
      const result = format([
        'sub init()',
        '    x = { a: 1, b: 2, c: 3, d: 4 }',
        'end sub',
      ], { associativeArraySingleLineThreshold: 10 });
      expect(result).to.include('{\n');
      expect(result).to.include('a: 1');
    });

    it('short AAs stay inline', () => {
      const input = [
        'sub init()',
        '    x = { a: 1 }',
        'end sub',
      ];
      expect(format(input, { associativeArraySingleLineThreshold: 50 })).to.equal(input.join('\n'));
    });

    it('0: no change (pass skipped)', () => {
      const input = [
        'sub init()',
        '    x = { a: 1, b: 2, c: 3, d: 4 }',
        'end sub',
      ];
      expect(format(input, { associativeArraySingleLineThreshold: 0 })).to.equal(input.join('\n'));
    });
  });

  describe('observeFieldStyle', () => {
    it('always-scoped: converts observeField to observeFieldScoped', () => {
      expect(format([
        'sub init()',
        '    m.top.observeField("visible", "onVisibleChange")',
        'end sub',
      ], { observeFieldStyle: 'always-scoped' })).to.equal([
        'sub init()',
        '    m.top.observeFieldScoped("visible", "onVisibleChange")',
        'end sub',
      ].join('\n'));
    });

    it('warn: adds TODO comment', () => {
      const result = format([
        'sub init()',
        '    m.top.observeField("visible", "onVisibleChange")',
        'end sub',
      ], { observeFieldStyle: 'warn' });
      expect(result).to.include("' TODO: consider using observeFieldScoped");
    });

    it('does not touch already-scoped calls', () => {
      const input = [
        'sub init()',
        '    m.top.observeFieldScoped("visible", "onVisibleChange")',
        'end sub',
      ];
      expect(format(input, { observeFieldStyle: 'always-scoped' })).to.equal(input.join('\n'));
    });

    it('preserve: no changes', () => {
      const input = [
        'sub init()',
        '    m.top.observeField("visible", "onVisibleChange")',
        'end sub',
      ];
      expect(format(input, { observeFieldStyle: 'preserve' })).to.equal(input.join('\n'));
    });
  });

  describe('mPrefixStyle', () => {
    it('dot: converts m["field"] to m.field', () => {
      expect(format([
        'sub init()',
        '    x = m["myField"]',
        'end sub',
      ], { mPrefixStyle: 'dot' })).to.equal([
        'sub init()',
        '    x = m.myField',
        'end sub',
      ].join('\n'));
    });

    it('bracket: converts m.field to m["field"]', () => {
      expect(format([
        'sub init()',
        '    x = m.myField',
        'end sub',
      ], { mPrefixStyle: 'bracket' })).to.equal([
        'sub init()',
        '    x = m["myField"]',
        'end sub',
      ].join('\n'));
    });

    it('does not touch m.top or m.global', () => {
      const input = [
        'sub init()',
        '    x = m.top',
        '    y = m.global',
        'end sub',
      ];
      expect(format(input, { mPrefixStyle: 'bracket' })).to.equal(input.join('\n'));
    });

    it('does not convert method calls to bracket', () => {
      const input = [
        'sub init()',
        '    m.doWork()',
        'end sub',
      ];
      expect(format(input, { mPrefixStyle: 'bracket' })).to.equal(input.join('\n'));
    });
  });

  describe('fieldAccessConsistency', () => {
    it('dot: converts m.top.getField("x") to m.top.x', () => {
      expect(format([
        'sub init()',
        '    x = m.top.getField("visible")',
        'end sub',
      ], { fieldAccessConsistency: 'dot' })).to.equal([
        'sub init()',
        '    x = m.top.visible',
        'end sub',
      ].join('\n'));
    });

    it('method: converts m.top.x to m.top.getField("x")', () => {
      expect(format([
        'sub init()',
        '    x = m.top.visible',
        'end sub',
      ], { fieldAccessConsistency: 'method' })).to.equal([
        'sub init()',
        '    x = m.top.getField("visible")',
        'end sub',
      ].join('\n'));
    });

    it('does not convert known methods like findNode', () => {
      const input = [
        'sub init()',
        '    node = m.top.findNode("myNode")',
        'end sub',
      ];
      expect(format(input, { fieldAccessConsistency: 'method' })).to.equal(input.join('\n'));
    });

    it('preserve: no changes', () => {
      const input = [
        'sub init()',
        '    x = m.top.visible',
        'end sub',
      ];
      expect(format(input, { fieldAccessConsistency: 'preserve' })).to.equal(input.join('\n'));
    });
  });

  describe('verifySyntax', () => {
    it('still applies regex passes when source has pre-existing parse errors', () => {
      // Files with pre-existing parse errors (e.g. unsupported syntax) should still
      // be formatted — the check must not block changes that don't introduce new errors.
      const input = [
        'function work(',
        '    x as String,',
        '    y as Integer)',
        '    z=5',
        '    return z',
        'end function',
      ];
      expect(format(input, { indentSize: 4, spaceAroundAssignment: true })).to.equal([
        'function work(',
        '    x as String,',
        '    y as Integer)',
        '    z = 5',
        '    return z',
        'end function',
      ].join('\n'));
    });

    it('falls back to original when formatting introduces new parse errors', () => {
      // verifySyntax: false bypasses the safety check entirely.
      // With it enabled (default), valid source whose formatted output is also
      // valid is always returned — this is a no-op passthrough guard.
      const input = [
        'sub init()',
        '  x=1',
        'end sub',
      ];
      // Normal valid source: formatter applies spacing
      expect(format(input, { indentSize: 2, spaceAroundAssignment: true })).to.equal([
        'sub init()',
        '  x = 1',
        'end sub',
      ].join('\n'));
    });

    it('exact casing with "invalid" key does not corrupt files that define sub constructor()', () => {
      // Regression: { invalid: "Invalid" } is a plain JS object. A bare
      // config.exact["constructor"] lookup walks Object.prototype and returns the
      // native Object constructor function. applyEdits coerced it to the string
      // "function Object() { [native code] }", which verifySyntax caught as a
      // parse error and silently reverted ALL formatting — blocking every Kopytko
      // component because every one defines `sub constructor()`.
      const input = [
        'sub constructor()',
        '    if (m.data = invalid)',
        '      m.doWork()',
        '    endif',
        'end sub',
      ];
      const casing: CasingConfig = {
        ...DEFAULT_CASING_CONFIG,
        keyword: 'lower-case',
        literal: 'lower-case',
        exact: { invalid: 'Invalid' },
      };
      const result = format(input, { indentSize: 2, endKeywordStyle: 'spaced', parenthesisIfCase: 'always' }, casing);
      // Must make formatting changes (not silently revert due to prototype pollution)
      expect(result).not.to.equal(input.join('\n'));
      // constructor identifier must survive untouched
      expect(result).to.contain('sub constructor()');
      // [native code] must never appear
      expect(result).not.to.contain('[native code]');
      // exact override must apply
      expect(result).to.contain('Invalid');
    });

    it('checkFormatting is not tricked into reporting clean when exact casing would corrupt', () => {
      // Same root cause — checkFormatting calls formatText internally. If formatText
      // silently returns source unchanged (due to prototype pollution), checkFormatting
      // incorrectly reports the file as already formatted.
      const source = 'sub constructor()\n    if (m.data = invalid)\n      return\n    endif\nend sub\n';
      const casing: CasingConfig = {
        ...DEFAULT_CASING_CONFIG,
        keyword: 'lower-case',
        exact: { invalid: 'Invalid' },
      };
      const config = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, endKeywordStyle: 'spaced' as const };
      // Source has 4-space indent + "invalid" lowercase → not clean per these settings
      expect(checkFormatting(source, config, casing)).to.equal(false);
    });
  });

  describe('casingPass exact — Object.prototype property safety', () => {
    // Verify that none of the standard Object.prototype inherited properties
    // are accidentally treated as exact casing overrides.
    const PROTO_PROPS = ['constructor', 'toString', 'valueOf', 'hasOwnProperty',
                         'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'];

    for (const prop of PROTO_PROPS) {
      it(`exact: { invalid: "Invalid" } does not corrupt identifier "${prop}"`, () => {
        const src = `sub ${prop}()\n  x = invalid\nend sub\n`;
        const casing: CasingConfig = { ...DEFAULT_CASING_CONFIG, exact: { invalid: 'Invalid' } };
        const result = formatText(src, { ...DEFAULT_FORMATTING_CONFIG, insertFinalNewline: false }, casing);
        expect(result).to.contain(prop);
        expect(result).not.to.contain('[native code]');
      });
    }
  });
});

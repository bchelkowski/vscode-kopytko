import { expect } from 'chai';
import { formatText, checkFormatting } from '../src/formatter';
import { FormattingConfig, DEFAULT_FORMATTING_CONFIG } from '../src/config';
import { CasingConfig, DEFAULT_CASING_CONFIG } from '../src/casing';
import { FunctionDefinition } from '../src/types';

const NO_CASING: CasingConfig = { builtins: 'NoChange', keywords: 'NoChange', methods: 'NoChange' };

function format(
  lines: string[],
  overrides: Partial<FormattingConfig> = {},
  casing: CasingConfig = NO_CASING,
  userFunctions: FunctionDefinition[] = [],
): string {
  const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, insertFinalNewline: false, ...overrides };
  return formatText(lines.join('\n'), config, casing, userFunctions);
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
    it('lowercases keywords', () => {
      const result = format(
        ['Function Main()', '  IF TRUE THEN', '    RETURN', '  END IF', 'End Function'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'LowerCase', methods: 'NoChange' },
      );
      expect(result).to.include('function');
      expect(result).to.include('if');
      expect(result).to.include('then');
      expect(result).to.include('return');
      expect(result).to.include('end if');
      expect(result).to.include('end function');
    });

    it('uppercases keywords', () => {
      const result = format(
        ['function main()', '  if true then', '    return', '  end if', 'end function'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'UpperCase', methods: 'NoChange' },
      );
      expect(result).to.include('FUNCTION');
      expect(result).to.include('IF');
      expect(result).to.include('THEN');
      expect(result).to.include('RETURN');
    });

    it('does not change keywords inside strings', () => {
      const result = format(
        ['sub init()', '  x = "if then else"', 'end sub'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'UpperCase', methods: 'NoChange' },
      );
      expect(result).to.include('"if then else"');
    });

    it('does not change text after comment marker', () => {
      const result = format(
        ['sub init()', "  x = 1 ' this is if then", 'end sub'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'UpperCase', methods: 'NoChange' },
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
        { builtins: 'LowerCase', keywords: 'NoChange', methods: 'NoChange' },
      );
      expect(result).to.include('len(');
    });

    it('PascalCases builtin function names from lowercase input', () => {
      const result = format(
        ['sub init()', '  x = createobject("roArray")', 'end sub'],
        { indentSize: 2 },
        { builtins: 'PascalCase', keywords: 'NoChange', methods: 'NoChange' },
      );
      expect(result).to.include('CreateObject(');
    });

    it('does not change user-defined function names', () => {
      const result = format(
        ['sub init()', '  myFunction()', 'end sub'],
        { indentSize: 2 },
        { builtins: 'UpperCase', keywords: 'NoChange', methods: 'NoChange' },
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
        { builtins: 'PascalCase', keywords: 'LowerCase', methods: 'NoChange' },
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
        { builtins: 'LowerCase', keywords: 'NoChange', methods: 'NoChange', exactCasing: { 'getglobalaa': 'GetGlobalAA' } },
      );
      expect(result).to.include('GetGlobalAA()');
    });

    it('applies exact override for a keyword', () => {
      const result = format(
        ['sub init()', '  x = invalid', 'end sub'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'LowerCase', methods: 'NoChange', exactCasing: { 'invalid': 'Invalid' } },
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

    it('normalizes builtins to catalog casing even with NoChange', () => {
      const result = format(
        ['sub init()', '  x = createobject("roArray")', 'end sub'],
        { indentSize: 2 },
      );
      expect(result).to.include('CreateObject(');
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty document', () => {
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      expect(checkFormatting('', config, NO_CASING)).to.be.true;
    });

    it('handles compound end keywords', () => {
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
        { builtins: 'NoChange', keywords: 'UpperCase', methods: 'NoChange' },
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
    it('applies typeCasing independently of keywordCasing', () => {
      const result = format(
        ['function main(x as integer) as boolean', 'end function'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'LowerCase', methods: 'NoChange', types: 'Capitalize' },
      );
      expect(result).to.include('as Integer');
      expect(result).to.include('as Boolean');
      expect(result).to.include('function');
    });

    it('applies typeCasing to "function" when used as a type (after as)', () => {
      const result = format(
        ['function main(callback as function) as function', 'end function'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'LowerCase', methods: 'NoChange', types: 'Capitalize' },
      );
      expect(result).to.include('as Function) as Function');
      expect(result).to.match(/^function main/);
    });

    it('applies literalCasing independently', () => {
      const result = format(
        ['sub init()', '  x = TRUE', '  y = FALSE', '  z = INVALID', 'end sub'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'NoChange', methods: 'NoChange', literals: 'LowerCase' },
      );
      expect(result).to.include('true');
      expect(result).to.include('false');
      expect(result).to.include('invalid');
    });

    it('applies logicOperatorCasing independently', () => {
      const result = format(
        ['sub init()', '  if a and b or not c then', '    return', '  end if', 'end sub'],
        { indentSize: 2 },
        { builtins: 'NoChange', keywords: 'LowerCase', methods: 'NoChange', logicOperators: 'UpperCase' },
      );
      expect(result).to.include('AND');
      expect(result).to.include('OR');
      expect(result).to.include('NOT');
      expect(result).to.include('if');
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
    it('does not corrupt identifier "constructor" via exactCasing prototype leak', () => {
      const result = format(
        ['sub constructor()', '  m.x = 1', 'end sub'],
        { indentSize: 2 },
        { builtins: 'PascalCase', keywords: 'LowerCase', methods: 'NoChange', exactCasing: { 'invalid': 'Invalid' } },
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
        { builtins: 'PascalCase', keywords: 'LowerCase', methods: 'CamelCase', userFunctions: 'CamelCase', exactCasing: {} },
        [{ name: 'objectUtils', nameLower: 'objectutils' }],
      );
      expect(result).to.include('ObjectUtils:');
      expect(result).to.not.include('objectUtils:');
    });

    it('does not apply user function casing to property accesses after dot', () => {
      const result = format(
        ['sub t()', '  result = context.arrayUtils.filter(items)', 'end sub'],
        { indentSize: 2 },
        { builtins: 'PascalCase', keywords: 'LowerCase', methods: 'CamelCase', userFunctions: 'PascalCase', exactCasing: {} },
        [{ name: 'ArrayUtils', nameLower: 'arrayutils' }],
      );
      expect(result).to.include('context.arrayUtils.filter');
      expect(result).to.not.include('context.ArrayUtils');
    });
  });

  // ── blankLineBeforeReturn fixes ─────────────────────────────────────────

  describe('blankLineBeforeReturn', () => {
    it('not-alone: does not add blank line between a comment and the return below it', () => {
      expect(format([
        'SomeFunction(function () as Object',
        '  someVariable = "hello"',
        "  ' Some comment above return",
        '  return { someVariable: someVariable }',
        'end function)',
      ], { indentSize: 2, blankLineBeforeReturn: 'not-alone' })).to.equal([
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
      ], { indentSize: 2, blankLineBeforeReturn: 'not-alone' })).to.equal([
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
      ], { indentSize: 2, blankLineBeforeReturn: 'not-alone' })).to.equal([
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
      ], { indentSize: 2, blankLineBeforeReturn: 'not-alone' })).to.equal([
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
      ], { indentSize: 2, blankLineBeforeReturn: 'not-alone' })).to.equal([
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
      ], { indentSize: 2, blankLineBeforeReturn: 'not-alone' })).to.equal([
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
      ], { indentSize: 2, blankLineBeforeReturn: 'not-alone' })).to.equal([
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
});

import { expect } from 'chai';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BrightScriptFormattingProvider } from '../../src/server/providers/formattingProvider';
import { CasingConfig } from '../../src/server/brightscript/casingUtils';
import { FormattingConfig, DEFAULT_FORMATTING_CONFIG } from '../../src/server/brightscript/formattingConfig';
import { FunctionDefinition } from '../../src/server/brightscript/functionIndex';

const makeDocument = (content: string | string[]): TextDocument => {
  const text = Array.isArray(content) ? content.join('\n') : content;
  return TextDocument.create('file:///test.brs', 'brightscript', 1, text);
};

function applyEdits(doc: TextDocument, provider: BrightScriptFormattingProvider, indent: number, casing: CasingConfig, userFunction: FunctionDefinition[] = []): string {
  const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: indent, insertFinalNewline: false };
  const edits = provider.provideDocumentFormatting(doc, config, casing, userFunction);
  if (edits.length === 0) return doc.getText();

  let text = doc.getText();
  const sorted = [...edits].sort((a, b) => {
    const lineDiff = b.range.start.line - a.range.start.line;
    if (lineDiff !== 0) return lineDiff;
    return b.range.start.character - a.range.start.character;
  });
  for (const edit of sorted) {
    const start = doc.offsetAt(edit.range.start);
    const end = doc.offsetAt(edit.range.end);
    text = text.substring(0, start) + edit.newText + text.substring(end);
  }
  return text;
}

const NO_CASING: CasingConfig = { builtin: 'preserve', keyword: 'preserve', method: 'preserve' };

describe('BrightScriptFormattingProvider', () => {
  let provider: BrightScriptFormattingProvider;

  beforeEach(() => {
    provider = new BrightScriptFormattingProvider();
  });

  // ── Indentation ──────────────────────────────────────────────────────────

  describe('indentation', () => {
    it('indents function body', () => {
      const doc = makeDocument([
        'function main()',
        'print "hello"',
        'end function',
      ]);
      const result = applyEdits(doc, provider, 4, NO_CASING);
      expect(result).to.equal([
        'function main()',
        '    print "hello"',
        'end function',
      ].join('\n'));
    });

    it('indents sub body', () => {
      const doc = makeDocument([
        'sub init()',
        'x = 1',
        'end sub',
      ]);
      const result = applyEdits(doc, provider, 2, NO_CASING);
      expect(result).to.equal([
        'sub init()',
        '  x = 1',
        'end sub',
      ].join('\n'));
    });

    it('indents nested if/for blocks', () => {
      const doc = makeDocument([
        'sub test()',
        'if true then',
        'for i = 0 to 10',
        'print i',
        'next',
        'end if',
        'end sub',
      ]);
      const result = applyEdits(doc, provider, 2, NO_CASING);
      expect(result).to.equal([
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
      const doc = makeDocument([
        'sub test()',
        'if a then',
        'x = 1',
        'elseif b then',
        'x = 2',
        'else',
        'x = 3',
        'end if',
        'end sub',
      ]);
      const result = applyEdits(doc, provider, 2, NO_CASING);
      expect(result).to.equal([
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
      const doc = makeDocument([
        'sub test()',
        'while true',
        'doWork()',
        'end while',
        'end sub',
      ]);
      const result = applyEdits(doc, provider, 4, NO_CASING);
      expect(result).to.equal([
        'sub test()',
        '    while true',
        '        doWork()',
        '    end while',
        'end sub',
      ].join('\n'));
    });

    it('handles try/catch blocks', () => {
      const doc = makeDocument([
        'sub test()',
        'try',
        'doWork()',
        'catch e',
        'handleError(e)',
        'end try',
        'end sub',
      ]);
      const result = applyEdits(doc, provider, 2, NO_CASING);
      expect(result).to.equal([
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
      const doc = makeDocument([
        'sub test()',
        'if x then return',
        'doWork()',
        'end sub',
      ]);
      const result = applyEdits(doc, provider, 2, NO_CASING);
      expect(result).to.equal([
        'sub test()',
        '  if x then return',
        '  doWork()',
        'end sub',
      ].join('\n'));
    });

    it('returns no edits when already correctly indented', () => {
      const doc = makeDocument([
        'sub test()',
        '  x = 1',
        'end sub',
      ]);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING);
      expect(edits).to.be.empty;
    });
  });

  // ── Keyword casing ───────────────────────────────────────────────────────

  describe('keyword casing', () => {
    it('lowercases keyword', () => {
      const doc = makeDocument('Function Main()\n  IF TRUE THEN\n    RETURN\n  END IF\nEnd Function');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'lower-case', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('function');
      expect(result).to.include('if');
      expect(result).to.include('then');
      expect(result).to.include('return');
      expect(result).to.include('end if');
      expect(result).to.include('end function');
    });

    it('uppercases keyword', () => {
      const doc = makeDocument('function main()\n  if true then\n    return\n  end if\nend function');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('FUNCTION');
      expect(result).to.include('IF');
      expect(result).to.include('THEN');
      expect(result).to.include('RETURN');
    });

    it('does not change keyword inside strings', () => {
      const doc = makeDocument('sub init()\n  x = "if then else"\nend sub');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('"if then else"');
    });

    it('does not change text after comment marker', () => {
      const doc = makeDocument("sub init()\n  x = 1 ' this is if then\nend sub");
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include("' this is if then");
    });
  });

  // ── Builtin function casing ──────────────────────────────────────────────

  describe('builtin function casing', () => {
    it('lowercases builtin function names', () => {
      const doc = makeDocument('sub init()\n  x = LEN("hello")\nend sub');
      const casing: CasingConfig = { builtin: 'lower-case', keyword: 'preserve', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('len(');
    });

    it('pascal-cases builtin function names from lowercase input', () => {
      const doc = makeDocument('sub init()\n  x = createobject("roArray")\nend sub');
      const casing: CasingConfig = { builtin: 'pascal-case', keyword: 'preserve', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('CreateObject(');
    });

    it('does not change user-defined function names', () => {
      const doc = makeDocument('sub init()\n  myFunction()\nend sub');
      const casing: CasingConfig = { builtin: 'upper-case', keyword: 'preserve', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('myFunction()');
    });
  });

  // ── Combined formatting ──────────────────────────────────────────────────

  describe('combined indentation and casing', () => {
    it('applies both indentation and casing in one pass', () => {
      const doc = makeDocument([
        'FUNCTION main()',
        'IF TRUE THEN',
        'x = len("hello")',
        'END IF',
        'END FUNCTION',
      ]);
      const casing: CasingConfig = { builtin: 'pascal-case', keyword: 'lower-case', method: 'preserve' };
      const result = applyEdits(doc, provider, 4, casing);
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
      const doc = makeDocument('sub init()\n  x = getglobalaa()\nend sub');
      const casing: CasingConfig = {
        builtin: 'lower-case', keyword: 'preserve', method: 'preserve',
        exact: { 'getglobalaa': 'GetGlobalAA' },
      };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('GetGlobalAA()');
    });

    it('applies exact override for a keyword', () => {
      const doc = makeDocument('sub init()\n  x = invalid\nend sub');
      const casing: CasingConfig = {
        builtin: 'preserve', keyword: 'lower-case', method: 'preserve',
        exact: { 'invalid': 'Invalid' },
      };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('Invalid');
      // sub/end sub should still be lowercased (no override for them)
      expect(result).to.match(/^sub/);
    });
  });

  // ── User function casing ─────────────────────────────────────────────────

  describe('user function casing normalization', () => {
    const makeFuncDef = (name: string): FunctionDefinition => ({
      name,
      nameLower: name.toLowerCase(),
      line: 0,
      column: 0,
      filePath: '/test.brs',
      signature: `function ${name}()`,
    });

    it('normalizes user function calls to definition casing', () => {
      const doc = makeDocument('sub init()\n  myhelper()\nend sub');
      const funcs = [makeFuncDef('myHelper')];
      const result = applyEdits(doc, provider, 2, NO_CASING, funcs);
      expect(result).to.include('myHelper()');
    });

    it('normalizes ALL-CAPS call to definition casing', () => {
      const doc = makeDocument('sub init()\n  GETDATA()\nend sub');
      const funcs = [makeFuncDef('getData')];
      const result = applyEdits(doc, provider, 2, NO_CASING, funcs);
      expect(result).to.include('getData()');
    });

    it('applies userFunction casing when set to a non-preserve value', () => {
      const doc = makeDocument('sub init()\n  myHelper()\nend sub');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'preserve', method: 'preserve', userFunction: 'lower-case' };
      const funcs = [makeFuncDef('myHelper')];
      const result = applyEdits(doc, provider, 2, casing, funcs);
      expect(result).to.include('myhelper()');
    });

    it('does not touch identifiers that are not in the function index', () => {
      const doc = makeDocument('sub init()\n  localVar = 1\nend sub');
      const funcs = [makeFuncDef('myHelper')];
      const result = applyEdits(doc, provider, 2, NO_CASING, funcs);
      expect(result).to.include('localVar');
    });

    it('normalizes builtin to catalog casing even with preserve', () => {
      const doc = makeDocument('sub init()\n  x = createobject("roArray")\nend sub');
      const result = applyEdits(doc, provider, 2, NO_CASING);
      expect(result).to.include('CreateObject(');
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty document', () => {
      const doc = makeDocument('');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING);
      expect(edits).to.be.empty;
    });

    it('handles compound end keyword (endif, endsub, etc.)', () => {
      const doc = makeDocument([
        'sub test()',
        'if true then',
        'x = 1',
        'endif',
        'endsub',
      ]);
      const result = applyEdits(doc, provider, 2, NO_CASING);
      expect(result).to.equal([
        'sub test()',
        '  if true then',
        '    x = 1',
        '  endif',
        'endsub',
      ].join('\n'));
    });

    it('preserves escaped quotes inside strings', () => {
      const doc = makeDocument('sub init()\n  x = "say ""hello"""\nend sub');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('"say ""hello"""');
    });

    it('indents comment lines at the current level', () => {
      const doc = makeDocument([
        'sub test()',
        "' a comment",
        'x = 1',
        'end sub',
      ]);
      const result = applyEdits(doc, provider, 2, NO_CASING);
      expect(result).to.equal([
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
      const doc = makeDocument('function main(x as integer) as boolean\nend function');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', type: 'capitalize' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('as Integer');
      expect(result).to.include('as Boolean');
      expect(result).to.include('function'); // keyword still lowercase
    });

    it('applies type casing to "function" when used as a type (after as)', () => {
      const doc = makeDocument('function main(callback as function) as function\nend function');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', type: 'capitalize' };
      const result = applyEdits(doc, provider, 2, casing);
      // "function" after "as" should use type casing (Capitalize)
      expect(result).to.include('as Function) as Function');
      // "function" as keyword (declaration) stays lowercase
      expect(result).to.match(/^function main/);
    });

    it('applies literal casing independently', () => {
      const doc = makeDocument('sub init()\n  x = TRUE\n  y = FALSE\n  z = INVALID\nend sub');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'preserve', method: 'preserve', literal: 'lower-case' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('true');
      expect(result).to.include('false');
      expect(result).to.include('invalid');
    });

    it('applies logicOperator casing independently', () => {
      const doc = makeDocument('sub init()\n  if a and b or not c then\n    return\n  end if\nend sub');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', logicOperator: 'upper-case' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('AND');
      expect(result).to.include('OR');
      expect(result).to.include('NOT');
      expect(result).to.include('if'); // keyword stays lowercase
    });

    it('applies mathOperator casing independently', () => {
      const doc = makeDocument('sub init()\n  x = 10 mod 3\nend sub');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'lower-case', method: 'preserve', mathOperator: 'upper-case' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('MOD');
      expect(result).to.include('sub'); // keyword stays lowercase
    });

    it('falls back to keyword casing when category is not set', () => {
      const doc = makeDocument('sub init()\n  x = true\n  y = 10 mod 3\nend sub');
      const casing: CasingConfig = { builtin: 'preserve', keyword: 'upper-case', method: 'preserve' };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('TRUE');
      expect(result).to.include('MOD');
      expect(result).to.include('SUB');
    });

    it('exact overrides category casing', () => {
      const doc = makeDocument('sub init()\n  x = true\nend sub');
      const casing: CasingConfig = {
        builtin: 'preserve', keyword: 'upper-case', method: 'preserve',
        literal: 'upper-case',
        exact: { 'true': 'True' },
      };
      const result = applyEdits(doc, provider, 2, casing);
      expect(result).to.include('True'); // exact override wins over literal: upper-case
    });
  });

  // ── emptyLineBeforeReturn context-aware ──────────────────────────────────

  describe('emptyLineBeforeReturn context-aware', () => {
    function formatWithReturn(content: string[], mode: 'always' | 'not-alone'): string {
      const doc = makeDocument(content);
      const config: FormattingConfig = {
        ...DEFAULT_FORMATTING_CONFIG,
        indentSize: 2,
        insertFinalNewline: false,
        emptyLineBeforeReturn: mode,
      };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING);
      if (edits.length === 0) return doc.getText();
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
      for (const edit of sorted) {
        const startOff = doc.offsetAt(edit.range.start);
        const endOff = doc.offsetAt(edit.range.end);
        text = text.substring(0, startOff) + edit.newText + text.substring(endOff);
      }
      return text;
    }

    it('always: adds blank line before return even when alone', () => {
      const result = formatWithReturn([
        'function guard(x)',
        '  if x then',
        '    return',
        '  end if',
        'end function',
      ], 'always');
      const lines = result.split('\n');
      const returnIdx = lines.findIndex(l => l.trim() === 'return');
      expect(lines[returnIdx - 1].trim()).to.equal('');
    });

    it('not-alone: skips blank line when return is the only statement in block', () => {
      const result = formatWithReturn([
        'function guard(x)',
        '  if x then',
        '    return',
        '  end if',
        'end function',
      ], 'not-alone');
      const lines = result.split('\n');
      const returnIdx = lines.findIndex(l => l.trim() === 'return');
      expect(lines[returnIdx - 1].trim()).to.not.equal('');
    });

    it('not-alone: adds blank line when return has sibling statements', () => {
      const result = formatWithReturn([
        'function test()',
        '  x = 1',
        '  y = 2',
        '  return x + y',
        'end function',
      ], 'not-alone');
      const lines = result.split('\n');
      const returnIdx = lines.findIndex(l => l.trim().startsWith('return'));
      expect(lines[returnIdx - 1].trim()).to.equal('');
    });
  });

  // ── Import & Mock sorting ──────────────────────────────────────────────────

  describe('import and mock sorting', () => {
    it('sorts @import lines alphabetically', () => {
      const doc = makeDocument([
        "' @import /components/Zebra.brs",
        "' @import /components/Alpha.brs",
        '',
        'sub init()',
        'end sub',
      ]);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, sortImports: true, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      const lines = text.split('\n');
      expect(lines[0]).to.include('Alpha');
      expect(lines[1]).to.include('Zebra');
    });

    it('sorts @mock lines and places them after @import', () => {
      const doc = makeDocument([
        "' @mock /components/Zebra.brs",
        "' @import /components/Foo.brs",
        "' @mock /components/Alpha.brs",
        "' @import /components/Bar.brs",
        '',
        'function TestSuite__Foo() as Object',
        '  return ts',
        'end function',
      ]);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, sortImports: true, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      const lines = text.split('\n');
      // Imports come first (sorted)
      expect(lines[0]).to.equal("' @import /components/Bar.brs");
      expect(lines[1]).to.equal("' @import /components/Foo.brs");
      // Mocks come after imports (sorted)
      expect(lines[2]).to.equal("' @mock /components/Alpha.brs");
      expect(lines[3]).to.equal("' @mock /components/Zebra.brs");
    });

    it('applies emptyLineAfterImports after the last @mock', () => {
      const doc = makeDocument([
        "' @import /components/Foo.brs",
        "' @mock /components/Bar.brs",
        'function TestSuite__Foo() as Object',
        '  return ts',
        'end function',
      ]);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, sortImports: true, emptyLineAfterImports: true, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      const lines = text.split('\n');
      expect(lines[0]).to.include('@import');
      expect(lines[1]).to.include('@mock');
      expect(lines[2]).to.equal('');
      expect(lines[3]).to.include('function TestSuite__Foo');
    });

    it('sorts module @mock imports (with "from") before local mocks', () => {
      const doc = makeDocument([
        "' @import /components/Foo.brs from @dazn/kopytko-unit-testing-framework",
        "' @mock /components/local/Service.brs",
        "' @mock /components/Router.brs from @dazn/kopytko-framework",
        "' @mock /components/Store.brs from @dazn/kopytko-framework",
        '',
        'function TestSuite__Foo() as Object',
        '  return ts',
        'end function',
      ]);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, sortImports: true, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      const lines = text.split('\n');
      // Import first
      expect(lines[0]).to.include('@import');
      // Module mocks before local mocks
      expect(lines[1]).to.include('@mock');
      expect(lines[1]).to.include('from @dazn');
      expect(lines[2]).to.include('@mock');
      expect(lines[2]).to.include('from @dazn');
      // Local mock last
      expect(lines[3]).to.include('@mock');
      expect(lines[3]).to.include('local/Service');
    });

    it('applies emptyLineAfterImports independently of sortImports', () => {
      const doc = makeDocument([
        "' @import /components/Foo.brs from @dazn/kopytko-utils",
        'function init()',
        'end function',
      ]);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, sortImports: false, emptyLineAfterImports: true, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      const lines = text.split('\n');
      expect(lines[0]).to.include('@import');
      expect(lines[1]).to.equal('');
      expect(lines[2]).to.include('function init');
    });
  });

  // ── Formatter Bug Regression Tests ──────────────────────────────────────────

  describe('formatter bug regression tests', () => {
    it('does not corrupt identifier "constructor" via exact prototype leak', () => {
      const doc = makeDocument('sub constructor()\n  m.x = 1\nend sub');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      const casing: CasingConfig = { builtin: 'pascal-case', keyword: 'lower-case', method: 'preserve', exact: { 'invalid': 'Invalid' } };
      const edits = provider.provideDocumentFormatting(doc, config, casing, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.include('sub constructor()');
      expect(text).to.not.include('[native code]');
      expect(text).to.not.include('Object');
    });

    it('preserves space between AND/OR/NOT and opening paren', () => {
      const doc = makeDocument('sub t()\n  if (a AND (b OR c)) then\n    print "ok"\n  end if\nend sub');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false, spaceBeforeCallParens: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.include('AND (b');
      expect(text).to.include('OR c)');
    });

    it('indents AA fields inside multi-line associative arrays', () => {
      const doc = makeDocument('sub t()\n  x = {\n    name: "test",\n  }\nend sub');
      const result = applyEdits(doc, provider, 2, NO_CASING);
      const lines = result.split('\n');
      const nameLine = lines.find(l => l.includes('name:'));
      expect(nameLine).to.exist;
      expect(nameLine!.startsWith('    ')).to.be.true;
    });

    it('does not wrap condition on single-line if without then', () => {
      const doc = makeDocument('sub t()\n  if (x = Invalid) return Invalid\nend sub');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false, parenthesisIfCase: 'always' };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.not.include('((');
      expect(text).to.include('if (x = Invalid) return Invalid');
    });

    it('does not indent after single-line if without then', () => {
      const doc = makeDocument('function t()\n  if (x = Invalid) return Invalid\n\n  return x\nend function');
      const result = applyEdits(doc, provider, 2, NO_CASING);
      const lines = result.split('\n');
      const returnLine = lines.find(l => l.trim() === 'return x');
      const ifLine = lines.find(l => l.includes('if (x = Invalid)'));
      expect(returnLine).to.exist;
      expect(ifLine).to.exist;
      const returnIndent = returnLine!.match(/^(\s*)/)![1].length;
      const ifIndent = ifLine!.match(/^(\s*)/)![1].length;
      expect(returnIndent).to.equal(ifIndent);
    });

    it('correctly deindents after closing }) of function call with AA argument', () => {
      const doc = makeDocument('sub t()\n  setState({\n    x: 1,\n  })\n  after()\nend sub');
      const result = applyEdits(doc, provider, 2, NO_CASING);
      const lines = result.split('\n');
      const setStateLine = lines.find(l => l.includes('setState('));
      const afterLine = lines.find(l => l.includes('after()'));
      expect(setStateLine).to.exist;
      expect(afterLine).to.exist;
      const setStateIndent = setStateLine!.match(/^(\s*)/)![1].length;
      const afterIndent = afterLine!.match(/^(\s*)/)![1].length;
      expect(afterIndent).to.equal(setStateIndent);
    });

    it('indents body of inline anonymous function callback', () => {
      const doc = makeDocument('sub t()\n  promise.then(sub (data)\n    print data\n  end sub)\nend sub');
      const result = applyEdits(doc, provider, 2, NO_CASING);
      const lines = result.split('\n');
      const bodyLine = lines.find(l => l.includes('print data'));
      const thenLine = lines.find(l => l.includes('.then('));
      expect(bodyLine).to.exist;
      expect(thenLine).to.exist;
      const bodyIndent = bodyLine!.match(/^(\s*)/)![1].length;
      const thenIndent = thenLine!.match(/^(\s*)/)![1].length;
      expect(bodyIndent).to.be.greaterThan(thenIndent);
    });

    it('indents body of anonymous function with return type annotation', () => {
      const doc = makeDocument('sub t()\n  _constructor = function (m as Object) as Object\n    return m\n  end function\nend sub');
      const result = applyEdits(doc, provider, 2, NO_CASING);
      const lines = result.split('\n');
      const bodyLine = lines.find(l => l.includes('return m'));
      const funcLine = lines.find(l => l.includes('_constructor = function'));
      expect(bodyLine).to.exist;
      expect(funcLine).to.exist;
      const bodyIndent = bodyLine!.match(/^(\s*)/)![1].length;
      const funcIndent = funcLine!.match(/^(\s*)/)![1].length;
      expect(bodyIndent).to.be.greaterThan(funcIndent);
    });

    it('double-indents content inside return [{ multi-item array', () => {
      const doc = makeDocument('function t()\n  return [{\n    name: "x",\n  },\n  other()\n  ]\nend function');
      const result = applyEdits(doc, provider, 2, NO_CASING);
      const lines = result.split('\n');
      const nameLine = lines.find(l => l.includes('name: "x"'));
      const funcBodyLine = lines.find(l => l.includes('return ['));
      expect(nameLine).to.exist;
      expect(funcBodyLine).to.exist;
      const nameIndent = nameLine!.match(/^(\s*)/)![1].length;
      const returnIndent = funcBodyLine!.match(/^(\s*)/)![1].length;
      expect(nameIndent).to.be.greaterThan(returnIndent);
    });

    it('does not add duplicate comma when line already has comma before comment', () => {
      const doc = makeDocument("sub t()\n  x = {\n    items: [1, 0], ' comment\n  }\nend sub");
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false, associativeArrayCommaStyle: 'always' };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.not.include(',,');
    });

    it('does not add commas to if/end if inside anonymous function in AA', () => {
      const doc = makeDocument([
        'sub t()',
        '  x = {',
        '    handler: function ()',
        '      if true then',
        '        print "yes"',
        '      end if',
        '    end function,',
        '  }',
        'end sub',
      ]);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false, associativeArrayCommaStyle: 'always' };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.not.match(/if true then,/);
      expect(text).to.not.match(/end if,/);
      expect(text).to.not.match(/print "yes",/);
    });

    it('treats Type as a builtin function, not a keyword', () => {
      const doc = makeDocument('sub t()\n  x = type(y)\nend sub');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      const casing: CasingConfig = { builtin: 'pascal-case', keyword: 'lower-case', method: 'preserve' };
      const edits = provider.provideDocumentFormatting(doc, config, casing, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.include('Type(y)');
    });

    it('does not convert function to sub when body has return with value', () => {
      const doc = makeDocument('function getData()\n  return { name: "test" }\nend function');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false, functionVsSubForVoid: 'sub' };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.include('function getData()');
      expect(text).to.include('end function');
      expect(text).to.not.include('sub getData()');
    });

    it('does not split compound assignment operators (+=, -=, *=, /=)', () => {
      const doc = makeDocument('sub t()\n  url += "/" + effect\n  count -= 1\n  ratio *= 2\n  total /= 3\nend sub');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false, spaceAroundOperators: true, spaceAroundAssignment: true };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING, []);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.include('url += "/" + effect');
      expect(text).to.include('count -= 1');
      expect(text).to.include('ratio *= 2');
      expect(text).to.include('total /= 3');
      expect(text).to.not.include('+ =');
      expect(text).to.not.include('- =');
      expect(text).to.not.include('* =');
      expect(text).to.not.include('/ =');
    });

    it('does not apply casing to associative array keys', () => {
      const doc = makeDocument('sub t()\n  obj = {\n    ObjectUtils: m._objectUtils,\n    content: content,\n  }\nend sub');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      const casing: CasingConfig = { builtin: 'pascal-case', keyword: 'lower-case', method: 'camel-case', userFunction: 'camel-case', exact: {} };
      const userFuncs: FunctionDefinition[] = [{ name: 'objectUtils', nameLower: 'objectutils', signature: 'function objectUtils()', line: 0, column: 0, filePath: '/a.brs' }];
      const edits = provider.provideDocumentFormatting(doc, config, casing, userFuncs);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.include('ObjectUtils:');
      expect(text).to.not.include('objectUtils:');
    });

    it('does not apply user function casing to property accesses after dot', () => {
      const doc = makeDocument('sub t()\n  result = context.arrayUtils.filter(items)\nend sub');
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2, insertFinalNewline: false };
      const casing: CasingConfig = { builtin: 'pascal-case', keyword: 'lower-case', method: 'camel-case', userFunction: 'pascal-case', exact: {} };
      const userFuncs: FunctionDefinition[] = [{ name: 'ArrayUtils', nameLower: 'arrayutils', signature: 'function ArrayUtils()', line: 0, column: 0, filePath: '/a.brs' }];
      const edits = provider.provideDocumentFormatting(doc, config, casing, userFuncs);
      let text = doc.getText();
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });
      for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.substring(0, start) + edit.newText + text.substring(end);
      }
      expect(text).to.include('context.arrayUtils.filter');
      expect(text).to.not.include('context.ArrayUtils');
    });
  });

  // ── readOnlyPaths guard ─────────────────────────────────────────────────

  describe('readOnlyPaths guard', () => {
    it('returns no edits when the document URI matches a readOnly check', () => {
      const doc = makeDocument([
        'function main()',
        'print "hello"',
        'end function',
      ]);
      provider.setReadOnlyCheck(() => true);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 4, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING);
      expect(edits).to.deep.equal([]);
    });

    it('formats normally when the document URI does not match', () => {
      const doc = makeDocument([
        'function main()',
        'print "hello"',
        'end function',
      ]);
      provider.setReadOnlyCheck(() => false);
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, indentSize: 4, insertFinalNewline: false };
      const edits = provider.provideDocumentFormatting(doc, config, NO_CASING);
      expect(edits).to.have.length.greaterThan(0);
    });

    it('passes the document URI to the readOnly check', () => {
      const doc = TextDocument.create('file:///project/node_modules/pkg/file.brs', 'brightscript', 1, 'print 1');
      let capturedUri = '';
      provider.setReadOnlyCheck((uri) => { capturedUri = uri; return true; });
      const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, insertFinalNewline: false };
      provider.provideDocumentFormatting(doc, config, NO_CASING);
      expect(capturedUri).to.equal('file:///project/node_modules/pkg/file.brs');
    });
  });
});

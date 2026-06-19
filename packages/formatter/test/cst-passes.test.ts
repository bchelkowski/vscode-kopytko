import { expect } from 'chai';
import { parse } from 'kopytko-brightscript-parser';
import { endKeywordStylePass } from '../src/cst-passes/endKeywordStyle';
import { casingPass } from '../src/cst-passes/casingPass';
import { commentNormalizationPass } from '../src/cst-passes/commentNormalization';
import { printStatementRemovalPass } from '../src/cst-passes/printStatementRemoval';
import { importSortingPass } from '../src/cst-passes/importSorting';
import { applyEdits, runCstPasses } from '../src/cst-passes/infrastructure';
import { DEFAULT_CASING_CONFIG } from '../src/casing';
import type { CasingConfig } from '../src/casing';

describe('CST Passes', () => {
  describe('endKeywordStylePass', () => {
    it('converts compact to spaced', () => {
      const source = 'if x\n  print 1\nendif';
      const result = parse(source);
      const edits = endKeywordStylePass('spaced')(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.equal('if x\n  print 1\nend if');
    });

    it('converts spaced to compact', () => {
      const source = 'if x\n  print 1\nend if';
      const result = parse(source);
      const edits = endKeywordStylePass('compact')(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.equal('if x\n  print 1\nendif');
    });

    it('handles multiple end keywords', () => {
      const source = 'function foo()\n  for i = 1 to 3\n    print i\n  endfor\nendfunction';
      const result = parse(source);
      const edits = endKeywordStylePass('spaced')(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('end for');
      expect(output).to.contain('end function');
      expect(output).not.to.contain('endfor');
      expect(output).not.to.contain('endfunction');
    });

    it('preserves casing pattern — uppercase stays uppercase', () => {
      const source = 'IF x\n  PRINT 1\nENDIF';
      const result = parse(source);
      const edits = endKeywordStylePass('spaced')(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('END IF');
    });

    it('preserves casing pattern — title case', () => {
      const source = 'If x\n  Print 1\nEndIf';
      const result = parse(source);
      const edits = endKeywordStylePass('spaced')(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('End If');
    });

    it('does nothing when already in target style', () => {
      const source = 'if x\n  print 1\nend if';
      const result = parse(source);
      const edits = endKeywordStylePass('spaced')(result.root, source);
      expect(edits).to.have.length(0);
    });

    it('handles all end keyword types', () => {
      const source = 'endsub\nendfor\nendwhile\nendtry\nendif\nendfunction';
      const result = parse(source);
      const edits = endKeywordStylePass('spaced')(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.equal('end sub\nend for\nend while\nend try\nend if\nend function');
    });

    it('never modifies string content', () => {
      const source = 'x = "contains endif inside"\nendif';
      const result = parse(source);
      const edits = endKeywordStylePass('spaced')(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('"contains endif inside"'); // string unchanged
      expect(output).to.contain('end if'); // keyword changed
    });
  });

  describe('casingPass', () => {
    it('applies keyword casing — lower case', () => {
      const source = 'IF x THEN\n  PRINT "hello"\nEND IF';
      const config: CasingConfig = { ...DEFAULT_CASING_CONFIG, keyword: 'lower-case' };
      const result = parse(source);
      const edits = casingPass(config)(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('if');
      expect(output).to.contain('then');
      expect(output).to.contain('end if');
    });

    it('applies builtin casing — capitalize', () => {
      const source = 'x = len("hello")';
      const config: CasingConfig = { ...DEFAULT_CASING_CONFIG, builtin: 'upper-case' };
      const result = parse(source);
      const edits = casingPass(config)(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('LEN');
    });

    it('does not modify strings', () => {
      const source = 'x = "FUNCTION inside string"';
      const config: CasingConfig = { ...DEFAULT_CASING_CONFIG, keyword: 'lower-case' };
      const result = parse(source);
      const edits = casingPass(config)(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.equal(source); // string untouched
    });

    it('applies exact casing overrides', () => {
      const source = 'x = myCustomFunc()';
      const config: CasingConfig = { ...DEFAULT_CASING_CONFIG, exact: { mycustomfunc: 'MyCustomFunc' } };
      const result = parse(source);
      const edits = casingPass(config)(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('MyCustomFunc');
    });

    it('exact override does not match Object.prototype inherited properties like constructor', () => {
      // { invalid: "Invalid" } inherits Object.prototype.constructor — without hasOwn
      // the casingPass would replace the BrightScript `constructor` identifier with
      // the JS Object function, producing "function Object() { [native code] }".
      const source = 'sub constructor()\n  x = invalid\nend sub\n';
      const config: CasingConfig = { ...DEFAULT_CASING_CONFIG, exact: { invalid: 'Invalid' } };
      const result = parse(source);
      const edits = casingPass(config)(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('constructor');
      expect(output).not.to.contain('[native code]');
      expect(output).to.contain('Invalid');
    });

    it('exact override does not corrupt any Object.prototype property name used as identifier', () => {
      // Exhaustive check: none of the standard Object.prototype inherited names should
      // be treated as an exact casing key when the user only set { invalid: "Invalid" }.
      const protoProps = ['constructor', 'toString', 'valueOf', 'hasOwnProperty',
                          'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'];
      const config: CasingConfig = { ...DEFAULT_CASING_CONFIG, exact: { invalid: 'Invalid' } };

      for (const prop of protoProps) {
        const source = `sub ${prop}()\n  x = invalid\nend sub\n`;
        const result = parse(source);
        const edits = casingPass(config)(result.root, source);
        const output = applyEdits(source, edits);
        expect(output, `${prop}: identifier must survive`).to.contain(prop);
        expect(output, `${prop}: no [native code] injection`).not.to.contain('[native code]');
        expect(output, `${prop}: invalid → Invalid`).to.contain('Invalid');
      }
    });

    it('preserve means no changes', () => {
      const source = 'IF x THEN Print "HELLO" END IF';
      const config: CasingConfig = { ...DEFAULT_CASING_CONFIG }; // all preserve
      const result = parse(source);
      const edits = casingPass(config)(result.root, source);
      expect(edits).to.have.length(0);
    });
  });

  describe('runCstPasses', () => {
    it('chains multiple passes', () => {
      const source = 'IF x\n  PRINT 1\nENDIF';
      const output = runCstPasses(source, [
        endKeywordStylePass('spaced'),
      ]);
      expect(output).to.contain('END IF');
      expect(output).not.to.contain('ENDIF');
    });

    it('returns original if source has parse errors', () => {
      const source = '~~~invalid~~~';
      const output = runCstPasses(source, [
        endKeywordStylePass('spaced'),
      ]);
      expect(output).to.equal(source);
    });
  });

  describe('commentNormalizationPass', () => {
    it('converts rem to tick', () => {
      const source = "rem this is a comment\nprint 1";
      const result = parse(source);
      const edits = commentNormalizationPass({ commentStyle: "'", spaceAfterCommentMarker: false })(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain("' this is a comment");
      expect(output).not.to.contain('rem');
    });

    it('converts tick to rem', () => {
      const source = "' this is a comment\nprint 1";
      const result = parse(source);
      const edits = commentNormalizationPass({ commentStyle: 'rem', spaceAfterCommentMarker: false })(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('rem this is a comment');
    });

    it('adds space after comment marker', () => {
      const source = "'no space here\nprint 1";
      const result = parse(source);
      const edits = commentNormalizationPass({ commentStyle: 'preserve', spaceAfterCommentMarker: true })(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain("' no space here");
    });

    it('does not modify @import annotations', () => {
      const source = "' @import /path/to/file from module\nprint 1";
      const result = parse(source);
      const edits = commentNormalizationPass({ commentStyle: 'rem', spaceAfterCommentMarker: true })(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain("' @import"); // unchanged
    });

    it('does not modify strings containing comment-like text', () => {
      const source = 'x = "rem this is not a comment"';
      const result = parse(source);
      const edits = commentNormalizationPass({ commentStyle: "'", spaceAfterCommentMarker: true })(result.root, source);
      expect(edits).to.have.length(0);
    });

    it('handles trailing comments', () => {
      const source = "x = 1 'trailing\nprint 2";
      const result = parse(source);
      const edits = commentNormalizationPass({ commentStyle: 'preserve', spaceAfterCommentMarker: true })(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain("' trailing");
    });
  });

  describe('printStatementRemovalPass', () => {
    it('removes print statement', () => {
      const source = 'x = 1\nprint "debug"\ny = 2';
      const result = parse(source);
      const edits = printStatementRemovalPass()(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).not.to.contain('print');
      expect(output).to.contain('x = 1');
      expect(output).to.contain('y = 2');
    });

    it('removes ? shorthand', () => {
      const source = 'x = 1\n? "debug"\ny = 2';
      const result = parse(source);
      const edits = printStatementRemovalPass()(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).not.to.contain('?');
      expect(output).to.contain('x = 1');
    });

    it('does not remove print inside strings', () => {
      const source = 'x = "print should stay"';
      const result = parse(source);
      const edits = printStatementRemovalPass()(result.root, source);
      expect(edits).to.have.length(0);
    });

    it('removes multiple print statements', () => {
      const source = 'print 1\nprint 2\nprint 3';
      const result = parse(source);
      const edits = printStatementRemovalPass()(result.root, source);
      const output = applyEdits(source, edits);
      expect(output.trim()).to.equal('');
    });
  });

  describe('importSortingPass', () => {
    it('sorts local imports alphabetically', () => {
      const source = "' @import /z/file\n' @import /a/file\nprint 1";
      const result = parse(source);
      const edits = importSortingPass({ sortImports: true, emptyLineAfterImports: false })(result.root, source);
      const output = applyEdits(source, edits);
      const lines = output.split('\n');
      expect(lines[0]).to.contain('/a/file');
      expect(lines[1]).to.contain('/z/file');
    });

    it('puts module imports before local imports', () => {
      const source = "' @import /local/file\n' @import /path from my-module\nprint 1";
      const result = parse(source);
      const edits = importSortingPass({ sortImports: true, emptyLineAfterImports: false })(result.root, source);
      const output = applyEdits(source, edits);
      const lines = output.split('\n');
      expect(lines[0]).to.contain('from my-module');
      expect(lines[1]).to.contain('/local/file');
    });

    it('does nothing when already sorted', () => {
      const source = "' @import /a/file\n' @import /z/file\nprint 1";
      const result = parse(source);
      const edits = importSortingPass({ sortImports: true, emptyLineAfterImports: false })(result.root, source);
      expect(edits).to.have.length(0);
    });

    it('preserves non-import content', () => {
      const source = "' @import /z/file\n' @import /a/file\nsub main()\n  print 1\nend sub";
      const result = parse(source);
      const edits = importSortingPass({ sortImports: true, emptyLineAfterImports: false })(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('sub main()');
      expect(output).to.contain('end sub');
    });
  });
});

  describe('trailingWhitespacePass', () => {
    const { trailingWhitespacePass } = require('../src/cst-passes/trailingWhitespace');
    it('removes trailing spaces', () => {
      const source = 'x = 1   \ny = 2  ';
      const result = parse(source);
      const edits = trailingWhitespacePass()(result.root, source);
      const output = applyEdits(source, edits);
      expect(output).to.equal('x = 1\ny = 2');
    });
    it('preserves lines without trailing spaces', () => {
      const source = 'x = 1\ny = 2';
      const edits = trailingWhitespacePass()(parse(source).root, source);
      expect(edits).to.have.length(0);
    });
  });

  describe('thenStylePass', () => {
    const { thenStylePass } = require('../src/cst-passes/thenStyle');
    it('adds then when style is always', () => {
      const source = 'if x > 0\n  print 1\nend if';
      const edits = thenStylePass('always')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('then');
    });
    it('preserve returns no edits', () => {
      const edits = thenStylePass('preserve')(parse('if x then\nend if').root, 'if x then\nend if');
      expect(edits).to.have.length(0);
    });
  });

  describe('functionVsSubPass', () => {
    const { functionVsSubPass } = require('../src/cst-passes/functionVsSub');
    it('preserve returns no edits', () => {
      const edits = functionVsSubPass('preserve')(parse('sub foo()\nend sub').root, 'sub foo()\nend sub');
      expect(edits).to.have.length(0);
    });
  });

  describe('spacingPass', () => {
    const { spacingPass } = require('../src/cst-passes/spacing');
    it('no-op when both disabled', () => {
      const edits = spacingPass({ spaceAroundOperators: false, spaceAroundAssignment: false })(
        parse('x=1+2').root, 'x=1+2');
      expect(edits).to.have.length(0);
    });
  });

  describe('indentationPass', () => {
    const { indentationPass } = require('../src/cst-passes/indentation');
    it('creates edits for misindented code', () => {
      const source = 'function foo()\nreturn 1\nend function';
      const edits = indentationPass({ indentSize: 4, useTabs: false })(parse(source).root, source);
      expect(edits.length).to.be.greaterThan(0);
    });
  });

  describe('trailingCommaPass', () => {
    const { trailingCommaPass } = require('../src/cst-passes/trailingCommas');
    it('preserve returns no edits', () => {
      const edits = trailingCommaPass('preserve')(parse('a = [1, 2]').root, 'a = [1, 2]');
      expect(edits).to.have.length(0);
    });
    it('returns no edits for array where last direct token is comma', () => {
      const source = 'a = [\n  1,\n  2\n]';
      const edits = trailingCommaPass('always')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(edits).to.have.length(0); // last direct child token is already comma
    });
  });

  describe('blankLinePass', () => {
    const { blankLinePass } = require('../src/cst-passes/blankLines');
    it('no-op when maxEmptyLines is 0', () => {
      const edits = blankLinePass({ maxEmptyLines: 0, emptyLinesBetweenFunctions: 0 })(
        parse('a = 1\n\n\n\nb = 2').root, 'a = 1\n\n\n\nb = 2');
      expect(edits).to.have.length(0);
    });
  });

  describe('stripCatchParensPass', () => {
    const { stripCatchParensPass } = require('../src/cst-passes/stripCatchParens');
    it('is a valid pass function', () => {
      const pass = stripCatchParensPass();
      expect(typeof pass).to.equal('function');
    });
  });

  describe('parenthesisIfCasePass', () => {
    const { parenthesisIfCasePass } = require('../src/cst-passes/parenthesisIfCase');
    it('preserve returns no edits', () => {
      const edits = parenthesisIfCasePass('preserve')(parse('if x then\nend if').root, 'if x then\nend if');
      expect(edits).to.have.length(0);
    });
  });

  describe('lineCommentPositionPass', () => {
    const { lineCommentPositionPass } = require('../src/cst-passes/lineCommentPosition');
    it('preserve returns no edits', () => {
      const edits = lineCommentPositionPass('preserve')(parse("x = 1 ' comment").root, "x = 1 ' comment");
      expect(edits).to.have.length(0);
    });
  });

  describe('observeFieldStylePass', () => {
    const { observeFieldStylePass } = require('../src/cst-passes/observeFieldStyle');
    it('preserve returns no edits', () => {
      const edits = observeFieldStylePass('preserve')(parse('m.top.observeField("f", "cb")').root, 'm.top.observeField("f", "cb")');
      expect(edits).to.have.length(0);
    });
    it('always-scoped converts observeField', () => {
      const source = 'm.top.observeField("f", "cb")';
      const edits = observeFieldStylePass('always-scoped')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('observeFieldScoped');
    });
  });

  describe('commentWidthPass', () => {
    const { commentWidthPass } = require('../src/cst-passes/commentWidth');
    it('no-op when maxWidth is 0', () => {
      const edits = commentWidthPass(0)(parse("' short").root, "' short");
      expect(edits).to.have.length(0);
    });
  });

  describe('stub passes (infrastructure ready)', () => {
    const { elseOnNewLinePass } = require('../src/cst-passes/elseOnNewLine');
    const { splitArrayOpenBracketPass } = require('../src/cst-passes/splitArrayOpenBracket');
    const { alignAssignmentsPass } = require('../src/cst-passes/alignAssignments');
    const { emptyLinesBetweenMethodsPass } = require('../src/cst-passes/emptyLinesBetweenMethods');
    const { mPrefixStylePass } = require('../src/cst-passes/mPrefixStyle');
    const { fieldAccessConsistencyPass } = require('../src/cst-passes/fieldAccessConsistency');
    const { wrapLongStringsPass } = require('../src/cst-passes/wrapLongStrings');
    const { stringConcatStylePass } = require('../src/cst-passes/stringConcatStyle');
    const { aaThresholdPass } = require('../src/cst-passes/aaThreshold');
    const { paramAlignmentPass } = require('../src/cst-passes/paramAlignment');

    it('elseOnNewLine: no-op when keepOnNewLine', () => {
      expect(elseOnNewLinePass(true)(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('splitArrayOpenBracket: no-op when disabled', () => {
      expect(splitArrayOpenBracketPass(false)(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('alignAssignments: no-op when disabled', () => {
      expect(alignAssignmentsPass(false)(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('emptyLinesBetweenMethods: no-op when 0', () => {
      expect(emptyLinesBetweenMethodsPass(0)(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('mPrefixStyle: no-op when preserve', () => {
      expect(mPrefixStylePass('preserve')(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('fieldAccessConsistency: no-op when preserve', () => {
      expect(fieldAccessConsistencyPass('preserve')(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('wrapLongStrings: no-op when preserve', () => {
      expect(wrapLongStringsPass('preserve', 0)(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('stringConcatStyle: no-op when preserve', () => {
      expect(stringConcatStylePass('preserve')(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('aaThreshold: no-op when 0', () => {
      expect(aaThresholdPass(0)(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
    it('paramAlignment: no-op when preserve', () => {
      expect(paramAlignmentPass('preserve')(parse('x = 1').root, 'x = 1')).to.have.length(0);
    });
  });

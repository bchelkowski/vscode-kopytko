import { expect } from 'chai';
import { parse } from 'kopytko-brightscript-parser';
import { endKeywordStylePass } from '../src/cst-passes/endKeywordStyle';
import { casingPass } from '../src/cst-passes/casingPass';
import { commentNormalizationPass } from '../src/cst-passes/commentNormalization';
import { printStatementRemovalPass } from '../src/cst-passes/printStatementRemoval';
import { functionVsSubPass } from '../src/cst-passes/functionVsSub';
import { thenStylePass } from '../src/cst-passes/thenStyle';
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

    it('regression: pass 2 positions correct after pass 1 shrinks text (function→sub then removal)', () => {
      // functionVsSubPass changes 'function' (8 chars) → 'sub' (3 chars) = −5 byte shift
      // BEFORE 'then' on the next line. With the stale-position bug, thenStylePass uses
      // the original 'then' position applied to the shifted result, corrupting 'return'.
      const source = [
        'function voidFunc()',
        '  if x then',
        '    return',
        '  end if',
        'end function',
      ].join('\n');
      const output = runCstPasses(source, [
        functionVsSubPass('sub'),         // 'function' → 'sub': −5 chars before 'then'
        thenStylePass('singleline-only'), // should remove ' then' from multi-line if
      ]);
      expect(output).to.contain('sub voidFunc()');       // pass 1 must have fired
      expect(output).not.to.contain('if x then');        // pass 2 must have removed 'then'
      expect(output).to.contain('if x');                 // condition remains
      expect(output).to.contain('    return');           // indented 'return' keyword present
      expect(output).not.to.match(/\beturn\b/);          // regression: 'eturn' (truncated 'return') must not appear as a standalone identifier
    });

    it('regression: pass 2 positions correct after pass 1 grows text (endsub→end sub then removal)', () => {
      // endKeywordStylePass changes 'endsub' (6 chars) → 'end sub' (7 chars) = +1 byte shift
      // BEFORE 'then' in the subsequent function. With the stale-position bug, thenStylePass
      // applies the 'then' edit one position off and corrupts the code.
      const source = [
        'sub outer()',
        'endsub',
        '',
        'function hasIf() as Integer',
        '  if x then',
        '    return 1',
        '  end if',
        'end function',
      ].join('\n');
      const output = runCstPasses(source, [
        endKeywordStylePass('spaced'),    // 'endsub' → 'end sub': +1 char before 'then'
        thenStylePass('singleline-only'), // should remove ' then' from multi-line if
      ]);
      expect(output).to.contain('end sub');          // pass 1 must have fired
      expect(output).not.to.contain('if x then');   // pass 2 must have removed 'then'
      expect(output).to.contain('if x');            // condition remains
      expect(output).to.contain('return 1');        // 'return' keyword must not be corrupted
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

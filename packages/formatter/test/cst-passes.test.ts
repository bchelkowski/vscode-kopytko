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

describe('observeFieldStylePass', () => {
  const { observeFieldStylePass } = require('../src/cst-passes/observeFieldStyle');

  it('preserve returns no edits', () => {
    const source = 'sub init()\n  m.top.observeField("f", "cb")\nend sub';
    const edits = observeFieldStylePass('preserve')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('always-scoped rewrites the member name', () => {
    const source = 'sub init()\n  m.top.observeField("f", "cb")\nend sub';
    const edits = observeFieldStylePass('always-scoped')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('m.top.observeFieldScoped("f", "cb")');
  });

  it('always-scoped does not touch an already-scoped call', () => {
    const source = 'sub init()\n  m.top.observeFieldScoped("f", "cb")\nend sub';
    const edits = observeFieldStylePass('always-scoped')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('always-scoped ignores a call mentioned only in a full-line comment', () => {
    const source = "sub init()\n  ' m.top.observeField(\"f\", \"cb\")\nend sub";
    const edits = observeFieldStylePass('always-scoped')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('warn appends a TODO comment after the call', () => {
    const source = 'sub init()\n  m.top.observeField("f", "cb")\nend sub';
    const edits = observeFieldStylePass('warn')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('m.top.observeField("f", "cb") \' TODO: consider using observeFieldScoped');
  });

  it('warn does not duplicate an existing TODO comment', () => {
    const source = 'sub init()\n  m.top.observeField("f", "cb") \' TODO: consider using observeFieldScoped\nend sub';
    const edits = observeFieldStylePass('warn')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('warn appends after an existing unrelated trailing comment', () => {
    const source = "sub init()\n  m.top.observeField(\"f\", \"cb\") ' note\nend sub";
    const edits = observeFieldStylePass('warn')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain("m.top.observeField(\"f\", \"cb\") ' note ' TODO: consider using observeFieldScoped");
  });
});

describe('mPrefixStylePass', () => {
  const { mPrefixStylePass } = require('../src/cst-passes/mPrefixStyle');

  it('preserve returns no edits', () => {
    const source = 'sub init()\n  x = m["field"]\nend sub';
    const edits = mPrefixStylePass('preserve')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('dot: converts m["field"] to m.field', () => {
    const source = 'sub init()\n  x = m["myField"]\nend sub';
    const edits = mPrefixStylePass('dot')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('x = m.myField');
  });

  it('dot: leaves non-identifier string content untouched', () => {
    const source = 'sub init()\n  x = m["has space"]\nend sub';
    const edits = mPrefixStylePass('dot')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('dot: does not match uppercase M (case-sensitive)', () => {
    const source = 'sub init()\n  x = M["myField"]\nend sub';
    const edits = mPrefixStylePass('dot')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('bracket: converts m.field to m["field"]', () => {
    const source = 'sub init()\n  x = m.myField\nend sub';
    const edits = mPrefixStylePass('bracket')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('x = m["myField"]');
  });

  it('bracket: does not touch m.top or m.global', () => {
    const source = 'sub init()\n  x = m.top\n  y = m.global\nend sub';
    const edits = mPrefixStylePass('bracket')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('bracket: does not convert method calls', () => {
    const source = 'sub init()\n  m.doWork()\nend sub';
    const edits = mPrefixStylePass('bracket')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('bracket: does not touch chained access like m.top.field', () => {
    const source = 'sub init()\n  x = m.top.field\nend sub';
    const edits = mPrefixStylePass('bracket')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('bracket: converts multiple occurrences on separate lines', () => {
    const source = 'sub init()\n  x = m.a\n  y = m.b\nend sub';
    const edits = mPrefixStylePass('bracket')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('x = m["a"]');
    expect(output).to.contain('y = m["b"]');
  });
});

describe('fieldAccessConsistencyPass', () => {
  const { fieldAccessConsistencyPass } = require('../src/cst-passes/fieldAccessConsistency');

  it('preserve returns no edits', () => {
    const source = 'sub init()\n  x = m.top.getField("visible")\nend sub';
    const edits = fieldAccessConsistencyPass('preserve')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  describe('dot', () => {
    it('converts getField to direct access', () => {
      const source = 'sub init()\n  x = m.top.getField("visible")\nend sub';
      const edits = fieldAccessConsistencyPass('dot')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('x = m.top.visible');
    });

    it('converts setField to assignment, preserving the value expression', () => {
      const source = 'sub init()\n  m.top.setField("count", x + 1)\nend sub';
      const edits = fieldAccessConsistencyPass('dot')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('m.top.count = x + 1');
    });

    it('normalizes M.TOP casing to lowercase', () => {
      const source = 'sub init()\n  x = M.TOP.GetField("visible")\nend sub';
      const edits = fieldAccessConsistencyPass('dot')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('x = m.top.visible');
    });

    it('leaves a non-string-literal argument untouched', () => {
      const source = 'sub init()\n  x = m.top.getField(fieldVar)\nend sub';
      const edits = fieldAccessConsistencyPass('dot')(parse(source).root, source);
      expect(edits).to.have.length(0);
    });
  });

  describe('method', () => {
    it('converts a read to getField', () => {
      const source = 'sub init()\n  x = m.top.visible\nend sub';
      const edits = fieldAccessConsistencyPass('method')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('x = m.top.getField("visible")');
    });

    it('converts a plain assignment to setField', () => {
      const source = 'sub init()\n  m.top.visible = true\nend sub';
      const edits = fieldAccessConsistencyPass('method')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('m.top.setField("visible", true)');
    });

    it('preserves a call-expression value in setField', () => {
      const source = 'sub init()\n  m.top.items = getItems(a, b)\nend sub';
      const edits = fieldAccessConsistencyPass('method')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('m.top.setField("items", getItems(a, b))');
    });

    it('does not touch a compound assignment (no setField/getField equivalent)', () => {
      const source = 'sub init()\n  m.top.count += 1\nend sub';
      const edits = fieldAccessConsistencyPass('method')(parse(source).root, source);
      expect(edits).to.have.length(0);
    });

    it('does not convert a skip-listed method call', () => {
      const source = 'sub init()\n  node = m.top.findNode("myNode")\nend sub';
      const edits = fieldAccessConsistencyPass('method')(parse(source).root, source);
      expect(edits).to.have.length(0);
    });

    it('does not convert a skip-listed method target in an assignment context', () => {
      const source = 'sub init()\n  m.top.update({foo: 1}, true)\nend sub';
      const edits = fieldAccessConsistencyPass('method')(parse(source).root, source);
      expect(edits).to.have.length(0);
    });

    it('normalizes M.TOP casing to lowercase', () => {
      const source = 'sub init()\n  x = M.TOP.visible\nend sub';
      const edits = fieldAccessConsistencyPass('method')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('x = m.top.getField("visible")');
    });

    it('converts the innermost m.top.field even when chained further (matches old regex behavior)', () => {
      const source = 'sub init()\n  x = m.top.field.nested\nend sub';
      const edits = fieldAccessConsistencyPass('method')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('x = m.top.getField("field").nested');
    });
  });
});

describe('lineCommentPositionPass', () => {
  const { lineCommentPositionPass } = require('../src/cst-passes/lineCommentPosition');

  it('preserve returns no edits', () => {
    const source = 'x = 1 \' note\n';
    const edits = lineCommentPositionPass('preserve')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('inline returns no edits (not yet implemented, matches old regex behavior)', () => {
    const source = 'x = 1 \' note\n';
    const edits = lineCommentPositionPass('inline')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('above: moves a trailing comment to its own line, preserving indentation', () => {
    const source = 'sub init()\n  x = 1 \' note\nend sub';
    const edits = lineCommentPositionPass('above')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal("sub init()\n  ' note\n  x = 1\nend sub");
  });

  it('above: leaves a standalone comment line untouched', () => {
    const source = "sub init()\n  ' already above\n  x = 1\nend sub";
    const edits = lineCommentPositionPass('above')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('above: leaves a code line with no trailing comment untouched', () => {
    const source = 'sub init()\n  x = 1\nend sub';
    const edits = lineCommentPositionPass('above')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('above: does not treat an apostrophe inside a string literal as a comment', () => {
    const source = 'sub init()\n  x = "it\'s fine"\nend sub';
    const edits = lineCommentPositionPass('above')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('above: handles multiple trailing comments on separate lines', () => {
    const source = "sub init()\n  x = 1 ' first\n  y = 2 ' second\nend sub";
    const edits = lineCommentPositionPass('above')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal("sub init()\n  ' first\n  x = 1\n  ' second\n  y = 2\nend sub");
  });
});

describe('trailingCommasPass', () => {
  const { trailingCommasPass } = require('../src/cst-passes/trailingCommas');

  const always = { trailingComma: 'always', arrayCommaStyle: 'always', associativeArrayCommaStyle: 'always' };
  const never = { trailingComma: 'never', arrayCommaStyle: 'never', associativeArrayCommaStyle: 'never' };

  it('leaves a single-line array untouched regardless of style', () => {
    const source = 'x = [1, 2, 3]';
    const edits = trailingCommasPass(always)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('leaves an empty multi-line array untouched', () => {
    const source = 'x = [\n]';
    const edits = trailingCommasPass(always)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('always: adds a trailing comma to the last item of a multi-line array', () => {
    const source = 'x = [\n  1,\n  2\n]';
    const edits = trailingCommasPass(always)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('x = [\n  1,\n  2,\n]');
  });

  it('never: removes commas from every item (arrayCommaStyle and trailingComma both never)', () => {
    const source = 'x = [\n  1,\n  2,\n]';
    const edits = trailingCommasPass(never)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('x = [\n  1\n  2\n]');
  });

  it('trailingComma governs the last item independently of arrayCommaStyle', () => {
    const source = 'x = [\n  1,\n  2,\n]';
    const config = { trailingComma: 'never', arrayCommaStyle: 'preserve', associativeArrayCommaStyle: 'preserve' };
    const edits = trailingCommasPass(config)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('x = [\n  1,\n  2\n]');
  });

  it('applies the same rules to a multi-line AA literal', () => {
    const source = 'x = {\n  a: 1,\n  b: 2\n}';
    const edits = trailingCommasPass(always)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('x = {\n  a: 1,\n  b: 2,\n}');
  });

  it('inserts the comma before a trailing comment, preserving existing spacing', () => {
    const source = "x = [\n  1   ' keep\n]";
    const edits = trailingCommasPass(always)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal("x = [\n  1,   ' keep\n]");
  });

  it('removes the comma before a trailing comment without disturbing it', () => {
    const source = "x = [\n  1,\n  2, ' keep\n]";
    const edits = trailingCommasPass(never)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal("x = [\n  1\n  2 ' keep\n]");
  });

  it('treats nested collections independently', () => {
    const source = 'x = [\n  [\n    1\n  ]\n]';
    const edits = trailingCommasPass(always)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('x = [\n  [\n    1,\n  ],\n]');
  });

  it('does not add a comma to a function/sub value in an AA field', () => {
    const source = 'm = {\n  key: function()\n    x = 1\n  end function\n}';
    const edits = trailingCommasPass(always)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('does not add a comma to a function/sub value used directly as an array element', () => {
    const source = 'x = [\n  function()\n    x = 1\n  end function\n]';
    const edits = trailingCommasPass(always)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('still adds a comma to a real item following a skipped function value', () => {
    const source = 'x = [\n  function()\n    x = 1\n  end function,\n  2\n]';
    const edits = trailingCommasPass(always)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('end function,\n  2,\n]');
  });
});

describe('parenthesisIfCasePass', () => {
  const { parenthesisIfCasePass } = require('../src/cst-passes/parenthesisIfCase');

  it('preserve returns no edits', () => {
    const source = 'sub t()\n  if x > 5 then\n    y = 1\n  end if\nend sub';
    const edits = parenthesisIfCasePass('preserve')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('always: wraps a bare if condition', () => {
    const source = 'sub t()\n  if x > 5 then\n    y = 1\n  end if\nend sub';
    const edits = parenthesisIfCasePass('always')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('if (x > 5) then');
  });

  it('always: leaves an already-wrapped condition alone', () => {
    const source = 'sub t()\n  if (x > 5) then\n    y = 1\n  end if\nend sub';
    const edits = parenthesisIfCasePass('always')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('always: wraps an elseif condition', () => {
    const source = 'sub t()\n  if a\n    x = 1\n  else if b > 2\n    x = 2\n  end if\nend sub';
    const edits = parenthesisIfCasePass('always')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('else if (b > 2)');
  });

  it('always: wraps a no-then single-line-if condition even when the body contains "return" (the old regex skipped this to avoid guessing the condition boundary; CST does not need to guess)', () => {
    const source = 'function t()\n  if x > 5 return true\nend function';
    const edits = parenthesisIfCasePass('always')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('if (x > 5) return true');
  });

  it('always: does not touch a trailing comment', () => {
    const source = "sub t()\n  if x > 5 ' note\n    y = 1\n  end if\nend sub";
    const edits = parenthesisIfCasePass('always')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain("if (x > 5) ' note");
  });

  it('always: wraps a partially-parenthesized condition once, not twice', () => {
    const source = 'sub t()\n  if (a > 1) and b > 2 then\n    x = 1\n  end if\nend sub';
    const edits = parenthesisIfCasePass('always')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('if ((a > 1) and b > 2) then');
  });

  it('never: unwraps a fully-parenthesized if condition', () => {
    const source = 'sub t()\n  if (x > 5) then\n    y = 1\n  end if\nend sub';
    const edits = parenthesisIfCasePass('never')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('if x > 5 then');
  });

  it('never: unwraps a fully-parenthesized elseif condition', () => {
    const source = 'sub t()\n  if (a > 1)\n    x = 1\n  else if (b > 2)\n    x = 2\n  end if\nend sub';
    const edits = parenthesisIfCasePass('never')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('else if b > 2');
  });

  it('never: leaves a bare condition alone', () => {
    const source = 'sub t()\n  if x > 5 then\n    y = 1\n  end if\nend sub';
    const edits = parenthesisIfCasePass('never')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('never: leaves a partially-parenthesized condition alone (not fully wrapped)', () => {
    const source = 'sub t()\n  if (a > 1) and b > 2 then\n    x = 1\n  end if\nend sub';
    const edits = parenthesisIfCasePass('never')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });
});

describe('stripCatchParensPass', () => {
  const { stripCatchParensPass } = require('../src/cst-passes/stripCatchParens');

  it('strips parentheses around the exception variable', () => {
    const source = 'sub t()\n  try\n    doWork()\n  catch (e)\n    print e.message\n  end try\nend sub';
    const edits = stripCatchParensPass()(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('catch e');
  });

  it('leaves a bare catch variable alone', () => {
    const source = 'sub t()\n  try\n    doWork()\n  catch err\n    print err.message\n  end try\nend sub';
    const edits = stripCatchParensPass()(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('does not touch a trailing comment', () => {
    const source = "sub t()\n  try\n    doWork()\n  catch (e) ' handle error\n  end try\nend sub";
    const edits = stripCatchParensPass()(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain("catch e ' handle error");
  });

  it('normalizes catch(e) with no space around parens', () => {
    const source = 'sub t()\n  try\n    doWork()\n  catch(e)\n    print e.message\n  end try\nend sub';
    const edits = stripCatchParensPass()(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('catch e');
    expect(output).to.not.contain('catche');
  });

  it('normalizes catch ( e ) with interior spaces', () => {
    const source = 'sub t()\n  try\n    doWork()\n  catch ( e )\n    print e.message\n  end try\nend sub';
    const edits = stripCatchParensPass()(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.contain('catch e');
  });
});

describe('stringConcatStylePass', () => {
  const { stringConcatStylePass } = require('../src/cst-passes/stringConcatStyle');

  it('preserve returns no edits', () => {
    const source = 'sub t()\n  x = [a, b].join("")\nend sub';
    const edits = stringConcatStylePass('preserve')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  describe('plus', () => {
    it('converts [a, b, c].join("") to a + b + c', () => {
      const source = 'sub t()\n  x = ["hello", " ", "world"].join("")\nend sub';
      const edits = stringConcatStylePass('plus')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('x = "hello" + " " + "world"');
    });

    it('matches .join case-insensitively', () => {
      const source = 'sub t()\n  x = [a, b].Join("")\nend sub';
      const edits = stringConcatStylePass('plus')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('x = a + b');
    });

    it('does not convert a non-empty separator', () => {
      const source = 'sub t()\n  x = [a, b].join(",")\nend sub';
      const edits = stringConcatStylePass('plus')(parse(source).root, source);
      expect(edits).to.have.length(0);
    });
  });

  describe('array-join', () => {
    it('converts a plus-chain with a string literal', () => {
      const source = 'sub t()\n  x = "hello" + " " + "world"\nend sub';
      const edits = stringConcatStylePass('array-join')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.contain('x = ["hello", " ", "world"].join("")');
    });

    it('does not convert a plus-chain with no string literal', () => {
      const source = 'sub t()\n  x = a + b + c\nend sub';
      const edits = stringConcatStylePass('array-join')(parse(source).root, source);
      expect(edits).to.have.length(0);
    });

    it('does not corrupt a compound assignment (the old regex dropped the "x +=" prefix here)', () => {
      const source = 'sub t()\n  x += a + b + "c"\nend sub';
      const edits = stringConcatStylePass('array-join')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.equal('sub t()\n  x += [a, b, "c"].join("")\nend sub');
    });

    it('does not corrupt a print statement (the old regex dropped the "print" prefix here)', () => {
      const source = 'sub t()\n  print a + "b" + c\nend sub';
      const edits = stringConcatStylePass('array-join')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.equal('sub t()\n  print [a, "b", c].join("")\nend sub');
    });

    it('converts only the pure-plus sub-chain when mixed with a different operator', () => {
      const source = 'sub t()\n  x = a + "b" - c\nend sub';
      const edits = stringConcatStylePass('array-join')(parse(source).root, source);
      const output = applyEdits(source, edits);
      expect(output).to.equal('sub t()\n  x = [a, "b"].join("") - c\nend sub');
    });
  });
});

describe('elseOnNewLinePass', () => {
  const { elseOnNewLinePass } = require('../src/cst-passes/elseOnNewLine');

  it('true (keep on own line) returns no edits', () => {
    const source = 'sub t()\n  if a\n    x = 1\n  else\n    x = 2\n  end if\nend sub';
    const edits = elseOnNewLinePass(true)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('false: collapses a simple if/else to one line, adding then', () => {
    const source = 'sub t()\n  if a\n    x = 1\n  else\n    x = 2\n  end if\nend sub';
    const edits = elseOnNewLinePass(false)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('sub t()\n  if a then x = 1 else x = 2\nend sub');
  });

  it('false: does not collapse when the if line has a trailing comment', () => {
    const source = "sub t()\n  if a ' note\n    x = 1\n  else\n    x = 2\n  end if\nend sub";
    const edits = elseOnNewLinePass(false)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('false: does not collapse when the then-branch has more than one statement', () => {
    const source = 'sub t()\n  if a\n    x = 1\n    y = 2\n  else\n    x = 2\n  end if\nend sub';
    const edits = elseOnNewLinePass(false)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('false: does not collapse an if/else-if/else chain', () => {
    const source = 'sub t()\n  if a\n    x = 1\n  else if b\n    x = 2\n  else\n    x = 3\n  end if\nend sub';
    const edits = elseOnNewLinePass(false)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('false: leaves an already-single-line if untouched', () => {
    const source = 'sub t()\n  if a then x = 1 else x = 2\nend sub';
    const edits = elseOnNewLinePass(false)(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('false: an unrelated comment on the line before the if does not block collapsing', () => {
    const source = "sub t()\n  ' unrelated comment\n  if a\n    x = 1\n  else\n    x = 2\n  end if\nend sub";
    const edits = elseOnNewLinePass(false)(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal("sub t()\n  ' unrelated comment\n  if a then x = 1 else x = 2\nend sub");
  });
});

describe('aaThresholdPass', () => {
  const { aaThresholdPass } = require('../src/cst-passes/aaThreshold');

  it('threshold 0 returns no edits', () => {
    const source = 'sub t()\n  x = { a: 1, b: 2, c: 3, d: 4 }\nend sub';
    const edits = aaThresholdPass(0, '  ')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('expands an inline AA exceeding the threshold, dropping commas for a later pass to restore', () => {
    const source = 'sub t()\n  x = { a: 1, b: 2, c: 3, d: 4 }\nend sub';
    const edits = aaThresholdPass(10, '  ')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('sub t()\n  x = {\n    a: 1\n    b: 2\n    c: 3\n    d: 4\n  }\nend sub');
  });

  it('leaves a short AA inline', () => {
    const source = 'sub t()\n  x = { a: 1 }\nend sub';
    const edits = aaThresholdPass(50, '  ')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('leaves an already-multi-line AA untouched', () => {
    const source = 'sub t()\n  x = {\n    a: 1,\n    b: 2\n  }\nend sub';
    const edits = aaThresholdPass(5, '  ')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('leaves an empty AA untouched', () => {
    const source = 'sub t()\n  x = {}\nend sub';
    const edits = aaThresholdPass(1, '  ')(parse(source).root, source);
    expect(edits).to.have.length(0);
  });

  it('preserves content after the closing brace (e.g. a call\'s closing paren)', () => {
    const source = 'sub t()\n  foo({ a: 1, b: 2, c: 3, d: 4 })\nend sub';
    const edits = aaThresholdPass(10, '  ')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('sub t()\n  foo({\n    a: 1\n    b: 2\n    c: 3\n    d: 4\n  })\nend sub');
  });

  it('expanding an outer AA over threshold does not also expand a nested AA in the same pass (avoids overlapping edits; the old regex could not even reach a nested AA correctly at all)', () => {
    const source = 'sub t()\n  x = { a: 1, b: { c: 2, d: 3 } }\nend sub';
    const edits = aaThresholdPass(10, '  ')(parse(source).root, source);
    const output = applyEdits(source, edits);
    expect(output).to.equal('sub t()\n  x = {\n    a: 1\n    b: { c: 2, d: 3 }\n  }\nend sub');
  });
});

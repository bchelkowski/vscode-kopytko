import { expect } from 'chai';
import { parseSuppressionMap, isSuppressed } from '../src/suppression';
import { lintFile, DEFAULT_LINTER_CONFIG } from '../src/index';
import { createMockContext } from './helpers';
import type { LintDiagnostic } from '../src/types';

function makeDiag(code: string, line: number): LintDiagnostic {
  return { code, line, column: 0, severity: 'error', message: '', filePath: '' };
}

describe('parseSuppressionMap', () => {
  it('returns an empty map for a file with no suppression comments', () => {
    const map = parseSuppressionMap(["function foo()", "  print 1", "end function"]);
    expect(map.size).to.equal(0);
  });

  it('recognises tick-style disable-next-line', () => {
    const map = parseSuppressionMap(["' kopytko-disable-next-line identifier/undefined-function", "doSomething()"]);
    expect(map.size).to.equal(1);
    expect(map.get(1)).to.be.instanceOf(Set);
    expect((map.get(1) as Set<string>).has('identifier/undefined-function')).to.be.true;
  });

  it('recognises rem-style disable-next-line', () => {
    const map = parseSuppressionMap(["rem kopytko-disable-next-line identifier/undefined-function", "doSomething()"]);
    expect(map.get(1)).to.be.instanceOf(Set);
  });

  it('is case-insensitive for rem prefix and directive', () => {
    const map = parseSuppressionMap(["REM KOPYTKO-DISABLE-NEXT-LINE identifier/undefined-function", "doSomething()"]);
    expect(map.get(1)).to.be.instanceOf(Set);
  });

  it('is case-insensitive for tick-style directive', () => {
    const map = parseSuppressionMap(["' KOPYTKO-DISABLE-NEXT-LINE identifier/undefined-function", "doSomething()"]);
    expect(map.get(1)).to.be.instanceOf(Set);
  });

  it('stores null when no rule codes are specified (suppress all)', () => {
    const map = parseSuppressionMap(["' kopytko-disable-next-line", "doSomething()"]);
    expect(map.get(1)).to.be.null;
  });

  it('parses a comma-separated code list into a Set', () => {
    const map = parseSuppressionMap(["' kopytko-disable-next-line import/*, identifier/wrong-arg-count", "doSomething()"]);
    const entry = map.get(1) as Set<string>;
    expect(entry).to.be.instanceOf(Set);
    expect(entry.has('import/*')).to.be.true;
    expect(entry.has('identifier/wrong-arg-count')).to.be.true;
  });

  it('trims whitespace around code tokens', () => {
    const map = parseSuppressionMap(["' kopytko-disable-next-line  import/*  ,  identifier/wrong-arg-count  ", "x"]);
    const entry = map.get(1) as Set<string>;
    expect(entry.has('import/*')).to.be.true;
    expect(entry.has('identifier/wrong-arg-count')).to.be.true;
  });

  it('handles leading whitespace before the tick comment', () => {
    const map = parseSuppressionMap(["    ' kopytko-disable-next-line identifier/undefined-function", "x"]);
    expect(map.get(1)).to.be.instanceOf(Set);
  });

  it('recognises disable-line and stores at the same line index', () => {
    const map = parseSuppressionMap(["first", "second", "third ' kopytko-disable-line identifier/undefined-function"]);
    expect(map.get(2)).to.be.instanceOf(Set);
    expect((map.get(2) as Set<string>).has('identifier/undefined-function')).to.be.true;
  });

  it('recognises disable-line as a trailing inline comment', () => {
    const map = parseSuppressionMap(["doSomething() ' kopytko-disable-line identifier/undefined-function"]);
    expect(map.get(0)).to.be.instanceOf(Set);
  });

  it('recognises rem-style disable-line as trailing comment', () => {
    const map = parseSuppressionMap(["doSomething() rem kopytko-disable-line identifier/undefined-function"]);
    expect(map.get(0)).to.be.instanceOf(Set);
  });

  it('does not crash when disable-next-line is on the last line', () => {
    const map = parseSuppressionMap(["' kopytko-disable-next-line identifier/undefined-function"]);
    expect(map.get(1)).to.be.instanceOf(Set);
  });

  it('merges disable-next-line and disable-line directives targeting the same line', () => {
    const map = parseSuppressionMap([
      "' kopytko-disable-next-line identifier/undefined-function",
      "doSomething() ' kopytko-disable-line identifier/wrong-arg-count",
    ]);
    const entry = map.get(1) as Set<string>;
    expect(entry).to.be.instanceOf(Set);
    expect(entry.has('identifier/undefined-function')).to.be.true;
    expect(entry.has('identifier/wrong-arg-count')).to.be.true;
  });

  it('null (suppress-all) wins when merged with a specific set', () => {
    const map = parseSuppressionMap([
      "' kopytko-disable-next-line identifier/undefined-function",
      "' kopytko-disable-next-line",
      "doSomething()",
    ]);
    expect(map.get(2)).to.be.null;
  });

  it('does not treat a normal comment as a suppression directive', () => {
    const map = parseSuppressionMap(["' just a regular comment"]);
    expect(map.size).to.equal(0);
  });

  it('does not match the directive inside a string literal (line starts with code, not comment)', () => {
    const map = parseSuppressionMap(['x = "kopytko-disable-next-line foo"']);
    expect(map.size).to.equal(0);
  });
});

describe('isSuppressed', () => {
  it('returns true when the entry is null (suppress all)', () => {
    const map: Map<number, Set<string> | null> = new Map([[0, null]]);
    expect(isSuppressed(map, makeDiag('anything/code', 0))).to.be.true;
  });

  it('returns true for an exact code match', () => {
    const map: Map<number, Set<string> | null> = new Map([[0, new Set(['identifier/undefined-function'])]]);
    expect(isSuppressed(map, makeDiag('identifier/undefined-function', 0))).to.be.true;
  });

  it('returns false when the code does not match any pattern', () => {
    const map: Map<number, Set<string> | null> = new Map([[0, new Set(['identifier/undefined-function'])]]);
    expect(isSuppressed(map, makeDiag('import/duplicate', 0))).to.be.false;
  });

  it('returns false when the diagnostic line has no entry', () => {
    const map: Map<number, Set<string> | null> = new Map([[1, new Set(['identifier/undefined-function'])]]);
    expect(isSuppressed(map, makeDiag('identifier/undefined-function', 0))).to.be.false;
  });

  it('glob import/* matches import/duplicate', () => {
    const map: Map<number, Set<string> | null> = new Map([[0, new Set(['import/*'])]]);
    expect(isSuppressed(map, makeDiag('import/duplicate', 0))).to.be.true;
  });

  it('glob import/* does not match identifier/undefined-function', () => {
    const map: Map<number, Set<string> | null> = new Map([[0, new Set(['import/*'])]]);
    expect(isSuppressed(map, makeDiag('identifier/undefined-function', 0))).to.be.false;
  });

  it('glob identifier/* matches identifier/undefined-function', () => {
    const map: Map<number, Set<string> | null> = new Map([[0, new Set(['identifier/*'])]]);
    expect(isSuppressed(map, makeDiag('identifier/undefined-function', 0))).to.be.true;
  });

  it('returns true when the first pattern misses but the second matches', () => {
    const map: Map<number, Set<string> | null> = new Map([[0, new Set(['import/*', 'throw/invalid-value'])]]);
    expect(isSuppressed(map, makeDiag('throw/invalid-value', 0))).to.be.true;
  });
});

describe('suppression — lintFile integration', () => {
  const ctx = createMockContext();

  it('disable-next-line suppresses the specific diagnostic and leaves others intact', () => {
    const content = [
      "' kopytko-disable-next-line import/path-not-absolute",
      "' @import utils/Relative.brs",
      'function doWork()',
      '  throw 42',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.not.include('import/path-not-absolute');
    expect(diags.map(d => d.code)).to.include('throw/invalid-value');
  });

  it('disable-next-line with no codes suppresses all diagnostics on that line', () => {
    const content = [
      "' kopytko-disable-next-line",
      "' @import utils/Relative.brs",
      'function doWork()',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.not.include('import/path-not-absolute');
  });

  it('wrong code in directive does not suppress the diagnostic', () => {
    const content = [
      "' kopytko-disable-next-line throw/invalid-value",
      "' @import utils/Relative.brs",
      'function doWork()',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.include('import/path-not-absolute');
  });

  it('disable-line suppresses on the same line as the code', () => {
    const content = [
      "' @import utils/Relative.brs ' kopytko-disable-line import/path-not-absolute",
      'function doWork()',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.not.include('import/path-not-absolute');
  });

  it('glob import/* suppresses an import/ diagnostic', () => {
    const content = [
      "' kopytko-disable-next-line import/*",
      "' @import utils/Relative.brs",
      'function doWork()',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.not.include('import/path-not-absolute');
  });

  it('glob import/* does not suppress an unrelated diagnostic on the same target line', () => {
    const content = [
      "' kopytko-disable-next-line import/*",
      '  throw 42',
      'function doWork()',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.include('throw/invalid-value');
  });

  it('comma-separated list suppresses both codes', () => {
    const content = [
      "' kopytko-disable-next-line import/path-not-absolute, throw/invalid-value",
      "' @import utils/Relative.brs",
      "' kopytko-disable-next-line import/path-not-absolute, throw/invalid-value",
      '  throw 42',
      'function doWork()',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.not.include('import/path-not-absolute');
    expect(diags.map(d => d.code)).to.not.include('throw/invalid-value');
  });

  it('suppression on line N does not affect line N+2', () => {
    const content = [
      "' kopytko-disable-next-line import/path-not-absolute",
      'function doWork()',
      "' @import utils/Relative.brs",
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.include('import/path-not-absolute');
  });

  it('rem-style suppression comment is recognised', () => {
    const content = [
      'rem kopytko-disable-next-line import/path-not-absolute',
      "' @import utils/Relative.brs",
      'function doWork()',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.not.include('import/path-not-absolute');
  });

  it('disable-line on an @import line suppresses import/unused', () => {
    const content = [
      "' @import /valid/absolute/path.brs ' kopytko-disable-line import/unused",
      'function doWork()',
      'end function',
    ].join('\n');

    const contextWithFile = createMockContext({
      importExists: () => true,
      parseFunctionsFromFile: () => [],
    });
    const diags = lintFile('/project/src/t.brs', content, contextWithFile, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.not.include('import/unused');
  });

  it('a file with no suppression comments returns the same diagnostics (no regression)', () => {
    const content = [
      "' @import utils/Relative.brs",
      'function doWork()',
      '  throw 42',
      'end function',
    ].join('\n');

    const diags = lintFile('/project/src/t.brs', content, ctx, DEFAULT_LINTER_CONFIG);
    expect(diags.map(d => d.code)).to.include('import/path-not-absolute');
    expect(diags.map(d => d.code)).to.include('throw/invalid-value');
  });
});

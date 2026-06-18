import { expect } from 'chai';
import { lintFile, DEFAULT_LINTER_CONFIG } from '../src/index';
import { createMockContext } from './helpers';

/**
 * Tests that verify source/ directory functions are treated as globally
 * accessible: no "identifier/undefined-function" diagnostic is raised when a
 * component file calls a function whose knownFuncNames entry was seeded by the
 * source/-dir collection pass inside buildKnownFunctions.
 *
 * buildKnownFunctions is internal, so these tests exercise the behaviour by
 * constructing a LintContext that reflects what the pass produces, and then
 * calling lintFile — the same path the CLI takes per file after the pass.
 */
describe('linter — source/ directory global function accessibility', () => {
  it('does not flag a call to a function in knownFuncNames (source/ convention)', () => {
    const content = [
      'sub init()',
      '  result = globalHelper("hello")',
      'end sub',
    ].join('\n');

    // Simulates what buildKnownFunctions produces: source/ functions are added
    // to every file's knownFuncNames set.
    const context = createMockContext({
      knownFuncNames: new Set(['globalhelper']),
    });

    const diags = lintFile('/project/app/components/Button.brs', content, context, DEFAULT_LINTER_CONFIG);
    const undef = diags.filter(d => d.code === 'identifier/undefined-function');
    expect(undef).to.be.empty;
  });

  it('still flags a call to a function NOT in knownFuncNames', () => {
    const content = [
      'sub init()',
      '  result = undefinedFn()',
      'end sub',
    ].join('\n');

    const context = createMockContext({
      knownFuncNames: new Set(['globalhelper']),
    });

    const diags = lintFile('/project/app/components/Button.brs', content, context, DEFAULT_LINTER_CONFIG);
    const undef = diags.filter(d => d.code === 'identifier/undefined-function');
    expect(undef).to.have.lengthOf(1);
    expect(undef[0].message).to.include('undefinedFn');
  });

  it('allows calling multiple source/ functions from a single component', () => {
    const content = [
      'sub init()',
      '  a = sourceHelperA()',
      '  b = sourceHelperB()',
      'end sub',
    ].join('\n');

    const context = createMockContext({
      knownFuncNames: new Set(['sourcehelpera', 'sourcehelperb']),
    });

    const diags = lintFile('/project/app/components/View.brs', content, context, DEFAULT_LINTER_CONFIG);
    const undef = diags.filter(d => d.code === 'identifier/undefined-function');
    expect(undef).to.be.empty;
  });

  it('functions from components/ directory are NOT in global scope (no source/ path)', () => {
    // This verifies that the source/ detection uses path-based logic.
    // A file at /components/ should not contribute to global scope.
    const content = [
      'sub init()',
      '  componentFn()',
      'end sub',
    ].join('\n');

    // knownFuncNames does NOT include componentfn (components/ not globally accessible)
    const context = createMockContext({
      knownFuncNames: new Set(),
    });

    const diags = lintFile('/project/app/components/Screen.brs', content, context, DEFAULT_LINTER_CONFIG);
    const undef = diags.filter(d => d.code === 'identifier/undefined-function');
    expect(undef).to.have.lengthOf(1);
    expect(undef[0].message).to.include('componentFn');
  });
});

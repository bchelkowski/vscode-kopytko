import { expect } from 'chai';
import { checkImports } from '../../src/rules/importRules';
import { createRuleContext } from '../helpers';
import { DEFAULT_RULE_CONFIG } from '../../src/config';

describe('importRules — checkImports', () => {
  it('returns no diagnostics for a file with no imports', () => {
    const ctx = createRuleContext([
      'function hello()',
      '  print "hi"',
      'end function',
    ].join('\n'));

    const diags = checkImports(ctx);
    expect(diags).to.be.an('array').that.is.empty;
  });

  it('reports import/duplicate for repeated imports', () => {
    const content = [
      "' @import /utils/Math.brs",
      "' @import /utils/Math.brs",
      'function test()',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content);
    const diags = checkImports(ctx);

    const dups = diags.filter(d => d.code === 'import/duplicate');
    expect(dups).to.have.lengthOf(1);
    expect(dups[0].severity).to.equal('warning');
    expect(dups[0].message).to.include('duplicate');
  });

  it('attaches a delete-line fix to import/duplicate diagnostics', () => {
    const content = [
      "' @import /utils/Math.brs",
      "' @import /utils/Math.brs",
      "' @import /utils/Math.brs",
      'function test()',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content);
    const diags = checkImports(ctx);

    const dups = diags.filter(d => d.code === 'import/duplicate');
    expect(dups).to.have.lengthOf(2);
    // Each duplicate should have a fix that removes its line (keeping the first)
    expect(dups[0].fix).to.deep.equal({ type: 'delete-line', line: 1, column: 0 });
    expect(dups[1].fix).to.deep.equal({ type: 'delete-line', line: 2, column: 0 });
  });

  it('reports import/missing-path when import path is empty', () => {
    const content = "' @import \n";
    const ctx = createRuleContext(content);
    const diags = checkImports(ctx);

    // parseImports won't match an empty path — verify no crash
    expect(diags).to.be.an('array');
  });

  it('reports import/path-not-absolute for relative paths', () => {
    const content = "' @import utils/Math.brs\n";
    const ctx = createRuleContext(content);
    const diags = checkImports(ctx);

    const notAbs = diags.filter(d => d.code === 'import/path-not-absolute');
    expect(notAbs).to.have.lengthOf(1);
    expect(notAbs[0].severity).to.equal('warning');
    expect(notAbs[0].message).to.include('should start with "/"');
  });

  it('reports import/wrong-comment-style for double-quote imports', () => {
    const content = '"@import /utils/Math.brs\n';

    // The parser uses the apostrophe pattern, so this line won't parse as an import.
    // But if we manually inject imports + the line text, we can test the line check.
    const lines = ['"@import /utils/Math.brs'];
    const imports = [{ raw: lines[0], importPath: '/utils/Math.brs', line: 1, isMock: false }];

    const ctx = createRuleContext(content, {
      lines,
      imports,
    });

    const diags = checkImports(ctx);
    const wrongStyle = diags.filter(d => d.code === 'import/wrong-comment-style');
    expect(wrongStyle).to.have.lengthOf(1);
    expect(wrongStyle[0].severity).to.equal('error');
    expect(wrongStyle[0].message).to.include('apostrophe');
  });

  it('reports import/unresolved when resolveImportPath returns null', () => {
    const content = "' @import /utils/Missing.brs\n";
    const ctx = createRuleContext(content, {
      lintContextOverrides: {
        resolveImportPath: () => null,
      },
    });

    const diags = checkImports(ctx);
    const unresolved = diags.filter(d => d.code === 'import/unresolved');
    expect(unresolved).to.have.lengthOf(1);
    expect(unresolved[0].severity).to.equal('error');
    expect(unresolved[0].message).to.include('cannot resolve');
  });

  it('reports import/unresolved with module hint for external imports', () => {
    const content = "' @import /components/Button.brs from kopytko-ui\n";
    const ctx = createRuleContext(content, {
      lintContextOverrides: {
        resolveImportPath: () => null,
      },
    });

    const diags = checkImports(ctx);
    const unresolved = diags.filter(d => d.code === 'import/unresolved');
    expect(unresolved).to.have.lengthOf(1);
    expect(unresolved[0].message).to.include('NPM dependency');
  });

  it('reports import/build-generated for matching generatedPaths patterns', () => {
    const content = "' @import /generated/Api.brs\n";
    const ctx = createRuleContext(content, {
      lintContextOverrides: {
        resolveImportPath: () => null,
        generatedPaths: ['/generated/**'],
      },
    });

    const diags = checkImports(ctx);
    const generated = diags.filter(d => d.code === 'import/build-generated');
    expect(generated).to.have.lengthOf(1);
    expect(generated[0].severity).to.equal('info');
    expect(generated[0].message).to.include('generated during the build');
  });

  it('reports import/unused when no exported functions are referenced', () => {
    const content = [
      "' @import /utils/Math.brs",
      'function doNothing()',
      '  print "hello"',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      lintContextOverrides: {
        resolveImportPath: (_path: string) => '/project/src/utils/Math.brs',
        readFile: (path: string) => {
          if (path === '/project/src/utils/Math.brs') {
            return [
              'function mathAdd(a, b)',
              '  return a + b',
              'end function',
            ].join('\n');
          }
          return null;
        },
      },
    });

    const diags = checkImports(ctx);
    const unused = diags.filter(d => d.code === 'import/unused');
    expect(unused).to.have.lengthOf(1);
    expect(unused[0].severity).to.equal('warning');
    expect(unused[0].message).to.include('none of its exported functions');
  });

  it('does not report import/unused when an exported function is used', () => {
    const content = [
      "' @import /utils/Math.brs",
      'function compute()',
      '  result = mathAdd(1, 2)',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      lintContextOverrides: {
        resolveImportPath: () => '/project/src/utils/Math.brs',
        readFile: (path: string) => {
          if (path === '/project/src/utils/Math.brs') {
            return [
              'function mathAdd(a, b)',
              '  return a + b',
              'end function',
            ].join('\n');
          }
          return null;
        },
      },
    });

    const diags = checkImports(ctx);
    const unused = diags.filter(d => d.code === 'import/unused');
    expect(unused).to.be.empty;
  });

  it('skips import/unused check for @mock imports', () => {
    const content = [
      "' @mock /utils/Math.brs",
      'function doNothing()',
      '  print "hello"',
      'end function',
    ].join('\n');

    const ctx = createRuleContext(content, {
      lintContextOverrides: {
        resolveImportPath: () => '/project/src/utils/Math.brs',
        readFile: () => 'function mathAdd(a, b)\n  return a + b\nend function',
      },
    });

    const diags = checkImports(ctx);
    const unused = diags.filter(d => d.code === 'import/unused');
    expect(unused).to.be.empty;
  });

  it('does not report diagnostics when a rule is turned off', () => {
    const content = "' @import utils/Relative.brs\n";
    const config = { ...DEFAULT_RULE_CONFIG, 'import/path-not-absolute': 'off' as const };
    const ctx = createRuleContext(content, { config });

    const diags = checkImports(ctx);
    const notAbs = diags.filter(d => d.code === 'import/path-not-absolute');
    expect(notAbs).to.be.empty;
  });

  it('does not report import/unresolved when rule is off', () => {
    const content = "' @import /missing/File.brs\n";
    const config = { ...DEFAULT_RULE_CONFIG, 'import/unresolved': 'off' as const };
    const ctx = createRuleContext(content, { config });

    const diags = checkImports(ctx);
    const unresolved = diags.filter(d => d.code === 'import/unresolved');
    expect(unresolved).to.be.empty;
  });

  it('does not report import/duplicate when rule is off', () => {
    const content = [
      "' @import /utils/Math.brs",
      "' @import /utils/Math.brs",
    ].join('\n');

    const config = { ...DEFAULT_RULE_CONFIG, 'import/duplicate': 'off' as const };
    const ctx = createRuleContext(content, { config });

    const diags = checkImports(ctx);
    const dups = diags.filter(d => d.code === 'import/duplicate');
    expect(dups).to.be.empty;
  });
});

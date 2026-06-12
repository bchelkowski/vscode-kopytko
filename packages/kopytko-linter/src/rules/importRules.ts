import type { LintDiagnostic, RuleContext, KopytkoImport } from '../types';
import { findMatchingGlob, matchesGlob } from '../analysis/globMatcher';
import { parseFunctionDefs } from '../analysis/functionIndex';
import { stripStringLiterals } from '../analysis/textUtils';
import { escapeRegex } from '../analysis/textUtils';

function lineRange(lineIndex: number, filePath: string): Pick<LintDiagnostic, 'line' | 'column' | 'endLine' | 'endColumn' | 'filePath'> {
  return { line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath };
}

const IMPLICIT_MOCK_DEPS: { pathPattern: RegExp; usagePattern: RegExp }[] = [
  { pathPattern: /\/PromiseResolve\.brs$/i, usagePattern: /\.resolvedValue\s*\(/i },
  { pathPattern: /\/PromiseReject\.brs$/i, usagePattern: /\.rejectedValue\s*\(/i },
];

function isImplicitMockDependency(importPath: string, corpus: string): boolean {
  return IMPLICIT_MOCK_DEPS.some(
    (dep) => dep.pathPattern.test(importPath) && dep.usagePattern.test(corpus),
  );
}

/**
 * Checks for duplicate, malformed, wrong-style, build-generated, and unresolved imports.
 */
export function checkImports(ctx: RuleContext): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const { filePath, lines, imports, config, lintContext } = ctx;
  const seenImportKeys = new Set<string>();

  for (const imp of imports) {
    const lineIndex = imp.line - 1;
    const lineText = lines[lineIndex] ?? '';
    const annotationType = imp.isMock ? '@mock' : '@import';

    // import/duplicate
    if (config['import/duplicate'] !== 'off') {
      const importKey = `${imp.importPath}|${imp.fromModule ?? ''}`;
      if (seenImportKeys.has(importKey)) {
        diagnostics.push({
          severity: config['import/duplicate'] ?? 'error',
          code: 'import/duplicate',
          message: `Kopytko ${annotationType}: duplicate import "${imp.importPath}"${imp.fromModule ? ` from "${imp.fromModule}"` : ''}.`,
          ...lineRange(lineIndex, filePath),
        });
        continue;
      }
      seenImportKeys.add(importKey);
    }

    // import/missing-path
    if (config['import/missing-path'] !== 'off') {
      if (!imp.importPath || imp.importPath.trim() === '') {
        diagnostics.push({
          severity: config['import/missing-path'] ?? 'error',
          code: 'import/missing-path',
          message: `Kopytko ${annotationType}: missing import path.`,
          ...lineRange(lineIndex, filePath),
        });
        continue;
      }
    }

    // import/path-not-absolute
    if (config['import/path-not-absolute'] !== 'off') {
      if (!imp.importPath.startsWith('/')) {
        diagnostics.push({
          severity: config['import/path-not-absolute'] ?? 'warning',
          code: 'import/path-not-absolute',
          message: `Kopytko ${annotationType}: path "${imp.importPath}" should start with "/".`,
          ...lineRange(lineIndex, filePath),
        });
      }
    }

    // import/wrong-comment-style
    if (config['import/wrong-comment-style'] !== 'off') {
      if (lineText.includes('"@import') || lineText.includes('"@mock')) {
        diagnostics.push({
          severity: config['import/wrong-comment-style'] ?? 'error',
          code: 'import/wrong-comment-style',
          message: `Kopytko ${annotationType} must be written as a line comment starting with an apostrophe ('), not a double quote.`,
          ...lineRange(lineIndex, filePath),
        });
      }
    }

    // File resolution checks
    const resolved = lintContext.resolveImportPath(imp.importPath, filePath, imp.fromModule);
    if (resolved !== null) {
      // Skip unused-import check for @mock
      if (!imp.isMock && config['import/unused'] !== 'off') {
        const unusedDiag = checkUnusedImport(resolved, imp, lineIndex, lines, filePath, ctx);
        if (unusedDiag) diagnostics.push(unusedDiag);
      }
      continue;
    }

    // import/build-generated
    if (config['import/build-generated'] !== 'off') {
      const matchedPattern = findMatchingGlob(imp.importPath, lintContext.generatedPaths)
        ?? lintContext.generatedModules.find((gm) => matchesGlob(imp.importPath, gm.path))?.path;
      if (matchedPattern) {
        diagnostics.push({
          severity: config['import/build-generated'] ?? 'info',
          code: 'import/build-generated',
          message: `Kopytko ${annotationType}: "${imp.importPath}" is not on disk — it is expected to be generated during the build process (matches configured pattern "${matchedPattern}").`,
          ...lineRange(lineIndex, filePath),
        });
        continue;
      }
    }

    // import/unresolved
    if (config['import/unresolved'] !== 'off') {
      const label = imp.fromModule
        ? `"${imp.importPath}" from "${imp.fromModule}"`
        : `"${imp.importPath}"`;
      const message = imp.fromModule
        ? `Kopytko ${annotationType}: cannot resolve ${label}. Is "${imp.fromModule}" installed as an NPM dependency?`
        : `Kopytko ${annotationType}: cannot resolve ${label}. Check the file path and the sourceDir configuration.`;

      diagnostics.push({
        severity: config['import/unresolved'] ?? 'warning',
        code: 'import/unresolved',
        message,
        ...lineRange(lineIndex, filePath),
      });
    }
  }

  return diagnostics;
}

function checkUnusedImport(
  resolvedPath: string,
  imp: KopytkoImport,
  lineIndex: number,
  fileLines: string[],
  documentPath: string,
  ctx: RuleContext,
): LintDiagnostic | null {
  const importedText = ctx.lintContext.readFile(resolvedPath);
  if (importedText === null) return null;

  const fns = parseFunctionDefs(importedText, resolvedPath);
  if (fns.length === 0) return null;

  const linesToCorpus = (lines: string[], skipIndex = -1): string =>
    lines
      .filter((_, i) => i !== skipIndex)
      .map((line) => {
        if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) return '';
        return stripStringLiterals(line, true);
      })
      .join('\n');

  const corpora = [linesToCorpus(fileLines, lineIndex)];

  for (const siblingPath of ctx.lintContext.getSiblingFiles(documentPath)) {
    const siblingText = ctx.lintContext.readFile(siblingPath);
    if (siblingText !== null) {
      corpora.push(linesToCorpus(siblingText.split(/\r?\n/)));
    }
  }

  if (ctx.lintContext.isTestFile(documentPath)) {
    for (const siblingTest of ctx.lintContext.getTestSiblings(documentPath)) {
      const sibText = ctx.lintContext.readFile(siblingTest);
      if (sibText !== null) {
        corpora.push(linesToCorpus(sibText.split(/\r?\n/)));
      }
    }
  }

  const corpus = corpora.join('\n');
  const anyUsed = fns.some(
    (fn) => new RegExp(`\\b${escapeRegex(fn.name)}\\b`, 'i').test(corpus),
  );
  if (anyUsed) return null;

  if (ctx.lintContext.isTestFile(documentPath) && isImplicitMockDependency(imp.importPath, corpus)) {
    return null;
  }

  return {
    severity: (ctx.config['import/unused'] === 'off' ? 'warning' : ctx.config['import/unused']) ?? 'warning',
    code: 'import/unused',
    message: `Kopytko @import: "${imp.importPath}" is imported but none of its exported functions are referenced in this file.`,
    ...lineRange(lineIndex, documentPath),
    fix: { type: 'delete-line', line: lineIndex, column: 0 },
  };
}

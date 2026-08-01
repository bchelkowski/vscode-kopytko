import {
  DotExpression, IdentifierExpression, SyntaxKind, walk,
  buildScopes, resolve, findScopeAtLine, matchesGlob, parse as parseBrs,
} from 'kopytko-brightscript-parser';
import type { Scope, ParseResult } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';
import type { LintContext } from '../../context';

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

/**
 * Check if any function from an imported file is actually used in the current file
 * (or its sibling/test sibling files). Uses AST analysis to avoid false positives
 * from comments or string literals.
 */
function isFunctionFromImportUsed(
  importedFuncNames: string[],
  currentFilePath: string,
  currentContent: string,
  currentParseResult: ParseResult | undefined,
  lintContext: LintContext,
  currentFileScope?: Scope,
  currentIdentifiers?: IdentifierExpression[],
  currentDotExpressions?: DotExpression[],
  siblingParseCache?: Map<string, SiblingParse | null>,
): boolean {
  const funcNamesLower = new Set(importedFuncNames.map(n => n.toLowerCase()));

  // Check usage in current file using the already-parsed result.
  // Pass the pre-built scope so buildScopes is not called again for each import.
  if (currentParseResult) {
    if (hasReferenceToAnyInTree(currentParseResult, funcNamesLower, currentFileScope, currentIdentifiers)) return true;
  } else if (currentContent) {
    if (hasReferenceToAny(currentContent, funcNamesLower)) return true;
  }

  const isTestFile = lintContext.isTestFile(currentFilePath);
  const isPromiseHelper = funcNamesLower.has('promiseresolve') || funcNamesLower.has('promisereject');

  // PromiseResolve/PromiseReject are used indirectly via .resolvedValue()/.rejectedValue()
  if (isPromiseHelper && isTestFile) {
    // Reuse the already-collected list for the current file when the caller has
    // one (it always does in practice — checkImportsAst passes ctx.analysis's);
    // sibling/test-sibling files below have no pre-built analysis, so they parse
    // their own text instead.
    const usesHelper = currentDotExpressions
      ? dotExpressionsUsePromiseHelper(currentDotExpressions, funcNamesLower)
      : contentUsesPromiseHelper(currentContent, funcNamesLower);
    if (usesHelper) return true;
  }

  // Check usage in sibling files. When the caller shares a cache across every
  // @import it's checking (checkImportsAst does), each sibling is read and
  // parsed at most once per lint call, not once per import.
  const cache = siblingParseCache ?? new Map<string, SiblingParse | null>();

  const siblings = lintContext.getSiblingFiles(currentFilePath);
  for (const sib of siblings) {
    const parsed = getSiblingParse(sib, lintContext, cache);
    if (!parsed) continue;
    if (hasReferenceToAnyInTree(parsed.parseResult, funcNamesLower, parsed.scope)) return true;
    if (isPromiseHelper && isTestFile && dotExpressionsUsePromiseHelper(parsed.dotExpressions, funcNamesLower)) return true;
  }

  // Check usage in test sibling files
  const testSiblings = lintContext.getTestSiblings(currentFilePath);
  for (const sib of testSiblings) {
    const parsed = getSiblingParse(sib, lintContext, cache);
    if (!parsed) continue;
    if (hasReferenceToAnyInTree(parsed.parseResult, funcNamesLower, parsed.scope)) return true;
    if (isPromiseHelper && isTestFile && dotExpressionsUsePromiseHelper(parsed.dotExpressions, funcNamesLower)) return true;
  }

  return false;
}

/**
 * Check if any identifier in `funcNames` is referenced in an already-parsed tree —
 * either as a direct call (`asd()`) or as a value (`callback = asd`).
 *
 * Scope-aware: skips references where the name is locally declared (variable or
 * parameter), because those shadow the imported function and do not constitute usage.
 * `resolve()` walks the file's scope chain; imported functions are not in the tree,
 * so it returns `undefined` for them — only locally declared names resolve.
 *
 * @param prebuiltScope — pre-built scope tree for `parseResult.root`. When the caller
 * already holds a scope (e.g., the current-file scope built once for the full import
 * loop), passing it avoids a redundant `buildScopes` call.
 */
function hasReferenceToAnyInTree(parseResult: ParseResult, funcNames: Set<string>, prebuiltScope?: Scope, identifiers?: IdentifierExpression[]): boolean {
  const rootScope = prebuiltScope ?? buildScopes(parseResult.root);
  const refs = identifiers ?? collectAst<IdentifierExpression>({} as RuleContext, parseResult, 'identifierExpressions', 'visitIdentifierExpression');
  for (const node of refs) {
    const nameLower = node.name.toLowerCase();
    if (!funcNames.has(nameLower)) continue;
    // If the name resolves to a local declaration, it shadows the import — skip.
    const token = node.nameToken;
    const line = token?.line ?? -1;
    const enclosingScope = findScopeAtLine(rootScope, line);
    if (resolve(nameLower, enclosingScope)) continue;
    return true;
  }
  return false;
}

/**
 * Parse text and check if any identifier in `funcNames` is referenced (called or used as value).
 * Uses the parser to avoid matching names in comments or string literals.
 */
function hasReferenceToAny(text: string, funcNames: Set<string>): boolean {
  const parseResult = parseBrs(text);
  if (!parseResult) return false;
  return hasReferenceToAnyInTree(parseResult, funcNames);
}

/**
 * First DotExpression in the list that is a *call* to `.<memberNameLower>(...)`
 * — not a bare property read. AST-based, so it cannot match text sitting
 * inside a comment or string literal (e.g. a code sample in a
 * `' .resolvedValue(` comment), unlike a `content.includes(...)` scan.
 */
function findDotCallByMember(dotExpressions: DotExpression[], memberNameLower: string): DotExpression | undefined {
  return dotExpressions.find(node =>
    node.syntax.parent?.kind === SyntaxKind.CallExpression && node.member.toLowerCase() === memberNameLower,
  );
}

/** Same idea as `findDotCallByMember`, gated to the promise-helper names relevant to `funcNames`. */
function findPromiseHelperCall(dotExpressions: DotExpression[], funcNames: Set<string>): DotExpression | undefined {
  if (funcNames.has('promiseresolve')) {
    const call = findDotCallByMember(dotExpressions, 'resolvedvalue');
    if (call) return call;
  }
  if (funcNames.has('promisereject')) {
    const call = findDotCallByMember(dotExpressions, 'rejectedvalue');
    if (call) return call;
  }
  return undefined;
}

/** True if any DotExpression in the list is a promise-helper call matching a name present in `funcNames`. */
function dotExpressionsUsePromiseHelper(dotExpressions: DotExpression[], funcNames: Set<string>): boolean {
  return findPromiseHelperCall(dotExpressions, funcNames) !== undefined;
}

/** Parses `content` fresh and checks it the same way — for sibling files, which have no pre-built analysis. */
function contentUsesPromiseHelper(content: string, funcNames: Set<string>): boolean {
  const parseResult = parseBrs(content);
  if (!parseResult) return false;
  const dotExpressions = collectAst<DotExpression>({} as RuleContext, parseResult, 'dotExpressions', 'visitDotExpression');
  return dotExpressionsUsePromiseHelper(dotExpressions, funcNames);
}

/** A sibling file's parse, memoized so checking N different @imports against the same M siblings parses each sibling once, not N×M times. */
interface SiblingParse {
  parseResult: ParseResult;
  scope: Scope;
  dotExpressions: DotExpression[];
}

/**
 * Reads and parses `filePath` (via `lintContext.readFile`, itself already
 * cached), memoizing the result in `cache`. `checkImportsAst` builds one
 * `cache` per lint call and shares it across every `@import` it checks —
 * without it, `isFunctionFromImportUsed` re-parsed every sibling file once
 * per import checked, even though the sibling list is identical for all of
 * them (they all belong to the same file being linted).
 */
function getSiblingParse(filePath: string, lintContext: LintContext, cache: Map<string, SiblingParse | null>): SiblingParse | null {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached;

  const content = lintContext.readFile(filePath);
  if (!content) {
    cache.set(filePath, null);
    return null;
  }
  const parseResult = parseBrs(content);
  const scope = buildScopes(parseResult.root);
  const dotExpressions = collectAst<DotExpression>({} as RuleContext, parseResult, 'dotExpressions', 'visitDotExpression');
  const result: SiblingParse = { parseResult, scope, dotExpressions };
  cache.set(filePath, result);
  return result;
}

/**
 * AST-based: check @import/@mock annotations in comment trivia.
 * Validates: duplicate, missing path, unresolved, unused.
 */
export function checkImportsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, imports, config, lintContext, parseResult, lines } = ctx;
  const currentContent = lines.join('\n');
  const diagnostics: LintDiagnostic[] = [];
  const seenImportKeys = new Set<string>();

  // Build the scope for the current file once so isFunctionFromImportUsed can pass it
  // to hasReferenceToAnyInTree without rebuilding it for every resolved @import.
  const currentFileScope = parseResult ? (ctx.analysis?.rootScope ?? buildScopes(parseResult.root)) : undefined;

  // Shared across every @import below so a sibling file referenced by more
  // than one import is read and parsed once for this whole lint call, not
  // once per import that happens to share it.
  const siblingParseCache = new Map<string, SiblingParse | null>();

  for (const imp of imports) {
    const lineIndex = imp.line - 1;
    const annotationType = imp.isMock ? '@mock' : '@import';

    // import/duplicate
    if (config['import/duplicate'] !== 'off') {
      const importKey = `${imp.importPath}|${imp.fromModule ?? ''}`;
      if (seenImportKeys.has(importKey)) {
        diagnostics.push({
          severity: (config['import/duplicate'] as LintSeverity) ?? 'warning',
          code: 'import/duplicate',
          message: `Kopytko ${annotationType}: duplicate import "${imp.importPath}"${imp.fromModule ? ` from "${imp.fromModule}"` : ''}.`,
          line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
          fix: { type: 'delete-line' as const, line: lineIndex, column: 0 },
        });
        continue;
      }
      seenImportKeys.add(importKey);
    }

    // import/missing-path
    if (config['import/missing-path'] !== 'off' && (!imp.importPath || imp.importPath.trim() === '')) {
      diagnostics.push({
        severity: (config['import/missing-path'] as LintSeverity) ?? 'error',
        code: 'import/missing-path',
        message: `Kopytko ${annotationType}: missing import path.`,
        line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
      });
      continue;
    }

    // import/path-not-absolute
    if (config['import/path-not-absolute'] !== 'off' && !imp.importPath.startsWith('/')) {
      diagnostics.push({
        severity: (config['import/path-not-absolute'] as LintSeverity) ?? 'warning',
        code: 'import/path-not-absolute',
        message: `Kopytko ${annotationType}: path "${imp.importPath}" should start with "/".`,
        line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
      });
    }

    // Resolve the import
    const resolved = lintContext.resolveImportPath(imp.importPath, filePath, imp.fromModule);
    if (resolved !== null) {
      // import/unused — check if any function from the resolved file is actually used
      if (config['import/unused'] !== 'off' && !imp.isMock) {
        const funcs = lintContext.parseFunctionsFromFile(resolved);
        if (funcs.length > 0) {
          // Check usage in current file + sibling files
          const isUsed = isFunctionFromImportUsed(funcs, filePath, currentContent, parseResult, lintContext, currentFileScope, ctx.analysis?.identifierExpressions, ctx.analysis?.dotExpressions, siblingParseCache);
          if (!isUsed) {
            diagnostics.push({
              severity: (config['import/unused'] as LintSeverity) ?? 'warning',
              code: 'import/unused',
              message: `Kopytko ${annotationType}: "${imp.importPath}" is imported but none of its functions are referenced.`,
              line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
              fix: { type: 'delete-line' as const, line: lineIndex, column: 0 },
            });
          }
        }
      }
      continue;
    }

    // Check if this is a build-generated file (matches generatedPaths/generatedModules)
    let matchedPattern: string | null = null;
    if (lintContext.generatedPaths && lintContext.generatedPaths.length > 0) {
      const pattern = lintContext.generatedPaths.find((p: string) => matchesGlob(imp.importPath, p));
      if (pattern) matchedPattern = pattern;
    }
    if (!matchedPattern && lintContext.generatedModules && lintContext.generatedModules.length > 0) {
      const gm = lintContext.generatedModules.find((gm: { path: string }) => matchesGlob(imp.importPath, gm.path));
      if (gm) matchedPattern = gm.path;
    }

    if (config['import/build-generated'] !== 'off' && matchedPattern) {
      diagnostics.push({
        severity: (config['import/build-generated'] as LintSeverity) ?? 'info',
        code: 'import/build-generated',
        message: `Kopytko ${annotationType}: "${imp.importPath}" matches generated pattern "${matchedPattern}" — file will be created at build time.`,
        line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
      });
      continue;
    }

    // import/unresolved
    if (config['import/unresolved'] !== 'off') {
      const label = imp.fromModule ? `"${imp.importPath}" from "${imp.fromModule}"` : `"${imp.importPath}"`;
      diagnostics.push({
        severity: (config['import/unresolved'] as LintSeverity) ?? 'warning',
        code: 'import/unresolved',
        message: imp.fromModule
          ? `Kopytko ${annotationType}: cannot resolve ${label}. Is "${imp.fromModule}" installed as an NPM dependency?`
          : `Kopytko ${annotationType}: cannot resolve ${label}. Check the file path and the sourceDir configuration.`,
        line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
      });
    }
  }

  // import/missing-promise-deps: warn when .resolvedValue()/.rejectedValue() used without the required import

  if (config['import/missing-promise-deps'] !== 'off' && lintContext.isTestFile(filePath)) {
    // Collect imports from current file and siblings (split suites share imports at runtime)
    const allImports = [...imports];
    for (const sib of [...lintContext.getSiblingFiles(filePath), ...lintContext.getTestSiblings(filePath)]) {
      const sibContent = lintContext.readFile(sib);
      if (sibContent) allImports.push(...lintContext.parseImports(sibContent));
    }

    const hasPromiseResolveImport = allImports.some(
      imp => !imp.isMock && imp.importPath.toLowerCase().endsWith('promiseresolve.brs'),
    );
    const hasPromiseRejectImport = allImports.some(
      imp => !imp.isMock && imp.importPath.toLowerCase().endsWith('promisereject.brs'),
    );

    // AST-based: a call, not a text scan — cannot match `.resolvedValue(` sitting
    // inside a comment or string literal, and yields the call's own token
    // position instead of "the first line containing this substring".
    const dotExpressions = parseResult
      ? collectAst<DotExpression>(ctx, parseResult, 'dotExpressions', 'visitDotExpression')
      : [];

    if (!hasPromiseResolveImport) {
      const call = findDotCallByMember(dotExpressions, 'resolvedvalue');
      if (call?.memberToken) {
        const { line, column } = call.memberToken;
        diagnostics.push({
          severity: (config['import/missing-promise-deps'] as LintSeverity) ?? 'warning',
          code: 'import/missing-promise-deps',
          message: "`.resolvedValue()` requires `' @import /components/promise/PromiseResolve.brs from @dazn/kopytko-utils`.",
          line, column, endLine: line, endColumn: column + call.memberToken.text.length, filePath,
        });
      }
    }

    if (!hasPromiseRejectImport) {
      const call = findDotCallByMember(dotExpressions, 'rejectedvalue');
      if (call?.memberToken) {
        const { line, column } = call.memberToken;
        diagnostics.push({
          severity: (config['import/missing-promise-deps'] as LintSeverity) ?? 'warning',
          code: 'import/missing-promise-deps',
          message: "`.rejectedValue()` requires `' @import /components/promise/PromiseReject.brs from @dazn/kopytko-utils`.",
          line, column, endLine: line, endColumn: column + call.memberToken.text.length, filePath,
        });
      }
    }
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'import/*',
  defaultSeverity: 'error',
  fn: checkImportsAst,
};

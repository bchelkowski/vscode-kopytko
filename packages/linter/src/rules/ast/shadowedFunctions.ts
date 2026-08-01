import { buildScopes } from 'kopytko-brightscript-parser';
import type { Scope } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

/**
 * AST-based: detect variables/parameters that shadow a user-defined function.
 * Checks against functions declared in this file (from root scope) and
 * functions imported via @import (from lintContext.knownFuncNames).
 */
export function checkShadowedFunctionsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['identifier/shadows-function'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  // Map lowercase → original casing for local function declarations.
  const localFuncNames = new Map<string, string>();
  for (const [nameLower, decl] of scope.declarations) {
    if (decl.kind === 'function') localFuncNames.set(nameLower, decl.name);
  }

  // Combined: local functions + imported/sibling functions.
  const allFuncNames = new Set<string>([
    ...localFuncNames.keys(),
    ...lintContext.knownFuncNames,
  ]);

  function checkScope(s: Scope): void {
    for (const [, decl] of s.declarations) {
      if (decl.kind === 'function') continue;
      if (!allFuncNames.has(decl.nameLower)) continue;
      const funcName = localFuncNames.get(decl.nameLower) ?? decl.name;
      diagnostics.push({
        severity: (config['identifier/shadows-function'] as LintSeverity) ?? 'error',
        code: 'identifier/shadows-function',
        message: `'${decl.name}' shadows the user-defined function '${funcName}'. Use a different name to avoid hiding the function.`,
        line: decl.line, column: decl.column,
        endLine: decl.line, endColumn: decl.column + decl.name.length,
        filePath,
      });
    }
    for (const child of s.children) checkScope(child);
  }

  checkScope(scope);
  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'identifier/shadows-function',
  defaultSeverity: 'error',
  fn: checkShadowedFunctionsAst,
};

import { buildScopes, builtinNames } from 'kopytko-brightscript-parser';
import type { Scope } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

/**
 * AST-based: detect variables/parameters that shadow built-in function names.
 * Uses buildScopes() to find all declarations, checks against builtinNames.
 */
export function checkShadowedBuiltinsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/shadows-builtin'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  function checkScope(s: Scope): void {
    for (const [, decl] of s.declarations) {
      if (decl.kind === 'function') continue; // function names don't shadow
      if (builtinNames.has(decl.nameLower)) {
        diagnostics.push({
          severity: (config['identifier/shadows-builtin'] as LintSeverity) ?? 'error',
          code: 'identifier/shadows-builtin',
          message: `'${decl.name}' shadows the built-in global function '${decl.name}'. Use a different name to avoid hiding the built-in.`,
          line: decl.line, column: decl.column,
          endLine: decl.line, endColumn: decl.column + decl.name.length,
          filePath,
        });
      }
    }
    for (const child of s.children) checkScope(child);
  }

  checkScope(scope);
  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'identifier/shadows-builtin',
  defaultSeverity: 'error',
  fn: checkShadowedBuiltinsAst,
};

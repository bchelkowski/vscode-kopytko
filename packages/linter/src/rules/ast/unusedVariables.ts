import { buildScopes } from 'kopytko-brightscript-parser';
import type { Declaration, Scope } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function isVarReferencedInScope(nameLower: string, scope: Scope): boolean {
  for (const ref of scope.references) {
    if (ref.nameLower === nameLower) return true;
  }
  for (const child of scope.children) {
    if (isVarReferencedInScope(nameLower, child)) return true;
  }
  return false;
}

/**
 * Checks if a variable declaration is actually read (used) in its scope.
 * A reference on the same line+column as the declaration is the assignment
 * target itself and doesn't count as a "use".
 */
function isVarUsedInScope(decl: Declaration, scope: Scope): boolean {
  // Check direct references in this scope
  for (const ref of scope.references) {
    if (ref.nameLower !== decl.nameLower) continue;
    // Skip the self-reference (assignment target)
    if (ref.line === decl.line && ref.column === decl.column) continue;
    return true;
  }
  // Check references in nested scopes (closures can read parent vars)
  for (const child of scope.children) {
    if (isVarReferencedInScope(decl.nameLower, child)) return true;
  }
  return false;
}

/**
 * AST-based: detect variables that are assigned but never read.
 * Uses buildScopes() — checks variable declarations vs references.
 */
export function checkUnusedVariablesAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/unused-variable'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  function checkScope(s: Scope): void {
    for (const [, decl] of s.declarations) {
      if (decl.kind !== 'variable' && decl.kind !== 'for-variable'
          && decl.kind !== 'dim-variable' && decl.kind !== 'catch-variable') continue;
      if (decl.name.startsWith('_')) continue;

      // A variable is "used" if it has references on a different line than its declaration,
      // or if it has more references than just the assignment target.
      const isUsed = isVarUsedInScope(decl, s);

      if (!isUsed) {
        diagnostics.push({
          severity: (config['identifier/unused-variable'] as LintSeverity) ?? 'warning',
          code: 'identifier/unused-variable',
          message: `Variable '${decl.name}' is defined but never used. Prefix with \`_\` to indicate it is intentionally unused.`,
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
  code: 'identifier/unused-variable',
  defaultSeverity: 'warning',
  fn: checkUnusedVariablesAst,
};

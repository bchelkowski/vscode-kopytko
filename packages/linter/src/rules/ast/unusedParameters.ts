import { buildScopes } from 'kopytko-brightscript-parser';
import type { Scope } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

/**
 * Collects all names referenced in a scope's body (references from this
 * scope and its nested child scopes that might read the variable).
 */
function collectUsedNames(scope: Scope): Set<string> {
  const used = new Set<string>();
  for (const ref of scope.references) used.add(ref.nameLower);
  // Nested functions can reference parent scope variables
  for (const child of scope.children) {
    for (const ref of child.references) used.add(ref.nameLower);
    // Go deeper — closures can be nested
    const nested = collectUsedNames(child);
    for (const n of nested) used.add(n);
  }
  return used;
}

/**
 * AST-based: detect function parameters that are never referenced in the body.
 * Uses buildScopes() — checks parameter declarations vs references in scope.
 */
export function checkUnusedParametersAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/unused-parameter'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  function checkScope(s: Scope): void {
    // Collect all referenced names in this scope (including from nested scopes)
    const usedNames = collectUsedNames(s);

    for (const [, decl] of s.declarations) {
      if (decl.kind !== 'parameter') continue;
      if (decl.name.startsWith('_')) continue; // explicitly unused

      if (!usedNames.has(decl.nameLower)) {
        diagnostics.push({
          severity: (config['identifier/unused-parameter'] as LintSeverity) ?? 'hint',
          code: 'identifier/unused-parameter',
          message: `Parameter "${decl.name}" is never used. Prefix with \`_\` to indicate it is intentionally unused.`,
          line: decl.line, column: decl.column,
          endLine: decl.line, endColumn: decl.column + decl.name.length,
          filePath,
          fix: { type: 'insert' as const, line: decl.line, column: decl.column, text: '_' },
        });
      }
    }
    for (const child of s.children) checkScope(child);
  }

  checkScope(scope);
  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'identifier/unused-parameter',
  defaultSeverity: 'hint',
  fn: checkUnusedParametersAst,
};

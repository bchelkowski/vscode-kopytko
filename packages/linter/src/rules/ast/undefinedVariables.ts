import {
  SyntaxKind, CallExpression, IdentifierExpression, walk,
  buildScopes, resolve, builtinNames, keywordNames,
} from 'kopytko-brightscript-parser';
import type { Declaration, ParseResult, Scope } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

/**
 * Resolve a variable name respecting BrightScript's no-closures semantics.
 * Anonymous functions (FunctionExpression) cannot see variables from enclosing function scopes.
 * Resolution walks up the scope chain but skips parent function scopes when crossing
 * a FunctionExpression boundary.
 */
function resolveNoClosures(name: string, scope: Scope): Declaration | undefined {
  const lower = name.toLowerCase();
  // Check current scope first
  const decl = scope.declarations.get(lower);
  if (decl) return decl;

  // Walk up, but skip intermediate function scopes if current scope is a function
  if (!scope.parent) return undefined;

  // If this scope's owner is a FunctionExpression (anonymous function),
  // skip all parent function scopes and go directly to file scope
  const ownerKind = scope.owner?.kind;
  if (ownerKind === SyntaxKind.FunctionExpression) {
    // Jump to file scope (root), skipping parent function scopes
    let fileScope = scope.parent;
    while (fileScope.parent) fileScope = fileScope.parent;
    return fileScope.declarations.get(lower);
  }

  // For named function scopes (FunctionDeclaration), check file scope
  if (ownerKind === SyntaxKind.FunctionDeclaration) {
    return scope.parent.declarations.get(lower);
  }

  // For other scopes (shouldn't happen with current parser), fall through
  return resolve(name, scope.parent);
}

/**
 * AST-based: detect usage of undefined variables.
 * Uses scope analysis — checks identifier references against declarations.
 * Respects BrightScript's no-closures semantics for anonymous functions.
 */
export function checkUndefinedVariablesAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['identifier/undefined-variable'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const rootScope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);
  const knownFuncNames = lintContext.knownFuncNames;
  const ALWAYS_VALID = new Set(['m', 'true', 'false', 'invalid', 'line_num']);

  // Collect all call target identifiers (line:col) to exclude from undefined-variable checks.
  // These are handled by checkUndefinedCallsAst instead.
  const callTargets = new Set<string>();
  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
    const callee = node.callee;
    if (callee && callee instanceof IdentifierExpression) {
      const t = callee.nameToken;
      if (t) callTargets.add(`${t.line}:${t.column}`);
    }
  }

  function checkScope(scope: Scope): void {
    for (const ref of scope.references) {
      if (ALWAYS_VALID.has(ref.nameLower)) continue;
      if (keywordNames.has(ref.nameLower)) continue;
      if (builtinNames.has(ref.nameLower)) continue;
      if (knownFuncNames.has(ref.nameLower)) continue;

      // Skip references that are call targets (handled by undefined-function rule)
      if (callTargets.has(`${ref.line}:${ref.column}`)) continue;

      // Resolve with no-closures semantics
      if (resolveNoClosures(ref.name, scope)) continue;

      diagnostics.push({
        severity: (config['identifier/undefined-variable'] as LintSeverity) ?? 'error',
        code: 'identifier/undefined-variable',
        message: `'${ref.name}' is used but never defined in this scope.`,
        line: ref.line, column: ref.column,
        endLine: ref.line, endColumn: ref.column + ref.name.length,
        filePath,
      });
    }
    for (const child of scope.children) checkScope(child);
  }

  checkScope(rootScope);
  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'identifier/undefined-variable',
  defaultSeverity: 'error',
  fn: checkUndefinedVariablesAst,
};

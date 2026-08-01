import { TokenKind, AALiteral, LiteralExpression, walk, buildScopes } from 'kopytko-brightscript-parser';
import type { ParseResult, Scope } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

/**
 * AST-based: check event callback values in Kopytko `events: { key: "funcName" }` blocks.
 * Validates that the function names referenced as string values exist.
 */
export function checkEventCallbacksAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  const code = 'callback/undefined-event-callback';
  if (config[code] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);
  const localFuncNames = new Set<string>();
  function gatherFuncs(s: Scope): void {
    for (const [name, decl] of s.declarations) {
      if (decl.kind === 'function') localFuncNames.add(name);
    }
    for (const child of s.children) gatherFuncs(child);
  }
  gatherFuncs(scope);

  // Find AA fields named "events" with an AA value containing string callbacks
  for (const node of collectAst<import('kopytko-brightscript-parser').AAField>(ctx, parseResult, 'aaFields', 'visitAAField')) {
      const key = node.key.toLowerCase().replace(/"/g, '');
      if (key !== 'events') continue;

      // The value should be an AALiteral containing key: "callbackName" entries
      const value = node.value;
      if (!value || !(value instanceof AALiteral)) continue;

      for (const field of value.fields) {
        const fieldValue = field.value;
        if (!fieldValue || !(fieldValue instanceof LiteralExpression)) continue;
        const token = fieldValue.token;
        if (!token || token.kind !== TokenKind.StringLiteral) continue;

        const callbackName = token.text.slice(1, -1);
        if (!callbackName) continue;

        const lower = callbackName.toLowerCase();
        if (lintContext.knownFuncNames.has(lower) || localFuncNames.has(lower)) continue;

        diagnostics.push({
          severity: (config[code] as LintSeverity) ?? 'error',
          code,
          message: `Event callback function '${callbackName}' is not defined in this file or any reachable @import.`,
          line: token.line,
          column: token.column + 1,
          endLine: token.line,
          endColumn: token.column + 1 + callbackName.length,
          filePath,
        });
      }
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'callback/undefined-event-callback',
  defaultSeverity: 'error',
  fn: checkEventCallbacksAst,
};

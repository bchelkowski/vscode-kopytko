import { SyntaxKind, TokenKind, CallExpression, walk, buildScopes } from 'kopytko-brightscript-parser';
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
 * AST-based: detect observeField/observeFieldScoped calls with undefined callbacks.
 * Uses CallExpression visitor to find the calls structurally.
 */
export function checkObserverCallbacksAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  const code = 'callback/undefined-observer-callback';
  if (config[code] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);
  const localFuncNames = new Set<string>();
  function gatherFuncNames(s: Scope): void {
    for (const [name, decl] of s.declarations) {
      if (decl.kind === 'function') localFuncNames.add(name);
    }
    for (const child of s.children) gatherFuncNames(child);
  }
  gatherFuncNames(scope);

  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
      // Check if callee is .observeField or .observeFieldScoped
      const calleeSyntax = node.syntax.findChild(SyntaxKind.DotExpression);
      if (!calleeSyntax) continue;

      const memberToken = calleeSyntax.childTokens[calleeSyntax.childTokens.length - 1];
      if (!memberToken) continue;
      const methodName = memberToken.text.toLowerCase();
      if (methodName !== 'observefield' && methodName !== 'observefieldscoped') continue;

      // Second argument should be the callback name string
      const args = node.args;
      if (args.length < 2) continue;
      const secondArg = args[1];
      if (!secondArg || secondArg.syntax.kind !== SyntaxKind.LiteralExpression) continue;
      const strToken = secondArg.syntax.childTokens[0];
      if (!strToken || strToken.kind !== TokenKind.StringLiteral) continue;

      const callbackName = strToken.text.slice(1, -1);
      if (!callbackName) continue;

      const lower = callbackName.toLowerCase();
      if (lintContext.knownFuncNames.has(lower) || localFuncNames.has(lower)) continue;

      diagnostics.push({
        severity: (config[code] as LintSeverity) ?? 'error',
        code,
        message: `Callback function '${callbackName}' is not defined in this file or any reachable @import.`,
        line: strToken.line, column: strToken.column + 1,
        endLine: strToken.line, endColumn: strToken.column + 1 + callbackName.length,
        filePath,
      });
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'callback/undefined-observer-callback',
  defaultSeverity: 'error',
  fn: checkObserverCallbacksAst,
};

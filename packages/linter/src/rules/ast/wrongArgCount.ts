import { CallExpression, IdentifierExpression, walk, builtinNames, builtinArity } from 'kopytko-brightscript-parser';
import type { ParseResult } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

/**
 * AST-based: detect calls to built-in functions with wrong number of arguments.
 * Uses CallExpression.args.length instead of manual paren balancing.
 */
export function checkWrongArgCountAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/wrong-arg-count'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
      const callee = node.callee;
      if (!callee || !(callee instanceof IdentifierExpression)) continue;

      const nameLower = callee.name.toLowerCase();
      if (!builtinNames.has(nameLower)) continue;

      const arity = builtinArity.get(nameLower);
      if (!arity) continue;

      const argCount = node.args.length;
      if (argCount < arity.min || argCount > arity.max) {
        const expected = arity.min === arity.max
          ? `${arity.min} argument${arity.min !== 1 ? 's' : ''}`
          : `${arity.min}–${arity.max} arguments`;
        const got = `${argCount} ${argCount !== 1 ? 'were' : 'was'}`;
        const nameToken = callee.nameToken;
        if (nameToken) {
          diagnostics.push({
            severity: (config['identifier/wrong-arg-count'] as LintSeverity) ?? 'error',
            code: 'identifier/wrong-arg-count',
            message: `'${callee.name}' expects ${expected} but ${got} provided.`,
            line: nameToken.line, column: nameToken.column,
            endLine: nameToken.line, endColumn: nameToken.column + nameToken.text.length,
            filePath,
          });
        }
      }
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'identifier/wrong-arg-count',
  defaultSeverity: 'error',
  fn: checkWrongArgCountAst,
};

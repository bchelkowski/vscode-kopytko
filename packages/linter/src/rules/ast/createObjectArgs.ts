import {
  SyntaxKind, TokenKind, CallExpression, IdentifierExpression, walk, findComponent,
} from 'kopytko-brightscript-parser';
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
 * AST-based: detect CreateObject calls with unknown component names.
 * Cannot false-positive on `"CreateObject"` inside strings.
 */
export function checkCreateObjectArgsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['createobject/unknown-component'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
      const callee = node.callee;
      if (!callee || !(callee instanceof IdentifierExpression)) continue;
      if (callee.name.toLowerCase() !== 'createobject') continue;

      const args = node.args;
      if (args.length === 0) continue;

      const firstArg = args[0];
      if (!firstArg || firstArg.syntax.kind !== SyntaxKind.LiteralExpression) continue;

      const token = firstArg.syntax.childTokens[0];
      if (!token || token.kind !== TokenKind.StringLiteral) continue;

      const componentName = token.text.slice(1, -1);
      if (!componentName || componentName.toLowerCase() === 'rosgnode') continue;

      if (!findComponent(componentName)) {
        diagnostics.push({
          severity: (config['createobject/unknown-component'] as LintSeverity) ?? 'warning',
          code: 'createobject/unknown-component',
          message: `Unknown BrightScript component "${componentName}". Check the component name spelling.`,
          line: token.line, column: token.column,
          endLine: token.line, endColumn: token.column + token.text.length,
          filePath,
        });
      }
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'createobject/unknown-component',
  defaultSeverity: 'warning',
  fn: checkCreateObjectArgsAst,
};

import { SyntaxKind, DotExpression, IdentifierExpression, walk } from 'kopytko-brightscript-parser';
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
 * AST-based: detect `m.top.fieldName` accesses where `fieldName` is not declared
 * in the component's XML interface or any ancestor component / SG node.
 * Only runs when `lintContext.getMtopFields` is populated (extension mode).
 */
export function checkMtopFieldAccessAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['mtop/undefined-field'] === 'off') return [];
  if (!parseResult) return [];
  if (!lintContext.getMtopFields) return [];

  const validFields = lintContext.getMtopFields(filePath);
  if (!validFields) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<DotExpression>(ctx, parseResult, 'dotExpressions', 'visitDotExpression')) {
      // Match the pattern: m.top.<fieldName>
      const obj = node.object;
      if (!(obj instanceof DotExpression)) continue;

      const innerObj = obj.object;
      if (!(innerObj instanceof IdentifierExpression)) continue;
      if (innerObj.name.toLowerCase() !== 'm') continue;
      if (obj.member.toLowerCase() !== 'top') continue;

      // m.top.method() — built-in SG methods are not declared in <interface>, skip
      if (node.syntax.parent?.kind === SyntaxKind.CallExpression) continue;

      const fieldName = node.member.toLowerCase();
      if (validFields.has(fieldName)) continue;

      const memberToken = node.memberToken;
      if (!memberToken) continue;

      diagnostics.push({
        severity: (config['mtop/undefined-field'] as LintSeverity) ?? 'warning',
        code: 'mtop/undefined-field',
        message: `'${node.member}' is not declared in this component's XML interface or any ancestor component.`,
        line: memberToken.line, column: memberToken.column,
        endLine: memberToken.line, endColumn: memberToken.column + memberToken.text.length,
        filePath,
      });
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'mtop/undefined-field',
  defaultSeverity: 'warning',
  fn: checkMtopFieldAccessAst,
};

import { FunctionDeclaration, Parameter, walk } from 'kopytko-brightscript-parser';
import type { ParseResult } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

function checkParamTypes(
  params: Parameter[], diagnostics: LintDiagnostic[],
  config: Record<string, unknown>, filePath: string,
): void {
  for (const param of params) {
    if (!param.typeName) {
      const t = param.nameToken;
      if (t) diagnostics.push({
        severity: (config['type/missing-param-type'] as LintSeverity) ?? 'warning',
        code: 'type/missing-param-type',
        message: `Parameter "${param.name}" is missing a type annotation.`,
        line: t.line, column: t.column, endLine: t.line, endColumn: t.column + t.text.length, filePath,
      });
    }
  }
}

/**
 * AST-based: detect missing type annotations on parameters and return types.
 * Handles multi-line params, defaults with complex expressions, nested functions.
 */
export function checkMissingTypeAnnotationsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  const returnTypeOff = config['type/missing-return-type'] === 'off';
  const paramTypeOff = config['type/missing-param-type'] === 'off';
  if (returnTypeOff && paramTypeOff) return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<FunctionDeclaration>(ctx, parseResult, 'functionDeclarations', 'visitFunctionDeclaration')) {
      if (!returnTypeOff && node.isFunction && !node.returnType) {
        const t = node.nameToken;
        if (t) diagnostics.push({
          severity: (config['type/missing-return-type'] as LintSeverity) ?? 'warning',
          code: 'type/missing-return-type',
          message: `Function "${node.name}" is missing a return type annotation.`,
          line: t.line, column: t.column, endLine: t.line, endColumn: t.column + t.text.length, filePath,
        });
      }
      if (!paramTypeOff) checkParamTypes(node.params, diagnostics, config, filePath);
  }
  for (const node of collectAst<import('kopytko-brightscript-parser').FunctionExpression>(ctx, parseResult, 'functionExpressions', 'visitFunctionExpression')) {
      if (!paramTypeOff) checkParamTypes(node.params, diagnostics, config, filePath);
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'type/*',
  defaultSeverity: 'warning',
  fn: checkMissingTypeAnnotationsAst,
};

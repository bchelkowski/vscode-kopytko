import { SyntaxKind, SyntaxNode, walk } from 'kopytko-brightscript-parser';
import type { ParseResult } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

/** Checks ancestors for a loop kind, stopping at function boundaries. */
function hasLoopAncestor(node: SyntaxNode, ...kinds: SyntaxKind[]): boolean {
  let current = node.parent;
  while (current) {
    if (kinds.includes(current.kind)) return true;
    if (current.kind === SyntaxKind.FunctionDeclaration || current.kind === SyntaxKind.FunctionExpression) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

function reportFlowError(
  diagnostics: LintDiagnostic[], keyword: string, loopType: string,
  node: SyntaxNode, config: Record<string, unknown>, filePath: string,
): void {
  const token = node.childTokens[0];
  if (!token) return;
  diagnostics.push({
    severity: (config['syntax/flow-outside-loop'] as LintSeverity) ?? 'error',
    code: 'syntax/flow-outside-loop',
    message: `\`${keyword} ${loopType}\` is only valid inside a \`${loopType}\` loop body.`,
    line: token.line, column: token.column,
    endLine: token.line, endColumn: token.column + token.text.length,
    filePath,
  });
}

/**
 * AST-based: detect exit/continue for/while outside their corresponding loop.
 * Uses ancestor chain instead of manual stack tracking.
 */
export function checkLoopFlowControlAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['syntax/flow-outside-loop'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<import('kopytko-brightscript-parser').ExitForStatement>(ctx, parseResult, 'exitForStatements', 'visitExitForStatement')) {
    if (!hasLoopAncestor(node.syntax, SyntaxKind.ForStatement, SyntaxKind.ForEachStatement)) {
      reportFlowError(diagnostics, 'exit', 'for', node.syntax, config, filePath);
    }
  }
  for (const node of collectAst<import('kopytko-brightscript-parser').ExitWhileStatement>(ctx, parseResult, 'exitWhileStatements', 'visitExitWhileStatement')) {
    if (!hasLoopAncestor(node.syntax, SyntaxKind.WhileStatement)) {
      reportFlowError(diagnostics, 'exit', 'while', node.syntax, config, filePath);
    }
  }
  for (const node of collectAst<import('kopytko-brightscript-parser').ContinueForStatement>(ctx, parseResult, 'continueForStatements', 'visitContinueForStatement')) {
    if (!hasLoopAncestor(node.syntax, SyntaxKind.ForStatement, SyntaxKind.ForEachStatement)) {
      reportFlowError(diagnostics, 'continue', 'for', node.syntax, config, filePath);
    }
  }
  for (const node of collectAst<import('kopytko-brightscript-parser').ContinueWhileStatement>(ctx, parseResult, 'continueWhileStatements', 'visitContinueWhileStatement')) {
    if (!hasLoopAncestor(node.syntax, SyntaxKind.WhileStatement)) {
      reportFlowError(diagnostics, 'continue', 'while', node.syntax, config, filePath);
    }
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'syntax/flow-outside-loop',
  defaultSeverity: 'error',
  fn: checkLoopFlowControlAst,
};

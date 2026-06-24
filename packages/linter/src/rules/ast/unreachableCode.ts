import {
  SyntaxKind, SyntaxNode, walk, isNode, isToken,
  FunctionDeclaration, FunctionExpression,
  IfStatement, ElseIfClause, ElseClause,
  ForStatement, ForEachStatement, WhileStatement,
  TryStatement, CatchClause,
} from 'kopytko-brightscript-parser';
import type { AstNode, Token, ParseResult } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

const TERMINATING_SYNTAX_KINDS = new Set<SyntaxKind>([
  SyntaxKind.ReturnStatement,
  SyntaxKind.ThrowStatement,
  SyntaxKind.StopStatement,
  SyntaxKind.EndStatement,
  SyntaxKind.GotoStatement,
  SyntaxKind.ExitForStatement,
  SyntaxKind.ExitWhileStatement,
  SyntaxKind.ContinueForStatement,
  SyntaxKind.ContinueWhileStatement,
]);

function getFirstToken(node: SyntaxNode): Token | undefined {
  for (const child of node.children) {
    if (isToken(child)) return child;
    if (isNode(child)) {
      const t = getFirstToken(child);
      if (t) return t;
    }
  }
  return undefined;
}

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

function checkBodyForUnreachable(
  body: AstNode[],
  diagnostics: LintDiagnostic[],
  config: Record<string, unknown>,
  filePath: string,
): void {
  let terminatorIdx = -1;
  for (let i = 0; i < body.length; i++) {
    if (TERMINATING_SYNTAX_KINDS.has(body[i].syntax.kind)) {
      terminatorIdx = i;
      break;
    }
  }
  if (terminatorIdx < 0 || terminatorIdx >= body.length - 1) return;

  const unreachable = body[terminatorIdx + 1];
  const firstToken = getFirstToken(unreachable.syntax);
  if (!firstToken) return;

  diagnostics.push({
    severity: (config['syntax/unreachable-code'] as LintSeverity) ?? 'warning',
    code: 'syntax/unreachable-code',
    message: 'This code is unreachable — it follows a `return`, `throw`, or other terminating statement.',
    line: firstToken.line, column: firstToken.column,
    endLine: firstToken.line, endColumn: Number.MAX_SAFE_INTEGER,
    filePath,
  });
}

/**
 * AST-based: detect statements that follow a terminating statement (`return`,
 * `throw`, `stop`, `goto`, `exit for`, etc.) in the same linear block.
 * Reports only the first unreachable statement to avoid noise.
 * Does not perform full control-flow analysis (no cross-branch detection).
 */
export function checkUnreachableCodeAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['syntax/unreachable-code'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<FunctionDeclaration>(ctx, parseResult, 'functionDeclarations', 'visitFunctionDeclaration')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<FunctionExpression>(ctx, parseResult, 'functionExpressions', 'visitFunctionExpression')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<IfStatement>(ctx, parseResult, 'ifStatements', 'visitIfStatement')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<ElseIfClause>(ctx, parseResult, 'elseIfClauses', 'visitElseIfClause')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<ElseClause>(ctx, parseResult, 'elseClauses', 'visitElseClause')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<ForStatement>(ctx, parseResult, 'forStatements', 'visitForStatement')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<ForEachStatement>(ctx, parseResult, 'forEachStatements', 'visitForEachStatement')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<WhileStatement>(ctx, parseResult, 'whileStatements', 'visitWhileStatement')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<TryStatement>(ctx, parseResult, 'tryStatements', 'visitTryStatement')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }
  for (const node of collectAst<CatchClause>(ctx, parseResult, 'catchClauses', 'visitCatchClause')) {
    checkBodyForUnreachable(node.body, diagnostics, config, filePath);
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'syntax/unreachable-code',
  defaultSeverity: 'warning',
  fn: checkUnreachableCodeAst,
};

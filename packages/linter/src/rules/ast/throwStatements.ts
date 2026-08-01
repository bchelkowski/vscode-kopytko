import {
  SyntaxKind, TokenKind, ThrowStatement, AALiteral, walk,
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

function isNumericTokenKind(kind: TokenKind): boolean {
  return kind === TokenKind.IntegerLiteral || kind === TokenKind.FloatLiteral
      || kind === TokenKind.DoubleLiteral || kind === TokenKind.LongIntegerLiteral;
}

/**
 * AST-based: detect throw with invalid operands (numeric, array, AA without message).
 */
export function checkThrowStatementsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['throw/invalid-value'] === 'off' && config['throw/missing-message'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<ThrowStatement>(ctx, parseResult, 'throwStatements', 'visitThrowStatement')) {
      const expr = node.expression;
      if (!expr) continue;
      const exprSyntax = expr.syntax;

      if (config['throw/invalid-value'] !== 'off') {
        if (exprSyntax.kind === SyntaxKind.LiteralExpression) {
          const token = exprSyntax.childTokens[0];
          if (token && isNumericTokenKind(token.kind)) {
            diagnostics.push({
              severity: (config['throw/invalid-value'] as LintSeverity) ?? 'warning',
              code: 'throw/invalid-value',
              message: '`throw` requires a string or an associative array with a "message" field — numeric literals are not valid throw values.',
              line: token.line, column: token.column,
              endLine: token.line, endColumn: token.column + token.text.length,
              filePath,
            });
          }
          // throw invalid — the `invalid` keyword literal is not a valid throw value
          if (token && token.kind === TokenKind.Invalid) {
            diagnostics.push({
              severity: (config['throw/invalid-value'] as LintSeverity) ?? 'warning',
              code: 'throw/invalid-value',
              message: '`throw` requires a string or an associative array with a "message" field — `invalid` is not a valid throw value.',
              line: token.line, column: token.column,
              endLine: token.line, endColumn: token.column + token.text.length,
              filePath,
            });
          }
        }

        // Unary negation of a numeric literal: throw -1, throw -3.14
        if (exprSyntax.kind === SyntaxKind.UnaryExpression) {
          const operand = exprSyntax.findChild(SyntaxKind.LiteralExpression);
          if (operand) {
            const numToken = operand.childTokens[0];
            if (numToken && isNumericTokenKind(numToken.kind)) {
              const minusToken = exprSyntax.childTokens[0];
              const startToken = minusToken ?? numToken;
              diagnostics.push({
                severity: (config['throw/invalid-value'] as LintSeverity) ?? 'warning',
                code: 'throw/invalid-value',
                message: '`throw` requires a string or an associative array with a "message" field — numeric literals are not valid throw values.',
                line: startToken.line, column: startToken.column,
                endLine: numToken.line, endColumn: numToken.column + numToken.text.length,
                filePath,
              });
            }
          }
        }

        if (exprSyntax.kind === SyntaxKind.ArrayLiteral) {
          const firstToken = exprSyntax.childTokens[0];
          if (firstToken) {
            diagnostics.push({
              severity: (config['throw/invalid-value'] as LintSeverity) ?? 'warning',
              code: 'throw/invalid-value',
              message: '`throw` requires a string or an associative array with a "message" field — array literals are not valid throw values.',
              line: firstToken.line, column: firstToken.column,
              endLine: firstToken.line, endColumn: firstToken.column + 1,
              filePath,
            });
          }
        }
      }

      if (config['throw/missing-message'] !== 'off' && exprSyntax.kind === SyntaxKind.AALiteral) {
        const aaNode = new AALiteral(exprSyntax);
        const hasMessage = aaNode.fields.some(
          f => f.key.toLowerCase() === 'message' || f.key === '"message"'
        );
        if (!hasMessage) {
          const firstToken = exprSyntax.childTokens[0];
          if (firstToken) {
            diagnostics.push({
              severity: (config['throw/missing-message'] as LintSeverity) ?? 'warning',
              code: 'throw/missing-message',
              message: 'Thrown associative array should include a "message" field.',
              line: firstToken.line, column: firstToken.column,
              endLine: firstToken.line, endColumn: firstToken.column + 1,
              filePath,
            });
          }
        }
      }
  }

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'throw/*',
  defaultSeverity: 'warning',
  fn: checkThrowStatementsAst,
};

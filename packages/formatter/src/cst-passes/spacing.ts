 /**
 * CST Pass: Spacing normalization.
 *
 * Enforces consistent spacing around operators, assignments, and parentheses.
 * Works on the whitespace trivia between tokens.
 */

import { SyntaxNode, TokenKind, isToken, isNode } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

interface SpacingConfig {
  spaceAroundOperators: boolean;
  spaceAroundAssignment: boolean;
}

const BINARY_OPS = new Set([
  TokenKind.Plus, TokenKind.Minus, TokenKind.Star, TokenKind.Slash,
  TokenKind.Backslash, TokenKind.Caret, TokenKind.Mod,
  TokenKind.And, TokenKind.Or,
  TokenKind.Less, TokenKind.Greater, TokenKind.LessEqual, TokenKind.GreaterEqual,
  TokenKind.LessGreater, TokenKind.LeftShift, TokenKind.RightShift,
]);

const ASSIGNMENT_OPS = new Set([
  TokenKind.Equal,
  TokenKind.PlusEqual, TokenKind.MinusEqual,
  TokenKind.StarEqual, TokenKind.SlashEqual,
  TokenKind.BackslashEqual,
  TokenKind.LeftShiftEqual, TokenKind.RightShiftEqual,
]);

/**
 * Creates a spacing pass that normalizes whitespace around operators.
 * This is a simplified version — handles the most common cases.
 */
export function spacingPass(config: SpacingConfig): (root: SyntaxNode, source: string) => TextEdit[] {
  if (!config.spaceAroundOperators && !config.spaceAroundAssignment) return () => [];

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    const tokens = collectAllTokens(root);

    for (let i = 0; i < tokens.length - 1; i++) {
      const token = tokens[i];
      const next = tokens[i + 1];

      // Skip if tokens are on different lines
      if (next.line !== token.line) continue;

      if (config.spaceAroundOperators && BINARY_OPS.has(token.kind)) {
        ensureSpaceBefore(token, source, edits);
        ensureSpaceAfter(token, next, source, edits);
      }

      if (config.spaceAroundAssignment && ASSIGNMENT_OPS.has(token.kind)) {
        ensureSpaceBefore(token, source, edits);
        ensureSpaceAfter(token, next, source, edits);
      }
    }

    return edits;
  };
}

function ensureSpaceBefore(token: Token, source: string, edits: TextEdit[]): void {
  if (token.pos === 0) return;
  const charBefore = source[token.pos - 1];
  if (charBefore !== ' ' && charBefore !== '\t' && charBefore !== '\n' && charBefore !== '\r') {
    edits.push({ pos: token.pos, end: token.pos, newText: ' ' });
  }
}

function ensureSpaceAfter(token: Token, next: Token, source: string, edits: TextEdit[]): void {
  const gap = source.slice(token.end, next.pos);
  // Check leading trivia of next token for whitespace
  if (next.leadingTrivia.length === 0 && gap === '') {
    edits.push({ pos: token.end, end: token.end, newText: ' ' });
  }
}

function collectAllTokens(node: SyntaxNode): Token[] {
  const tokens: Token[] = [];
  function walk(n: SyntaxNode): void {
    for (const child of n.children) {
      if (isToken(child)) tokens.push(child);
      else if (isNode(child)) walk(child);
    }
  }
  walk(node);
  return tokens;
}

/**
 * Token — a single lexical unit produced by the BrightScript lexer.
 *
 * Each token carries its original source text, position information, and
 * any trivia (whitespace / comments) attached to it. Together, the token
 * stream forms a lossless representation of the source: concatenating all
 * leading trivia, token text, and trailing trivia reproduces the original
 * source byte-for-byte.
 */

import { TokenKind } from './tokenKind.js';
import { Trivia } from './trivia.js';
import type { SyntaxNode } from './syntaxNode.js';

export interface Token {
  readonly kind: TokenKind;
  /** The original source text of this token (preserving original casing). */
  readonly text: string;
  /** Byte offset in the source where this token starts (excluding leading trivia). */
  readonly pos: number;
  /** Byte offset just past the end of this token (excluding trailing trivia). */
  readonly end: number;
  /** 0-based line number of the token start. */
  readonly line: number;
  /** 0-based column (character offset within the line) of the token start. */
  readonly column: number;
  /** Whitespace / comments that appear before this token. */
  readonly leadingTrivia: readonly Trivia[];
  /** Whitespace / comments that appear after this token on the same line. */
  readonly trailingTrivia: readonly Trivia[];
  /**
   * True for a synthetic zero-width token the parser inserts when a required
   * token is missing from the source (see `Parser.expect()`). Never set by
   * the lexer. `text` is always `''` and `pos === end` for a missing token,
   * so it contributes nothing to `tokenFullText`/round-trip reconstruction.
   */
  readonly isMissing?: boolean;
  /**
   * The `SyntaxNode` this token is a direct child of. Set by `SyntaxNode`'s
   * constructor (mirroring how it stamps `parent` on child nodes) — `undefined`
   * until the token is attached to a tree. Mutable (unlike every other Token
   * field) for exactly that reason. Lets a position lookup that already found
   * a token (e.g. via `findTokenAtPositionIndexed`) recover the full ancestor
   * chain in O(depth) by walking `.parent` upward, instead of a fresh O(n)
   * tree walk from the root.
   */
  parent?: SyntaxNode;
}

/**
 * Reconstructs the full source text for a single token including its trivia.
 * Useful for round-trip fidelity verification.
 */
export function tokenFullText(token: Token): string {
  let result = '';
  for (const t of token.leadingTrivia) result += t.text;
  result += token.text;
  for (const t of token.trailingTrivia) result += t.text;
  return result;
}

/**
 * Reconstructs the full source text from a complete token array.
 * Must produce the exact original source for a correct lexer.
 */
export function tokensToText(tokens: readonly Token[]): string {
  let result = '';
  for (const token of tokens) {
    result += tokenFullText(token);
  }
  return result;
}

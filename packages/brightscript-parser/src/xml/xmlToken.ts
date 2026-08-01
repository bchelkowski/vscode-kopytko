/**
 * XmlToken — a single lexical unit produced by the SceneGraph XML scanner.
 * Mirrors `../token.ts`'s Token: original text, position, and attached
 * trivia, so the token stream is a lossless representation of the source.
 */

import { XmlTokenKind } from './xmlTokenKind.js';
import { XmlTrivia } from './xmlTrivia.js';
import type { XmlSyntaxNode } from './xmlSyntaxNode.js';

export interface XmlToken {
  readonly kind: XmlTokenKind;
  readonly text: string;
  readonly pos: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly leadingTrivia: readonly XmlTrivia[];
  readonly trailingTrivia: readonly XmlTrivia[];
  /**
   * A synthetic zero-width token inserted when a required token (e.g. a
   * closing `>` or the value after `=`) is missing. See `Token.isMissing`
   * in the BrightScript CST for the same rationale.
   */
  readonly isMissing?: boolean;
  /** The `XmlSyntaxNode` this token is a direct child of. See `Token.parent`. */
  parent?: XmlSyntaxNode;
}

export function xmlTokenFullText(token: XmlToken): string {
  let result = '';
  for (const t of token.leadingTrivia) result += t.text;
  result += token.text;
  for (const t of token.trailingTrivia) result += t.text;
  return result;
}

export function xmlTokensToText(tokens: readonly XmlToken[]): string {
  let result = '';
  for (const token of tokens) result += xmlTokenFullText(token);
  return result;
}

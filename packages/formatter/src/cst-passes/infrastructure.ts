/**
 * CST-based formatting infrastructure.
 *
 * Each pass walks the CST and produces a list of text edits (replacements).
 * Edits are applied in reverse order to avoid position shifts.
 *
 * This approach replaces the regex line-by-line transforms with
 * structure-aware transformations that cannot accidentally modify
 * code inside string literals or comments.
 */

import { parse, SyntaxNode, isNode, isToken, TokenKind } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';

/** A text replacement at a specific byte range in the source. */
export interface TextEdit {
  /** Start byte offset (inclusive). */
  pos: number;
  /** End byte offset (exclusive). */
  end: number;
  /** New text to replace the range with. */
  newText: string;
}

/** A CST formatting pass returns a list of edits to apply to the source. */
export type CstPass = (root: SyntaxNode, source: string) => TextEdit[];

/**
 * Applies a list of text edits to a source string.
 * Edits are applied in reverse order to preserve positions.
 */
export function applyEdits(source: string, edits: TextEdit[]): string {
  // Sort by position descending so we can apply without offset adjustments
  const sorted = [...edits].sort((a, b) => b.pos - a.pos);
  let result = source;
  for (const edit of sorted) {
    result = result.slice(0, edit.pos) + edit.newText + result.slice(edit.end);
  }
  return result;
}

/**
 * Runs one or more CST passes on the source and returns the transformed text.
 * Re-parses after each pass that modifies the source so subsequent passes use
 * correct token positions (avoids position drift when a pass changes text length).
 */
export function runCstPasses(source: string, passes: CstPass[]): string {
  let parseResult = parse(source);
  if (parseResult.diagnostics.length > 0) {
    // Source has syntax errors — don't transform
    return source;
  }

  let result = source;
  for (const pass of passes) {
    const edits = pass(parseResult.root, result);
    if (edits.length > 0) {
      result = applyEdits(result, edits);
      const next = parse(result);
      // If a pass somehow introduced a syntax error, stop rather than corrupting further
      if (next.diagnostics.length > 0) break;
      parseResult = next;
    }
  }
  return result;
}

/**
 * Walks all tokens in the CST depth-first.
 * This is the primary iteration pattern for token-level passes.
 */
export function walkTokens(node: SyntaxNode, callback: (token: Token, parent: SyntaxNode) => void): void {
  for (const child of node.children) {
    if (isToken(child)) {
      callback(child, node);
    } else if (isNode(child)) {
      walkTokens(child, callback);
    }
  }
}

/** Raw start of a node's first token, ignoring leading trivia. */
export function rawStart(node: SyntaxNode): number {
  let first: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; });
  return first ? first.pos : node.pos;
}

/** Raw end of a node's last token, ignoring trailing trivia (unlike `node.end`, which includes it). */
export function rawEnd(node: SyntaxNode): number {
  let last: Token | undefined;
  walkTokens(node, (t) => { last = t; });
  return last ? last.end : node.end;
}

/** A node's exact source text, from its first token's start to its last token's end — excludes leading/trailing trivia (comments, whitespace). */
export function rawText(node: SyntaxNode, source: string): string {
  let first: Token | undefined;
  let last: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; last = t; });
  if (!first || !last) return node.getText().trim();
  return source.slice(first.pos, last.end);
}

/** Trivia-inclusive start offset of a bare token (includes its leading comments/blank lines). */
export function triviaStart(token: Token): number {
  return token.leadingTrivia.length > 0 ? token.leadingTrivia[0].pos : token.pos;
}

/** Trivia-inclusive end offset of a bare token (includes its trailing same-line comment + line break). */
export function triviaEnd(token: Token): number {
  return token.trailingTrivia.length > 0 ? token.trailingTrivia[token.trailingTrivia.length - 1].end : token.end;
}

/** Last non-`.` direct-child token of a dot-access node (`a.b` → `b`) — the member name. */
export function dotMemberToken(node: SyntaxNode): Token | undefined {
  const children = node.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (isToken(child) && child.kind !== TokenKind.Dot) return child;
  }
  return undefined;
}

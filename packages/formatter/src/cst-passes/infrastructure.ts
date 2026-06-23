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

import { parse, SyntaxNode, isNode, isToken } from 'kopytko-brightscript-parser';
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

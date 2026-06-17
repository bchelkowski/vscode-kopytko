/* eslint-disable @typescript-eslint/no-unused-vars *//**
 * CST Pass: Print statement removal.
 *
 * Removes all `print` and `?` statements from the source.
 * Used to strip debug output before release builds.
 *
 * Unlike the regex version (`/^\s*(?:print|\?)\b/i`), this pass:
 * - Uses the parsed AST to find actual PrintStatement nodes
 * - Cannot match "print" inside strings or comments
 * - Correctly handles multi-line print statements
 * - Removes the entire statement including its trailing trivia (newline)
 */

import { SyntaxNode, SyntaxKind, isNode, isToken } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

/**
 * Creates a print-removal CST pass.
 * Finds all PrintStatement nodes and removes them (including their line).
 */
export function printStatementRemovalPass(): (root: SyntaxNode, source: string) => TextEdit[] {
  return (root: SyntaxNode, _source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    function findPrintStatements(node: SyntaxNode): void {
      for (const child of node.children) {
        if (isNode(child)) {
          if (child.kind === SyntaxKind.PrintStatement) {
            // Calculate the full range including leading whitespace and trailing newline
            const fullStart = getFullStart(child);
            const fullEnd = getFullEnd(child);
            edits.push({ pos: fullStart, end: fullEnd, newText: '' });
          } else {
            findPrintStatements(child);
          }
        }
      }
    }

    findPrintStatements(root);
    return edits;
  };
}

/** Gets the start of a node including its leading trivia (indentation). */
function getFullStart(node: SyntaxNode): number {
  const first = node.children[0];
  if (!first) return node.pos;
  if (isToken(first) && first.leadingTrivia.length > 0) {
    // Include leading whitespace (indentation) but not comments
    const firstTrivia = first.leadingTrivia[0];
    if (firstTrivia.kind === 'Whitespace') return firstTrivia.pos;
  }
  return isToken(first) ? first.pos : getFullStart(first);
}

/** Gets the end of a node including its trailing newline. */
function getFullEnd(node: SyntaxNode): number {
  const last = node.children[node.children.length - 1];
  if (!last) return node.end;
  if (isToken(last) && last.trailingTrivia.length > 0) {
    const lastTrivia = last.trailingTrivia[last.trailingTrivia.length - 1];
    return lastTrivia.end;
  }
  return isToken(last) ? last.end : getFullEnd(last);
}

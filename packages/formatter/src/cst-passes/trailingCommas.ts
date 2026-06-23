/**
 * CST Pass: Trailing commas.
 *
 * Controls trailing commas in array and AA literals:
 * - 'always': add trailing comma after last element
 * - 'never': remove trailing comma after last element
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

type TrailingCommaStyle = 'always' | 'never' | 'preserve';

export function trailingCommaPass(style: TrailingCommaStyle): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];

  return (root: SyntaxNode): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.ArrayLiteral || node.kind === SyntaxKind.AALiteral) {
        processLiteral(node, edits, style);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }

    visit(root);
    return edits;
  };
}

function processLiteral(node: SyntaxNode, edits: TextEdit[], style: TrailingCommaStyle): void {
  const closingKind = node.kind === SyntaxKind.ArrayLiteral ? TokenKind.RightBracket : TokenKind.RightBrace;

  // Find the last significant token before the closing bracket/brace
  const tokens = node.childTokens;
  const closingIdx = tokens.findIndex(t => t.kind === closingKind);
  if (closingIdx <= 0) return;

  // Check if it's multi-line (opening and closing on different lines)
  const openToken = tokens[0];
  const closeToken = tokens[closingIdx];
  if (openToken.line === closeToken.line) return; // single-line — don't touch

  // Find the last token before closing (could be a comma or a value)
  const prevToken = tokens[closingIdx - 1];
  if (!prevToken) return;

  const hasTrailingComma = prevToken.kind === TokenKind.Comma;

  if (style === 'always' && !hasTrailingComma) {
    // Insert comma after last element
    edits.push({ pos: prevToken.end, end: prevToken.end, newText: ',' });
  } else if (style === 'never' && hasTrailingComma) {
    // Remove trailing comma
    edits.push({ pos: prevToken.pos, end: prevToken.end, newText: '' });
  }
}

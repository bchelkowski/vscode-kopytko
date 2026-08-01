/**
 * CST Pass: Strip parentheses around a `catch` clause's exception variable.
 *
 * Roku's own docs only show the bare `catch e` form, but the parser accepts
 * `catch (e)` too (see `parseCatchClause` in parser.ts) since it shows up
 * often enough in the wild (defensive/BrighterScript-influenced style). The
 * formatter always normalizes to the bare form.
 *
 * `CatchClause`'s children are a flat list — `[catch, LeftParen?, Identifier,
 * RightParen?, ...body]`, no `GroupingExpression` wrapper — so this is a
 * direct-token search + edit, not a node substitution like
 * `parenthesisIfCasePass`. The edit replaces the span from the end of
 * `catch` to the start of the identifier with a single space (handles
 * `catch(e)`/`catch ( e )`/any spacing uniformly) and deletes everything
 * from the identifier's end through the closing paren — leaving any trailing
 * same-line comment untouched, since the deleted range stops at the raw
 * (trivia-exclusive) end of the `)` token.
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function stripCatchParensPass(): (root: SyntaxNode, source: string) => TextEdit[] {
  return (root: SyntaxNode): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.CatchClause) {
        processCatchClause(node, edits);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }
    visit(root);

    return edits;
  };
}

function processCatchClause(node: SyntaxNode, edits: TextEdit[]): void {
  const catchToken = node.findToken(TokenKind.Catch);
  const leftParen = node.findToken(TokenKind.LeftParen);
  const rightParen = node.findToken(TokenKind.RightParen);
  const identifier = node.findToken(TokenKind.Identifier);
  if (!catchToken || !leftParen || !rightParen || !identifier) return;

  edits.push({ pos: catchToken.end, end: identifier.pos, newText: ' ' });
  edits.push({ pos: identifier.end, end: rightParen.end, newText: '' });
}

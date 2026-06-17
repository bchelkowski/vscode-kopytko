/* eslint-disable @typescript-eslint/no-unused-vars */import { SyntaxNode, SyntaxKind, TokenKind, isToken, isNode } from 'brightscript-parser';
import { TextEdit } from './infrastructure';

export function stripCatchParensPass(): (root: SyntaxNode, source: string) => TextEdit[] {
  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.CatchClause) {
        const tokens = node.childTokens;
        for (let i = 0; i < tokens.length; i++) {
          if (tokens[i].kind === TokenKind.LeftParen) {
            edits.push({ pos: tokens[i].pos, end: tokens[i].end, newText: '' });
          }
          if (tokens[i].kind === TokenKind.RightParen) {
            edits.push({ pos: tokens[i].pos, end: tokens[i].end, newText: '' });
          }
        }
      }
      for (const child of node.children) { if (isNode(child)) visit(child); }
    }
    visit(root);
    return edits;
  };
}

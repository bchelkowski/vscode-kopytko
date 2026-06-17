/* eslint-disable @typescript-eslint/no-unused-vars */import { SyntaxNode, SyntaxKind, TokenKind, isToken, isNode } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

type ParenStyle = 'always' | 'never' | 'preserve';

export function parenthesisIfCasePass(style: ParenStyle): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];
  return (root: SyntaxNode, _source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.IfStatement || node.kind === SyntaxKind.ElseIfClause) {
        const children = node.children;
        let condIdx = -1;
        for (let i = 0; i < children.length; i++) {
          const c = children[i];
          if (isToken(c) && (c.kind === TokenKind.If || c.kind === TokenKind.ElseIf)) {
            condIdx = i + 1;
            break;
          }
        }
        if (condIdx >= 0 && condIdx < children.length && isNode(children[condIdx])) {
          const condNode = children[condIdx] as SyntaxNode;
          if (style === 'always' && condNode.kind !== SyntaxKind.GroupingExpression) {
            const condText = condNode.getText();
            edits.push({ pos: condNode.pos, end: condNode.end, newText: '(' + condText + ')' });
          } else if (style === 'never' && condNode.kind === SyntaxKind.GroupingExpression) {
            const innerText = condNode.getText().slice(1, -1);
            edits.push({ pos: condNode.pos, end: condNode.end, newText: innerText });
          }
        }
      }
      for (const child of node.children) { if (isNode(child)) visit(child); }
    }
    visit(root);
    return edits;
  };
}

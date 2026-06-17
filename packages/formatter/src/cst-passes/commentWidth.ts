/* eslint-disable @typescript-eslint/no-unused-vars */import { SyntaxNode, TriviaKind, isToken, isNode } from 'kopytko-brightscript-parser';
import type { Trivia } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function commentWidthPass(maxWidth: number): (root: SyntaxNode, source: string) => TextEdit[] {
  if (maxWidth <= 0) return () => [];
  return (root: SyntaxNode, _source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    function walkTrivia(node: SyntaxNode): void {
      for (const child of node.children) {
        if (isToken(child)) {
          for (const t of child.leadingTrivia) processComment(t, edits, maxWidth);
          for (const t of child.trailingTrivia) processComment(t, edits, maxWidth);
        } else if (isNode(child)) { walkTrivia(child); }
      }
    }
    walkTrivia(root);
    return edits;
  };
}
function processComment(trivia: Trivia, edits: TextEdit[], maxWidth: number): void {
  if (trivia.kind !== TriviaKind.Comment) return;
  if (trivia.text.length <= maxWidth) return;
  const content = trivia.text.slice(2);
  const words = content.split(/\s+/);
  const lines: string[] = [];
  let current = "'";
  for (const word of words) {
    if (current.length + 1 + word.length > maxWidth && current !== "'") {
      lines.push(current);
      current = "' " + word;
    } else {
      current += (current === "'" ? ' ' : ' ') + word;
    }
  }
  lines.push(current);
  if (lines.length > 1) {
    edits.push({ pos: trivia.pos, end: trivia.end, newText: lines.join('\n') });
  }
}

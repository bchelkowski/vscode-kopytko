/**
 * CST Pass: observeField style.
 *
 * - 'always-scoped': rewrites `.observeField(` calls to `.observeFieldScoped(`.
 * - 'warn': appends a trailing `' TODO: consider using observeFieldScoped` comment
 *   instead of rewriting (observeFieldScoped has different unobserve semantics,
 *   so this is left for the developer to opt into).
 *
 * Only matches real `CallExpression` nodes, so (unlike the old regex pass) text
 * that merely *mentions* "observeField" inside an unrelated comment can never be
 * mistaken for a call — comments aren't parsed as expressions.
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode, TriviaKind } from 'kopytko-brightscript-parser';
import { TextEdit, dotMemberToken } from './infrastructure';

type ObserveFieldStyle = 'preserve' | 'always-scoped' | 'warn';

export function observeFieldStylePass(style: ObserveFieldStyle): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];
  // Re-bind to a narrower const: TS doesn't carry the `!== 'preserve'` narrowing
  // of a parameter into a nested `function` declaration's closure.
  const activeStyle = style;

  return (root: SyntaxNode): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.CallExpression) {
        processCallNode(node, edits, activeStyle);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }

    visit(root);
    return edits;
  };
}

function processCallNode(node: SyntaxNode, edits: TextEdit[], style: 'always-scoped' | 'warn'): void {
  const callee = node.childNodes[0];
  if (!callee || callee.kind !== SyntaxKind.DotExpression) return;

  const memberToken = dotMemberToken(callee);
  if (!memberToken || memberToken.text.toLowerCase() !== 'observefield') return;

  if (style === 'always-scoped') {
    edits.push({ pos: memberToken.pos, end: memberToken.end, newText: 'observeFieldScoped' });
    return;
  }

  // 'warn' — append a trailing comment after the call's closing paren, unless
  // one already flags it.
  const argList = node.findChild(SyntaxKind.ArgumentList);
  const lastToken = argList?.findToken(TokenKind.RightParen) ?? memberToken;

  const existingComment = lastToken.trailingTrivia.find(t => t.kind === TriviaKind.Comment);
  if (existingComment && /TODO:.*observeFieldScoped/i.test(existingComment.text)) return;

  const lineBreak = lastToken.trailingTrivia.find(t => t.kind === TriviaKind.LineBreak);
  const insertPos = lineBreak
    ? lineBreak.pos
    : lastToken.trailingTrivia.length > 0
      ? lastToken.trailingTrivia[lastToken.trailingTrivia.length - 1].end
      : lastToken.end;

  edits.push({ pos: insertPos, end: insertPos, newText: " ' TODO: consider using observeFieldScoped" });
}

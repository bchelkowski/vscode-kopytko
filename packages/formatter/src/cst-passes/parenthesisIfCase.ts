/**
 * CST Pass: Parenthesis around if/else-if conditions.
 *
 * - 'always': wraps the condition in `( )` unless it's already a single
 *   `GroupingExpression` (the parser's own node for a parenthesized
 *   sub-expression — structurally unambiguous, unlike the old regex's
 *   `isWrappedInParens` balance-scan of raw text).
 * - 'never': unwraps a condition that IS a `GroupingExpression`, replacing it
 *   with its inner expression's raw text.
 *
 * `IfStatement` and `ElseIfClause` both parse as `[keyword, condition, then?,
 * ...body]` (see parser.ts `parseIfStatement`/`parseElseIfClause`) — the
 * condition is always the first node-kind child, regardless of whether the
 * `then` keyword is present or the if is single-line vs. block-form. That
 * removes the old regex's entire reason for existing: its "no explicit then"
 * branch had to *guess* where the condition ended (skipping lines containing
 * `return` or a bare `=` because it couldn't tell a real condition boundary
 * from body text it had wandered into). Here the parser already drew that
 * boundary, so no guessing is needed for either style.
 */

import { SyntaxNode, SyntaxKind, isNode } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

export function parenthesisIfCasePass(style: 'preserve' | 'always' | 'never'): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];
  const activeStyle = style;

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.IfStatement || node.kind === SyntaxKind.ElseIfClause) {
        processCondition(node, activeStyle, edits, source);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }
    visit(root);

    return edits;
  };
}

function processCondition(
  node: SyntaxNode,
  style: 'always' | 'never',
  edits: TextEdit[],
  source: string,
): void {
  const condition = node.childNodes[0];
  if (!condition) return;

  if (style === 'always') {
    if (condition.kind === SyntaxKind.GroupingExpression) return;
    const start = rawStart(condition);
    const end = rawEnd(condition);
    edits.push({ pos: start, end, newText: `(${rawText(condition, source)})` });
  } else {
    if (condition.kind !== SyntaxKind.GroupingExpression) return;
    const inner = condition.childNodes[0];
    if (!inner) return;
    const start = rawStart(condition);
    const end = rawEnd(condition);
    edits.push({ pos: start, end, newText: rawText(inner, source) });
  }
}

function rawStart(node: SyntaxNode): number {
  let first: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; });
  return first ? first.pos : node.pos;
}

function rawEnd(node: SyntaxNode): number {
  let last: Token | undefined;
  walkTokens(node, (t) => { last = t; });
  return last ? last.end : node.end;
}

function rawText(node: SyntaxNode, source: string): string {
  let first: Token | undefined;
  let last: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; last = t; });
  if (!first || !last) return node.getText().trim();
  return source.slice(first.pos, last.end);
}

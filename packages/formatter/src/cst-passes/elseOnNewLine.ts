/**
 * CST Pass: Else on new line.
 *
 * When `elseOnNewLine` is false, collapses a simple block-form
 * `if ... / stmt / else / stmt / end if` (exactly one statement per branch,
 * no `else if`, no comment anywhere in the statement) onto a single line:
 * `if <cond> then <thenStmt> else <elseStmt>`.
 *
 * `IfStatement`/`ElseClause` node shapes (see parser.ts `parseIfStatement`/
 * `parseElseClause`) make the two structural facts the old regex had to
 * infer from exactly five physical lines directly checkable instead:
 * "exactly one statement in each branch" is a childNodes-length check, and
 * "block form, not single-line-if" is "has an `EndIf` token child" (a
 * single-line `if x then y else z` parses to the same `IfStatement`/
 * `ElseClause` kinds but never gets one). No comment anywhere in the
 * collapsed span is verified directly on trivia, rather than the old
 * regex's per-line `isSimpleStmt`/blank checks.
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode, TriviaKind } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

export function elseOnNewLinePass(elseOnNewLine: boolean): (root: SyntaxNode, source: string) => TextEdit[] {
  if (elseOnNewLine) return () => [];

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.IfStatement) {
        processIfStatement(node, edits, source);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }
    visit(root);

    return edits;
  };
}

function processIfStatement(node: SyntaxNode, edits: TextEdit[], source: string): void {
  const hasEndIf = node.childTokens.some(t => t.kind === TokenKind.EndIf);
  if (!hasEndIf) return; // single-line if — nothing to collapse

  const childNodes = node.childNodes;
  const elseClauseIdx = childNodes.findIndex(c => c.kind === SyntaxKind.ElseClause);
  if (elseClauseIdx === -1) return; // no plain else

  const thenBody = childNodes.slice(1, elseClauseIdx);
  if (thenBody.length !== 1 || thenBody[0].kind === SyntaxKind.ElseIfClause) return;

  const elseClause = childNodes[elseClauseIdx];
  const elseBody = elseClause.childNodes;
  if (elseBody.length !== 1) return;

  if (hasAnyComment(node)) return;

  const condition = childNodes[0];
  const thenStmt = thenBody[0];
  const elseStmt = elseBody[0];

  const ifToken = node.childTokens.find(t => t.kind === TokenKind.If);
  const endIfToken = node.childTokens.find(t => t.kind === TokenKind.EndIf);
  if (!ifToken || !endIfToken) return;

  const collapsed = `if ${rawText(condition, source)} then ${rawText(thenStmt, source)} else ${rawText(elseStmt, source)}`;
  edits.push({ pos: ifToken.pos, end: endIfToken.end, newText: collapsed });
}

/**
 * True if any trivia strictly *inside* the node's span (i.e. excluding the
 * first token's leading trivia and the last token's trailing trivia — those
 * belong to whatever precedes/follows the node, not the node itself) is a
 * `'`/`rem` comment.
 */
function hasAnyComment(node: SyntaxNode): boolean {
  const tokens: Token[] = [];
  walkTokens(node, (t) => { tokens.push(t); });
  const isComment = (tr: { kind: string }) => tr.kind === TriviaKind.Comment || tr.kind === TriviaKind.RemComment;
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0 && tokens[i].leadingTrivia.some(isComment)) return true;
    if (i < tokens.length - 1 && tokens[i].trailingTrivia.some(isComment)) return true;
  }
  return false;
}

function rawText(node: SyntaxNode, source: string): string {
  let first: Token | undefined;
  let last: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; last = t; });
  if (!first || !last) return node.getText().trim();
  return source.slice(first.pos, last.end);
}

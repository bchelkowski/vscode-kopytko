/**
 * CST Pass: Line comment position.
 *
 * 'above': moves a trailing `'` comment (attached as a token's trailing
 * trivia — same-line, after real code) onto its own line directly above the
 * code, preserving the code line's original indentation for both lines.
 *
 * A standalone comment line (nothing but a comment on that physical line)
 * never shows up here: the lexer only attaches a `'` comment as *trailing*
 * trivia when it directly follows a real token on the same line — a
 * comment-only line is captured as *leading* trivia of the next token
 * instead, so it's structurally impossible to mistake one for the other
 * (the old regex needed an explicit "skip pure comment lines" check for
 * exactly this; here it's just not reachable).
 *
 * `rem` comments are never trailing trivia (see lexer.ts `scanTrailingTrivia`
 * — only a `'` comment is captured there), so this pass never touches them,
 * matching the old regex which also only recognized `'` as a movable trailing
 * comment.
 */

import { SyntaxNode, TriviaKind } from 'kopytko-brightscript-parser';
import type { Trivia } from 'kopytko-brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

export function lineCommentPositionPass(style: 'above' | 'inline' | 'preserve'): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style !== 'above') return () => [];

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    const eol = source.includes('\r\n') ? '\r\n' : '\n';

    walkTokens(root, (token) => {
      const commentTrivia = token.trailingTrivia.find((t: Trivia) => t.kind === TriviaKind.Comment);
      if (!commentTrivia) return;

      const wsTrivia = token.trailingTrivia.find((t: Trivia) => t.kind === TriviaKind.Whitespace);
      const lbTrivia = token.trailingTrivia.find((t: Trivia) => t.kind === TriviaKind.LineBreak);
      const lineEnd = lbTrivia ? lbTrivia.text : eol;

      const lineStart = source.lastIndexOf('\n', token.pos - 1) + 1;
      const indentMatch = /^[ \t]*/.exec(source.slice(lineStart));
      const indent = indentMatch ? indentMatch[0] : '';

      // Strip the whitespace-before-comment (if any) and the comment itself
      // off the end of the code line — the comment is moving above.
      edits.push({ pos: wsTrivia ? wsTrivia.pos : commentTrivia.pos, end: commentTrivia.end, newText: '' });
      // Insert the comment as its own line above, at the same indentation.
      edits.push({ pos: lineStart, end: lineStart, newText: indent + commentTrivia.text + lineEnd });
    });

    return edits;
  };
}

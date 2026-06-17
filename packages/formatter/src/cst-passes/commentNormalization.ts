/* eslint-disable @typescript-eslint/no-unused-vars *//**
 * CST Pass: Comment normalization.
 *
 * - Convert between `'` and `rem` comment styles
 * - Ensure a space after the comment marker
 *
 * Unlike the regex version, this pass operates on trivia (comments are trivia
 * in the CST, not tokens), so it cannot accidentally modify code that looks
 * like a comment inside a string literal.
 */

import { SyntaxNode, TriviaKind, isToken, isNode } from 'kopytko-brightscript-parser';
import type { Token, Trivia } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

type CommentStyle = "'" | 'rem' | 'preserve';

interface CommentNormConfig {
  commentStyle: CommentStyle;
  spaceAfterCommentMarker: boolean;
}

/**
 * Creates a comment normalization CST pass.
 * Works on trivia attached to tokens — never touches code or string content.
 */
export function commentNormalizationPass(config: CommentNormConfig): (root: SyntaxNode, source: string) => TextEdit[] {
  if (config.commentStyle === 'preserve' && !config.spaceAfterCommentMarker) {
    return () => [];
  }

  return (root: SyntaxNode, _source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    function processTrivia(trivia: Trivia): void {
      if (trivia.kind !== TriviaKind.Comment && trivia.kind !== TriviaKind.RemComment) return;

      // Skip @import / @mock annotations
      if (/^\s*'\s*@(?:import|mock)\s+/.test(trivia.text)) return;

      const isTickComment = trivia.kind === TriviaKind.Comment;
      const originalText = trivia.text;

      let marker: string;
      let content: string;

      if (isTickComment) {
        marker = "'";
        content = originalText.slice(1); // after '
      } else {
        marker = originalText.slice(0, 3); // 'rem' or 'REM' etc.
        content = originalText.slice(3);
      }

      // Determine target marker
      let targetMarker = marker;
      if (config.commentStyle !== 'preserve') {
        targetMarker = config.commentStyle === "'" ? "'" : 'rem';
      }

      // Determine target content (space after marker)
      let targetContent = content;
      if (config.spaceAfterCommentMarker && targetContent.length > 0 && !targetContent.startsWith(' ')) {
        targetContent = ' ' + targetContent;
      }

      const newText = targetMarker + targetContent;
      if (newText !== originalText) {
        edits.push({ pos: trivia.pos, end: trivia.end, newText });
      }
    }

    // Walk all tokens and process their trivia
    function walkAllTrivia(node: SyntaxNode): void {
      for (const child of node.children) {
        if (isToken(child)) {
          for (const t of child.leadingTrivia) processTrivia(t);
          for (const t of child.trailingTrivia) processTrivia(t);
        } else if (isNode(child)) {
          walkAllTrivia(child);
        }
      }
    }

    walkAllTrivia(root);
    return edits;
  };
}

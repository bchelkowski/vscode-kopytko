/**
 * CST Pass: Trailing whitespace removal.
 *
 * Removes trailing spaces/tabs from the end of lines.
 * Works on whitespace trivia that appears before a LineBreak trivia.
 */

import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

/**
 * Creates a trailing-whitespace-removal pass.
 */
export function trailingWhitespacePass(): (root: SyntaxNode, source: string) => TextEdit[] {
  return (_root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    // Simple approach: find all trailing whitespace before newlines in the source
    const trailingRe = /[ \t]+(?=\r?\n|$)/g;
    let match: RegExpExecArray | null;
    while ((match = trailingRe.exec(source)) !== null) {
      // Don't trim if it's the only content (empty lines are handled by blank line rules)
      edits.push({ pos: match.index, end: match.index + match[0].length, newText: '' });
    }
    return edits;
  };
}

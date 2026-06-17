/* eslint-disable @typescript-eslint/no-unused-vars *//**
 * CST Pass: Blank line normalization.
 *
 * Controls maximum consecutive blank lines and blank lines between functions.
 * Works by finding sequences of LineBreak trivia and trimming excess.
 */

import { SyntaxNode, SyntaxKind, isToken, isNode, TriviaKind } from 'brightscript-parser';
import { TextEdit } from './infrastructure';

interface BlankLineConfig {
  maxEmptyLines: number;
  emptyLinesBetweenFunctions: number;
}

/**
 * Creates a blank-line-normalization pass.
 * Removes excess blank lines based on maxEmptyLines setting.
 */
export function blankLinePass(config: BlankLineConfig): (root: SyntaxNode, source: string) => TextEdit[] {
  if (config.maxEmptyLines === 0 && config.emptyLinesBetweenFunctions === 0) return () => [];

  return (_root: SyntaxNode, source: string): TextEdit[] => {
    if (config.maxEmptyLines === 0) return [];

    const edits: TextEdit[] = [];
    const maxAllowed = config.maxEmptyLines;

    // Find runs of blank lines (3+ consecutive newlines = 2+ blank lines)
    // A "blank line" is a newline followed by optional whitespace and another newline
    const blankRunRe = /(\r?\n)((?:[ \t]*\r?\n){2,})/g;
    let match: RegExpExecArray | null;

    while ((match = blankRunRe.exec(source)) !== null) {
      const fullRun = match[2];
      const lineBreaks = fullRun.split(/\r?\n/).length - 1;

      if (lineBreaks > maxAllowed) {
        // Keep only maxAllowed blank lines
        const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
        const replacement = (lineEnding).repeat(maxAllowed);
        const startPos = match.index + match[1].length;
        edits.push({ pos: startPos, end: startPos + fullRun.length, newText: replacement });
      }
    }

    return edits;
  };
}

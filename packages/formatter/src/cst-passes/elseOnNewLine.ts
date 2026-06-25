// TODO: not yet implemented — placeholder for a future feature.
// The elseOnNewLine config option currently has no effect on formatting output.
import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function elseOnNewLinePass(_keepOnNewLine: boolean): (root: SyntaxNode, source: string) => TextEdit[] {
  return (): TextEdit[] => [];
}

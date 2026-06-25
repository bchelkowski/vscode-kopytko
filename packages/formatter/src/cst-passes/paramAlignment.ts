// TODO: not yet implemented — placeholder for a future feature.
// The paramAlignmentStyle config option currently has no effect on formatting output.
import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function paramAlignmentPass(_style: string): (root: SyntaxNode, source: string) => TextEdit[] {
  return (): TextEdit[] => [];
}

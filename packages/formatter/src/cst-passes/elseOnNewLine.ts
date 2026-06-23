import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function elseOnNewLinePass(keepOnNewLine: boolean): (root: SyntaxNode, source: string) => TextEdit[] {
  if (keepOnNewLine) return () => [];
  return (): TextEdit[] => [];
}

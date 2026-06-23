import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function wrapLongStringsPass(style: string, maxLength: number): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve' || maxLength <= 0) return () => [];
  return (): TextEdit[] => [];
}

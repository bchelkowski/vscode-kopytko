import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function fieldAccessConsistencyPass(style: string): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];
  return (): TextEdit[] => [];
}

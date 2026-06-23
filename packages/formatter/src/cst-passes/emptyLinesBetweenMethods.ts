import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function emptyLinesBetweenMethodsPass(count: number): (root: SyntaxNode, source: string) => TextEdit[] {
  if (count <= 0) return () => [];
  return (): TextEdit[] => [];
}

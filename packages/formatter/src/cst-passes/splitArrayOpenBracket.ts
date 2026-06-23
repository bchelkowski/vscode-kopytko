import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function splitArrayOpenBracketPass(enabled: boolean): (root: SyntaxNode, source: string) => TextEdit[] {
  if (!enabled) return () => [];
  return (): TextEdit[] => [];
}

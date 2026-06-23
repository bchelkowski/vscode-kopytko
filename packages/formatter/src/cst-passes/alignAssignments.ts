import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function alignAssignmentsPass(enabled: boolean): (root: SyntaxNode, source: string) => TextEdit[] {
  if (!enabled) return () => [];
  return (): TextEdit[] => [];
}

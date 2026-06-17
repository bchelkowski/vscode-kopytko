/* eslint-disable @typescript-eslint/no-unused-vars */import type { SyntaxNode } from 'brightscript-parser';
import { TextEdit } from './infrastructure';

export function alignAssignmentsPass(enabled: boolean): (root: SyntaxNode, source: string) => TextEdit[] {
  if (!enabled) return () => [];
  return (_root: SyntaxNode, _source: string): TextEdit[] => {
    return [];
  };
}

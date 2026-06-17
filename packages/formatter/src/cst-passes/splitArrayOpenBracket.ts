/* eslint-disable @typescript-eslint/no-unused-vars */import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function splitArrayOpenBracketPass(enabled: boolean): (root: SyntaxNode, source: string) => TextEdit[] {
  if (!enabled) return () => [];
  return (_root: SyntaxNode, _source: string): TextEdit[] => {
    return [];
  };
}

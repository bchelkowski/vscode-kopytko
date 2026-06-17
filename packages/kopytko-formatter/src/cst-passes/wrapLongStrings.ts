/* eslint-disable @typescript-eslint/no-unused-vars */import type { SyntaxNode } from 'brightscript-parser';
import { TextEdit } from './infrastructure';

export function wrapLongStringsPass(style: string, maxLength: number): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve' || maxLength <= 0) return () => [];
  return (_root: SyntaxNode, _source: string): TextEdit[] => {
    return [];
  };
}

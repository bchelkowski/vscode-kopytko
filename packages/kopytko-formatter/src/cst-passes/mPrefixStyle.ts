/* eslint-disable @typescript-eslint/no-unused-vars */import type { SyntaxNode } from 'brightscript-parser';
import { TextEdit } from './infrastructure';

export function mPrefixStylePass(style: string): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];
  return (_root: SyntaxNode, _source: string): TextEdit[] => {
    return [];
  };
}

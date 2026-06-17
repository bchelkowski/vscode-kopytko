/* eslint-disable @typescript-eslint/no-unused-vars */import type { SyntaxNode } from 'brightscript-parser';
import { TextEdit } from './infrastructure';

export function elseOnNewLinePass(keepOnNewLine: boolean): (root: SyntaxNode, source: string) => TextEdit[] {
  if (keepOnNewLine) return () => [];
  return (_root: SyntaxNode, _source: string): TextEdit[] => {
    return [];
  };
}

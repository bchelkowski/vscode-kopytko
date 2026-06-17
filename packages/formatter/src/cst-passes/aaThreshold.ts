/* eslint-disable @typescript-eslint/no-unused-vars */import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

export function aaThresholdPass(threshold: number): (root: SyntaxNode, source: string) => TextEdit[] {
  if (threshold <= 0) return () => [];
  return (_root: SyntaxNode, _source: string): TextEdit[] => {
    return [];
  };
}

/* eslint-disable @typescript-eslint/no-unused-vars */import { SyntaxNode, SyntaxKind, TokenKind, isToken, isNode } from 'brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

type ObserveStyle = 'always-scoped' | 'warn' | 'preserve';

export function observeFieldStylePass(style: ObserveStyle): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];
  return (root: SyntaxNode, _source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    walkTokens(root, (token) => {
      if (token.kind !== TokenKind.Identifier) return;
      if (style === 'always-scoped' && token.text.toLowerCase() === 'observefield') {
        edits.push({ pos: token.pos, end: token.end, newText: 'observeFieldScoped' });
      }
    });
    return edits;
  };
}

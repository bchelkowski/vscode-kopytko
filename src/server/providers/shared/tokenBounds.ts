import { SyntaxNode, isToken } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';

/** Recursively finds the first token under `node` (depth-first, forward order). */
export function firstToken(node: SyntaxNode): Token | undefined {
  for (const child of node.children) {
    if (isToken(child)) return child;
    const tok = firstToken(child);
    if (tok) return tok;
  }
  return undefined;
}

/** Recursively finds the last token under `node` (depth-first, reverse order). */
export function lastToken(node: SyntaxNode): Token | undefined {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (isToken(child)) return child;
    const tok = lastToken(child);
    if (tok) return tok;
  }
  return undefined;
}

/**
 * SyntaxNode — a node in the lossless Concrete Syntax Tree.
 *
 * Every byte of the original source is represented in the tree. A node's
 * children are an interleaved sequence of child SyntaxNodes and Tokens.
 * Calling `getText()` on the root node reproduces the original source
 * byte-for-byte.
 */

import { SyntaxKind } from './syntaxKind.js';
import { TokenKind } from './tokenKind.js';
import { Token, tokenFullText } from './token.js';

/** A child in the CST is either another node or a token. */
export type SyntaxChild = SyntaxNode | Token;

/** Type guard: is the child a SyntaxNode (not a Token)? */
export function isNode(child: SyntaxChild): child is SyntaxNode {
  return 'kind' in child && 'children' in child;
}

/** Type guard: is the child a Token (not a SyntaxNode)? */
export function isToken(child: SyntaxChild): child is Token {
  return 'kind' in child && !('children' in child);
}

/** Finds the first token in `node`'s subtree (depth-first), or `undefined` for a childless node. */
export function firstToken(node: SyntaxNode): Token | undefined {
  for (const child of node.children) {
    if (isToken(child)) return child;
    const found = firstToken(child);
    if (found) return found;
  }
  return undefined;
}

/** Finds the last token in `node`'s subtree (depth-first), or `undefined` for a childless node. */
export function lastToken(node: SyntaxNode): Token | undefined {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (isToken(child)) return child;
    const found = lastToken(child);
    if (found) return found;
  }
  return undefined;
}

export class SyntaxNode {
  readonly kind: SyntaxKind;
  readonly children: SyntaxChild[];
  parent: SyntaxNode | null = null;
  private _childNodes: SyntaxNode[] | undefined;
  private _childTokens: Token[] | undefined;

  constructor(kind: SyntaxKind, children: SyntaxChild[] = []) {
    this.kind = kind;
    this.children = children;
    // Set parent references — on child nodes, and on child tokens too (a
    // token's `parent` is what lets a position lookup that already found the
    // token recover its ancestor chain without a tree walk; see Token.parent).
    for (const child of children) {
      child.parent = this;
    }
  }

  /**
   * Byte offset of the start of this node (including trivia of first child).
   * Returns `-1` for a childless node — there is no valid position to report,
   * and `0` would silently collide with real content at the start of the file.
   */
  get pos(): number {
    if (this.children.length === 0) return -1;
    const first = this.children[0];
    if (isToken(first)) {
      return first.leadingTrivia.length > 0 ? first.leadingTrivia[0].pos : first.pos;
    }
    return first.pos;
  }

  /**
   * Byte offset just past the end of this node (including trivia of last child).
   * Returns `-1` for a childless node — see `pos`.
   */
  get end(): number {
    if (this.children.length === 0) return -1;
    const last = this.children[this.children.length - 1];
    if (isToken(last)) {
      return last.trailingTrivia.length > 0
        ? last.trailingTrivia[last.trailingTrivia.length - 1].end
        : last.end;
    }
    return last.end;
  }

  /**
   * 0-based line number of the start of this node (including trivia of first
   * child). Returns `-1` for a childless node.
   */
  get line(): number {
    if (this.children.length === 0) return -1;
    const first = this.children[0];
    if (isToken(first)) {
      return first.leadingTrivia.length > 0 ? first.leadingTrivia[0].line : first.line;
    }
    return first.line;
  }

  /**
   * 0-based column of the start of this node (including trivia of first
   * child). Returns `-1` for a childless node.
   */
  get column(): number {
    if (this.children.length === 0) return -1;
    const first = this.children[0];
    if (isToken(first)) {
      return first.leadingTrivia.length > 0 ? first.leadingTrivia[0].column : first.column;
    }
    return first.column;
  }

  /**
   * Reconstructs the full source text of this node and all its descendants,
   * including all trivia. For the root SourceFile node, this reproduces the
   * original source byte-for-byte.
   */
  getText(): string {
    const chunks: string[] = [];
    this.appendText(chunks);
    return chunks.join('');
  }

  private appendText(chunks: string[]): void {
    for (const child of this.children) {
      if (isToken(child)) {
        chunks.push(tokenFullText(child));
      } else {
        child.appendText(chunks);
      }
    }
  }

  /** Finds the first direct child node with the given SyntaxKind, or undefined. */
  findChild(kind: SyntaxKind): SyntaxNode | undefined {
    for (const child of this.children) {
      if (isNode(child) && child.kind === kind) return child;
    }
    return undefined;
  }

  /** Finds all direct child nodes with the given SyntaxKind. */
  findAllChildren(kind: SyntaxKind): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    for (const child of this.children) {
      if (isNode(child) && child.kind === kind) result.push(child);
    }
    return result;
  }

  /** Finds the first direct child token with the given TokenKind, or undefined. */
  findToken(kind: TokenKind): Token | undefined {
    for (const child of this.children) {
      if (isToken(child) && child.kind === kind) return child;
    }
    return undefined;
  }

  /** Finds all direct child tokens with the given TokenKind. */
  findAllTokens(kind: TokenKind): Token[] {
    const result: Token[] = [];
    for (const child of this.children) {
      if (isToken(child) && child.kind === kind) result.push(child);
    }
    return result;
  }

  /** Returns all direct child nodes (filtering out tokens). */
  get childNodes(): SyntaxNode[] {
    return this._childNodes ??= this.children.filter(isNode);
  }

  /** Returns all direct child tokens (filtering out nodes). */
  get childTokens(): Token[] {
    return this._childTokens ??= this.children.filter(isToken);
  }
}

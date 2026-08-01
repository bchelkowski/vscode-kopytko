/**
 * XmlSyntaxNode — a node in the lossless SceneGraph XML CST. Mirrors
 * `../syntaxNode.ts`: children are an interleaved sequence of nodes and
 * tokens, and `getText()` on the root reproduces the original source
 * byte-for-byte.
 */

import { XmlSyntaxKind } from './xmlSyntaxKind.js';
import { XmlTokenKind } from './xmlTokenKind.js';
import { XmlToken, xmlTokenFullText } from './xmlToken.js';

export type XmlSyntaxChild = XmlSyntaxNode | XmlToken;

export function isXmlNode(child: XmlSyntaxChild): child is XmlSyntaxNode {
  return 'kind' in child && 'children' in child;
}

export function isXmlToken(child: XmlSyntaxChild): child is XmlToken {
  return 'kind' in child && !('children' in child);
}

export class XmlSyntaxNode {
  readonly kind: XmlSyntaxKind;
  readonly children: XmlSyntaxChild[];
  parent: XmlSyntaxNode | null = null;
  private _childNodes: XmlSyntaxNode[] | undefined;
  private _childTokens: XmlToken[] | undefined;

  constructor(kind: XmlSyntaxKind, children: XmlSyntaxChild[] = []) {
    this.kind = kind;
    this.children = children;
    for (const child of children) {
      child.parent = this;
    }
  }

  get pos(): number {
    if (this.children.length === 0) return -1;
    const first = this.children[0];
    if (isXmlToken(first)) {
      return first.leadingTrivia.length > 0 ? first.leadingTrivia[0].pos : first.pos;
    }
    return first.pos;
  }

  get end(): number {
    if (this.children.length === 0) return -1;
    const last = this.children[this.children.length - 1];
    if (isXmlToken(last)) {
      return last.trailingTrivia.length > 0
        ? last.trailingTrivia[last.trailingTrivia.length - 1].end
        : last.end;
    }
    return last.end;
  }

  get line(): number {
    if (this.children.length === 0) return -1;
    const first = this.children[0];
    if (isXmlToken(first)) {
      return first.leadingTrivia.length > 0 ? first.leadingTrivia[0].line : first.line;
    }
    return first.line;
  }

  get column(): number {
    if (this.children.length === 0) return -1;
    const first = this.children[0];
    if (isXmlToken(first)) {
      return first.leadingTrivia.length > 0 ? first.leadingTrivia[0].column : first.column;
    }
    return first.column;
  }

  getText(): string {
    const chunks: string[] = [];
    this.appendText(chunks);
    return chunks.join('');
  }

  private appendText(chunks: string[]): void {
    for (const child of this.children) {
      if (isXmlToken(child)) {
        chunks.push(xmlTokenFullText(child));
      } else {
        child.appendText(chunks);
      }
    }
  }

  findChild(kind: XmlSyntaxKind): XmlSyntaxNode | undefined {
    for (const child of this.children) {
      if (isXmlNode(child) && child.kind === kind) return child;
    }
    return undefined;
  }

  findAllChildren(kind: XmlSyntaxKind): XmlSyntaxNode[] {
    const result: XmlSyntaxNode[] = [];
    for (const child of this.children) {
      if (isXmlNode(child) && child.kind === kind) result.push(child);
    }
    return result;
  }

  findToken(kind: XmlTokenKind): XmlToken | undefined {
    for (const child of this.children) {
      if (isXmlToken(child) && child.kind === kind) return child;
    }
    return undefined;
  }

  get childNodes(): XmlSyntaxNode[] {
    return this._childNodes ??= this.children.filter(isXmlNode);
  }

  get childTokens(): XmlToken[] {
    return this._childTokens ??= this.children.filter(isXmlToken);
  }
}

/** Finds the first token in `node`'s subtree (depth-first), or `undefined` for a childless node. */
export function firstXmlToken(node: XmlSyntaxNode): XmlToken | undefined {
  for (const child of node.children) {
    if (isXmlToken(child)) return child;
    const found = firstXmlToken(child);
    if (found) return found;
  }
  return undefined;
}

/** Finds the last token in `node`'s subtree (depth-first), or `undefined` for a childless node. */
export function lastXmlToken(node: XmlSyntaxNode): XmlToken | undefined {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (isXmlToken(child)) return child;
    const found = lastXmlToken(child);
    if (found) return found;
  }
  return undefined;
}

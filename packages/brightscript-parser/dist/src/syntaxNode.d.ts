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
import { Token } from './token.js';
/** A child in the CST is either another node or a token. */
export type SyntaxChild = SyntaxNode | Token;
/** Type guard: is the child a SyntaxNode (not a Token)? */
export declare function isNode(child: SyntaxChild): child is SyntaxNode;
/** Type guard: is the child a Token (not a SyntaxNode)? */
export declare function isToken(child: SyntaxChild): child is Token;
export declare class SyntaxNode {
    readonly kind: SyntaxKind;
    readonly children: SyntaxChild[];
    parent: SyntaxNode | null;
    constructor(kind: SyntaxKind, children?: SyntaxChild[]);
    /** Byte offset of the start of this node (including trivia of first child). */
    get pos(): number;
    /** Byte offset just past the end of this node (including trivia of last child). */
    get end(): number;
    /**
     * Reconstructs the full source text of this node and all its descendants,
     * including all trivia. For the root SourceFile node, this reproduces the
     * original source byte-for-byte.
     */
    getText(): string;
    /** Finds the first direct child node with the given SyntaxKind, or undefined. */
    findChild(kind: SyntaxKind): SyntaxNode | undefined;
    /** Finds all direct child nodes with the given SyntaxKind. */
    findAllChildren(kind: SyntaxKind): SyntaxNode[];
    /** Finds the first direct child token with the given TokenKind, or undefined. */
    findToken(kind: TokenKind): Token | undefined;
    /** Finds all direct child tokens with the given TokenKind. */
    findAllTokens(kind: TokenKind): Token[];
    /** Returns all direct child nodes (filtering out tokens). */
    get childNodes(): SyntaxNode[];
    /** Returns all direct child tokens (filtering out nodes). */
    get childTokens(): Token[];
}
//# sourceMappingURL=syntaxNode.d.ts.map
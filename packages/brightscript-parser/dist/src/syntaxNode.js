"use strict";
/**
 * SyntaxNode — a node in the lossless Concrete Syntax Tree.
 *
 * Every byte of the original source is represented in the tree. A node's
 * children are an interleaved sequence of child SyntaxNodes and Tokens.
 * Calling `getText()` on the root node reproduces the original source
 * byte-for-byte.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyntaxNode = void 0;
exports.isNode = isNode;
exports.isToken = isToken;
const token_js_1 = require("./token.js");
/** Type guard: is the child a SyntaxNode (not a Token)? */
function isNode(child) {
    return 'kind' in child && 'children' in child;
}
/** Type guard: is the child a Token (not a SyntaxNode)? */
function isToken(child) {
    return 'kind' in child && !('children' in child);
}
class SyntaxNode {
    kind;
    children;
    parent = null;
    constructor(kind, children = []) {
        this.kind = kind;
        this.children = children;
        // Set parent references
        for (const child of children) {
            if (isNode(child)) {
                child.parent = this;
            }
        }
    }
    /** Byte offset of the start of this node (including trivia of first child). */
    get pos() {
        if (this.children.length === 0)
            return 0;
        const first = this.children[0];
        if (isToken(first)) {
            return first.leadingTrivia.length > 0 ? first.leadingTrivia[0].pos : first.pos;
        }
        return first.pos;
    }
    /** Byte offset just past the end of this node (including trivia of last child). */
    get end() {
        if (this.children.length === 0)
            return 0;
        const last = this.children[this.children.length - 1];
        if (isToken(last)) {
            return last.trailingTrivia.length > 0
                ? last.trailingTrivia[last.trailingTrivia.length - 1].end
                : last.end;
        }
        return last.end;
    }
    /**
     * Reconstructs the full source text of this node and all its descendants,
     * including all trivia. For the root SourceFile node, this reproduces the
     * original source byte-for-byte.
     */
    getText() {
        let result = '';
        for (const child of this.children) {
            if (isToken(child)) {
                result += (0, token_js_1.tokenFullText)(child);
            }
            else {
                result += child.getText();
            }
        }
        return result;
    }
    /** Finds the first direct child node with the given SyntaxKind, or undefined. */
    findChild(kind) {
        for (const child of this.children) {
            if (isNode(child) && child.kind === kind)
                return child;
        }
        return undefined;
    }
    /** Finds all direct child nodes with the given SyntaxKind. */
    findAllChildren(kind) {
        const result = [];
        for (const child of this.children) {
            if (isNode(child) && child.kind === kind)
                result.push(child);
        }
        return result;
    }
    /** Finds the first direct child token with the given TokenKind, or undefined. */
    findToken(kind) {
        for (const child of this.children) {
            if (isToken(child) && child.kind === kind)
                return child;
        }
        return undefined;
    }
    /** Finds all direct child tokens with the given TokenKind. */
    findAllTokens(kind) {
        const result = [];
        for (const child of this.children) {
            if (isToken(child) && child.kind === kind)
                result.push(child);
        }
        return result;
    }
    /** Returns all direct child nodes (filtering out tokens). */
    get childNodes() {
        return this.children.filter(isNode);
    }
    /** Returns all direct child tokens (filtering out nodes). */
    get childTokens() {
        return this.children.filter(isToken);
    }
}
exports.SyntaxNode = SyntaxNode;
//# sourceMappingURL=syntaxNode.js.map
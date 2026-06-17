/**
 * Position-based CST node lookup.
 *
 * Given a cursor position (line, column), finds the deepest CST node
 * and token at that position. This is the foundation for all LSP features
 * that need context at the cursor: hover, go-to-definition, completion,
 * signature help, rename, references.
 */
import { SyntaxNode } from '../syntaxNode.js';
import { Token } from '../token.js';
export interface NodeAtPosition {
    /** The deepest SyntaxNode containing the position. */
    node: SyntaxNode;
    /** The specific token at the position, if any. */
    token: Token | undefined;
    /** The chain of ancestor nodes from root to the deepest node. */
    ancestors: SyntaxNode[];
}
/**
 * Finds the deepest CST node at the given line and column.
 *
 * @param root - The root SourceFile node.
 * @param line - 0-based line number.
 * @param column - 0-based column (character offset within line).
 * @returns The node, token, and ancestor chain at the position, or null if not found.
 */
export declare function findNodeAtPosition(root: SyntaxNode, line: number, column: number): NodeAtPosition | null;
/**
 * Finds the token at the given line and column by scanning all tokens.
 * Simpler than findNodeAtPosition — just returns the token, no ancestors.
 */
export declare function findTokenAtPosition(root: SyntaxNode, line: number, column: number): Token | undefined;
/**
 * Gets the identifier word at the given position in a line of text.
 * Returns the word and its start/end columns, or null if not on an identifier.
 *
 * This replaces the regex-based `getWord` / `getWordInfo` in textUtils.
 */
export declare function getWordAtPosition(line: string, column: number): {
    word: string;
    start: number;
    end: number;
} | null;
/**
 * Escapes special regex characters in a string.
 * Shared utility used by linter rules and LSP providers.
 */
export declare function escapeRegex(str: string): string;
//# sourceMappingURL=position.d.ts.map
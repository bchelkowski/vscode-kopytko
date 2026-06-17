/**
 * Token — a single lexical unit produced by the BrightScript lexer.
 *
 * Each token carries its original source text, position information, and
 * any trivia (whitespace / comments) attached to it. Together, the token
 * stream forms a lossless representation of the source: concatenating all
 * leading trivia, token text, and trailing trivia reproduces the original
 * source byte-for-byte.
 */
import { TokenKind } from './tokenKind.js';
import { Trivia } from './trivia.js';
export interface Token {
    readonly kind: TokenKind;
    /** The original source text of this token (preserving original casing). */
    readonly text: string;
    /** Byte offset in the source where this token starts (excluding leading trivia). */
    readonly pos: number;
    /** Byte offset just past the end of this token (excluding trailing trivia). */
    readonly end: number;
    /** 0-based line number of the token start. */
    readonly line: number;
    /** 0-based column (character offset within the line) of the token start. */
    readonly column: number;
    /** Whitespace / comments that appear before this token. */
    readonly leadingTrivia: readonly Trivia[];
    /** Whitespace / comments that appear after this token on the same line. */
    readonly trailingTrivia: readonly Trivia[];
}
/**
 * Reconstructs the full source text for a single token including its trivia.
 * Useful for round-trip fidelity verification.
 */
export declare function tokenFullText(token: Token): string;
/**
 * Reconstructs the full source text from a complete token array.
 * Must produce the exact original source for a correct lexer.
 */
export declare function tokensToText(tokens: readonly Token[]): string;
//# sourceMappingURL=token.d.ts.map
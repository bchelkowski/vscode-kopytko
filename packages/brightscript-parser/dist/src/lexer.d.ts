/**
 * Hand-written BrightScript lexer.
 *
 * Converts a source string into a lossless token stream. Every byte of the
 * source is represented — either as a token's `text` or as trivia attached
 * to a token. Concatenating `tokenFullText()` for every token in the output
 * reproduces the original source byte-for-byte.
 *
 * BrightScript syntax reference:
 * - https://developer.roku.com/dev/docs/expressions-variables-types
 * - https://developer.roku.com/dev/docs/program-statements
 * - https://developer.roku.com/dev/docs/reserved-words
 * - https://developer.roku.com/dev/docs/conditional-compilation
 */
import { Token } from './token.js';
/**
 * Tokenizes BrightScript source code into a lossless token stream.
 *
 * @param source - The complete BrightScript source text.
 * @returns An array of tokens with attached trivia.
 */
export declare function tokenize(source: string): Token[];
//# sourceMappingURL=lexer.d.ts.map
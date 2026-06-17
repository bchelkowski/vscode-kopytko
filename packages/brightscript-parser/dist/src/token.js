"use strict";
/**
 * Token — a single lexical unit produced by the BrightScript lexer.
 *
 * Each token carries its original source text, position information, and
 * any trivia (whitespace / comments) attached to it. Together, the token
 * stream forms a lossless representation of the source: concatenating all
 * leading trivia, token text, and trailing trivia reproduces the original
 * source byte-for-byte.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenFullText = tokenFullText;
exports.tokensToText = tokensToText;
/**
 * Reconstructs the full source text for a single token including its trivia.
 * Useful for round-trip fidelity verification.
 */
function tokenFullText(token) {
    let result = '';
    for (const t of token.leadingTrivia)
        result += t.text;
    result += token.text;
    for (const t of token.trailingTrivia)
        result += t.text;
    return result;
}
/**
 * Reconstructs the full source text from a complete token array.
 * Must produce the exact original source for a correct lexer.
 */
function tokensToText(tokens) {
    let result = '';
    for (const token of tokens) {
        result += tokenFullText(token);
    }
    return result;
}
//# sourceMappingURL=token.js.map
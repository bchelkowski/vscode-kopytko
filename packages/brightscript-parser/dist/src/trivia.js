"use strict";
/**
 * Trivia — whitespace and comments that appear between (or around) tokens.
 *
 * In a lossless CST every byte of the original source must be represented.
 * Trivia is the mechanism for preserving whitespace and comments without
 * polluting the structural token stream.
 *
 * Trivia is attached to the nearest *significant* token:
 * - Leading trivia:  whitespace / comments that appear *before* a token,
 *                    starting from the previous token's trailing trivia end.
 * - Trailing trivia: whitespace / comments that appear *after* a token on
 *                    the *same* line (up to and including the line break).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TriviaKind = void 0;
var TriviaKind;
(function (TriviaKind) {
    /** Horizontal whitespace: spaces and tabs (no line breaks). */
    TriviaKind["Whitespace"] = "Whitespace";
    /** One line break: `\n` or `\r\n`. */
    TriviaKind["LineBreak"] = "LineBreak";
    /** Tick comment: starts with `'`, extends to end of line (not including line break). */
    TriviaKind["Comment"] = "Comment";
    /** REM comment: starts with `rem` (as a statement, not inside an identifier), extends to end of line. */
    TriviaKind["RemComment"] = "RemComment";
})(TriviaKind || (exports.TriviaKind = TriviaKind = {}));
//# sourceMappingURL=trivia.js.map
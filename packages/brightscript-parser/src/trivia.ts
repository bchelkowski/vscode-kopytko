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

export enum TriviaKind {
  /** Horizontal whitespace: spaces and tabs (no line breaks). */
  Whitespace = 'Whitespace',
  /** One line break: `\n` or `\r\n`. */
  LineBreak = 'LineBreak',
  /** Tick comment: starts with `'`, extends to end of line (not including line break). */
  Comment = 'Comment',
  /** REM comment: starts with `rem` (as a statement, not inside an identifier), extends to end of line. */
  RemComment = 'RemComment',
}

export interface Trivia {
  readonly kind: TriviaKind;
  /** The original source text of this trivia piece. */
  readonly text: string;
  /** Byte offset in the source where this trivia starts. */
  readonly pos: number;
  /** Byte offset just past the end of this trivia. */
  readonly end: number;
  /** 0-based line number of the trivia start. */
  readonly line: number;
  /** 0-based column (character offset within the line) of the trivia start. */
  readonly column: number;
}

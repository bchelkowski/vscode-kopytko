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

import { TokenKind, KEYWORD_MAP } from './tokenKind.js';
import { TriviaKind, Trivia } from './trivia.js';
import { Token } from './token.js';

// ─── Character classification helpers ───────────────────────────────────────

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t';
}

// ─── Lexer state ────────────────────────────────────────────────────────────

/**
 * Tokenizes BrightScript source code into a lossless token stream.
 *
 * @param source - The complete BrightScript source text.
 * @returns An array of tokens with attached trivia.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const len = source.length;

  /** Current byte offset in source. */
  let pos = 0;
  /** Current 0-based line number. */
  let line = 0;
  /** Current 0-based column. */
  let column = 0;

  // ── Position helpers ──────────────────────────────────────────────────

  function _peek(): string {
    return pos < len ? source[pos] : '';
  }

  function _peekAt(offset: number): string {
    const idx = pos + offset;
    return idx < len ? source[idx] : '';
  }

  function advance(): string {
    const ch = source[pos];
    pos++;
    if (ch === '\n') {
      line++;
      column = 0;
    } else if (ch === '\r') {
      // Don't bump line here — the \n that follows (if CRLF) will do it.
      // For bare \r (old Mac style) we do bump.
      if (pos < len && source[pos] === '\n') {
        // CRLF — handled together in scanLineBreak
      } else {
        line++;
        column = 0;
      }
    } else {
      column++;
    }
    return ch;
  }

  // ── Trivia scanning ───────────────────────────────────────────────────

  function scanWhitespace(): Trivia {
    const start = pos;
    while (pos < len && isWhitespace(source[pos])) {
      advance();
    }
    return { kind: TriviaKind.Whitespace, text: source.slice(start, pos), pos: start, end: pos };
  }

  function scanLineBreak(): Trivia {
    const start = pos;
    if (source[pos] === '\r') {
      advance();
      if (pos < len && source[pos] === '\n') {
        advance();
      }
    } else {
      advance(); // \n
    }
    return { kind: TriviaKind.LineBreak, text: source.slice(start, pos), pos: start, end: pos };
  }

  function scanTickComment(): Trivia {
    const start = pos;
    advance(); // consume '
    while (pos < len && source[pos] !== '\n' && source[pos] !== '\r') {
      advance();
    }
    return { kind: TriviaKind.Comment, text: source.slice(start, pos), pos: start, end: pos };
  }

  function scanRemComment(): Trivia {
    const start = pos;
    // consume 'rem' — we already know it matches
    advance(); advance(); advance();
    while (pos < len && source[pos] !== '\n' && source[pos] !== '\r') {
      advance();
    }
    return { kind: TriviaKind.RemComment, text: source.slice(start, pos), pos: start, end: pos };
  }

  /**
   * Returns true if the current position starts a `rem` comment.
   * REM is a comment only when it appears as a statement (preceded by
   * line start, whitespace, or `:`) and is followed by a space, newline, or EOF.
   */
  function isRemComment(): boolean {
    if (pos + 2 >= len) {
      // Could be exactly "rem" at EOF
      if (pos + 2 === len) {
        const word = source.slice(pos, pos + 3);
        if (word.toLowerCase() !== 'rem') return false;
        // "rem" at EOF — is it preceded by line-start / whitespace / colon?
        return isStatementStart();
      }
      return false;
    }
    const word = source.slice(pos, pos + 3);
    if (word.toLowerCase() !== 'rem') return false;
    // Must be followed by non-alphanumeric (space, newline, EOF, etc.)
    const after = source[pos + 3];
    if (after !== undefined && isAlphaNumeric(after)) return false;
    return isStatementStart();
  }

  /** Checks that we are at the start of a statement (beginning of line, after whitespace, or after `:`). */
  function isStatementStart(): boolean {
    if (pos === 0) return true;
    const before = source[pos - 1];
    return before === '\n' || before === '\r' || before === ':' || isWhitespace(before);
  }

  /**
   * Scans leading trivia — all whitespace, line breaks, and comments that
   * appear before the next significant token.
   */
  function scanLeadingTrivia(): Trivia[] {
    const trivia: Trivia[] = [];
    while (pos < len) {
      const ch = source[pos];
      if (isWhitespace(ch)) {
        trivia.push(scanWhitespace());
      } else if (ch === '\n' || ch === '\r') {
        trivia.push(scanLineBreak());
      } else if (ch === "'") {
        trivia.push(scanTickComment());
      } else if (isRemComment()) {
        trivia.push(scanRemComment());
      } else {
        break;
      }
    }
    return trivia;
  }

  /**
   * Scans trailing trivia — whitespace and a single comment on the same line
   * after a token, up to and including the line break.
   */
  function scanTrailingTrivia(): Trivia[] {
    const trivia: Trivia[] = [];
    // Consume horizontal whitespace
    if (pos < len && isWhitespace(source[pos])) {
      trivia.push(scanWhitespace());
    }
    // Consume an optional tick comment
    if (pos < len && source[pos] === "'") {
      trivia.push(scanTickComment());
    }
    // Consume the line break (belongs to trailing trivia of this token)
    if (pos < len && (source[pos] === '\n' || source[pos] === '\r')) {
      trivia.push(scanLineBreak());
    }
    return trivia;
  }

  // ── Token scanning ────────────────────────────────────────────────────

  function scanString(): Token {
    const start = pos;
    const startLine = line;
    const startCol = column;
    advance(); // consume opening "
    while (pos < len) {
      if (source[pos] === '"') {
        advance();
        // Escaped quote: "" inside a string
        if (pos < len && source[pos] === '"') {
          advance();
          continue;
        }
        // End of string
        return makeToken(TokenKind.StringLiteral, start, startLine, startCol);
      }
      if (source[pos] === '\n' || source[pos] === '\r') {
        // Unterminated string — stop at newline
        break;
      }
      advance();
    }
    // Unterminated string
    return makeToken(TokenKind.StringLiteral, start, startLine, startCol);
  }

  /**
   * Scans a numeric literal. BrightScript supports:
   * - Integer:     255, 125%
   * - LongInteger: 9876543210&, &hABCD&
   * - Float:       2.01, 1.23E+5, 2!
   * - Double:      1.23D-12, 2.3#
   * - Hex:         &HFF, &hABCD (integer), &hABCD& (long integer)
   */
  function scanNumber(): Token {
    const start = pos;
    const startLine = line;
    const startCol = column;

    // Hex literal: &H... or &h...
    if (source[pos] === '&' && pos + 1 < len && (source[pos + 1] === 'H' || source[pos + 1] === 'h')) {
      advance(); advance(); // &H
      while (pos < len && isHexDigit(source[pos])) advance();
      // Trailing & for LongInteger
      if (pos < len && source[pos] === '&') {
        advance();
        return makeToken(TokenKind.LongIntegerLiteral, start, startLine, startCol);
      }
      return makeToken(TokenKind.IntegerLiteral, start, startLine, startCol);
    }

    // Decimal / float / double
    while (pos < len && isDigit(source[pos])) advance();

    let isFloat = false;
    let isDouble = false;

    // Decimal point
    if (pos < len && source[pos] === '.') {
      // Only if followed by a digit (otherwise it's a dot operator)
      if (pos + 1 < len && isDigit(source[pos + 1])) {
        advance(); // .
        while (pos < len && isDigit(source[pos])) advance();
        isFloat = true;
      } else if (pos + 1 >= len || !isAlpha(source[pos + 1])) {
        // Bare trailing dot like `2.` — treat as float
        advance();
        isFloat = true;
      }
    }

    // Exponent: E/e (float) or D/d (double)
    if (pos < len && (source[pos] === 'E' || source[pos] === 'e')) {
      advance();
      if (pos < len && (source[pos] === '+' || source[pos] === '-')) advance();
      while (pos < len && isDigit(source[pos])) advance();
      isFloat = true;
    } else if (pos < len && (source[pos] === 'D' || source[pos] === 'd')) {
      // D exponent is only valid if followed by +, -, or digit (not an identifier like `dim`)
      if (pos + 1 < len && (source[pos + 1] === '+' || source[pos + 1] === '-' || isDigit(source[pos + 1]))) {
        advance();
        if (pos < len && (source[pos] === '+' || source[pos] === '-')) advance();
        while (pos < len && isDigit(source[pos])) advance();
        isDouble = true;
      }
    }

    // Type designator suffix
    if (pos < len) {
      if (source[pos] === '#') {
        advance();
        isDouble = true;
      } else if (source[pos] === '!') {
        advance();
        isFloat = true;
      } else if (source[pos] === '&') {
        advance();
        return makeToken(TokenKind.LongIntegerLiteral, start, startLine, startCol);
      } else if (source[pos] === '%') {
        advance();
        return makeToken(TokenKind.IntegerLiteral, start, startLine, startCol);
      }
    }

    if (isDouble) return makeToken(TokenKind.DoubleLiteral, start, startLine, startCol);
    if (isFloat) return makeToken(TokenKind.FloatLiteral, start, startLine, startCol);
    return makeToken(TokenKind.IntegerLiteral, start, startLine, startCol);
  }

  /**
   * Scans an identifier or keyword.
   * BrightScript identifiers: start with [a-zA-Z_], followed by [a-zA-Z0-9_].
   * May end with a type designator ($, %, !, #, &).
   */
  function scanIdentifierOrKeyword(): Token {
    const start = pos;
    const startLine = line;
    const startCol = column;

    while (pos < len && isAlphaNumeric(source[pos])) {
      advance();
    }

    // Type designator suffix on identifier
    if (pos < len && '$%!#&'.includes(source[pos])) {
      advance();
      // Type-designated identifiers are never keywords
      return makeToken(TokenKind.Identifier, start, startLine, startCol);
    }

    const text = source.slice(start, pos);
    const lower = text.toLowerCase();

    // Check for two-word compound keywords: "end if", "end function", "end sub",
    // "end while", "end for", "end try", "exit while", "exit for",
    // "else if", "continue for", "continue while"
    if (lower === 'end' || lower === 'else' || lower === 'exit' || lower === 'continue') {
      const compound = tryCompoundKeyword(lower, start, startLine, startCol);
      if (compound) return compound;
    }

    // Single-word keyword lookup
    const kwKind = KEYWORD_MAP.get(lower);
    if (kwKind !== undefined) {
      return makeToken(kwKind, start, startLine, startCol);
    }

    return makeToken(TokenKind.Identifier, start, startLine, startCol);
  }

  /**
   * Attempts to scan a two-word compound keyword (e.g. "end if", "else if").
   * If the second word matches, the compound token is returned.
   * Otherwise, returns null and the lexer position stays at end of first word.
   */
  function tryCompoundKeyword(firstWord: string, start: number, startLine: number, startCol: number): Token | null {
    const savedPos = pos;
    const savedLine = line;
    const savedCol = column;

    // Must be followed by whitespace then a keyword
    const gapStart = pos;
    while (pos < len && isWhitespace(source[pos])) advance();
    if (pos === gapStart) return null; // no whitespace — not compound

    // Read the second word
    const secondStart = pos;
    while (pos < len && isAlphaNumeric(source[pos])) advance();
    if (pos === secondStart) {
      // No second word — revert
      pos = savedPos; line = savedLine; column = savedCol;
      return null;
    }

    const secondWord = source.slice(secondStart, pos).toLowerCase();
    const compound = firstWord + secondWord;
    const kwKind = KEYWORD_MAP.get(compound);

    if (kwKind !== undefined) {
      return makeToken(kwKind, start, startLine, startCol);
    }

    // Special: "end try" → EndTry, "exit for" → ExitFor (not in keyword map as single)
    // "continue for" / "continue while" are not compound keywords — they are two separate tokens.
    // "exit for" is two separate tokens as well ("exit" + "for").

    // Not a compound keyword — revert
    pos = savedPos;
    line = savedLine;
    column = savedCol;
    return null;
  }

  /**
   * Scans a conditional compilation directive: #if, #else, #else if, #end if,
   * #endif, #elseif, #const, #error.
   */
  function scanPreprocessor(): Token {
    const start = pos;
    const startLine = line;
    const startCol = column;

    advance(); // consume #

    // Read the directive word
    const wordStart = pos;
    while (pos < len && isAlpha(source[pos])) advance();
    const word = source.slice(wordStart, pos).toLowerCase();

    if (word === 'if') return makeToken(TokenKind.HashIf, start, startLine, startCol);
    if (word === 'const') return makeToken(TokenKind.HashConst, start, startLine, startCol);
    if (word === 'error') {
      // #error consumes the rest of the line as its message
      while (pos < len && source[pos] !== '\n' && source[pos] !== '\r') advance();
      return makeToken(TokenKind.HashError, start, startLine, startCol);
    }

    if (word === 'else') {
      // Could be "#else" or "#else if"
      const savedPos2 = pos;
      const savedLine2 = line;
      const savedCol2 = column;
      while (pos < len && isWhitespace(source[pos])) advance();
      const w2Start = pos;
      while (pos < len && isAlpha(source[pos])) advance();
      const w2 = source.slice(w2Start, pos).toLowerCase();
      if (w2 === 'if') return makeToken(TokenKind.HashElseIf, start, startLine, startCol);
      // Plain #else — revert past whitespace + word
      pos = savedPos2; line = savedLine2; column = savedCol2;
      return makeToken(TokenKind.HashElse, start, startLine, startCol);
    }

    if (word === 'elseif') return makeToken(TokenKind.HashElseIf, start, startLine, startCol);

    if (word === 'end') {
      // Could be "#end if" or "#endif"
      const savedPos2 = pos;
      const savedLine2 = line;
      const savedCol2 = column;
      while (pos < len && isWhitespace(source[pos])) advance();
      const w2Start = pos;
      while (pos < len && isAlpha(source[pos])) advance();
      const w2 = source.slice(w2Start, pos).toLowerCase();
      if (w2 === 'if') return makeToken(TokenKind.HashEndIf, start, startLine, startCol);
      pos = savedPos2; line = savedLine2; column = savedCol2;
      return makeToken(TokenKind.Unknown, start, startLine, startCol);
    }

    if (word === 'endif') return makeToken(TokenKind.HashEndIf, start, startLine, startCol);

    // Unknown preprocessor directive
    return makeToken(TokenKind.Unknown, start, startLine, startCol);
  }

  // ── Operator / punctuation scanning ───────────────────────────────────

  function scanOperatorOrPunctuation(): Token {
    const start = pos;
    const startLine = line;
    const startCol = column;
    const ch = source[pos];

    switch (ch) {
      case '(': advance(); return makeToken(TokenKind.LeftParen, start, startLine, startCol);
      case ')': advance(); return makeToken(TokenKind.RightParen, start, startLine, startCol);
      case '[': advance(); return makeToken(TokenKind.LeftBracket, start, startLine, startCol);
      case ']': advance(); return makeToken(TokenKind.RightBracket, start, startLine, startCol);
      case '{': advance(); return makeToken(TokenKind.LeftBrace, start, startLine, startCol);
      case '}': advance(); return makeToken(TokenKind.RightBrace, start, startLine, startCol);
      case ',': advance(); return makeToken(TokenKind.Comma, start, startLine, startCol);
      case ':': advance(); return makeToken(TokenKind.Colon, start, startLine, startCol);
      case ';': advance(); return makeToken(TokenKind.Semicolon, start, startLine, startCol);
      case '@': advance(); return makeToken(TokenKind.At, start, startLine, startCol);
      case '^': advance(); return makeToken(TokenKind.Caret, start, startLine, startCol);
      case '\\':
        advance();
        if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.BackslashEqual, start, startLine, startCol); }
        return makeToken(TokenKind.Backslash, start, startLine, startCol);
      case '.':
        // Could be a decimal number starting with .
        if (pos + 1 < len && isDigit(source[pos + 1])) return scanNumber();
        advance();
        return makeToken(TokenKind.Dot, start, startLine, startCol);
      case '+':
        advance();
        if (pos < len && source[pos] === '+') { advance(); return makeToken(TokenKind.PlusPlus, start, startLine, startCol); }
        if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.PlusEqual, start, startLine, startCol); }
        return makeToken(TokenKind.Plus, start, startLine, startCol);
      case '-':
        advance();
        if (pos < len && source[pos] === '-') { advance(); return makeToken(TokenKind.MinusMinus, start, startLine, startCol); }
        if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.MinusEqual, start, startLine, startCol); }
        return makeToken(TokenKind.Minus, start, startLine, startCol);
      case '*':
        advance();
        if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.StarEqual, start, startLine, startCol); }
        return makeToken(TokenKind.Star, start, startLine, startCol);
      case '/':
        advance();
        if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.SlashEqual, start, startLine, startCol); }
        return makeToken(TokenKind.Slash, start, startLine, startCol);
      case '=':
        advance();
        return makeToken(TokenKind.Equal, start, startLine, startCol);
      case '<':
        advance();
        if (pos < len && source[pos] === '>') { advance(); return makeToken(TokenKind.LessGreater, start, startLine, startCol); }
        if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.LessEqual, start, startLine, startCol); }
        if (pos < len && source[pos] === '<') {
          advance();
          if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.LeftShiftEqual, start, startLine, startCol); }
          return makeToken(TokenKind.LeftShift, start, startLine, startCol);
        }
        return makeToken(TokenKind.Less, start, startLine, startCol);
      case '>':
        advance();
        if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.GreaterEqual, start, startLine, startCol); }
        if (pos < len && source[pos] === '>') {
          advance();
          if (pos < len && source[pos] === '=') { advance(); return makeToken(TokenKind.RightShiftEqual, start, startLine, startCol); }
          return makeToken(TokenKind.RightShift, start, startLine, startCol);
        }
        return makeToken(TokenKind.Greater, start, startLine, startCol);
      case '?':
        // Optional chaining: ?. ?[ ?( ?@
        if (pos + 1 < len) {
          const next = source[pos + 1];
          if (next === '.') { advance(); advance(); return makeToken(TokenKind.QuestionDot, start, startLine, startCol); }
          if (next === '[') { advance(); advance(); return makeToken(TokenKind.QuestionBracket, start, startLine, startCol); }
          if (next === '(') { advance(); advance(); return makeToken(TokenKind.QuestionParen, start, startLine, startCol); }
          if (next === '@') { advance(); advance(); return makeToken(TokenKind.QuestionAt, start, startLine, startCol); }
        }
        // Standalone ? is print shorthand
        advance();
        return makeToken(TokenKind.QuestionMark, start, startLine, startCol);
      default:
        // Unknown character — consume it as an error token
        advance();
        return makeToken(TokenKind.Unknown, start, startLine, startCol);
    }
  }

  // ── Token construction ────────────────────────────────────────────────

  function makeToken(kind: TokenKind, start: number, startLine: number, startCol: number): Token {
    return {
      kind,
      text: source.slice(start, pos),
      pos: start,
      end: pos,
      line: startLine,
      column: startCol,
      leadingTrivia: [],
      trailingTrivia: [],
    };
  }

  // ── Main tokenization loop ────────────────────────────────────────────

  while (pos < len) {
    const leading = scanLeadingTrivia();

    if (pos >= len) {
      // Only trivia remaining — attach to EOF token
      tokens.push({
        kind: TokenKind.Eof,
        text: '',
        pos,
        end: pos,
        line,
        column,
        leadingTrivia: leading,
        trailingTrivia: [],
      });
      return tokens;
    }

    const ch = source[pos];
    let token: Token;

    if (ch === '"') {
      token = scanString();
    } else if (isDigit(ch)) {
      token = scanNumber();
    } else if (ch === '&' && pos + 1 < len && (source[pos + 1] === 'H' || source[pos + 1] === 'h')) {
      // Hex literal
      token = scanNumber();
    } else if (ch === '.' && pos + 1 < len && isDigit(source[pos + 1])) {
      // Number starting with decimal point
      token = scanNumber();
    } else if (isAlpha(ch)) {
      token = scanIdentifierOrKeyword();
    } else if (ch === '#') {
      token = scanPreprocessor();
    } else {
      token = scanOperatorOrPunctuation();
    }

    // Attach trivia
    const trailing = scanTrailingTrivia();
    const fullToken: Token = {
      ...token,
      leadingTrivia: leading,
      trailingTrivia: trailing,
    };
    tokens.push(fullToken);
  }

  // Emit EOF
  tokens.push({
    kind: TokenKind.Eof,
    text: '',
    pos,
    end: pos,
    line,
    column,
    leadingTrivia: [],
    trailingTrivia: [],
  });

  return tokens;
}

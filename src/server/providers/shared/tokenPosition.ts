import { Position } from 'vscode-languageserver/node';
import { TokenKind } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';

/**
 * True if position `a` is at or before position `b` (line/column, 0-based).
 */
export function isAtOrBefore(aLine: number, aColumn: number, bLine: number, bColumn: number): boolean {
  return aLine < bLine || (aLine === bLine && aColumn <= bColumn);
}

/**
 * The last non-EOF token whose start position is at-or-before `position`.
 *
 * Shared by every provider that needs "what token is the cursor sitting
 * right after" — `signatureHelpProvider.ts`'s `findActiveCall` and
 * `receiverContext.ts`'s receiver-name/dot-access resolution both need this
 * exact lookup, for the same reason: the cursor is almost always positioned
 * right after an unclosed construct (an open paren, a trailing `.`/`?.`),
 * past the last real token, where a plain `findNodeAtPosition` lookup can't
 * reach (there's nothing token-shaped exactly at that position to match).
 */
export function findPrecedingToken(tokens: readonly Token[], position: Position): Token | null {
  let result: Token | null = null;
  for (const t of tokens) {
    if (t.kind === TokenKind.Eof) break;
    if (isAtOrBefore(t.line, t.column, position.line, position.character)) {
      result = t;
    } else {
      break; // tokens are in document order — once we pass the cursor, stop
    }
  }
  return result;
}

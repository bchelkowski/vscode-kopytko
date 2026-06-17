/* eslint-disable @typescript-eslint/no-unused-vars *//**
 * CST Pass: End keyword style.
 *
 * Converts between compact (`endif`, `endfor`) and spaced (`end if`, `end for`)
 * forms of end keywords. This pass demonstrates the simplest CST transformation:
 * finding specific tokens and replacing their text.
 *
 * Unlike the regex version, this pass:
 * - Cannot accidentally match keywords inside string literals
 * - Works correctly regardless of indentation or surrounding whitespace
 * - Preserves all trivia (comments, whitespace) attached to the token
 */

import { SyntaxNode, TokenKind } from 'brightscript-parser';
import type { Token } from 'brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

/** Map from compact form to spaced form. */
const COMPACT_TO_SPACED: Record<string, string> = {
  'endif': 'end if',
  'endfunction': 'end function',
  'endsub': 'end sub',
  'endwhile': 'end while',
  'endfor': 'end for',
  'endtry': 'end try',
};

/** Map from spaced token text (lowercased) to compact form. */
const SPACED_TO_COMPACT: Record<string, string> = {
  'end if': 'endif',
  'end function': 'endfunction',
  'end sub': 'endsub',
  'end while': 'endwhile',
  'end for': 'endfor',
  'end try': 'endtry',
};

/** The token kinds that represent end keywords. */
const END_KEYWORD_KINDS = new Set<TokenKind>([
  TokenKind.EndIf,
  TokenKind.EndFunction,
  TokenKind.EndSub,
  TokenKind.EndWhile,
  TokenKind.EndFor,
  TokenKind.EndTry,
]);

/**
 * Creates an end-keyword-style CST pass.
 *
 * @param style - 'spaced' converts `endif` → `end if`, 'compact' does the reverse.
 */
export function endKeywordStylePass(style: 'spaced' | 'compact'): (root: SyntaxNode, source: string) => TextEdit[] {
  return (root: SyntaxNode, _source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    walkTokens(root, (token: Token) => {
      if (!END_KEYWORD_KINDS.has(token.kind)) return;

      const lower = token.text.toLowerCase();

      if (style === 'spaced') {
        const spaced = COMPACT_TO_SPACED[lower];
        if (spaced) {
          // Preserve original casing pattern: if original was "EndIf", produce "End If"
          const newText = matchCasing(token.text, spaced);
          edits.push({ pos: token.pos, end: token.end, newText });
        }
      } else {
        const compact = SPACED_TO_COMPACT[lower];
        if (compact) {
          const newText = matchCasing(token.text, compact);
          edits.push({ pos: token.pos, end: token.end, newText });
        }
      }
    });

    return edits;
  };
}

/**
 * Produces the target string with casing that matches the original's pattern.
 * If original is all-lowercase → target lowercase.
 * If original starts with uppercase → capitalize first letter of each word in target.
 * If original is all-uppercase → target uppercase.
 */
function matchCasing(original: string, target: string): string {
  if (original === original.toLowerCase()) return target.toLowerCase();
  if (original === original.toUpperCase()) return target.toUpperCase();
  // Title case: capitalize first letter of each word
  return target.replace(/\b\w/g, (ch, idx) => {
    // Match the casing of the corresponding position in the original
    if (idx === 0) return original[0] === original[0].toUpperCase() ? ch.toUpperCase() : ch.toLowerCase();
    return ch.toUpperCase();
  });
}

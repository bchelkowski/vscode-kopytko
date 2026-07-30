/**
 * CST Pass: Then style.
 *
 * Controls the presence of `then` keyword after `if`/`else if` conditions:
 * - 'always': add `then` if missing
 * - 'never': remove `then` from multi-line ifs (keep on single-line)
 * - 'multiline-only': add `then` only on multi-line ifs
 * - 'singleline-only': remove `then` from multi-line ifs, keep on single-line
 */

import { SyntaxNode, SyntaxKind, TokenKind, isToken, isNode } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

type ThenStyle = 'always' | 'never' | 'multiline-only' | 'singleline-only' | 'preserve';

export function thenStylePass(style: ThenStyle): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visitNode(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.IfStatement || node.kind === SyntaxKind.ElseIfClause) {
        processIfNode(node, edits, style, source);
      }
      for (const child of node.children) {
        if (isNode(child)) visitNode(child);
      }
    }

    visitNode(root);
    return edits;
  };
}

function processIfNode(node: SyntaxNode, edits: TextEdit[], style: ThenStyle, source: string): void {
  const thenToken = node.findToken(TokenKind.Then);
  const hasThen = thenToken !== undefined;

  // Detect single-line: if there's a `then` token AND the next statement after
  // `then` is on the SAME line as `then`, it's a single-line if.
  // Single-line: `if x then return y` (no end if needed)
  // Multi-line: `if x then\n  ...\nend if`
  let isSingleLine = false;
  if (hasThen) {
    // Check if there's code after 'then' on the same line
    const thenLine = thenToken!.line;
    const children = node.children;
    const thenIdx = children.indexOf(thenToken!);
    if (thenIdx >= 0) {
      for (let i = thenIdx + 1; i < children.length; i++) {
        const c = children[i];
        if ('line' in c && (c as { line: number }).line === thenLine) { isSingleLine = true; break; }
        if ('children' in c) {
          
          const firstToken = findFirstTokenInNode(c as SyntaxNode);
          if (firstToken && firstToken.line === thenLine) { isSingleLine = true; break; }
        }
        break;
      }
    }
  }

  switch (style) {
    case 'always':
      if (!hasThen) {
        // Find the position right before the body starts — after condition
        const insertPos = findThenInsertPosition(node);
        if (insertPos >= 0) {
          edits.push({ pos: insertPos, end: insertPos, newText: ' then' });
        }
      }
      break;
    case 'never':
      if (hasThen && !isSingleLine) {
        removeThen(thenToken!, edits, source);
      }
      break;
    case 'multiline-only':
      if (!hasThen && !isSingleLine) {
        const insertPos = findThenInsertPosition(node);
        if (insertPos >= 0) {
          edits.push({ pos: insertPos, end: insertPos, newText: ' then' });
        }
      }
      break;
    case 'singleline-only':
      if (hasThen && !isSingleLine) {
        removeThen(thenToken!, edits, source);
      }
      break;
  }
}

function removeThen(token: Token, edits: TextEdit[], source: string): void {
  // Remove the 'then' token and the preceding space
  let start = token.leadingTrivia.length > 0
    ? token.leadingTrivia[0].pos
    : token.pos;
  // Also consume one space before 'then' to avoid double spacing
  if (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) {
    start--;
  }
  edits.push({ pos: start, end: token.end, newText: '' });
}

function findThenInsertPosition(node: SyntaxNode): number {
  // Find the last token before the body (after the condition expression)
  // For if: the condition is between `if` keyword and the body/then
  // We want to insert after the last condition token
  let lastConditionEnd = -1;
  let foundIf = false;

  for (const child of node.children) {
    if (isToken(child)) {
      if (child.kind === TokenKind.If || child.kind === TokenKind.ElseIf) {
        foundIf = true;
        continue;
      }
      if (foundIf && child.kind !== TokenKind.Then) {
        lastConditionEnd = child.end;
      }
    } else if (isNode(child) && foundIf) {
      // First child node after if keyword is the condition expression
      lastConditionEnd = child.end;
      break;
    }
  }
  return lastConditionEnd;
}

function findFirstTokenInNode(node: SyntaxNode): Token | undefined {
  let found: Token | undefined;
  walkTokens(node, (token) => {
    if (!found) found = token;
  });
  return found;
}

/**
 * CST Pass: String concatenation style.
 *
 * - 'plus': `[a, b, c].join("")` → `a + b + c`.
 * - 'array-join': a `+`-chain with at least one string-literal operand →
 *   `[a, b, c].join("")`.
 *
 * Unlike the old regex, this never needs to detect "the assignment prefix"
 * (`code.match(/^(\s*\S+\s*=\s*)/)`) to know what surrounds the expression —
 * it replaces only the matched sub-expression's own raw token range in
 * place, so whatever it's embedded in (a plain assignment, a compound
 * assignment, a `print` statement, a function argument, an array element)
 * is left completely untouched by construction. The old regex's prefix
 * heuristic silently failed on a compound assignment — `x += a + b + "c"`
 * matched no `\S+\s*=` prefix (the `+` before `=` breaks it), so it fell
 * back to using indentation as the "prefix" and dropped `x +=` entirely,
 * producing `[a, b, "c"].join("")` — invalid code that `formatText`'s
 * `verifySyntax` safety net caught and reverted, silently no-opping the
 * rule for every compound-assignment line. That whole class of bug doesn't
 * exist here.
 *
 * 'array-join' only flattens a *pure* `+`-chain (every operator in the
 * chain is `+`). If a `+`-chain is embedded inside a larger expression
 * joined by a different operator (`a + "b" - c`, or `a + (b + "c")`), only
 * the pure-plus sub-chain converts — the surrounding operator/parens are
 * left exactly as they were. This is safe by construction: each edit
 * replaces a self-contained sub-expression with another expression of
 * identical evaluated value, so the substitution can never change what the
 * enclosing `-` or anything else operates on. This is a deliberate
 * simplification from the old regex's textual "split the whole line at
 * every top-level `+`, glue `-` to whichever side it's on" behavior, which
 * no existing test pins.
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode, isToken } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

type StringConcatStyle = 'preserve' | 'plus' | 'array-join';

export function stringConcatStylePass(style: StringConcatStyle): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];
  const activeStyle = style;

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (activeStyle === 'plus' && node.kind === SyntaxKind.CallExpression) {
        processJoinCall(node, edits, source);
      } else if (activeStyle === 'array-join' && node.kind === SyntaxKind.BinaryExpression) {
        processPlusChain(node, edits, source);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }
    visit(root);

    return edits;
  };
}

function opToken(node: SyntaxNode): Token | undefined {
  const c = node.children[1];
  return c && isToken(c) ? c : undefined;
}

// ── 'plus': [a, b, c].join("") → a + b + c ──────────────────────────────────

function processJoinCall(node: SyntaxNode, edits: TextEdit[], source: string): void {
  const callee = node.childNodes[0];
  if (!callee || callee.kind !== SyntaxKind.DotExpression) return;

  const array = callee.childNodes[0];
  if (!array || array.kind !== SyntaxKind.ArrayLiteral) return;

  const memberToken = dotMemberToken(callee);
  if (!memberToken || memberToken.text.toLowerCase() !== 'join') return;

  const argList = node.findChild(SyntaxKind.ArgumentList);
  const args = argList?.childNodes ?? [];
  if (args.length !== 1) return;
  if (!isEmptyStringLiteral(args[0])) return;

  const elements = array.childNodes;
  if (elements.length === 0) return;

  const rightParen = argList?.findToken(TokenKind.RightParen);
  if (!rightParen) return;

  const start = rawStart(array);
  const newText = elements.map(el => rawText(el, source)).join(' + ');
  edits.push({ pos: start, end: rightParen.end, newText });
}

function isEmptyStringLiteral(node: SyntaxNode | undefined): boolean {
  if (!node || node.kind !== SyntaxKind.LiteralExpression) return false;
  const token = node.childTokens.find(t => t.kind === TokenKind.StringLiteral);
  return token?.text === '""';
}

function dotMemberToken(node: SyntaxNode): Token | undefined {
  const children = node.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (isToken(child) && child.kind !== TokenKind.Dot) return child;
  }
  return undefined;
}

// ── 'array-join': a + b + "c" → [a, b, "c"].join("") ────────────────────────

function processPlusChain(node: SyntaxNode, edits: TextEdit[], source: string): void {
  // Skip if this node is itself part of a larger + chain — the outermost
  // node in the chain handles the whole thing.
  const parent = node.parent;
  if (parent && parent.kind === SyntaxKind.BinaryExpression) {
    const parentOp = opToken(parent);
    if (parentOp && parentOp.kind === TokenKind.Plus) return;
  }

  const flat = flattenPlusChain(node);
  if (!flat || flat.length < 2) return;

  const hasString = flat.some(isStringLiteralOperand);
  if (!hasString) return;

  const start = rawStart(node);
  const end = rawEnd(node);
  const items = flat.map(n => rawText(n, source)).join(', ');
  edits.push({ pos: start, end, newText: `[${items}].join("")` });
}

/** Flattens a left-associative pure `+` chain into its ordered operands, or null if any operator in the chain isn't `+`. */
function flattenPlusChain(node: SyntaxNode): SyntaxNode[] | null {
  if (node.kind !== SyntaxKind.BinaryExpression) return [node];
  const op = opToken(node);
  if (!op || op.kind !== TokenKind.Plus) return null;

  const [left, right] = node.childNodes;
  if (!left || !right) return null;
  const leftFlat = flattenPlusChain(left);
  if (!leftFlat) return null;
  return [...leftFlat, right];
}

function isStringLiteralOperand(node: SyntaxNode): boolean {
  return node.kind === SyntaxKind.LiteralExpression && node.childTokens.some(t => t.kind === TokenKind.StringLiteral);
}

function rawStart(node: SyntaxNode): number {
  let first: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; });
  return first ? first.pos : node.pos;
}

function rawEnd(node: SyntaxNode): number {
  let last: Token | undefined;
  walkTokens(node, (t) => { last = t; });
  return last ? last.end : node.end;
}

function rawText(node: SyntaxNode, source: string): string {
  let first: Token | undefined;
  let last: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; last = t; });
  if (!first || !last) return node.getText().trim();
  return source.slice(first.pos, last.end);
}

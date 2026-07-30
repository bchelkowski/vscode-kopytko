/**
 * CST Pass: m prefix style.
 *
 * Converts between bracket and dot access on the implicit `m` scope object:
 * - 'dot': `m["field"]` → `m.field` (only when the quoted content is a valid identifier)
 * - 'bracket': `m.field` → `m["field"]` (skips `m.top`, `m.global`, and method calls)
 *
 * Only matches `m` as a bare identifier object (case-sensitive, matching the
 * long-standing convention) — `m.top.field`, `obj.m`, etc. are untouched, same
 * as the regex version.
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode, isToken } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

type MPrefixStyle = 'preserve' | 'dot' | 'bracket';

const KNOWN_PROPS = new Set(['top', 'global']);
const IDENTIFIER_RE = /^[a-zA-Z_]\w*$/;

export function mPrefixStylePass(style: MPrefixStyle): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];

  return (root: SyntaxNode): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (style === 'dot' && node.kind === SyntaxKind.IndexExpression) {
        processIndexNode(node, edits);
      } else if (style === 'bracket' && node.kind === SyntaxKind.DotExpression) {
        processDotNode(node, edits);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }

    visit(root);
    return edits;
  };
}

/** True if `node` is a bare `m` identifier (case-sensitive, no other children). */
function isBareM(node: SyntaxNode): boolean {
  if (node.kind !== SyntaxKind.IdentifierExpression) return false;
  const tokens = node.childTokens;
  return tokens.length === 1 && tokens[0].text === 'm';
}

function processIndexNode(node: SyntaxNode, edits: TextEdit[]): void {
  const object = node.childNodes[0];
  if (!object || !isBareM(object)) return;

  const rightBracket = node.findToken(TokenKind.RightBracket);
  if (!rightBracket) return;

  // Single-index access only: [object, LeftBracket, index, RightBracket].
  const indices = node.childNodes.slice(1);
  if (indices.length !== 1) return;
  const index = indices[0];
  if (index.kind !== SyntaxKind.LiteralExpression) return;

  const literalToken = index.childTokens.find(t => t.kind === TokenKind.StringLiteral);
  if (!literalToken) return;

  const field = literalToken.text.slice(1, -1);
  if (!IDENTIFIER_RE.test(field)) return;

  edits.push({ pos: objectRawEnd(object), end: rightBracket.end, newText: `.${field}` });
}

function processDotNode(node: SyntaxNode, edits: TextEdit[]): void {
  const object = node.childNodes[0];
  if (!object || !isBareM(object)) return;

  const memberToken = dotMemberToken(node);
  if (!memberToken) return;
  const field = memberToken.text;
  if (KNOWN_PROPS.has(field.toLowerCase())) return;

  // Skip method calls: m.doWork() — this DotExpression is the CallExpression's callee.
  const parent = node.parent;
  if (parent && parent.kind === SyntaxKind.CallExpression && parent.childNodes[0] === node) return;

  // Use raw token ends, not node.end — a node's `.end` includes trailing
  // trivia (e.g. the newline after the last token on a line).
  edits.push({ pos: objectRawEnd(object), end: memberToken.end, newText: `["${field}"]` });
}

/** A node's own `.end` includes trailing trivia of its last token; this returns
 * the raw end of its last direct-child token instead. */
function objectRawEnd(node: SyntaxNode): number {
  const tokens = node.childTokens;
  return tokens.length > 0 ? tokens[tokens.length - 1].end : node.end;
}

/** Last non-Dot direct-child token of a DotExpression — the member name. */
function dotMemberToken(node: SyntaxNode) {
  const children = node.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (isToken(child) && child.kind !== TokenKind.Dot) return child;
  }
  return undefined;
}

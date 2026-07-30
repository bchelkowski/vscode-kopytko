/**
 * CST Pass: m.top field access consistency.
 *
 * - 'dot': `m.top.getField("x")` → `m.top.x`, `m.top.setField("x", v)` → `m.top.x = v`.
 * - 'method': `m.top.x` → `m.top.getField("x")` (reads) and `m.top.x = v` →
 *   `m.top.setField("x", v)` (plain-`=` assignments only — compound assignments
 *   like `m.top.x += 1` don't translate to setField/getField and are left alone).
 *
 * Matching is case-insensitive on `m`/`top`/`getField`/`setField` (matching the
 * old regex's `i` flag), but replacement text always normalizes to lowercase
 * `m.top.`, same as before. Real SceneGraph node methods (`update`, `findNode`,
 * etc.) are never mistaken for fields because this only matches actual
 * `CallExpression`/`DotExpression`/`AssignmentStatement` nodes — a callee is
 * never also read as a field access, regardless of whether its `(` happens to
 * be on the same source line (the old line-based regex needed FIELD_ACCESS_SKIP_METHODS
 * as a workaround for exactly that; kept here too, for exact parity).
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode, isToken } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

type FieldAccessConsistency = 'preserve' | 'dot' | 'method';

const SKIP_METHODS = new Set([
  'observefield', 'observefieldscoped', 'unobservefield', 'unobservefieldscoped',
  'update', 'getchild', 'getchildren', 'getparent', 'findnode',
  'createchild', 'removechild', 'appendchild', 'getfield', 'setfield',
  'hasfield', 'addfield', 'addfields', 'removechildindex', 'removechildren',
  'getchildcount', 'replacechild', 'insertchild', 'createobject',
]);

const IDENTIFIER_RE = /^[a-zA-Z_]\w*$/;

export function fieldAccessConsistencyPass(style: FieldAccessConsistency): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    const assignmentTargets = new Set<SyntaxNode>();

    function visit(node: SyntaxNode): void {
      if (style === 'dot' && node.kind === SyntaxKind.CallExpression) {
        processCallNode(node, edits, source);
      } else if (style === 'method' && node.kind === SyntaxKind.AssignmentStatement) {
        processAssignmentNode(node, edits, source, assignmentTargets);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }
    visit(root);

    if (style === 'method') {
      function visitReads(node: SyntaxNode): void {
        if (node.kind === SyntaxKind.DotExpression && !assignmentTargets.has(node)) {
          processReadNode(node, edits);
        }
        for (const child of node.children) {
          if (isNode(child)) visitReads(child);
        }
      }
      visitReads(root);
    }

    return edits;
  };
}

/** If `dotNode.object` is `m.top` (bare `m`, case-insensitive), returns dotNode's own member token. */
function matchMTopMember(dotNode: SyntaxNode): Token | undefined {
  const topDot = dotNode.childNodes[0];
  if (!topDot || topDot.kind !== SyntaxKind.DotExpression) return undefined;

  const mObj = topDot.childNodes[0];
  if (!mObj || mObj.kind !== SyntaxKind.IdentifierExpression) return undefined;
  const mTokens = mObj.childTokens;
  if (mTokens.length !== 1 || mTokens[0].text.toLowerCase() !== 'm') return undefined;

  const topMember = dotMemberToken(topDot);
  if (!topMember || topMember.text.toLowerCase() !== 'top') return undefined;

  return dotMemberToken(dotNode);
}

function dotMemberToken(node: SyntaxNode): Token | undefined {
  const children = node.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (isToken(child) && child.kind !== TokenKind.Dot) return child;
  }
  return undefined;
}

function rawText(node: SyntaxNode, source: string): string {
  let first: Token | undefined;
  let last: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; last = t; });
  if (!first || !last) return node.getText().trim();
  return source.slice(first.pos, last.end);
}

/** Raw start of a node's first token, ignoring leading trivia. */
function rawStart(node: SyntaxNode): number {
  let first: Token | undefined;
  walkTokens(node, (t) => { if (!first) first = t; });
  return first ? first.pos : node.pos;
}

// ── 'dot' direction: getField/setField → direct access ─────────────────────

function processCallNode(node: SyntaxNode, edits: TextEdit[], source: string): void {
  const callee = node.childNodes[0];
  if (!callee || callee.kind !== SyntaxKind.DotExpression) return;

  const methodToken = matchMTopMember(callee);
  if (!methodToken) return;
  const methodLower = methodToken.text.toLowerCase();
  if (methodLower !== 'getfield' && methodLower !== 'setfield') return;

  const argList = node.findChild(SyntaxKind.ArgumentList);
  const args = argList?.childNodes ?? [];

  const fieldName = stringLiteralIdentifier(args[0]);
  if (!fieldName) return;

  const rightParen = argList?.findToken(TokenKind.RightParen);
  if (!rightParen) return;
  // Replace the whole "m.top...." range, not just from after it — the old
  // regex matched (and so normalized to lowercase) the entire m.top prefix too.
  const start = rawStart(callee.childNodes[0]);

  if (methodLower === 'getfield') {
    if (args.length !== 1) return;
    edits.push({ pos: start, end: rightParen.end, newText: `m.top.${fieldName}` });
  } else {
    if (args.length !== 2) return;
    const valueText = rawText(args[1], source);
    edits.push({ pos: start, end: rightParen.end, newText: `m.top.${fieldName} = ${valueText}` });
  }
}

/** A string-literal argument whose content is a valid identifier, or undefined. */
function stringLiteralIdentifier(argNode: SyntaxNode | undefined): string | undefined {
  if (!argNode || argNode.kind !== SyntaxKind.LiteralExpression) return undefined;
  const token = argNode.childTokens.find(t => t.kind === TokenKind.StringLiteral);
  if (!token) return undefined;
  const content = token.text.slice(1, -1);
  return IDENTIFIER_RE.test(content) ? content : undefined;
}

// ── 'method' direction: m.top.field ↔ setField/getField ─────────────────────

function processAssignmentNode(
  node: SyntaxNode,
  edits: TextEdit[],
  source: string,
  assignmentTargets: Set<SyntaxNode>,
): void {
  const target = node.childNodes[0];
  if (!target || target.kind !== SyntaxKind.DotExpression) return;

  const opToken = node.childTokens.find(t =>
    t.kind === TokenKind.Equal || t.kind === TokenKind.PlusEqual || t.kind === TokenKind.MinusEqual
    || t.kind === TokenKind.StarEqual || t.kind === TokenKind.SlashEqual || t.kind === TokenKind.BackslashEqual
    || t.kind === TokenKind.LeftShiftEqual || t.kind === TokenKind.RightShiftEqual,
  );

  const fieldToken = matchMTopMember(target);
  if (!fieldToken) return;

  // This IS an m.top.<field> assignment target — mark it so the read-pass
  // below never also converts it, regardless of the operator.
  assignmentTargets.add(target);

  // Compound assignment (+=, -=, ...) has no setField/getField equivalent —
  // leave it untouched entirely (matches the old regex's inability to match
  // `+=`, but here it's an explicit, deliberate skip rather than an accident).
  if (!opToken || opToken.kind !== TokenKind.Equal) return;

  const field = fieldToken.text;
  if (SKIP_METHODS.has(field.toLowerCase())) return;

  const value = node.childNodes[node.childNodes.length - 1];
  if (!value || value === target) return;

  const start = rawStart(target.childNodes[0]);
  const valueText = rawText(value, source);
  const end = rawEnd(node);
  edits.push({ pos: start, end, newText: `m.top.setField("${field}", ${valueText})` });
}

/** A node's own `.end` includes trailing trivia of its last token; this returns
 * the raw end of its last direct-child token instead. */
function rawEnd(node: SyntaxNode): number {
  let last: Token | undefined;
  walkTokens(node, (t) => { last = t; });
  return last ? last.end : node.end;
}

function processReadNode(node: SyntaxNode, edits: TextEdit[]): void {
  const fieldToken = matchMTopMember(node);
  if (!fieldToken) return;
  const field = fieldToken.text;
  if (SKIP_METHODS.has(field.toLowerCase())) return;

  // Skip call callees: m.top.someMethod(...) — regardless of which line the
  // opening paren lands on, since we're looking at real tree structure.
  const parent = node.parent;
  if (parent && parent.kind === SyntaxKind.CallExpression && parent.childNodes[0] === node) return;

  const start = rawStart(node.childNodes[0]);
  const end = rawEnd(node);
  edits.push({ pos: start, end, newText: `m.top.getField("${field}")` });
}

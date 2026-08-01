import { Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  SyntaxKind,
  DotExpression, OptionalChainingExpression, IdentifierExpression,
  AssignmentStatement, CallExpression,
  findScopeAtLine,
} from 'kopytko-brightscript-parser';
import type { SyntaxNode, AstNode, Scope } from 'kopytko-brightscript-parser';
import { getCachedParseResult, getCachedScopeTree } from '../../utils/documentCache';
import { findPrecedingToken } from './tokenPosition';

/**
 * Returns the receiver name for a `receiver.word` (or `receiver?.word`)
 * pattern immediately before `position` — the identifier the member-access
 * completion/definition/hover providers need to resolve a type for. `null`
 * when the cursor isn't in that shape at all.
 *
 * AST-based, replacing three near-duplicate regex/text-scanning versions
 * that used to live in `typeInference.ts` (`getReceiverName`),
 * `symbolResolver.ts` (an inline `/(\w+)$/` match), and
 * `completionContexts.ts` (`isDotAccessContext`'s dot check). Walks up from
 * the nearest token at-or-before the cursor — same technique as
 * `signatureHelpProvider.ts`'s `findActiveCall`, and for the same reason:
 * the cursor is almost always positioned right after an unclosed `.`/`?.`,
 * past the last real token, which a plain `findNodeAtPosition` lookup can't
 * reach (there's nothing token-shaped exactly at that position to match).
 *
 * Distinguishes `.` from `?.` and (unlike the old text-scanning versions)
 * never matches XML `@attr` access — `DotExpression.isAttributeAccess`
 * disambiguates what the old callers couldn't tell apart from raw text.
 */
export function getReceiverNameAtPosition(document: TextDocument, position: Position): string | null {
  const dotContext = findDotContext(document, position);
  if (!dotContext) return null;
  return objectName(dotContext.object);
}

/**
 * True if `position` sits immediately after a `.`/`?.` (not `@`/`?@`) that
 * starts a member-access chain — regardless of whether the receiver resolves
 * to a simple name. Deliberately a *different* (broader) test than
 * `getReceiverNameAtPosition() !== null`: `foo().` or `arr[0].` are dot
 * contexts whose receiver is a call/index expression, not a bare identifier
 * or dotted chain — `getReceiverNameAtPosition` can't name a receiver for
 * either, but a caller falling back to "not a dot context, offer default
 * completions" would be wrong for both.
 */
export function isDotAccessAtPosition(document: TextDocument, position: Position): boolean {
  return findDotContext(document, position) !== null;
}

function findDotContext(document: TextDocument, position: Position): { object: AstNode | null } | null {
  const parseResult = getCachedParseResult(document);
  const token = findPrecedingToken(parseResult.tokens, position);
  if (!token) return null;

  // A DotExpression/OptionalChainingExpression closes the instant its member
  // token is consumed — unlike an unclosed call's ArgumentList (which
  // legitimately spans lines while still being typed), there's no "unclosed"
  // state to justify matching a token on an earlier line. Require the cursor
  // to still be on the same physical line as the anchor token, matching the
  // old text-scanning versions' implicit single-line scope (they only ever
  // looked at `line.substring(0, charPos)`).
  if (token.line !== position.line) return null;

  const parent = token.parent;
  if (!parent) return null;

  if (parent.kind === SyntaxKind.DotExpression) {
    const dotExpr = new DotExpression(parent);
    if (dotExpr.isAttributeAccess) return null; // `@attr`, not `.member`
    return { object: dotExpr.object };
  }
  if (parent.kind === SyntaxKind.OptionalChainingExpression) {
    const chain = new OptionalChainingExpression(parent);
    if (chain.operator !== '?.') return null; // `?[`/`?(`/`?@` aren't a dot-member context
    return { object: chain.object };
  }
  return null;
}

/**
 * Finds the constructor function a variable was most recently assigned from
 * — `obj = SomeClass()` → `"SomeClass"` — as of `cursorLine`, so callers can
 * narrow which "class" (AA-with-methods) an inner-method call like `obj.c()`
 * belongs to when multiple classes define a method with the same name.
 *
 * AST-based, replacing `receiverAssignment.ts`'s `findAssignedConstructor`,
 * which scanned every line of the *whole file* backward with a regex —
 * including lines in an unrelated function that happens to assign the same
 * variable name. This walks the scope chain from `cursorLine` instead
 * (the cursor's own function, then each enclosing one for a closure), so a
 * same-named local in a sibling function is never considered. Among matches
 * in scope, the textually nearest-preceding one wins, same as the old
 * backward line scan.
 *
 * `beforeLine: true` excludes an assignment on `cursorLine` itself (used by
 * completion, where the cursor's own not-yet-finished line shouldn't count);
 * the default includes it (used by go-to-definition, where `receiver.method()`
 * and its assignment can share a colon-separated line).
 */
export function findAssignedConstructor(
  document: TextDocument,
  cursorLine: number,
  receiverName: string,
  opts: { beforeLine?: boolean } = {},
): string | null {
  const fileScope = getCachedScopeTree(document);
  const cursorScope = findScopeAtLine(fileScope, cursorLine);
  const nameLower = receiverName.toLowerCase();
  const maxLine = opts.beforeLine ? cursorLine - 1 : cursorLine;

  let bestLine = -1;
  let bestNode: SyntaxNode | null = null;
  for (let scope: Scope | null = cursorScope; scope; scope = scope.parent) {
    for (const ref of scope.references) {
      if (!ref.isWrite || ref.nameLower !== nameLower || ref.line > maxLine) continue;
      if (ref.line > bestLine) {
        bestLine = ref.line;
        bestNode = ref.node;
      }
    }
  }
  if (!bestNode?.parent || bestNode.parent.kind !== SyntaxKind.AssignmentStatement) return null;

  const value = new AssignmentStatement(bestNode.parent).value;
  if (value instanceof CallExpression && value.callee instanceof IdentifierExpression) {
    return value.callee.name;
  }
  return null;
}

function objectName(obj: AstNode | null): string | null {
  if (obj instanceof IdentifierExpression) return obj.name;
  if (obj instanceof DotExpression && !obj.isAttributeAccess) return obj.member;
  return null;
}

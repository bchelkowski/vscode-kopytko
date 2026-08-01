import {
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  Position,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  SyntaxKind, TokenKind, TriviaKind, isToken,
  findNodeAtPosition,
  CallExpression, IdentifierExpression, DotExpression,
} from 'kopytko-brightscript-parser';
import type { SyntaxNode, Token } from 'kopytko-brightscript-parser';
import { KopytkoModuleCatalog } from '../kopytko/moduleCatalog';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { getCachedParseResult } from '../utils/documentCache';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { SymbolResolver } from './shared/symbolResolver';
import { findPrecedingToken, isAtOrBefore } from './shared/tokenPosition';

interface ActiveCall {
  funcName: string;
  receiverName: string | null;
  activeParam: number;
}

/**
 * Provides signature help (parameter hints) when the cursor is inside a
 * function call. Covers:
 *   - BrightScript built-in functions
 *   - ro* component methods (type-inferred from CreateObject / typed params)
 *   - Kopytko module exports
 *   - User-defined functions (same file + @import chain + XML siblings)
 */
export class BrightScriptSignatureHelpProvider {
  private readonly symbolResolver: SymbolResolver;

  constructor(
    importResolver: KopytkoImportResolver,
    catalog: KopytkoModuleCatalog,
    workspaceIndex?: WorkspaceFunctionIndex,
  ) {
    this.symbolResolver = new SymbolResolver(catalog, importResolver, workspaceIndex);
  }

  provideSignatureHelp(document: TextDocument, position: Position, siblingPatterns: string[][] = []): SignatureHelp | null {
    const parseResult = getCachedParseResult(document);
    if (isInComment(parseResult.root, position)) return null;

    const call = findActiveCall(parseResult.tokens, position);
    if (!call) return null;

    const { funcName, receiverName, activeParam } = call;

    const resolved = this.symbolResolver.resolveByName(document, funcName, receiverName, siblingPatterns);
    if (!resolved) return null;

    switch (resolved.kind) {
      case 'componentMethod':
        return buildSignatureHelp(resolved.method.signature, activeParam);
      case 'builtin':
        return buildSignatureHelp(resolved.builtin.signature, activeParam);
      case 'kopytkoExport':
        return buildSignatureHelp(resolved.entry.signature, activeParam);
      case 'userFunction':
      case 'sourceFunction':
        return buildSignatureHelp(resolved.definition.signature, activeParam);
      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Finds the enclosing function call at `position` and its active (comma-based)
 * parameter index, by walking up from the nearest token at-or-before the
 * cursor through `Token.parent`/`SyntaxNode.parent` to the nearest
 * `ArgumentList` the cursor is still genuinely inside of.
 *
 * A plain `findNodeAtPosition` lookup isn't enough on its own: signature help
 * is almost always requested with the cursor sitting right after an unclosed
 * `(` or `,` — i.e. past the last real token, at the position the lexer's
 * `Eof` token occupies — and `Eof` is a sibling of the unclosed call, not a
 * descendant of its `ArgumentList`. Walking from the nearest real token
 * instead works for both the open and closed cases.
 */
function findActiveCall(tokens: readonly Token[], position: Position): ActiveCall | null {
  const token = findPrecedingToken(tokens, position);
  if (!token) return null;

  let node: SyntaxNode | null = token.parent ?? null;
  while (node) {
    if (node.kind === SyntaxKind.ArgumentList) {
      const active = activeCallFromArgumentList(node, position);
      if (active) return active;
    }
    node = node.parent;
  }
  return null;
}

/**
 * Builds an `ActiveCall` from `argList` if the cursor is genuinely still
 * inside its parens: at-or-after the `(`, and — when a real (non-missing)
 * `)` exists — at-or-before it. Returns `null` (not "try an outer call") is
 * the caller's job via the parent-chain walk; this only judges `argList` itself.
 */
function activeCallFromArgumentList(argList: SyntaxNode, position: Position): ActiveCall | null {
  const openParen = argList.findToken(TokenKind.LeftParen);
  if (!openParen) return null;
  if (!isAtOrBefore(openParen.line, openParen.column + openParen.text.length, position.line, position.character)) {
    return null; // cursor is before the '(' itself
  }

  const closeParen = argList.findToken(TokenKind.RightParen);
  if (closeParen && !closeParen.isMissing) {
    if (!isAtOrBefore(position.line, position.character, closeParen.line, closeParen.column)) {
      return null; // cursor is past a real ')'
    }
  }

  const callExprNode = argList.parent;
  if (!callExprNode || callExprNode.kind !== SyntaxKind.CallExpression) return null;
  const callee = new CallExpression(callExprNode).callee;

  let funcName: string;
  let receiverName: string | null;
  if (callee instanceof DotExpression && !callee.isAttributeAccess) {
    funcName = callee.member;
    const obj = callee.object;
    receiverName = obj instanceof IdentifierExpression ? obj.name
      : obj instanceof DotExpression ? obj.member
      : null;
  } else if (callee instanceof IdentifierExpression) {
    funcName = callee.name;
    receiverName = null;
  } else {
    return null;
  }

  // Count commas that are direct children of this ArgumentList (not nested
  // inside an argument's own array literal / call / etc.) before the cursor.
  let activeParam = 0;
  for (const child of argList.children) {
    if (isToken(child) && child.kind === TokenKind.Comma
        && isAtOrBefore(child.line, child.column, position.line, position.character)) {
      activeParam++;
    }
  }

  return { funcName, receiverName, activeParam };
}

/** True when `position` falls inside a comment (tick or REM), via the CST's trivia. */
function isInComment(root: SyntaxNode, position: Position): boolean {
  const result = findNodeAtPosition(root, position.line, position.character);
  const kind = result?.trivia?.kind;
  return kind === TriviaKind.Comment || kind === TriviaKind.RemComment;
}

/**
 * Builds a SignatureHelp from a raw signature string.
 * Strips a leading `function`/`sub` keyword so the label is uniform
 * regardless of whether the source is a built-in, component method, or
 * user-defined function.
 */
function buildSignatureHelp(rawSignature: string, activeParam: number): SignatureHelp {
  const label = rawSignature.trim().replace(/^(?:function|sub)\s+/i, '');
  const params = splitParams(label);
  const parameters: ParameterInformation[] = params.map((p) => ({ label: p }));

  return {
    signatures: [
      {
        label,
        parameters,
      } as SignatureInformation,
    ],
    activeSignature: 0,
    activeParameter: params.length > 0 ? Math.min(activeParam, params.length - 1) : 0,
  };
}

/**
 * Splits the parameter list out of a signature string into individual
 * parameter strings.  Handles default values that contain string literals
 * (e.g. `arg = ""`) and nested parentheses.
 *
 * This operates on a catalog/declaration *signature string* (e.g.
 * `Mid(s as String, start as Integer, length = -1 as Integer) as String`),
 * not BrightScript source — there is no CST for it to walk.
 *
 * `Mid(s as String, start as Integer, length = -1 as Integer) as String`
 * → `["s as String", "start as Integer", "length = -1 as Integer"]`
 */
function splitParams(signature: string): string[] {
  const parenStart = signature.indexOf('(');
  const parenEnd = signature.lastIndexOf(')');
  if (parenStart === -1 || parenEnd === -1 || parenEnd <= parenStart) return [];
  const paramStr = signature.slice(parenStart + 1, parenEnd).trim();
  if (!paramStr) return [];

  const params: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;

  for (let i = 0; i < paramStr.length; i++) {
    const ch = paramStr[i];
    if (ch === '"') {
      if (!inString) {
        inString = true;
      } else if (i + 1 < paramStr.length && paramStr[i + 1] === '"') {
        i++; // skip escaped ""
      } else {
        inString = false;
      }
    } else if (!inString) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) {
        params.push(paramStr.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  params.push(paramStr.slice(start).trim());
  return params.filter((p) => p.length > 0);
}

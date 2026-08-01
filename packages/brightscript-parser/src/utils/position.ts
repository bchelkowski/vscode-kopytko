/**
 * Position-based CST node lookup.
 *
 * Given a cursor position (line, column), finds the deepest CST node
 * and token at that position. This is the foundation for all LSP features
 * that need context at the cursor: hover, go-to-definition, completion,
 * signature help, rename, references.
 */

import { SyntaxNode, isNode, isToken } from '../syntaxNode.js';
import { SyntaxKind } from '../syntaxKind.js';
import { TokenKind } from '../tokenKind.js';
import { Token } from '../token.js';
import { Trivia } from '../trivia.js';

export interface NodeAtPosition {
  /** The deepest SyntaxNode containing the position. */
  node: SyntaxNode;
  /** The specific token at the position, if any. */
  token: Token | undefined;
  /** The chain of ancestor nodes from root to the deepest node. */
  ancestors: SyntaxNode[];
  /**
   * The trivia piece (comment/whitespace) containing the position, if the
   * position falls inside a token's leading trivia rather than the token
   * itself — e.g. the cursor sitting inside a `' @import ...` comment.
   */
  trivia: Trivia | undefined;
}

/**
 * Finds the deepest CST node at the given line and column.
 *
 * @param root - The root SourceFile node.
 * @param line - 0-based line number.
 * @param column - 0-based column (character offset within line).
 * @returns The node, token, and ancestor chain at the position, or null if not found.
 */
export function findNodeAtPosition(root: SyntaxNode, line: number, column: number): NodeAtPosition | null {
  const ancestors: SyntaxNode[] = [];
  const result = findDeepest(root, line, column, ancestors);
  if (!result) return null;
  return result;
}

function findDeepest(node: SyntaxNode, line: number, column: number, ancestors: SyntaxNode[]): NodeAtPosition | null {
  ancestors.push(node);

  // Check children in order — find the deepest match
  for (const child of node.children) {
    if (isToken(child)) {
      if (child.line === line && column >= child.column && column < child.column + child.text.length) {
        return { node, token: child, ancestors: [...ancestors], trivia: undefined };
      }
      // Also check trivia (comments/whitespace at cursor position) on both
      // sides of the token — e.g. `' @import ...` is leading trivia on the
      // token that follows it, but `x = 1 ' comment` is trailing trivia on
      // the token before it.
      const leadingHit = findTriviaAt(child.leadingTrivia, line, column);
      if (leadingHit) return { node, token: child, ancestors: [...ancestors], trivia: leadingHit };
      const trailingHit = findTriviaAt(child.trailingTrivia, line, column);
      if (trailingHit) return { node, token: child, ancestors: [...ancestors], trivia: trailingHit };
    } else if (isNode(child)) {
      const result = findDeepest(child, line, column, ancestors);
      if (result) return result;
    }
  }

  ancestors.pop();
  return null;
}

function findTriviaAt(trivia: readonly Trivia[], line: number, column: number): Trivia | undefined {
  for (const t of trivia) {
    if (containsPosition(t, line, column)) return t;
  }
  return undefined;
}

/**
 * True if (line, column) falls within a trivia piece's span. Trivia never
 * spans multiple lines — Whitespace/Comment/RemComment all stop scanning at
 * the line break, and LineBreak trivia is the line break itself — so this is
 * a same-line column-range check against the trivia's own line/column.
 */
function containsPosition(trivia: Trivia, line: number, column: number): boolean {
  if (trivia.line !== line) return false;
  return column >= trivia.column && column < trivia.column + trivia.text.length;
}

/**
 * Finds the token at the given line and column by scanning all tokens.
 * Simpler than findNodeAtPosition — just returns the token, no ancestors.
 */
export function findTokenAtPosition(root: SyntaxNode, line: number, column: number): Token | undefined {
  let found: Token | undefined;

  function walk(node: SyntaxNode): void {
    for (const child of node.children) {
      if (isToken(child)) {
        if (child.line === line && column >= child.column && column < child.column + child.text.length) {
          found = child;
          return;
        }
      } else if (isNode(child)) {
        walk(child);
        if (found) return;
      }
    }
  }

  walk(root);
  return found;
}

/**
 * Gets the identifier word at the given position in a line of text.
 * Returns the word and its start/end columns, or null if not on an identifier.
 *
 * This replaces the regex-based `getWord` / `getWordInfo` in textUtils.
 */
export function getWordAtPosition(line: string, column: number): { word: string; start: number; end: number } | null {
  if (column < 0 || column >= line.length) return null;

  // Expand left to find word start
  let start = column;
  while (start > 0 && isIdentChar(line[start - 1])) start--;

  // Expand right to find word end
  let end = column;
  while (end < line.length && isIdentChar(line[end])) end++;

  if (start === end) return null;

  const word = line.slice(start, end);
  // Must start with alpha or underscore to be a valid identifier
  if (!isIdentStart(word[0])) return null;

  return { word, start, end };
}

function isIdentChar(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

/**
 * Escapes special regex characters in a string.
 * Shared utility used by linter rules and LSP providers.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Position index ─────────────────────────────────────────────────────────
//
// findNodeAtPosition/findTokenAtPosition above are full O(n) tree walks —
// fine for a single lookup, wasteful for a caller making many lookups
// against the same parse (e.g. an LSP server answering hover/completion/
// signature-help requests against one open document). PositionIndex trades
// an O(n) build (once per parse) for O(log lines + tokens-on-that-line)
// lookups after that.

export interface PositionIndex {
  /** Every token in the tree, in document order. */
  readonly tokens: readonly Token[];
  /** tokens[lineStarts[L]] is the first token on line L or later (sparse lines fall through to the next line that has one). */
  readonly lineStarts: readonly number[];
}

/** Builds a `PositionIndex` for `root`. Call once per parse and reuse across lookups. */
export function buildPositionIndex(root: SyntaxNode): PositionIndex {
  const tokens: Token[] = [];
  collectTokens(root, tokens);

  const lineStarts: number[] = [];
  let lastLine = -1;
  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i].line;
    while (lastLine < line) {
      lastLine++;
      lineStarts[lastLine] = i;
    }
  }

  return { tokens, lineStarts };
}

function collectTokens(node: SyntaxNode, out: Token[]): void {
  for (const child of node.children) {
    if (isToken(child)) out.push(child);
    else collectTokens(child, out);
  }
}

/**
 * Indexed equivalent of `findTokenAtPosition` — O(tokens on that line)
 * instead of O(n) once `index` is built.
 */
export function findTokenAtPositionIndexed(index: PositionIndex, line: number, column: number): Token | undefined {
  if (line < 0 || line >= index.lineStarts.length) return undefined;
  const start = index.lineStarts[line];
  if (start === undefined) return undefined;
  for (let i = start; i < index.tokens.length; i++) {
    const t = index.tokens[i];
    if (t.line !== line) break;
    if (column >= t.column && column < t.column + t.text.length) return t;
  }
  return undefined;
}

/**
 * Indexed equivalent of `findNodeAtPosition`. Ancestor chains are recovered
 * by walking `Token.parent` upward (O(depth)) rather than a fresh tree walk
 * — see `Token.parent`'s doc comment for why that's available at all.
 * Falls back to the token before/after the given line for trivia (comment)
 * hits, matching `findNodeAtPosition`'s leading/trailing trivia check.
 */
export function findNodeAtPositionIndexed(index: PositionIndex, line: number, column: number): NodeAtPosition | null {
  const exact = findTokenAtPositionIndexed(index, line, column);
  if (exact) return fromToken(exact, undefined);

  const start = index.lineStarts[line];
  const anchor = start !== undefined ? index.tokens[start] : undefined;
  if (anchor) {
    // `anchor`'s leading trivia covers this line whether or not `anchor`
    // itself starts on this line — a whole-line comment (no real token on
    // that line at all) is leading trivia of the NEXT token, which is
    // necessarily on a later line; `lineStarts` falls through to it.
    const leadingHit = findTriviaAt(anchor.leadingTrivia, line, column);
    if (leadingHit) return fromToken(anchor, leadingHit);

    // Additional same-line tokens (e.g. a trailing comment after code) —
    // only meaningful when `anchor` really is on this line.
    if (anchor.line === line) {
      for (let i = start!; i < index.tokens.length && index.tokens[i].line === line; i++) {
        const trailingHit = findTriviaAt(index.tokens[i].trailingTrivia, line, column);
        if (trailingHit) return fromToken(index.tokens[i], trailingHit);
      }
    }
  }
  // Defensive symmetry with findNodeAtPosition: also check the trailing
  // trivia of the token just before `start`, in case a comment ever ends up
  // attributed there instead (trailing trivia of token N and leading trivia
  // of token N+1 partition the source without overlap in the current lexer,
  // so this should not normally fire — kept as a fallback, not a load-bearing path).
  if (start !== undefined && start > 0) {
    const prev = index.tokens[start - 1];
    const trailingHit = findTriviaAt(prev.trailingTrivia, line, column);
    if (trailingHit) return fromToken(prev, trailingHit);
  }
  return null;
}

function fromToken(token: Token, trivia: Trivia | undefined): NodeAtPosition | null {
  const owner = token.parent;
  if (!owner) return null;
  const ancestors: SyntaxNode[] = [];
  for (let n: SyntaxNode | null = owner; n; n = n.parent) ancestors.unshift(n);
  return { node: owner, token, ancestors, trivia };
}

export interface SymbolIndex {
  /** Every named function/sub declaration in the file, keyed by lowercased name. Last declaration wins on a duplicate name, same as re-declaring a variable. */
  readonly functions: ReadonlyMap<string, SyntaxNode>;
}

/**
 * Builds a name → `FunctionDeclaration` node index for `root` in a single
 * pass. Lets a caller resolve "the function named X" in O(1) instead of a
 * fresh tree walk per lookup (what `getSymbolInfo` and `buildCallGraph`
 * currently each do on their own). Reuse across many lookups against the
 * same parse.
 */
export function buildSymbolIndex(root: SyntaxNode): SymbolIndex {
  const functions = new Map<string, SyntaxNode>();
  collectFunctions(root, functions);
  return { functions };
}

function collectFunctions(node: SyntaxNode, out: Map<string, SyntaxNode>): void {
  if (node.kind === SyntaxKind.FunctionDeclaration) {
    const nameToken = node.findToken(TokenKind.Identifier);
    if (nameToken) out.set(nameToken.text.toLowerCase(), node);
  }
  for (const child of node.children) {
    if (isNode(child)) collectFunctions(child, out);
  }
}

import {
  Range,
  Position,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { readCachedFileText, getCachedFileParseResult } from '../utils/fileParseCache';
import {
  getWordAtPosition, walk, parse as parseBrs,
  FunctionDeclaration, IdentifierExpression,
} from 'kopytko-brightscript-parser';
import type { Token, Scope, Declaration } from 'kopytko-brightscript-parser';
import { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS } from 'kopytko-brightscript-parser';
import { getCachedLines, getCachedScopeTree } from '../utils/documentCache';
import { findScopeAtLine } from 'kopytko-brightscript-parser';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { SymbolResolver } from './shared/symbolResolver';

const BUILTIN_NAMES = new Set(BRIGHTSCRIPT_BUILTINS.map((b) => b.name.toLowerCase()));
const KEYWORD_NAMES = new Set(BRIGHTSCRIPT_KEYWORDS.map((k) => k.toLowerCase()));

/** Valid BrightScript identifier: starts with a letter or underscore, then word chars. */
const VALID_IDENTIFIER_RE = /^[a-zA-Z_]\w*$/;

export class BrightScriptRenameProvider {
  private readonly symbolResolver: SymbolResolver;

  constructor(
    importResolver: KopytkoImportResolver,
    private readonly _index?: WorkspaceFunctionIndex,
  ) {
    this.symbolResolver = new SymbolResolver(undefined, importResolver, _index);
  }

  /**
   * Called by VS Code before showing the rename input box.
   * Returns the range of the identifier under the cursor and its current text.
   * Returns null when the cursor is not on a user-defined identifier.
   */
  prepareRename(
    document: TextDocument,
    position: Position,
  ): { range: Range; placeholder: string } | null {
    const lines = getCachedLines(document);
    const line = lines[position.line] ?? '';
    const info = getWordAtPosition(line, position.character);
    if (!info) return null;
    if (isProtected(info.word)) return null;
    return {
      range: Range.create(Position.create(position.line, info.start), Position.create(position.line, info.end)),
      placeholder: info.word,
    };
  }

  /**
   * Produces a WorkspaceEdit renaming the symbol under the cursor to `newName`.
   *
   * Scope rules:
   * - **Function/sub names** — renamed workspace-wide across all .brs files, because
   *   top-level functions are effectively global identifiers in BrightScript.
   * - **Everything else** (local variables, parameters, AA fields) — renamed only within
   *   the body of the innermost enclosing function in the current file.
   *
   * Both cases walk the parsed AST rather than regex-matching `\bword\b` — a
   * regex match fires inside comments and string literals too (renaming
   * `count` used to rewrite `' count is the total` and `"count: " + str(count)`
   * alike), and for the local case a regex over "the enclosing function's raw
   * line range" has no way to tell a real declaration from prose that happens
   * to mention the same word.
   */
  provideRename(
    document: TextDocument,
    position: Position,
    newName: string,
  ): WorkspaceEdit | null {
    if (!VALID_IDENTIFIER_RE.test(newName)) return null;

    const lines = getCachedLines(document);
    const line = lines[position.line] ?? '';
    const info = getWordAtPosition(line, position.character);
    if (!info) return null;
    if (isProtected(info.word)) return null;

    const { word } = info;

    // Determine whether the identifier is a visible top-level function/sub name.
    const functionSymbol = this.symbolResolver.resolveFunctionSymbol(document, word, [], {
      includeWorkspaceFunctions: false,
    });
    if (functionSymbol?.kind === 'userFunction') {
      return this._renameWorkspaceWide(word, newName);
    }

    return this._renameLocal(document, position, word, newName);
  }

  /**
   * Renames a top-level function/sub: its own declaration, plus every bare
   * `name(...)` / bare `name` reference (an `IdentifierExpression`) in every
   * workspace file. Deliberately does NOT touch `obj.name` (a `DotExpression`
   * member) — that's a field/method on some other object, not necessarily
   * this function, even when it happens to share the name.
   */
  private _renameWorkspaceWide(word: string, newName: string): WorkspaceEdit {
    const wordLower = word.toLowerCase();
    const changes: { [uri: string]: TextEdit[] } = {};

    const files = this._index ? this._index.getFiles() : [];
    for (const filePath of files) {
      let parseResult = getCachedFileParseResult(filePath);
      if (!parseResult) {
        const text = readCachedFileText(filePath);
        if (text === undefined) continue;
        parseResult = parseBrs(text);
      }

      const edits: TextEdit[] = [];
      walk(parseResult.root, {
        visitFunctionDeclaration(node: FunctionDeclaration) {
          if (node.name.toLowerCase() !== wordLower) return;
          const t = node.nameToken;
          if (t) edits.push(tokenEdit(t, newName));
        },
        visitIdentifierExpression(node: IdentifierExpression) {
          if (node.name.toLowerCase() !== wordLower) return;
          const t = node.nameToken;
          if (t) edits.push(tokenEdit(t, newName));
        },
      });

      if (edits.length > 0) {
        changes[URI.file(filePath).toString()] = edits;
      }
    }

    return { changes };
  }

  /**
   * Renames a local variable / parameter / for-loop-or-catch variable within
   * the scope it's declared in, plus any nested (closure) scope that reads it
   * without re-declaring it locally — but never a same-named variable in a
   * sibling function or a shadowing inner re-declaration.
   */
  private _renameLocal(document: TextDocument, position: Position, word: string, newName: string): WorkspaceEdit {
    const wordLower = word.toLowerCase();
    const fileScope = getCachedScopeTree(document);
    const cursorScope = findScopeAtLine(fileScope, position.line);
    const declScope = findDeclaringScope(cursorScope, wordLower);

    // No resolvable declaration anywhere in the scope chain (e.g. the cursor
    // landed on plain prose inside a comment, which the AST never sees) —
    // there is nothing well-defined to rename.
    if (!declScope) return { changes: {} };

    const decl = declScope.declarations.get(wordLower)!;
    const targets = collectRenameTargets(declScope, decl, wordLower);
    const edits = targets.map(t => rangeEdit(t.line, t.column, t.length, newName));

    return { changes: edits.length > 0 ? { [document.uri]: edits } : {} };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenEdit(token: Token, newName: string): TextEdit {
  return TextEdit.replace(
    Range.create(token.line, token.column, token.line, token.column + token.text.length),
    newName,
  );
}

function rangeEdit(line: number, column: number, length: number, newName: string): TextEdit {
  return TextEdit.replace(Range.create(line, column, line, column + length), newName);
}

/** Walks up the scope chain from `scope`, returning the nearest scope that declares `nameLower`, or `null`. */
function findDeclaringScope(scope: Scope, nameLower: string): Scope | null {
  let current: Scope | null = scope;
  while (current) {
    if (current.declarations.has(nameLower)) return current;
    current = current.parent;
  }
  return null;
}

/**
 * Collects every position that must change when renaming `decl` (declared in
 * `declScope`) to a new name: the declaration site itself, every reference to
 * it in `declScope`, and every reference in a descendant scope that resolves
 * to the SAME declaration (a closure reading an outer local) — stopping at
 * any descendant scope that re-declares `nameLower` locally, since that
 * subtree's occurrences refer to a different variable (shadowing).
 */
function collectRenameTargets(
  declScope: Scope,
  decl: Declaration,
  nameLower: string,
): { line: number; column: number; length: number }[] {
  const targets: { line: number; column: number; length: number }[] = [
    { line: decl.line, column: decl.column, length: decl.name.length },
  ];
  const seen = new Set<string>([`${decl.line}:${decl.column}`]);

  function visit(scope: Scope, isDeclaringScope: boolean): void {
    if (!isDeclaringScope && scope.declarations.has(nameLower)) return; // shadowed — a different variable
    for (const ref of scope.references) {
      if (ref.nameLower !== nameLower) continue;
      const key = `${ref.line}:${ref.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ line: ref.line, column: ref.column, length: ref.name.length });
    }
    for (const child of scope.children) visit(child, false);
  }

  visit(declScope, true);
  return targets;
}

function isProtected(word: string): boolean {
  const lower = word.toLowerCase();
  return BUILTIN_NAMES.has(lower) || KEYWORD_NAMES.has(lower);
}

import {
  Range,
  Position,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { readCachedFileText } from '../utils/fileParseCache';
import { getDocumentPath } from '../utils/textUtils';
import { getWordAtPosition, escapeRegex } from 'kopytko-brightscript-parser';
import { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS } from 'kopytko-brightscript-parser';
import { getCachedAllFunctions, getCachedLines } from '../utils/documentCache';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';

const BUILTIN_NAMES = new Set(BRIGHTSCRIPT_BUILTINS.map((b) => b.name.toLowerCase()));
const KEYWORD_NAMES = new Set(BRIGHTSCRIPT_KEYWORDS.map((k) => k.toLowerCase()));

/** Valid BrightScript identifier: starts with a letter or underscore, then word chars. */
const VALID_IDENTIFIER_RE = /^[a-zA-Z_]\w*$/;

export class BrightScriptRenameProvider {
  constructor(
    private readonly importResolver: KopytkoImportResolver,
    private readonly _index?: WorkspaceFunctionIndex,
  ) {}

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
    const documentPath = getDocumentPath(document);

    // Determine whether the identifier is a top-level function/sub name.
    const allFunctions = getCachedAllFunctions(document, documentPath, this.importResolver, []);
    const isFunctionName = allFunctions.some((f) => f.nameLower === word.toLowerCase());

    if (isFunctionName) {
      return this._renameWorkspaceWide(word, newName);
    }

    // Local variable / parameter — rename only within the enclosing function body.
    const funcRange = findEnclosingFunctionLines(lines, position.line);
    const startLine = funcRange ? funcRange.start : 0;
    const endLine = funcRange ? funcRange.end : lines.length - 1;
    return buildFileRangeEdit(document.uri, lines, word, newName, startLine, endLine);
  }

  private _renameWorkspaceWide(word: string, newName: string): WorkspaceEdit {
    const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    const changes: { [uri: string]: TextEdit[] } = {};

    const files = this._index ? this._index.getFiles() : [];
    for (const filePath of files) {
      const fileText = readCachedFileText(filePath);
      if (fileText === undefined) continue;
      const fileLines = fileText.split(/\r?\n/);
      const edits: TextEdit[] = [];
      for (let lineIdx = 0; lineIdx < fileLines.length; lineIdx++) {
        wordRe.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = wordRe.exec(fileLines[lineIdx])) !== null) {
          edits.push(TextEdit.replace(
            Range.create(lineIdx, match.index, lineIdx, match.index + word.length),
            newName,
          ));
        }
      }
      if (edits.length > 0) {
        changes[URI.file(filePath).toString()] = edits;
      }
    }

    return { changes };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scans `lines` to find the innermost function/sub body that contains `cursorLine`.
 * Handles both named (`function foo()`) and anonymous (`this.x = function()`) starts.
 * Returns line indices { start, end } inclusive, or null when the cursor is not inside
 * any function.
 */
function findEnclosingFunctionLines(
  lines: string[],
  cursorLine: number,
): { start: number; end: number } | null {
  // Matches any function/sub start: named, anonymous, or colon-syntax AA method.
  const ANY_FUNC_RE = /\b(?:function|sub)\b/i;
  const FUNC_END_RE = /^\s*end\s+(?:function|sub)\b/i;

  // Scan backwards from the cursor to find the nearest unclosed function start.
  let depth = 0;
  let funcStart = -1;
  for (let i = cursorLine; i >= 0; i--) {
    const ln = lines[i];
    if (/^\s*'/.test(ln)) continue;
    if (i < cursorLine && FUNC_END_RE.test(ln)) {
      // A closing keyword we haven't yet accounted for — skip its matching open.
      depth++;
    } else if (ANY_FUNC_RE.test(ln) && !FUNC_END_RE.test(ln)) {
      if (depth === 0) {
        funcStart = i;
        break;
      }
      depth--;
    }
  }

  if (funcStart < 0) return null;

  // Scan forwards from funcStart to find the matching end function/sub.
  let innerDepth = 0;
  for (let j = funcStart; j < lines.length; j++) {
    const ln = lines[j];
    if (/^\s*'/.test(ln)) continue;
    if (ANY_FUNC_RE.test(ln) && !FUNC_END_RE.test(ln)) {
      innerDepth++;
    } else if (FUNC_END_RE.test(ln)) {
      innerDepth--;
      if (innerDepth === 0) return { start: funcStart, end: j };
    }
  }

  return null;
}

/** Builds a WorkspaceEdit replacing every word-boundary match within [startLine, endLine]. */
function buildFileRangeEdit(
  uri: string,
  lines: string[],
  word: string,
  newName: string,
  startLine: number,
  endLine: number,
): WorkspaceEdit {
  const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
  const edits: TextEdit[] = [];

  for (let i = startLine; i <= endLine; i++) {
    wordRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = wordRe.exec(lines[i])) !== null) {
      edits.push(TextEdit.replace(
        Range.create(i, match.index, i, match.index + word.length),
        newName,
      ));
    }
  }

  return { changes: edits.length > 0 ? { [uri]: edits } : {} };
}

function isProtected(word: string): boolean {
  const lower = word.toLowerCase();
  return BUILTIN_NAMES.has(lower) || KEYWORD_NAMES.has(lower);
}

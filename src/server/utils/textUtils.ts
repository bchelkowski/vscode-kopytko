import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Extracts the word under the cursor from a line of text.
 * Returns null if the cursor is not on a word character.
 */
export function getWord(line: string, character: number): string | null {
  const info = getWordInfo(line, character);
  return info ? info.word : null;
}

/**
 * Extracts the word under the cursor along with its start and end offsets.
 * Returns null if the cursor is not on a word character.
 */
export function getWordInfo(line: string, character: number): { word: string; start: number; end: number } | null {
  let start = character;
  while (start > 0 && /\w/.test(line[start - 1])) start--;
  let end = character;
  while (end < line.length && /\w/.test(line[end])) end++;
  if (start === end) return null;
  return { word: line.substring(start, end), start, end };
}

/** Escapes special regex characters in a string for use in `new RegExp(...)`. */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns the fsPath of a TextDocument's URI. */
export function getDocumentPath(document: TextDocument): string {
  return URI.parse(document.uri).fsPath;
}

/**
 * Replaces string literal contents with spaces, preserving character offsets.
 * When `stripComments` is true, truncates at the first `'` comment marker
 * outside a string.
 */
export function stripStringLiterals(s: string, stripComments = false): string {
  let result = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += '"';
      } else if (s[i + 1] === '"') {
        result += '  '; // BrightScript escaped quote ""
        i++;
      } else {
        inString = false;
        result += '"';
      }
    } else if (inString) {
      result += ' ';
    } else if (stripComments && ch === "'") {
      break; // rest is a comment
    } else {
      result += ch;
    }
  }
  return result;
}

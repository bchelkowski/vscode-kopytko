import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';

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

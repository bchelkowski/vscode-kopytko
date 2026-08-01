import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';

/** Returns the fsPath of a TextDocument's URI. */
export function getDocumentPath(document: TextDocument): string {
  return URI.parse(document.uri).fsPath;
}

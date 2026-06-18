import { ReferenceParams, Location, Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { readCachedFileText } from '../utils/fileParseCache';
import { getWordAtPosition, escapeRegex } from 'kopytko-brightscript-parser';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';

const FUNC_DEF_RE = /^\s*(?:function|sub)\s+(\w+)\s*\(/i;

export class BrightScriptReferencesProvider {
  constructor(private readonly _index: WorkspaceFunctionIndex) {}

  provideReferences(document: TextDocument, params: ReferenceParams): Location[] {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const lineText = lines[params.position.line] ?? '';

    const wordResult = getWordAtPosition(lineText, params.position.character);
    const word = wordResult?.word ?? null;
    if (!word) return [];

    const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    const locations: Location[] = [];

    for (const filePath of this._index.getFiles()) {
      const fileText = readCachedFileText(filePath);
      if (fileText === undefined) continue;
      const fileLines = fileText.split(/\r?\n/);
      for (let lineIdx = 0; lineIdx < fileLines.length; lineIdx++) {
        const line = fileLines[lineIdx];
        const defMatch = FUNC_DEF_RE.exec(line);
        if (defMatch && defMatch[1].toLowerCase() === word.toLowerCase()) continue;
        wordRe.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = wordRe.exec(line)) !== null) {
          locations.push({
            uri: URI.file(filePath).toString(),
            range: Range.create(
              Position.create(lineIdx, match.index),
              Position.create(lineIdx, match.index + word.length),
            ),
          });
        }
      }
    }

    return locations;
  }
}

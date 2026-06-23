import { ReferenceParams, Location, Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { getCachedFileParseResult, readCachedFileText } from '../utils/fileParseCache';
import { getWordAtPosition, walk, IdentifierExpression, parse as parseBrs } from 'kopytko-brightscript-parser';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { getCachedLines } from '../utils/documentCache';

export class BrightScriptReferencesProvider {
  constructor(private readonly _index: WorkspaceFunctionIndex) {}

  provideReferences(document: TextDocument, params: ReferenceParams): Location[] {
    const lines = getCachedLines(document);
    const lineText = lines[params.position.line] ?? '';

    const wordResult = getWordAtPosition(lineText, params.position.character);
    const word = wordResult?.word ?? null;
    if (!word) return [];

    const wordLower = word.toLowerCase();
    const locations: Location[] = [];

    for (const filePath of this._index.getFiles()) {
      // Use the cached AST when available; fall back to parsing the cached text.
      // AST-based walking naturally excludes false positives such as dot-member
      // accesses (obj.funcName) and AA keys ({ funcName: value }) because those
      // name tokens are not IdentifierExpression nodes.
      let parseResult = getCachedFileParseResult(filePath);
      if (!parseResult) {
        const fileText = readCachedFileText(filePath);
        if (fileText === undefined) continue;
        parseResult = parseBrs(fileText);
      }
      if (!parseResult) continue;

      walk(parseResult.root, {
        visitIdentifierExpression(node: IdentifierExpression) {
          if (node.name.toLowerCase() !== wordLower) return;
          const token = node.nameToken;
          if (!token) return;
          locations.push({
            uri: URI.file(filePath).toString(),
            range: Range.create(
              Position.create(token.line, token.column),
              Position.create(token.line, token.column + word.length),
            ),
          });
        },
      });
    }

    return locations;
  }
}

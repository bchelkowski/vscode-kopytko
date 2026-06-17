import { Location, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { InnerMethodDefinition } from '../brightscript/functionIndex';
import { getReceiverName } from '../brightscript/typeInference';
import { getDocumentPath } from '../utils/textUtils';
import { getWordAtPosition } from 'kopytko-brightscript-parser';
import { getCachedAllFunctions, getCachedAllInnerMethods } from '../utils/documentCache';

export class BrightScriptDefinitionProvider {
  constructor(private readonly importResolver: KopytkoImportResolver) {}

  provideDefinition(
    document: TextDocument,
    position: Position,
    siblingPatterns: string[][] = [],
  ): Location | Location[] | null {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const currentLine = lines[position.line] ?? '';

    // 1. Cursor on a @import line → navigate to the imported file
    const importMatch = /^\s*'\s*@import\s+(\S+)(?:\s+from\s+(\S+))?/.exec(currentLine);
    if (importMatch) {
      const documentPath = getDocumentPath(document);
      const imp = this.importResolver.parseImports(currentLine);
      if (imp.length > 0) {
        const resolved = this.importResolver.resolveImportPath(imp[0], documentPath);
        if (resolved) {
          return {
            uri: URI.file(resolved).toString(),
            range: Range.create(0, 0, 0, 0),
          };
        }
      }
      return null;
    }

    // 2. Cursor on a function/sub name or AA method → find definition across all visible files
    const wordInfo = getWordAtPosition(currentLine, position.character);
    if (wordInfo) {
      const { word, start } = wordInfo;
      const documentPath = getDocumentPath(document);

      // Dot-preceded word → likely an AA method call; try inner methods first
      if (start > 0 && currentLine[start - 1] === '.') {
        const allMethods = getCachedAllInnerMethods(document, documentPath, this.importResolver, siblingPatterns);
        const candidates = allMethods.filter((m) => m.nameLower === word.toLowerCase());

        if (candidates.length > 0) {
          // When names collide across classes, narrow by receiver type inference.
          const selected = (() => {
            if (candidates.length > 1) {
              const receiver = getReceiverName(currentLine, position.character);
              if (receiver) {
                const constructor = findConstructorForReceiver(lines, position.line, receiver);
                if (constructor) {
                  const typed = candidates.filter(
                    (m) => m.ownerFunction?.toLowerCase() === constructor.toLowerCase()
                  );
                  if (typed.length > 0) return typed;
                }
              }
            }
            return candidates;
          })();

          const locations = deduplicateLocations(selected.map(toMethodLocation));
          if (locations.length === 1) {
            return locations[0];
          }
          return locations;
        }
      }

      // Top-level function lookup (also covers m.topLevelFn() patterns)
      const allFunctions = getCachedAllFunctions(document, documentPath, this.importResolver, siblingPatterns);
      const funcMatch = allFunctions.find((f) => f.nameLower === word.toLowerCase());
      if (funcMatch) {
        return {
          uri: URI.file(funcMatch.filePath).toString(),
          range: Range.create(funcMatch.line, funcMatch.column, funcMatch.line, funcMatch.column + funcMatch.name.length),
        };
      }
    }

    return null;
  }
}

function toMethodLocation(m: InnerMethodDefinition): Location {
  return {
    uri: URI.file(m.filePath).toString(),
    range: Range.create(m.line, m.column, m.line, m.column + m.name.length),
  };
}

/** Removes duplicate Locations that share the same uri, start line, and start character. */
function deduplicateLocations(locations: Location[]): Location[] {
  const seen = new Set<string>();
  return locations.filter((loc) => {
    const key = `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Scans backward from `cursorLine` for `receiverName = ConstructorName(...)` and
 * returns `ConstructorName`. Returns null if no such assignment is found.
 */
function findConstructorForReceiver(lines: string[], cursorLine: number, receiverName: string): string | null {
  const escaped = receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\s*=\\s*(\\w+)\\s*\\(`, 'i');
  for (let i = cursorLine; i >= 0; i--) {
    const match = re.exec(lines[i]);
    if (match) return match[1];
  }
  return null;
}

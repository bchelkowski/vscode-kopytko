import { Location, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { InnerMethodDefinition } from '../brightscript/functionIndex';
import { getDocumentPath } from '../utils/textUtils';
import { getCachedAllInnerMethods, getCachedLines } from '../utils/documentCache';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { SymbolResolver, functionLocation, resolveWordContext } from './shared/symbolResolver';
import { getReceiverNameAtPosition, findAssignedConstructor } from './shared/receiverContext';

export class BrightScriptDefinitionProvider {
  private readonly symbolResolver: SymbolResolver;

  constructor(
    private readonly importResolver: KopytkoImportResolver,
    workspaceIndex?: WorkspaceFunctionIndex,
  ) {
    this.symbolResolver = new SymbolResolver(undefined, importResolver, workspaceIndex);
  }

  provideDefinition(
    document: TextDocument,
    position: Position,
    siblingPatterns: string[][] = [],
  ): Location | Location[] | null {
    const lines = getCachedLines(document);
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
    const wordInfo = resolveWordContext(document, position);
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
              const receiver = getReceiverNameAtPosition(document, position);
              if (receiver) {
                const constructor = findAssignedConstructor(document, position.line, receiver);
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

      // Top-level function lookup (also covers m.topLevelFn() patterns), then
      // source/ directory functions (globally accessible, not in @import chain).
      const resolved = this.symbolResolver.resolveFunctionSymbol(document, word, siblingPatterns);
      if (resolved?.kind === 'userFunction' || resolved?.kind === 'sourceFunction') {
        return functionLocation(resolved.definition);
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


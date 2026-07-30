import { SymbolInformation, SymbolKind, Location, Range } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { getCachedInnerMethodDefs } from '../utils/fileParseCache';

export class BrightScriptWorkspaceSymbolProvider {
  constructor(private readonly workspaceIndex: WorkspaceFunctionIndex) {}

  provideWorkspaceSymbols(query: string): SymbolInformation[] {
    const queryLower = query.toLowerCase();
    const symbols: SymbolInformation[] = [];

    for (const def of this.workspaceIndex.getAllFunctions()) {
      if (queryLower && !def.nameLower.includes(queryLower)) continue;
      const uri = URI.file(def.filePath).toString();
      symbols.push({
        name: def.name,
        kind: SymbolKind.Function,
        location: Location.create(uri, Range.create(def.line, def.column, def.line, def.column + def.name.length)),
      });
    }

    for (const filePath of this.workspaceIndex.getFiles()) {
      const innerDefs = getCachedInnerMethodDefs(filePath);
      if (!innerDefs) continue;
      const uri = URI.file(filePath).toString();
      for (const method of innerDefs) {
        if (queryLower && !method.nameLower.includes(queryLower)) continue;
        symbols.push({
          name: method.name,
          kind: SymbolKind.Method,
          containerName: method.ownerFunction,
          location: Location.create(uri, Range.create(method.line, method.column, method.line, method.column + method.name.length)),
        });
      }
    }

    return symbols;
  }
}

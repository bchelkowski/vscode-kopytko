import { SymbolInformation, SymbolKind, Location, Range } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { parseFunctionDefs, parseInnerMethodDefs } from '../brightscript/functionIndex';
import fsWrapper from '../utils/fsWrapper';
import { collectBrsFiles } from '../utils/brsFileCollector';

export class BrightScriptWorkspaceSymbolProvider {
  constructor(private readonly importResolver: KopytkoImportResolver) {}

  provideWorkspaceSymbols(query: string): SymbolInformation[] {
    const queryLower = query.toLowerCase();
    const symbols: SymbolInformation[] = [];

    for (const wsFolder of this.importResolver.getWorkspaceFolders()) {
      collectBrsFiles(wsFolder, (filePath) => {
        let text: string;
        try {
          text = fsWrapper.readFileSync(filePath, 'utf-8');
        } catch {
          return;
        }

        const uri = URI.file(filePath).toString();

        for (const def of parseFunctionDefs(text, filePath)) {
          if (queryLower && !def.nameLower.includes(queryLower)) continue;
          symbols.push({
            name: def.name,
            kind: SymbolKind.Function,
            location: Location.create(uri, Range.create(def.line, def.column, def.line, def.column + def.name.length)),
          });
        }

        for (const method of parseInnerMethodDefs(text, filePath)) {
          if (queryLower && !method.nameLower.includes(queryLower)) continue;
          symbols.push({
            name: method.name,
            kind: SymbolKind.Method,
            containerName: method.ownerFunction,
            location: Location.create(uri, Range.create(method.line, method.column, method.line, method.column + method.name.length)),
          });
        }
      });
    }

    return symbols;
  }
}

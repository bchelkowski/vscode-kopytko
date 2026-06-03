import { Location, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';

/**
 * Provides go-to-definition support for:
 *   - Kopytko @import paths: navigates to the imported file
 *   - (Future) function definitions within the same file / workspace
 */
export class BrightScriptDefinitionProvider {
  constructor(private readonly importResolver: KopytkoImportResolver) {}

  async provideDefinition(
    document: TextDocument,
    position: Position
  ): Promise<Location | Location[] | null> {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const currentLine = lines[position.line] ?? '';

    // Check if the cursor is on a @import line
    const importMatch = /^\s*'\s*@import\s+(\S+)(?:\s+from\s+(\S+))?/.exec(currentLine);
    if (importMatch) {
      const documentPath = URI.parse(document.uri).fsPath;
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

    // TODO: function definition lookup within workspace files
    return null;
  }
}

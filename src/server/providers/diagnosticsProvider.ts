import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';

/**
 * Provides diagnostics for BrightScript documents.
 * Currently covers:
 *   - Unresolved Kopytko @import annotations
 *   - Malformed @import syntax
 */
export class BrightScriptDiagnosticsProvider {
  constructor(private readonly importResolver: KopytkoImportResolver) {}

  async provideDiagnostics(document: TextDocument): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    const text = document.getText();
    const documentPath = URI.parse(document.uri).fsPath;

    const imports = this.importResolver.parseImports(text);

    for (const imp of imports) {
      const lineIndex = imp.line - 1;
      const lineText = text.split(/\r?\n/)[lineIndex] ?? '';

      // Check for malformed import (missing path)
      if (!imp.importPath || imp.importPath.trim() === '') {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: lineRange(lineIndex),
          message: 'Kopytko @import: missing import path.',
          source: 'kopytko',
          code: 'import/missing-path',
        });
        continue;
      }

      // Import path should start with /
      if (!imp.importPath.startsWith('/')) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: lineRange(lineIndex),
          message: `Kopytko @import: path "${imp.importPath}" should start with "/".`,
          source: 'kopytko',
          code: 'import/path-not-absolute',
        });
      }

      // Attempt file resolution
      const resolved = this.importResolver.resolveImportPath(imp, documentPath);
      if (resolved === undefined) {
        const label = imp.fromModule
          ? `"${imp.importPath}" from "${imp.fromModule}"`
          : `"${imp.importPath}"`;

        const message = imp.fromModule
          ? `Kopytko @import: cannot resolve ${label}. Is "${imp.fromModule}" installed as an NPM dependency?`
          : `Kopytko @import: cannot resolve ${label}. Check the file path and the sourceDir configuration.`;

        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: lineRange(lineIndex),
          message,
          source: 'kopytko',
          code: 'import/unresolved',
        });
      }

      // Highlight use of line comment characters inside @import (common mistake: double quote instead of apostrophe)
      if (lineText.includes('"@import')) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: lineRange(lineIndex),
          message: 'Kopytko @import must be written as a line comment starting with an apostrophe (\'), not a double quote.',
          source: 'kopytko',
          code: 'import/wrong-comment-style',
        });
      }
    }

    return diagnostics;
  }
}

function lineRange(lineIndex: number): Range {
  return {
    start: { line: lineIndex, character: 0 },
    end: { line: lineIndex, character: Number.MAX_SAFE_INTEGER },
  };
}

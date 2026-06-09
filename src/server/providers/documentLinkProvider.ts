import { DocumentLink, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { findMatchingGlob } from '../brightscript/globMatcher';

/**
 * Provides document links for Kopytko @import and @mock annotations.
 *
 * The link range covers only the path token (e.g. `/components/Foo.brs`), not
 * the full annotation. This keeps the underline tight and semantically correct —
 * the path is what you are navigating to.
 */
export class BrightScriptDocumentLinkProvider {
  constructor(private readonly importResolver: KopytkoImportResolver) {}

  provideDocumentLinks(document: TextDocument, generatedPaths: string[] = []): DocumentLink[] {
    const links: DocumentLink[] = [];
    const text = document.getText();
    const documentPath = URI.parse(document.uri).fsPath;
    const lines = text.split(/\r?\n/);
    const imports = this.importResolver.parseImports(text);

    for (const imp of imports) {
      const lineIndex = imp.line - 1;
      const lineText = lines[lineIndex] ?? '';

      // Locate the path token: the first non-whitespace sequence after '@import' or '@mock'.
      const keyword = imp.isMock ? '@mock' : '@import';
      const atIdx = lineText.indexOf(keyword);
      if (atIdx === -1) continue;

      const afterKeyword = atIdx + keyword.length;
      const spaceAndPath = /^\s+(\S+)/.exec(lineText.slice(afterKeyword));
      if (!spaceAndPath) continue;

      const pathStart = afterKeyword + spaceAndPath[0].length - spaceAndPath[1].length;
      const pathEnd = pathStart + spaceAndPath[1].length;

      // Skip build-generated paths — no real file to link to
      if (findMatchingGlob(imp.importPath, generatedPaths)) continue;

      const resolved = this.importResolver.resolveImportPath(imp, documentPath);
      if (!resolved) continue;

      links.push({
        range: Range.create(lineIndex, pathStart, lineIndex, pathEnd),
        target: URI.file(resolved).toString(),
        tooltip: resolved,
      });
    }

    return links;
  }
}

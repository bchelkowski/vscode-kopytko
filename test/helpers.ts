import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoImportResolver } from '../src/server/kopytko/importResolver';
import { KopytkoModuleCatalog } from '../src/server/kopytko/moduleCatalog';

/**
 * Creates a TextDocument for use in tests.
 * Accepts either a string or an array of lines (joined with `\n`).
 */
export function makeDocument(
  content: string | string[],
  uri = 'file:///project/app/Test.brs',
): TextDocument {
  const text = Array.isArray(content) ? content.join('\n') : content;
  return TextDocument.create(uri, 'brightscript', 1, text);
}

/** Creates a KopytkoImportResolver with sensible test defaults. */
export function makeResolver(
  opts: Partial<ConstructorParameters<typeof KopytkoImportResolver>[0]> = {},
): KopytkoImportResolver {
  return new KopytkoImportResolver({
    workspaceFolders: ['/project'],
    sourceDir: 'app',
    resolveModules: false,
    ...opts,
  });
}

/** Creates an empty KopytkoModuleCatalog (no packages scanned). */
export function makeEmptyCatalog(): KopytkoModuleCatalog {
  return new KopytkoModuleCatalog();
}

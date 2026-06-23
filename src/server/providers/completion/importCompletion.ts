import * as path from 'path';
import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  Range,
  TextEdit,
} from 'vscode-languageserver/node';
import { readCachedDir } from '../../utils/fileParseCache';
import { KopytkoImportResolver } from '../../kopytko/importResolver';
import { KopytkoModuleCatalog } from '../../kopytko/moduleCatalog';

export function kopytkoAnnotationCompletions(
  editRange: Range,
  documentPath: string,
  importResolver: KopytkoImportResolver,
): CompletionItem[] {
  const importItem: CompletionItem = {
    label: '@import',
    kind: CompletionItemKind.Keyword,
    detail: 'Kopytko internal import',
    documentation: {
      kind: MarkupKind.Markdown,
      value: "Import an internal BrightScript file.\n\n```brightscript\n' @import /components/MyComponent.brs\n```",
    },
    textEdit: TextEdit.replace(editRange, "' @import /"),
    command: { title: 'Re-trigger completions', command: 'editor.action.triggerSuggest' },
  };

  const mockItem: CompletionItem = {
    label: '@mock',
    kind: CompletionItemKind.Keyword,
    detail: 'Kopytko test mock dependency',
    documentation: {
      kind: MarkupKind.Markdown,
      value: "Mock a dependency in tests. Functions from this file can be controlled via `mockFunction()`.\n\n```brightscript\n' @mock /components/MyService.brs\n' @mock /components/Router.brs from @dazn/kopytko-framework\n```",
    },
    textEdit: TextEdit.replace(editRange, "' @mock /"),
    command: { title: 'Re-trigger completions', command: 'editor.action.triggerSuggest' },
  };

  const packageItems = buildPackageAnnotationItems(editRange, documentPath, importResolver);
  return [importItem, mockItem, ...packageItems];
}

export function importPathCompletions(
  typedPrefix: string,
  editRange: Range,
  documentPath: string,
  importResolver: KopytkoImportResolver,
  fromPackage?: string,
): CompletionItem[] {
  const lastSlash = typedPrefix.lastIndexOf('/');
  const dirPart = typedPrefix.substring(0, lastSlash + 1);
  const namePart = typedPrefix.substring(lastSlash + 1).toLowerCase();

  const baseDirs: string[] = fromPackage
    ? (() => {
        const d = importResolver.resolvePackageBaseDir(fromPackage, documentPath);
        return d ? [d] : [];
      })()
    : importResolver.getWorkspaceFolders()
        .map((ws) => path.join(ws, importResolver.getSourceDir()));

  const results: CompletionItem[] = [];
  for (const baseDir of baseDirs) {
    const relDir = dirPart.length > 1 ? dirPart.slice(1, -1) : '';
    const absDir = relDir ? path.join(baseDir, relDir) : baseDir;

    const entries = readCachedDir(absDir);
    if (entries === undefined) continue;

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (!entry.name.toLowerCase().startsWith(namePart)) continue;

      if (entry.isDirectory) {
        const newText = entry.name + '/';
        results.push({
          label: entry.name + '/',
          kind: CompletionItemKind.Folder,
          detail: 'directory',
          filterText: entry.name + '/',
          insertText: newText,
          textEdit: TextEdit.replace(editRange, newText),
          sortText: '0_' + entry.name,
          command: { title: 'Re-trigger completions', command: 'editor.action.triggerSuggest' },
        });
      } else if (entry.name.endsWith('.brs')) {
        results.push({
          label: entry.name,
          kind: CompletionItemKind.File,
          detail: entry.name,
          filterText: entry.name,
          insertText: entry.name,
          textEdit: TextEdit.replace(editRange, entry.name),
          sortText: '1_' + entry.name,
        });
      }
    }
  }
  results.sort((a, b) => {
    const sa = a.sortText ?? a.label;
    const sb = b.sortText ?? b.label;
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return results;
}

export function importModuleCompletions(documentPath: string, importResolver: KopytkoImportResolver): CompletionItem[] {
  return importResolver.getInstalledKopytkoPackages(documentPath).map((pkg) => ({
    label: pkg,
    kind: CompletionItemKind.Module,
    detail: pkg,
  }));
}

export function kopytkoExportCompletions(
  documentUri: string,
  catalog?: KopytkoModuleCatalog,
): CompletionItem[] {
  if (!catalog || catalog.size === 0) return [];
  const items: CompletionItem[] = [];

  for (const entry of catalog.getEntries()) {
    items.push({
      label: entry.name,
      kind: CompletionItemKind.Function,
      detail: entry.npmPackage,
      sortText: `2_${entry.name}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `\`\`\`brightscript\n${entry.signature}\n\`\`\`\n\n*${entry.npmPackage}*`,
      },
      data: {
        kind: 'kopytkoExport',
        documentUri,
        importPath: entry.importPath,
        npmPackage: entry.npmPackage,
      },
    });
  }
  return items;
}

function buildPackageAnnotationItems(
  editRange: Range,
  documentPath: string,
  importResolver: KopytkoImportResolver,
): CompletionItem[] {
  return importResolver.getInstalledKopytkoPackages(documentPath).map((pkg) => ({
    label: `@import … from ${pkg}`,
    kind: CompletionItemKind.Module,
    insertTextFormat: InsertTextFormat.Snippet,
    detail: `Kopytko module: ${pkg}`,
    textEdit: TextEdit.replace(editRange, `' @import /$0 from ${pkg}`),
    command: { title: 'Re-trigger completions', command: 'editor.action.triggerSuggest' },
  }));
}

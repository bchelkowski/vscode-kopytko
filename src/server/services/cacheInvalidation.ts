import {
  Connection,
  DidChangeWatchedFilesParams,
  FileChangeType,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { KopytkoModuleCatalog } from '../kopytko/moduleCatalog';
import { invalidateAllCaches, invalidateDocumentCaches } from '../utils/documentCache';
import { invalidateFileParseCache } from '../utils/fileParseCache';
import { WorkspaceCallIndex } from '../utils/workspaceCallIndex';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';

export interface CacheInvalidationDeps {
  importResolver: () => KopytkoImportResolver;
  catalog: () => KopytkoModuleCatalog;
  workspaceIndex: WorkspaceFunctionIndex;
  workspaceCallIndex: WorkspaceCallIndex;
  documents: TextDocuments<TextDocument>;
  scheduleValidation: (document: TextDocument) => void;
}

export class CacheInvalidationService {
  constructor(
    private readonly connection: Connection,
    private readonly deps: CacheInvalidationDeps,
  ) {}

  registerWatchedFileHandler(): void {
    this.connection.onDidChangeWatchedFiles((params) => this.handleWatchedFiles(params));
  }

  async handleConfigurationChanged(refreshConfiguration: () => Promise<void>): Promise<void> {
    await refreshConfiguration();
    this.revalidateOpenDocuments();
  }

  handleWatchedFiles(params: DidChangeWatchedFilesParams): void {
    const importResolver = this.deps.importResolver();
    const catalog = this.deps.catalog();
    const hasPackageChange = params.changes.some(
      (c) => c.uri.endsWith('package.json') || c.uri.includes('node_modules')
    );
    if (hasPackageChange) {
      importResolver.invalidatePackageCache();
      catalog.scan(importResolver.getWorkspaceFolders()[0] ?? '/', importResolver);
    }

    for (const change of params.changes) {
      const fsPath = URI.parse(change.uri).fsPath;
      if (change.uri.endsWith('.brs')) {
        if (change.type === FileChangeType.Deleted) {
          this.deps.workspaceIndex.removeFile(fsPath);
          this.deps.workspaceCallIndex.removeFile(fsPath);
        } else {
          this.deps.workspaceIndex.updateFile(fsPath);
          this.deps.workspaceCallIndex.updateFile(fsPath);
        }
      } else if (change.uri.endsWith('.xml')) {
        invalidateFileParseCache(fsPath);
        if (change.type === FileChangeType.Deleted) {
          this.deps.workspaceCallIndex.removeFile(fsPath);
        } else {
          this.deps.workspaceCallIndex.updateFile(fsPath);
        }
      }
    }

    if (hasPackageChange) {
      invalidateAllCaches();
    } else {
      invalidateDocumentCaches();
    }
    this.revalidateOpenDocuments();
  }

  revalidateOpenDocuments(): void {
    for (const document of this.deps.documents.all()) {
      this.deps.scheduleValidation(document);
    }
  }
}

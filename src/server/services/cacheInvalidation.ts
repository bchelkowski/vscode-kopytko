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
import { WorkspaceComponentIndex } from '../utils/workspaceComponentIndex';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';

export interface CacheInvalidationDeps {
  importResolver: () => KopytkoImportResolver;
  catalog: () => KopytkoModuleCatalog;
  workspaceIndex: WorkspaceFunctionIndex;
  workspaceCallIndex: WorkspaceCallIndex;
  workspaceComponentIndex: WorkspaceComponentIndex;
  documents: TextDocuments<TextDocument>;
  scheduleValidation: (document: TextDocument) => void;
  /** Re-runs the workspace-level component checks after the index changes. */
  refreshComponentDiagnostics: () => void;
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
    // The exclusion globs the component checks honour are settings themselves.
    this.deps.refreshComponentDiagnostics();
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

    let componentsChanged = false;
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
        componentsChanged = true;
        if (change.type === FileChangeType.Deleted) {
          this.deps.workspaceCallIndex.removeFile(fsPath);
          this.deps.workspaceComponentIndex.removeFile(fsPath);
        } else {
          this.deps.workspaceCallIndex.updateFile(fsPath);
          this.deps.workspaceComponentIndex.updateFile(fsPath);
        }
      }
    }

    if (componentsChanged) {
      this.deps.refreshComponentDiagnostics();
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

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionParams,
  Hover,
  HoverParams,
  DefinitionParams,
  DocumentSymbol,
  DocumentSymbolParams,
  SymbolInformation,
  WorkspaceSymbolParams,
  ReferenceParams,
  RenameParams,
  PrepareRenameParams,
  SignatureHelpParams,
  CodeActionParams,
  CodeActionKind,
  Location,
  DiagnosticSeverity,
  Diagnostic,
  TextDocumentChangeEvent,
  DidChangeConfigurationNotification,
  TextEdit,
  WorkspaceEdit,
  DocumentFormattingParams,
  DidChangeWatchedFilesParams,
  FileChangeType,
} from 'vscode-languageserver/node';
import type { Connection } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { KopytkoImportResolver } from './kopytko/importResolver';
import { KopytkoModuleCatalog } from './kopytko/moduleCatalog';
import { BrightScriptDiagnosticsProvider } from './providers/diagnosticsProvider';
import { BrightScriptCompletionProvider } from './providers/completionProvider';
import { BrightScriptHoverProvider } from './providers/hoverProvider';
import { BrightScriptDefinitionProvider } from './providers/definitionProvider';
import { BrightScriptDocumentLinkProvider } from './providers/documentLinkProvider';
import { BrightScriptReferencesProvider } from './providers/referencesProvider';
import { BrightScriptSignatureHelpProvider } from './providers/signatureHelpProvider';
import { BrightScriptDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { BrightScriptWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { BrightScriptRenameProvider } from './providers/renameProvider';
import { BrightScriptCodeActionProvider } from './providers/codeActionProvider';
import { BrightScriptFormattingProvider } from './providers/formattingProvider';
import { CasingConfig, DEFAULT_CASING_CONFIG, CasingOption } from './brightscript/casingUtils';
import { FormattingConfig, DEFAULT_FORMATTING_CONFIG, parseFormattingConfig } from './brightscript/formattingConfig';
import { GeneratedModuleConfig } from './providers/diagnosticsProvider';
import { invalidateAllCaches, getCachedAllFunctions } from './utils/documentCache';
import { WorkspaceFunctionIndex } from './utils/workspaceFunctionIndex';
import { findMatchingGlob } from './brightscript/globMatcher';

const connection: Connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments<TextDocument>(TextDocument);
const workspaceIndex = new WorkspaceFunctionIndex();

let importResolver: KopytkoImportResolver;
let catalog: KopytkoModuleCatalog;
let diagnosticsProvider: BrightScriptDiagnosticsProvider;
let completionProvider: BrightScriptCompletionProvider;
let hoverProvider: BrightScriptHoverProvider;
let definitionProvider: BrightScriptDefinitionProvider;
let documentLinkProvider: BrightScriptDocumentLinkProvider;
let referencesProvider: BrightScriptReferencesProvider;
let signatureHelpProvider: BrightScriptSignatureHelpProvider;
let documentSymbolProvider: BrightScriptDocumentSymbolProvider;
let workspaceSymbolProvider: BrightScriptWorkspaceSymbolProvider;
let renameProvider: BrightScriptRenameProvider;
let codeActionProvider: BrightScriptCodeActionProvider;
let formattingProvider: BrightScriptFormattingProvider;
let casingConfig: CasingConfig = { ...DEFAULT_CASING_CONFIG };
let formattingConfig: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG };
let generatedPaths: string[] = [];
let generatedModules: GeneratedModuleConfig[] = [];
let siblingPatterns: string[][] = [];
let readOnlyPaths: string[] = [];
connection.onInitialize((params: InitializeParams): InitializeResult => {
  const initOptions = params.initializationOptions ?? {};
  const workspaceFolders: string[] = initOptions.workspaceFolders ?? [];
  const sourceDir: string = initOptions.sourceDir ?? 'app';
  const resolveModules: boolean = initOptions.resolveModules ?? true;

  importResolver = new KopytkoImportResolver({ workspaceFolders, sourceDir, resolveModules });
  catalog = new KopytkoModuleCatalog();
  diagnosticsProvider = new BrightScriptDiagnosticsProvider(importResolver);
  completionProvider = new BrightScriptCompletionProvider(importResolver, catalog);
  hoverProvider = new BrightScriptHoverProvider(catalog, importResolver);
  definitionProvider = new BrightScriptDefinitionProvider(importResolver);
  documentLinkProvider = new BrightScriptDocumentLinkProvider(importResolver);
  referencesProvider = new BrightScriptReferencesProvider(workspaceIndex);
  signatureHelpProvider = new BrightScriptSignatureHelpProvider(importResolver, catalog);
  documentSymbolProvider = new BrightScriptDocumentSymbolProvider();
  workspaceSymbolProvider = new BrightScriptWorkspaceSymbolProvider(importResolver);
  renameProvider = new BrightScriptRenameProvider(importResolver, workspaceIndex);
  codeActionProvider = new BrightScriptCodeActionProvider();
  formattingProvider = new BrightScriptFormattingProvider();

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      documentFormattingProvider: true,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['.', '@', '/', '"'],
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
      },
      documentLinkProvider: { resolveProvider: false },
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      renameProvider: {
        prepareProvider: true,
      },
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
    },
    serverInfo: {
      name: 'Kopytko BrightScript Language Server',
      version: '0.1.0',
    },
  };
});

connection.onInitialized(async () => {
  connection.console.log('Kopytko BrightScript Language Server initialized.');
  connection.client.register(DidChangeConfigurationNotification.type, {
    section: 'kopytko',
  });
  await refreshConfiguration();
  workspaceIndex.build(importResolver.getWorkspaceFolders());
  // Re-validate all documents that may have been validated before config loaded
  for (const document of documents.all()) {
    scheduleValidation(document);
  }
});

connection.onDidChangeConfiguration(async () => {
  await refreshConfiguration();
  for (const document of documents.all()) {
    scheduleValidation(document);
  }
});

// Invalidate caches when files change on disk
connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
  const hasPackageChange = params.changes.some(
    (c) => c.uri.endsWith('package.json') || c.uri.includes('node_modules')
  );
  if (hasPackageChange) {
    importResolver.invalidatePackageCache();
    catalog.scan(importResolver.getWorkspaceFolders()[0] ?? '/', importResolver);
  }

  // Update workspace function index incrementally
  for (const change of params.changes) {
    if (!change.uri.endsWith('.brs')) continue;
    const fsPath = URI.parse(change.uri).fsPath;
    if (change.type === FileChangeType.Deleted) {
      workspaceIndex.removeFile(fsPath);
    } else {
      workspaceIndex.updateFile(fsPath);
    }
  }

  // Any .brs or .xml change invalidates the document function cache
  invalidateAllCaches();
  for (const document of documents.all()) {
    scheduleValidation(document);
  }
});

async function refreshConfiguration(): Promise<void> {
  casingConfig = await fetchCasingConfig();
  formattingConfig = await fetchFormattingConfig();
  const importCfg = await fetchImportConfig();
  generatedPaths = importCfg.generatedPaths;
  generatedModules = importCfg.generatedModules;
  siblingPatterns = importCfg.siblingPatterns;
  readOnlyPaths = await fetchReadOnlyPaths();
  invalidateAllCaches();
  importResolver.invalidatePackageCache();
  catalog.scan(importResolver.getWorkspaceFolders()[0] ?? '/', importResolver);
}

async function fetchImportConfig(): Promise<{ generatedPaths: string[]; generatedModules: GeneratedModuleConfig[]; siblingPatterns: string[][] }> {
  try {
    const cfg = await connection.workspace.getConfiguration('kopytko.imports');
    const paths = cfg?.generatedPaths;
    const modules = cfg?.generatedModules;
    const patterns = cfg?.siblingPatterns;
    return {
      generatedPaths: Array.isArray(paths) ? paths.filter((p: unknown) => typeof p === 'string') : [],
      generatedModules: Array.isArray(modules)
        ? modules.filter(
            (m: unknown): m is GeneratedModuleConfig =>
              typeof m === 'object' && m !== null &&
              typeof (m as GeneratedModuleConfig).path === 'string' &&
              Array.isArray((m as GeneratedModuleConfig).functions) &&
              (m as GeneratedModuleConfig).functions.every((f: unknown) => typeof f === 'string'),
          )
        : [],
      siblingPatterns: Array.isArray(patterns)
        ? patterns.filter(
            (group: unknown): group is string[] =>
              Array.isArray(group) && (group as unknown[]).every((p) => typeof p === 'string'),
          )
        : [],
    };
  } catch {
    return { generatedPaths: [], generatedModules: [], siblingPatterns: [] };
  }
}

async function fetchReadOnlyPaths(): Promise<string[]> {
  try {
    const cfg = await connection.workspace.getConfiguration('kopytko');
    const paths = cfg?.readOnlyPaths;
    return Array.isArray(paths) ? paths.filter((p: unknown) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

async function fetchCasingConfig(): Promise<CasingConfig> {
  try {
    const cfg = await connection.workspace.getConfiguration('kopytko.format');
    const exact = cfg?.exactCasing;
    return {
      builtins: (cfg?.builtinCasing ?? 'NoChange') as CasingOption,
      keywords: (cfg?.keywordCasing ?? 'NoChange') as CasingOption,
      methods:  (cfg?.methodCasing  ?? 'NoChange') as CasingOption,
      types: (cfg?.typeCasing ?? undefined) as CasingOption | undefined,
      literals: (cfg?.literalCasing ?? undefined) as CasingOption | undefined,
      logicOperators: (cfg?.logicOperatorCasing ?? undefined) as CasingOption | undefined,
      mathOperators: (cfg?.mathOperatorCasing ?? undefined) as CasingOption | undefined,
      userFunctions: (cfg?.userFunctionCasing ?? 'NoChange') as CasingOption,
      userMethods: (cfg?.userMethodCasing ?? 'NoChange') as CasingOption,
      exactCasing: (exact && typeof exact === 'object' && !Array.isArray(exact))
        ? Object.fromEntries(
            Object.entries(exact as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k.toLowerCase(), v as string])
          )
        : {},
    };
  } catch {
    return { ...DEFAULT_CASING_CONFIG };
  }
}

async function fetchFormattingConfig(): Promise<FormattingConfig> {
  try {
    const cfg = await connection.workspace.getConfiguration('kopytko.format');
    return parseFormattingConfig(cfg);
  } catch {
    return { ...DEFAULT_FORMATTING_CONFIG };
  }
}

// Validate documents on open and change (with debounce)
let validationSeq = 0;
const VALIDATION_DELAY_MS = 300;

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
  scheduleValidation(change.document);
});

documents.onDidOpen((event) => {
  validateDocument(event.document);
});

function scheduleValidation(document: TextDocument): void {
  const seq = ++validationSeq;
  setTimeout(() => {
    if (seq !== validationSeq) return; // superseded by a newer change
    validateDocument(document);
  }, VALIDATION_DELAY_MS);
}

function validateDocument(document: TextDocument): void {
  if (!isBrightScriptDocument(document)) {
    return;
  }

  try {
    const diagnostics: Diagnostic[] = diagnosticsProvider.provideDiagnostics(document, generatedPaths, generatedModules, siblingPatterns);
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
  } catch (err) {
    connection.console.error(`[kopytko] Error validating ${document.uri}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

function isBrightScriptDocument(document: TextDocument): boolean {
  return document.languageId === 'brightscript' || document.uri.endsWith('.brs');
}

/** Returns the BrightScript document for the given URI, or undefined if not found/applicable. */
function getBrsDocument(uri: string): TextDocument | undefined {
  const document = documents.get(uri);
  return document && isBrightScriptDocument(document) ? document : undefined;
}

/** Checks if a document URI matches any readOnlyPaths glob pattern. */
function isReadOnlyPath(uri: string): boolean {
  if (readOnlyPaths.length === 0) return false;
  const fsPath = URI.parse(uri).fsPath.replace(/\\/g, '/');
  return readOnlyPaths.some((pattern) => findMatchingGlob(fsPath, [pattern]) !== undefined);
}

// Completion
connection.onCompletion((params: CompletionParams): CompletionItem[] => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return [];
  return completionProvider.provideCompletions(document, params.position, casingConfig, siblingPatterns);
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  const data = item.data as { kind?: string; documentUri?: string; importPath?: string; npmPackage?: string } | undefined;
  if (data?.kind === 'kopytkoExport' && data.documentUri && data.importPath && data.npmPackage) {
    const document = documents.get(data.documentUri);
    if (document) {
      const importLine = `' @import ${data.importPath} from ${data.npmPackage}`;
      const alreadyImported = document.getText().split(/\r?\n/).some(
        (line) => line.trim() === importLine
      );
      if (!alreadyImported) {
        item.additionalTextEdits = [
          TextEdit.insert({ line: 0, character: 0 }, importLine + '\n'),
        ];
      }
    }
  }
  return item;
});

// Hover
connection.onHover((params: HoverParams): Hover | null => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return null;
  return hoverProvider.provideHover(document, params.position, siblingPatterns);
});

// Go-to-definition
connection.onDefinition((params: DefinitionParams): Location | Location[] | null => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return null;
  return definitionProvider.provideDefinition(document, params.position, siblingPatterns);
});

// References (Find Usages)
connection.onReferences((params: ReferenceParams): Location[] => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return [];
  return referencesProvider.provideReferences(document, params);
});

// Signature help
connection.onSignatureHelp((params: SignatureHelpParams) => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return null;
  return signatureHelpProvider.provideSignatureHelp(document, params.position, siblingPatterns);
});

// Document symbols (Outline panel + breadcrumb)
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return [];
  return documentSymbolProvider.provideDocumentSymbols(document);
});

// Workspace symbols (Ctrl+T symbol search)
connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
  return workspaceSymbolProvider.provideWorkspaceSymbols(params.query);
});

// Rename symbol
connection.onPrepareRename((params: PrepareRenameParams) => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return null;
  return renameProvider.prepareRename(document, params.position);
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return null;
  return renameProvider.provideRename(document, params.position, params.newName);
});

// Code actions (quick fixes on import diagnostics)
connection.onCodeAction((params: CodeActionParams) => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return [];
  if (isReadOnlyPath(document.uri)) return [];
  return codeActionProvider.provideCodeActions(document, params);
});

// Document links (@import as clickable URL)
connection.onDocumentLinks((params) => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return [];
  return documentLinkProvider.provideDocumentLinks(document, generatedPaths);
});

// Document formatting
connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
  const document = getBrsDocument(params.textDocument.uri);
  if (!document) return [];
  if (isReadOnlyPath(document.uri)) return [];
  const documentPath = URI.parse(document.uri).fsPath;
  const allFunctions = getCachedAllFunctions(document, documentPath, importResolver, siblingPatterns);
  return formattingProvider.provideDocumentFormatting(document, formattingConfig, casingConfig, allFunctions);
});

// Wire up
documents.listen(connection);
connection.listen();

export { connection, documents, DiagnosticSeverity };

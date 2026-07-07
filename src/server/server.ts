import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CodeActionKind,
  DiagnosticSeverity,
  Diagnostic,
  TextDocumentChangeEvent,
  DidChangeConfigurationNotification,
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
import { BrightScriptSemanticTokensProvider } from './providers/semanticTokensProvider';
import { BrightScriptFoldingRangeProvider } from './providers/foldingRangeProvider';
import { BrightScriptSelectionRangeProvider } from './providers/selectionRangeProvider';
import { BrightScriptCallHierarchyProvider } from './providers/callHierarchyProvider';
import { CasingConfig, DEFAULT_CASING_CONFIG, CasingOption } from 'kopytko-brightscript-parser';
import type { RuleConfig } from 'kopytko-linter';
import { FormattingConfig, DEFAULT_FORMATTING_CONFIG, parseFormattingConfig } from './brightscript/formattingConfig';
import { GeneratedModuleConfig } from './providers/diagnosticsProvider';
import { invalidateAllCaches } from './utils/documentCache';
import { WorkspaceFunctionIndex } from './utils/workspaceFunctionIndex';
import { WorkspaceCallIndex } from './utils/workspaceCallIndex';
import { findMatchingGlob } from 'kopytko-brightscript-parser';
import { registerHandlers } from './registerHandlers';
import { CacheInvalidationService } from './services/cacheInvalidation';

const connection: Connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments<TextDocument>(TextDocument);
const workspaceIndex = new WorkspaceFunctionIndex();
const workspaceCallIndex = new WorkspaceCallIndex();

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
let semanticTokensProvider: BrightScriptSemanticTokensProvider;
let foldingRangeProvider: BrightScriptFoldingRangeProvider;
let selectionRangeProvider: BrightScriptSelectionRangeProvider;
let callHierarchyProvider: BrightScriptCallHierarchyProvider;
let cacheInvalidationService: CacheInvalidationService;
let casingConfig: CasingConfig = { ...DEFAULT_CASING_CONFIG };
let formattingConfig: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG };
let generatedPaths: string[] = [];
let generatedModules: GeneratedModuleConfig[] = [];
let siblingPatterns: string[][] = [];
let readOnlyPaths: string[] = [];
let lintReadOnlyPaths: string[] = [];
let lintRuleOverrides: Partial<RuleConfig> = {};
connection.onInitialize((params: InitializeParams): InitializeResult => {
  const initOptions = params.initializationOptions ?? {};
  const workspaceFolders: string[] = initOptions.workspaceFolders ?? [];
  const sourceDir: string = initOptions.sourceDir ?? 'app';
  const resolveModules: boolean = initOptions.resolveModules ?? true;

  importResolver = new KopytkoImportResolver({ workspaceFolders, sourceDir, resolveModules });
  catalog = new KopytkoModuleCatalog();
  diagnosticsProvider = new BrightScriptDiagnosticsProvider(importResolver, workspaceIndex, catalog, workspaceCallIndex);
  completionProvider = new BrightScriptCompletionProvider(importResolver, catalog, workspaceIndex);
  hoverProvider = new BrightScriptHoverProvider(catalog, importResolver, workspaceIndex);
  definitionProvider = new BrightScriptDefinitionProvider(importResolver, workspaceIndex);
  documentLinkProvider = new BrightScriptDocumentLinkProvider(importResolver);
  referencesProvider = new BrightScriptReferencesProvider(workspaceIndex);
  signatureHelpProvider = new BrightScriptSignatureHelpProvider(importResolver, catalog, workspaceIndex);
  documentSymbolProvider = new BrightScriptDocumentSymbolProvider();
  workspaceSymbolProvider = new BrightScriptWorkspaceSymbolProvider(importResolver);
  renameProvider = new BrightScriptRenameProvider(importResolver, workspaceIndex);
  codeActionProvider = new BrightScriptCodeActionProvider();
  formattingProvider = new BrightScriptFormattingProvider();
  semanticTokensProvider = new BrightScriptSemanticTokensProvider();
  foldingRangeProvider = new BrightScriptFoldingRangeProvider();
  selectionRangeProvider = new BrightScriptSelectionRangeProvider();
  callHierarchyProvider = new BrightScriptCallHierarchyProvider(workspaceIndex);
  cacheInvalidationService = new CacheInvalidationService(connection, {
    importResolver: () => importResolver,
    catalog: () => catalog,
    workspaceIndex,
    workspaceCallIndex,
    documents,
    scheduleValidation,
  });
  cacheInvalidationService.registerWatchedFileHandler();
  registerHandlers(
    connection,
    documents,
    {
      completionProvider,
      hoverProvider,
      definitionProvider,
      documentLinkProvider,
      referencesProvider,
      signatureHelpProvider,
      documentSymbolProvider,
      workspaceSymbolProvider,
      renameProvider,
      codeActionProvider,
      formattingProvider,
      semanticTokensProvider,
      foldingRangeProvider,
      selectionRangeProvider,
      callHierarchyProvider,
    },
    {
      casingConfig: () => casingConfig,
      formattingConfig: () => formattingConfig,
      generatedPaths: () => generatedPaths,
      siblingPatterns: () => siblingPatterns,
    },
    {
      importResolver: () => importResolver,
      getBrsDocument,
      isReadOnlyPath,
    },
  );

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
      semanticTokensProvider: {
        legend: semanticTokensProvider.getLegend(),
        full: true,
      },
      foldingRangeProvider: true,
      selectionRangeProvider: true,
      callHierarchyProvider: true,
    },
    serverInfo: {
      name: 'Kopytko BrightScript Language Server',
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      version: require('../../package.json').version ?? '0.0.0',
    },
  };
});

connection.onInitialized(async () => {
  connection.console.log('Kopytko BrightScript Language Server initialized.');
  connection.client.register(DidChangeConfigurationNotification.type, {
    section: 'kopytko',
  });
  await refreshConfiguration(true);
  workspaceIndex.build(importResolver.getWorkspaceFolders());
  workspaceCallIndex.build(importResolver.getWorkspaceFolders());
  // Re-validate all documents that may have been validated before config loaded
  cacheInvalidationService.revalidateOpenDocuments();
});

connection.onDidChangeConfiguration(async () => {
  await cacheInvalidationService.handleConfigurationChanged(() => refreshConfiguration(false));
});

async function refreshConfiguration(rescanPackages: boolean): Promise<void> {
  casingConfig = await fetchCasingConfig();
  formattingConfig = await fetchFormattingConfig();
  const importCfg = await fetchImportConfig();
  generatedPaths = importCfg.generatedPaths;
  generatedModules = importCfg.generatedModules;
  siblingPatterns = importCfg.siblingPatterns;
  readOnlyPaths = await fetchReadOnlyPaths();
  lintReadOnlyPaths = await fetchLintReadOnlyPaths();
  lintRuleOverrides = await fetchLintRuleOverrides();
  formattingProvider.setReadOnlyCheck(isReadOnlyPath);
  invalidateAllCaches();
  // The installed Kopytko package list and the module catalog depend on
  // node_modules, not on user settings (the import resolver's sourceDir and
  // workspace folders are fixed at construction). So a plain settings change no
  // longer triggers a full package re-walk — that runs once at startup, and
  // package.json/node_modules changes are handled in onDidChangeWatchedFiles.
  if (rescanPackages) {
    importResolver.invalidatePackageCache();
    catalog.scan(importResolver.getWorkspaceFolders()[0] ?? '/', importResolver);
  }
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
    // Format-specific takes priority over shared fallback
    const formatCfg = await connection.workspace.getConfiguration('kopytko.format');
    const formatPaths = formatCfg?.readOnlyPaths;
    if (Array.isArray(formatPaths) && formatPaths.length > 0) {
      return formatPaths.filter((p: unknown) => typeof p === 'string');
    }
    // Shared fallback
    const cfg = await connection.workspace.getConfiguration('kopytko');
    const paths = cfg?.readOnlyPaths;
    return Array.isArray(paths) ? paths.filter((p: unknown) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

async function fetchLintReadOnlyPaths(): Promise<string[]> {
  try {
    // Lint-specific takes priority over shared fallback
    const lintCfg = await connection.workspace.getConfiguration('kopytko.lint');
    const lintPaths = lintCfg?.readOnlyPaths;
    if (Array.isArray(lintPaths) && lintPaths.length > 0) {
      return lintPaths.filter((p: unknown) => typeof p === 'string');
    }
    // Shared fallback
    const cfg = await connection.workspace.getConfiguration('kopytko');
    const paths = cfg?.readOnlyPaths;
    return Array.isArray(paths) ? paths.filter((p: unknown) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

const VALID_RULE_SEVERITIES = new Set(['error', 'warning', 'info', 'hint', 'off']);

async function fetchLintRuleOverrides(): Promise<Partial<RuleConfig>> {
  try {
    const cfg = await connection.workspace.getConfiguration('kopytko.lint.rules');
    const overrides: Partial<RuleConfig> = {};
    for (const rule of ['type/missing-return-type', 'type/missing-param-type'] as const) {
      const value = cfg?.[rule];
      if (typeof value === 'string' && VALID_RULE_SEVERITIES.has(value)) {
        overrides[rule] = value as RuleConfig[string];
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

async function fetchCasingConfig(): Promise<CasingConfig> {
  try {
    const cfg = await connection.workspace.getConfiguration('kopytko.casing');
    const exact = cfg?.exact;
    return {
      builtin: (cfg?.builtin ?? 'preserve') as CasingOption,
      keyword: (cfg?.keyword ?? 'preserve') as CasingOption,
      method:  (cfg?.method  ?? 'preserve') as CasingOption,
      type: (cfg?.type ?? undefined) as CasingOption | undefined,
      literal: (cfg?.literal ?? undefined) as CasingOption | undefined,
      logicOperator: (cfg?.logicOperator ?? undefined) as CasingOption | undefined,
      mathOperator: (cfg?.mathOperator ?? undefined) as CasingOption | undefined,
      userFunction: (cfg?.userFunction ?? 'preserve') as CasingOption,
      userMethod: (cfg?.userMethod ?? 'preserve') as CasingOption,
      exact: (exact && typeof exact === 'object' && !Array.isArray(exact))
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

  if (isLintReadOnlyPath(document.uri)) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }

  try {
    const diagnostics: Diagnostic[] = diagnosticsProvider.provideDiagnostics(document, generatedPaths, generatedModules, siblingPatterns, lintRuleOverrides);
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

/** Checks if a document URI matches any readOnlyPaths glob pattern (formatter). */
function isReadOnlyPath(uri: string): boolean {
  if (readOnlyPaths.length === 0) return false;
  const fsPath = URI.parse(uri).fsPath.replace(/\\/g, '/');
  return readOnlyPaths.some((pattern) => findMatchingGlob(fsPath, [pattern]) !== undefined);
}

/** Checks if a document URI matches any lintReadOnlyPaths glob pattern (linter). */
function isLintReadOnlyPath(uri: string): boolean {
  if (lintReadOnlyPaths.length === 0) return false;
  const fsPath = URI.parse(uri).fsPath.replace(/\\/g, '/');
  return lintReadOnlyPaths.some((pattern) => findMatchingGlob(fsPath, [pattern]) !== undefined);
}

// Wire up
documents.listen(connection);
connection.listen();

export { connection, documents, DiagnosticSeverity };

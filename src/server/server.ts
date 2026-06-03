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
  Location,
  DiagnosticSeverity,
  Diagnostic,
  TextDocumentChangeEvent,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoImportResolver } from './kopytko/importResolver';
import { BrightScriptDiagnosticsProvider } from './providers/diagnosticsProvider';
import { BrightScriptCompletionProvider } from './providers/completionProvider';
import { BrightScriptHoverProvider } from './providers/hoverProvider';
import { BrightScriptDefinitionProvider } from './providers/definitionProvider';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments<TextDocument>(TextDocument);

let importResolver: KopytkoImportResolver;
let diagnosticsProvider: BrightScriptDiagnosticsProvider;
let completionProvider: BrightScriptCompletionProvider;
let hoverProvider: BrightScriptHoverProvider;
let definitionProvider: BrightScriptDefinitionProvider;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const initOptions = params.initializationOptions ?? {};
  const workspaceFolders: string[] = initOptions.workspaceFolders ?? [];
  const sourceDir: string = initOptions.sourceDir ?? 'app';
  const resolveModules: boolean = initOptions.resolveModules ?? true;

  importResolver = new KopytkoImportResolver({ workspaceFolders, sourceDir, resolveModules });
  diagnosticsProvider = new BrightScriptDiagnosticsProvider(importResolver);
  completionProvider = new BrightScriptCompletionProvider(importResolver);
  hoverProvider = new BrightScriptHoverProvider();
  definitionProvider = new BrightScriptDefinitionProvider(importResolver);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['.', '@', '/'],
      },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: false,
    },
    serverInfo: {
      name: 'Kopytko BrightScript Language Server',
      version: '0.1.0',
    },
  };
});

connection.onInitialized(() => {
  connection.console.log('Kopytko BrightScript Language Server initialized.');
});

// Validate documents on open and change
documents.onDidChangeContent(async (change: TextDocumentChangeEvent<TextDocument>) => {
  await validateDocument(change.document);
});

documents.onDidOpen(async (event) => {
  await validateDocument(event.document);
});

async function validateDocument(document: TextDocument): Promise<void> {
  if (!isBrightScriptDocument(document)) {
    return;
  }

  const diagnostics: Diagnostic[] = await diagnosticsProvider.provideDiagnostics(document);
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

function isBrightScriptDocument(document: TextDocument): boolean {
  return (
    document.languageId === 'brightscript' ||
    document.uri.endsWith('.brs') ||
    document.uri.endsWith('.bs')
  );
}

// Completion
connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !isBrightScriptDocument(document)) {
    return [];
  }
  return completionProvider.provideCompletions(document, params.position);
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return item;
});

// Hover
connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !isBrightScriptDocument(document)) {
    return null;
  }
  return hoverProvider.provideHover(document, params.position);
});

// Go-to-definition
connection.onDefinition(async (params: DefinitionParams): Promise<Location | Location[] | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !isBrightScriptDocument(document)) {
    return null;
  }
  return definitionProvider.provideDefinition(document, params.position);
});

// Wire up
documents.listen(connection);
connection.listen();

export { connection, documents, DiagnosticSeverity };

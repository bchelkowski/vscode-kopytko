import {
  CodeActionParams,
  CompletionItem,
  CompletionParams,
  Connection,
  DefinitionParams,
  DocumentFormattingParams,
  DocumentSymbol,
  DocumentSymbolParams,
  FoldingRange,
  FoldingRangeParams,
  Hover,
  HoverParams,
  Location,
  PrepareRenameParams,
  ReferenceParams,
  RenameParams,
  SelectionRange,
  SelectionRangeParams,
  SemanticTokensParams,
  SignatureHelpParams,
  SymbolInformation,
  TextDocuments,
  TextEdit,
  WorkspaceEdit,
  WorkspaceSymbolParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { CasingConfig } from 'kopytko-brightscript-parser';
import { FormattingConfig } from './brightscript/formattingConfig';
import { KopytkoImportResolver } from './kopytko/importResolver';
import { BrightScriptCodeActionProvider } from './providers/codeActionProvider';
import { BrightScriptCompletionProvider } from './providers/completionProvider';
import { BrightScriptDefinitionProvider } from './providers/definitionProvider';
import { BrightScriptDocumentLinkProvider } from './providers/documentLinkProvider';
import { BrightScriptDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { BrightScriptFormattingProvider } from './providers/formattingProvider';
import { BrightScriptHoverProvider } from './providers/hoverProvider';
import { BrightScriptReferencesProvider } from './providers/referencesProvider';
import { BrightScriptRenameProvider } from './providers/renameProvider';
import { BrightScriptSemanticTokensProvider } from './providers/semanticTokensProvider';
import { BrightScriptFoldingRangeProvider } from './providers/foldingRangeProvider';
import { BrightScriptSelectionRangeProvider } from './providers/selectionRangeProvider';
import { BrightScriptCallHierarchyProvider } from './providers/callHierarchyProvider';
import { BrightScriptSignatureHelpProvider } from './providers/signatureHelpProvider';
import { BrightScriptWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { getCachedAllFunctions, getCachedLines } from './utils/documentCache';

export interface ServerProviders {
  completionProvider: BrightScriptCompletionProvider;
  hoverProvider: BrightScriptHoverProvider;
  definitionProvider: BrightScriptDefinitionProvider;
  documentLinkProvider: BrightScriptDocumentLinkProvider;
  referencesProvider: BrightScriptReferencesProvider;
  signatureHelpProvider: BrightScriptSignatureHelpProvider;
  documentSymbolProvider: BrightScriptDocumentSymbolProvider;
  workspaceSymbolProvider: BrightScriptWorkspaceSymbolProvider;
  renameProvider: BrightScriptRenameProvider;
  codeActionProvider: BrightScriptCodeActionProvider;
  formattingProvider: BrightScriptFormattingProvider;
  semanticTokensProvider: BrightScriptSemanticTokensProvider;
  foldingRangeProvider: BrightScriptFoldingRangeProvider;
  selectionRangeProvider: BrightScriptSelectionRangeProvider;
  callHierarchyProvider: BrightScriptCallHierarchyProvider;
}

export interface HandlerState {
  casingConfig: () => CasingConfig;
  formattingConfig: () => FormattingConfig;
  generatedPaths: () => string[];
  siblingPatterns: () => string[][];
}

export interface HandlerServices {
  importResolver: () => KopytkoImportResolver;
  getBrsDocument: (uri: string) => TextDocument | undefined;
  isReadOnlyPath: (uri: string) => boolean;
}

export function registerHandlers(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  providers: ServerProviders,
  state: HandlerState,
  services: HandlerServices,
): void {
  connection.onCompletion((params: CompletionParams): CompletionItem[] => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return [];
    return providers.completionProvider.provideCompletions(document, params.position, state.casingConfig(), state.siblingPatterns());
  });

  connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    const data = item.data as { kind?: string; documentUri?: string; importPath?: string; npmPackage?: string } | undefined;
    if (data?.kind === 'kopytkoExport' && data.documentUri && data.importPath && data.npmPackage) {
      const document = documents.get(data.documentUri);
      if (document) {
        const importLine = `' @import ${data.importPath} from ${data.npmPackage}`;
        const alreadyImported = getCachedLines(document).some(
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

  connection.onHover((params: HoverParams): Hover | null => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return null;
    return providers.hoverProvider.provideHover(document, params.position, state.siblingPatterns());
  });

  connection.onDefinition((params: DefinitionParams): Location | Location[] | null => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return null;
    return providers.definitionProvider.provideDefinition(document, params.position, state.siblingPatterns());
  });

  connection.onReferences((params: ReferenceParams): Location[] => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return [];
    return providers.referencesProvider.provideReferences(document, params);
  });

  connection.onSignatureHelp((params: SignatureHelpParams) => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return null;
    return providers.signatureHelpProvider.provideSignatureHelp(document, params.position, state.siblingPatterns());
  });

  connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return [];
    return providers.documentSymbolProvider.provideDocumentSymbols(document);
  });

  connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
    return providers.workspaceSymbolProvider.provideWorkspaceSymbols(params.query);
  });

  connection.onPrepareRename((params: PrepareRenameParams) => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return null;
    return providers.renameProvider.prepareRename(document, params.position);
  });

  connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return null;
    return providers.renameProvider.provideRename(document, params.position, params.newName);
  });

  connection.onCodeAction((params: CodeActionParams) => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return [];
    if (services.isReadOnlyPath(document.uri)) return [];
    return providers.codeActionProvider.provideCodeActions(document, params);
  });

  connection.onDocumentLinks((params) => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return [];
    return providers.documentLinkProvider.provideDocumentLinks(document, state.generatedPaths());
  });

  connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return [];
    if (services.isReadOnlyPath(document.uri)) return [];
    const documentPath = URI.parse(document.uri).fsPath;
    const allFunctions = getCachedAllFunctions(document, documentPath, services.importResolver(), state.siblingPatterns());
    return providers.formattingProvider.provideDocumentFormatting(document, state.formattingConfig(), state.casingConfig(), allFunctions);
  });

  connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return { data: [] };
    return providers.semanticTokensProvider.provideSemanticTokens(document);
  });

  connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return [];
    return providers.foldingRangeProvider.provideFoldingRanges(document);
  });

  connection.onSelectionRanges((params: SelectionRangeParams): SelectionRange[] => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return [];
    return providers.selectionRangeProvider.provideSelectionRanges(document, params.positions);
  });

  connection.languages.callHierarchy.onPrepare((params) => {
    const document = services.getBrsDocument(params.textDocument.uri);
    if (!document) return null;
    return providers.callHierarchyProvider.prepare(document, params.position);
  });

  connection.languages.callHierarchy.onIncomingCalls((params) =>
    providers.callHierarchyProvider.incomingCalls(params.item)
  );

  connection.languages.callHierarchy.onOutgoingCalls((params) =>
    providers.callHierarchyProvider.outgoingCalls(params.item)
  );
}

import { Location, Position, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import {
  findBuiltin,
  findComponent,
  findMethodInterface,
  getComponentMethods,
  getWordAtPosition,
} from 'kopytko-brightscript-parser';
import type { BrightScriptBuiltin } from 'kopytko-brightscript-parser';
import { KopytkoImportResolver } from '../../kopytko/importResolver';
import { KopytkoModuleCatalog, KopytkoExportEntry } from '../../kopytko/moduleCatalog';

// The parser package does not export named types for catalog entries, so derive
// them from the lookup function return types (single source of truth = the catalog).
type BrightScriptComponent = NonNullable<ReturnType<typeof findComponent>>;
type ComponentMethod = ReturnType<typeof getComponentMethods>[number];
type ComponentInterface = NonNullable<ReturnType<typeof findMethodInterface>>;
import { FunctionDefinition } from '../../brightscript/functionIndex';
import { getInlineCreateObjectType, resolveReceiverType } from '../../brightscript/typeInference';
import { getReceiverNameAtPosition } from './receiverContext';
import { getDocumentPath } from '../../utils/textUtils';
import { getCachedAllFunctions, getCachedLines, getCachedTypeMap } from '../../utils/documentCache';
import { WorkspaceFunctionIndex } from '../../utils/workspaceFunctionIndex';

export interface WordContext {
  lines: string[];
  line: string;
  word: string;
  start: number;
  end: number;
}

export type ResolvedSymbol =
  | { kind: 'component'; component: BrightScriptComponent }
  | { kind: 'componentMethod'; componentType: string; method: ComponentMethod; iface?: ComponentInterface }
  | { kind: 'builtin'; builtin: BrightScriptBuiltin }
  | { kind: 'kopytkoExport'; entry: KopytkoExportEntry; moduleName: string }
  | { kind: 'userFunction'; definition: FunctionDefinition }
  | { kind: 'sourceFunction'; definition: FunctionDefinition };

export interface ResolveOptions {
  includeUserFunctions?: boolean;
  includeWorkspaceFunctions?: boolean;
}

export class SymbolResolver {
  constructor(
    private readonly catalog?: KopytkoModuleCatalog,
    private readonly importResolver?: KopytkoImportResolver,
    private readonly workspaceIndex?: WorkspaceFunctionIndex,
  ) {}

  resolveAtPosition(
    document: TextDocument,
    position: Position,
    siblingPatterns: string[][] = [],
    options: ResolveOptions = {},
  ): ResolvedSymbol | null {
    const context = resolveWordContext(document, position);
    if (!context) return null;

    const component = findComponent(context.word);
    if (component) return { kind: 'component', component };

    const inlineType = getInlineCreateObjectType(context.line, context.start);
    const inlineMethod = inlineType ? this.resolveComponentMethod(inlineType, context.word) : null;
    if (inlineMethod) return inlineMethod;

    const receiverName = getReceiverNameAtPosition(document, { line: position.line, character: context.start });
    if (receiverName) {
      const componentType = resolveReceiverType(receiverName, getCachedTypeMap(document));
      const member = componentType ? this.resolveComponentMethod(componentType, context.word) : null;
      if (member) return member;
    }

    return this.resolveByName(document, context.word, null, siblingPatterns, options);
  }

  resolveByName(
    document: TextDocument,
    name: string,
    receiverName: string | null = null,
    siblingPatterns: string[][] = [],
    options: ResolveOptions = {},
  ): ResolvedSymbol | null {
    if (receiverName) {
      const componentType = resolveReceiverType(receiverName, getCachedTypeMap(document));
      const member = componentType ? this.resolveComponentMethod(componentType, name) : null;
      if (member) return member;
    }

    const builtin = findBuiltin(name);
    if (builtin) return { kind: 'builtin', builtin };

    const kopytkoExport = this.catalog?.findExport(name);
    if (kopytkoExport) {
      return {
        kind: 'kopytkoExport',
        entry: kopytkoExport,
        moduleName: deriveModuleName(kopytkoExport.importPath),
      };
    }

    return this.resolveFunctionSymbol(document, name, siblingPatterns, options);
  }

  resolveFunctionSymbol(
    document: TextDocument,
    name: string,
    siblingPatterns: string[][] = [],
    options: ResolveOptions = {},
  ): ResolvedSymbol | null {
    const includeUserFunctions = options.includeUserFunctions ?? true;
    const includeWorkspaceFunctions = options.includeWorkspaceFunctions ?? true;
    const lower = name.toLowerCase();

    if (includeUserFunctions && this.importResolver) {
      const documentPath = getDocumentPath(document);
      const allFunctions = getCachedAllFunctions(document, documentPath, this.importResolver, siblingPatterns);
      const userFunc = allFunctions.find((f) => f.nameLower === lower);
      if (userFunc) return { kind: 'userFunction', definition: userFunc };
    }

    if (includeWorkspaceFunctions && this.workspaceIndex) {
      const match = this.workspaceIndex.findSourceDirFunction(lower);
      if (match) return { kind: 'sourceFunction', definition: match };
    }

    return null;
  }

  private resolveComponentMethod(componentType: string, methodName: string): ResolvedSymbol | null {
    const method = getComponentMethods(componentType)
      .find((m) => m.name.toLowerCase() === methodName.toLowerCase());
    if (!method) return null;
    return {
      kind: 'componentMethod',
      componentType,
      method,
      iface: findMethodInterface(componentType, method.name),
    };
  }
}

export function resolveWordContext(document: TextDocument, position: Position): WordContext | null {
  const lines = getCachedLines(document);
  const line = lines[position.line];
  if (!line) return null;
  const word = getWordAtPosition(line, position.character);
  if (!word) return null;
  return { lines, line, word: word.word, start: word.start, end: word.end };
}

export function functionLocation(definition: FunctionDefinition): Location {
  return {
    uri: URI.file(definition.filePath).toString(),
    range: Range.create(
      definition.line,
      definition.column,
      definition.line,
      definition.column + definition.name.length,
    ),
  };
}

export function deriveModuleName(importPath: string): string {
  const base = importPath.split('/').pop() ?? importPath;
  return base.endsWith('.brs') ? base.slice(0, -4) : base;
}

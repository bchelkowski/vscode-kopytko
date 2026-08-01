import {
  CompletionItem,
  CompletionItemKind,
  Position,
  Range,
} from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CasingConfig,
  DEFAULT_CASING_CONFIG,
} from 'kopytko-brightscript-parser';
import { getInlineCreateObjectType, resolveReceiverType } from '../brightscript/typeInference';
import { getCachedTypeMap, getCachedAllFunctions, getCachedAllInnerMethods, getCachedLines, getCachedScopeTree } from '../utils/documentCache';
import { findScopeAtLine } from 'kopytko-brightscript-parser';
import type { Scope } from 'kopytko-brightscript-parser';
import { getReceiverNameAtPosition, isDotAccessAtPosition, findAssignedConstructor } from './shared/receiverContext';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { KopytkoModuleCatalog } from '../kopytko/moduleCatalog';
import { isTestFile } from '../kopytko/testFramework';
import {
  builtinCompletions,
  createObjectStringCompletions,
  keywordCompletions,
  typeAnnotationCompletions,
} from './completion/completionBuilders';
import {
  computeAnnotationEditRange,
  extractImportPathPrefix,
  getCreateObjectStringContext,
  getInlineFunctionCallName,
  getTestDotContext,
  isImportPackageContext,
  isImportPathContext,
  isKopytkoAnnotationContext,
  isMtopAccess,
  isTypeAnnotationContext,
} from './completion/completionContexts';
import {
  importModuleCompletions,
  importPathCompletions,
  kopytkoAnnotationCompletions,
  kopytkoExportCompletions,
} from './completion/importCompletion';
import { innerMethodCompletions, memberCompletions, mtopCompletions } from './completion/memberCompletion';
import { testFrameworkDotCompletions, testGlobalCompletions } from './completion/testCompletion';

/** Provides completion items for BrightScript + Kopytko files. */
export class BrightScriptCompletionProvider {
  constructor(
    private readonly _importResolver: KopytkoImportResolver,
    private readonly _catalog?: KopytkoModuleCatalog,
    private readonly _workspaceIndex?: WorkspaceFunctionIndex,
  ) {}

  provideCompletions(
    document: TextDocument,
    position: Position,
    casing: CasingConfig = DEFAULT_CASING_CONFIG,
    siblingPatterns: string[][] = [],
  ): CompletionItem[] {
    const lines = getCachedLines(document);
    const currentLine = lines[position.line] ?? '';
    const documentPath = URI.parse(document.uri).fsPath;

    if (isImportPackageContext(currentLine, position.character)) {
      return importModuleCompletions(documentPath, this._importResolver);
    }

    if (isImportPathContext(currentLine, position.character)) {
      const typedPrefix = extractImportPathPrefix(currentLine, position.character);
      const afterCursor = currentLine.substring(position.character);
      const lastSlashInPrefix = typedPrefix.lastIndexOf('/');
      const namePart = typedPrefix.substring(lastSlashInPrefix + 1);
      const nameStart = position.character - namePart.length;
      const trailingName = /^([^\s/'""]*)/.exec(afterCursor)?.[1] ?? '';
      const editRange: Range = {
        start: { line: position.line, character: nameStart },
        end: { line: position.line, character: position.character + trailingName.length },
      };

      const trailingPath = /^([^\s'"]*)/.exec(afterCursor)?.[1] ?? '';
      const afterPathToken = currentLine.substring(position.character + trailingPath.length);
      const fromMatch = /^\s+from\s+(\S+)/.exec(afterPathToken);
      const fromPackage = fromMatch?.[1];
      return importPathCompletions(typedPrefix, editRange, documentPath, this._importResolver, fromPackage);
    }

    if (isKopytkoAnnotationContext(currentLine, position.character)) {
      const editRange = computeAnnotationEditRange(currentLine, position);
      return kopytkoAnnotationCompletions(editRange, documentPath, this._importResolver);
    }

    if (isTypeAnnotationContext(currentLine, position.character)) {
      return this.typeAnnotationCompletions(casing);
    }

    const createObjCtx = getCreateObjectStringContext(currentLine, position.character);
    if (createObjCtx) {
      return createObjectStringCompletions(createObjCtx, position.line);
    }

    const testDotContext = getTestDotContext(currentLine, position.character);
    if (testDotContext) {
      return testFrameworkDotCompletions(testDotContext);
    }

    const inlineType = getInlineCreateObjectType(currentLine, position.character);
    if (inlineType) {
      return this.memberCompletions(inlineType, casing);
    }

    const inlineFuncCall = getInlineFunctionCallName(currentLine, position.character);
    if (inlineFuncCall) {
      const allMethods = getCachedAllInnerMethods(document, documentPath, this._importResolver, siblingPatterns);
      const methodItems = innerMethodCompletions(inlineFuncCall, allMethods);
      if (methodItems.length > 0) return methodItems;
    }

    const receiverName = getReceiverNameAtPosition(document, position);
    if (receiverName !== null) {
      if (isMtopAccess(currentLine, position.character)) {
        return mtopCompletions(documentPath, this._importResolver, casing);
      }
      const typeMap = getCachedTypeMap(document);
      const componentType = resolveReceiverType(receiverName, typeMap);
      if (componentType) {
        return this.memberCompletions(componentType, casing);
      }

      const allMethods = getCachedAllInnerMethods(document, documentPath, this._importResolver, siblingPatterns);
      const ownerFunc = findAssignedConstructor(document, position.line, receiverName, { beforeLine: true });
      const methodItems = innerMethodCompletions(ownerFunc, allMethods);
      if (methodItems.length > 0) return methodItems;

      return [];
    }

    if (isDotAccessAtPosition(document, position)) {
      return [];
    }

    const defaults = [
      ...builtinCompletions(casing),
      ...keywordCompletions(casing),
      ...kopytkoExportCompletions(document.uri, this._catalog),
      ...this.userFunctionCompletions(document, documentPath, siblingPatterns),
      ...this.sourceDirFunctionCompletions(document, documentPath, siblingPatterns),
      ...this.localVariableCompletions(document, position.line),
    ];

    if (isTestFile(document.uri)) {
      defaults.push(...testGlobalCompletions());
    }

    const seen = new Set<string>();
    return defaults.filter((item) => {
      const key = (item.label as string).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  memberCompletions(componentType: string, casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
    return memberCompletions(componentType, casing);
  }

  typeAnnotationCompletions(casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
    return typeAnnotationCompletions(casing);
  }

  private userFunctionCompletions(
    document: TextDocument,
    documentPath: string,
    siblingPatterns: string[][],
  ): CompletionItem[] {
    const allFunctions = getCachedAllFunctions(document, documentPath, this._importResolver, siblingPatterns);
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    for (const fn of allFunctions) {
      if (seen.has(fn.nameLower)) continue;
      seen.add(fn.nameLower);
      items.push({
        label: fn.name,
        kind: CompletionItemKind.Function,
        detail: fn.signature,
        sortText: `2_${fn.name}`,
      });
    }
    return items;
  }

  private sourceDirFunctionCompletions(
    document: TextDocument,
    documentPath: string,
    siblingPatterns: string[][],
  ): CompletionItem[] {
    if (!this._workspaceIndex) return [];
    const importChainNames = new Set(
      getCachedAllFunctions(document, documentPath, this._importResolver, siblingPatterns).map((f) => f.nameLower),
    );
    const seen = new Set<string>();
    return this._workspaceIndex.getSourceDirFunctions()
      .filter((fn) => {
        if (importChainNames.has(fn.nameLower) || seen.has(fn.nameLower)) return false;
        seen.add(fn.nameLower);
        return true;
      })
      .map((fn) => ({
        label: fn.name,
        kind: CompletionItemKind.Function,
        detail: fn.signature,
        sortText: `3_${fn.name}`,
      }));
  }

  /**
   * Offers parameters, `dim`/assignment locals, `for`/`for each` counters,
   * and `catch` variables visible at the cursor — the cursor's own scope
   * plus every enclosing scope up to file scope, since a nested (closure)
   * function genuinely sees its outer function's locals in BrightScript.
   * `function`/`sub` declarations are skipped here — `userFunctionCompletions`
   * already offers those, scope-tree-backed so a regex can't miss a
   * multi-line parameter list, a `dim`, or a `catch` variable the way the
   * old text-scanning version did, and can't offer a variable that's only
   * assigned *after* the cursor (declarations are still filtered by line,
   * except parameters — those exist for the whole function body).
   */
  private localVariableCompletions(document: TextDocument, cursorLine: number): CompletionItem[] {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    const fileScope = getCachedScopeTree(document);
    let scope: Scope | null = findScopeAtLine(fileScope, cursorLine);

    while (scope) {
      for (const decl of scope.declarations.values()) {
        if (decl.kind === 'function') continue;
        if (decl.kind !== 'parameter' && decl.line >= cursorLine) continue;
        if (seen.has(decl.nameLower)) continue;
        seen.add(decl.nameLower);
        items.push({
          label: decl.name,
          kind: CompletionItemKind.Variable,
          sortText: `1_${decl.name}`,
        });
      }
      scope = scope.parent;
    }

    return items;
  }
}

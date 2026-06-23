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
import { getReceiverName, getInlineCreateObjectType, resolveReceiverType } from '../brightscript/typeInference';
import { getCachedTypeMap, getCachedAllFunctions, getCachedAllInnerMethods, getCachedLines } from '../utils/documentCache';
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
  isDotAccessContext,
  isImportPackageContext,
  isImportPathContext,
  isKopytkoAnnotationContext,
  isMtopAccess,
  isTypeAnnotationContext,
  resolveReceiverOwnerFunction,
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

    const receiverName = getReceiverName(currentLine, position.character);
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
      const ownerFunc = resolveReceiverOwnerFunction(receiverName, lines, position.line);
      const methodItems = innerMethodCompletions(ownerFunc, allMethods);
      if (methodItems.length > 0) return methodItems;

      return [];
    }

    if (isDotAccessContext(currentLine, position.character)) {
      return [];
    }

    const defaults = [
      ...builtinCompletions(casing),
      ...keywordCompletions(casing),
      ...kopytkoExportCompletions(document.uri, this._catalog),
      ...this.userFunctionCompletions(document, documentPath, siblingPatterns),
      ...this.sourceDirFunctionCompletions(document, documentPath, siblingPatterns),
      ...this.localVariableCompletions(lines, position.line),
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

  private localVariableCompletions(lines: string[], cursorLine: number): CompletionItem[] {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    let funcStartLine = -1;
    for (let i = cursorLine; i >= 0; i--) {
      if (/^\s*(?:function|sub)\b/i.test(lines[i])) {
        funcStartLine = i;
        break;
      }
    }
    if (funcStartLine < 0) return items;

    const declLine = lines[funcStartLine];
    const paramMatch = /\(([^)]*)\)/.exec(declLine);
    if (paramMatch && paramMatch[1].trim()) {
      for (const param of paramMatch[1].split(',')) {
        const nameMatch = /^\s*(\w+)/.exec(param.trim());
        if (nameMatch && !seen.has(nameMatch[1].toLowerCase())) {
          seen.add(nameMatch[1].toLowerCase());
          items.push({
            label: nameMatch[1],
            kind: CompletionItemKind.Variable,
            sortText: `1_${nameMatch[1]}`,
          });
        }
      }
    }

    for (let i = funcStartLine + 1; i < cursorLine; i++) {
      const line = lines[i];
      if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) continue;

      const assignMatch = /^\s*(\w+)\s*[+\-*\/\\]?=\s/i.exec(line);
      if (assignMatch && !seen.has(assignMatch[1].toLowerCase())) {
        seen.add(assignMatch[1].toLowerCase());
        items.push({
          label: assignMatch[1],
          kind: CompletionItemKind.Variable,
          sortText: `1_${assignMatch[1]}`,
        });
      }

      const forMatch = /^\s*for\s+(?:each\s+)?(\w+)\s/i.exec(line);
      if (forMatch && !seen.has(forMatch[1].toLowerCase())) {
        seen.add(forMatch[1].toLowerCase());
        items.push({
          label: forMatch[1],
          kind: CompletionItemKind.Variable,
          sortText: `1_${forMatch[1]}`,
        });
      }
    }

    return items;
  }
}

import {
  CallHierarchyItem, CallHierarchyIncomingCall, CallHierarchyOutgoingCall,
  Position, Range, SymbolKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import {
  getWordAtPosition, buildCallGraph, walk, FunctionDeclaration, parse as parseBrs,
} from 'kopytko-brightscript-parser';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { getCachedFileParseResult, readCachedFileText } from '../utils/fileParseCache';
import { getCachedLines } from '../utils/documentCache';
import type { FunctionDefinition } from '../brightscript/functionIndex';

function makeItem(
  name: string,
  uri: string,
  line: number,
  nameColumn: number,
): CallHierarchyItem {
  return {
    name,
    kind: SymbolKind.Function,
    uri,
    range: Range.create(line, 0, line, nameColumn + name.length),
    selectionRange: Range.create(line, nameColumn, line, nameColumn + name.length),
  };
}

export class BrightScriptCallHierarchyProvider {
  constructor(private readonly _index: WorkspaceFunctionIndex) {}

  prepare(document: TextDocument, position: Position): CallHierarchyItem[] | null {
    const lines = getCachedLines(document);
    const lineText = lines[position.line] ?? '';
    const wordResult = getWordAtPosition(lineText, position.character);
    if (!wordResult) return null;

    const { word } = wordResult;
    const wordLower = word.toLowerCase();
    const docUri = document.uri;
    const docFilePath = URI.parse(docUri).fsPath;

    // Find in workspace index first (covers source-dir and component functions)
    const allFunctions = this._index.getAllFunctions();
    const match = allFunctions.find(f => f.nameLower === wordLower);
    if (match) {
      return [makeItem(match.name, URI.file(match.filePath).toString(), match.line, match.column)];
    }

    // Fall back to walking the current document's AST
    let parseResult = getCachedFileParseResult(docFilePath);
    if (!parseResult) {
      parseResult = parseBrs(document.getText());
    }
    if (!parseResult) return null;

    let item: CallHierarchyItem | null = null;
    walk(parseResult.root, {
      visitFunctionDeclaration(node: FunctionDeclaration) {
        if (node.name.toLowerCase() !== wordLower) return;
        const nameToken = node.nameToken;
        if (!nameToken) return;
        item = makeItem(node.name, docUri, nameToken.line, nameToken.column);
        return false;
      },
    });

    return item ? [item] : null;
  }

  incomingCalls(item: CallHierarchyItem): CallHierarchyIncomingCall[] {
    const funcNameLower = item.name.toLowerCase();
    const result: CallHierarchyIncomingCall[] = [];

    for (const filePath of this._index.getFiles()) {
      let parseResult = getCachedFileParseResult(filePath);
      if (!parseResult) {
        const text = readCachedFileText(filePath);
        if (text === undefined) continue;
        parseResult = parseBrs(text);
      }
      if (!parseResult) continue;

      const graph = buildCallGraph(parseResult.root);
      const callers = graph.findCallers(funcNameLower);
      if (callers.length === 0) continue;

      const fileUri = URI.file(filePath).toString();

      // Group call sites by enclosing function
      const callerMap = new Map<string, typeof callers>();
      for (const site of callers) {
        if (!site.enclosingFunction) continue; // skip file-scope calls
        const key = site.enclosingFunction;
        const group = callerMap.get(key);
        if (group) {
          group.push(site);
        } else {
          callerMap.set(key, [site]);
        }
      }

      for (const [callerName, sites] of callerMap) {
        const callerInfo = graph.functions.get(callerName);
        if (!callerInfo) continue;

        // Look up column from workspace index (FunctionInfo only has line)
        const callerDef = this._findFunctionDef(callerInfo.name.toLowerCase(), filePath);
        const nameColumn = callerDef?.column ?? 0;

        const fromItem = makeItem(callerInfo.originalName, fileUri, callerInfo.line, nameColumn);
        const fromRanges = sites.map(s =>
          Range.create(s.line, s.column, s.line, s.column + item.name.length)
        );

        result.push({ from: fromItem, fromRanges });
      }
    }

    return result;
  }

  outgoingCalls(item: CallHierarchyItem): CallHierarchyOutgoingCall[] {
    const funcNameLower = item.name.toLowerCase();
    const filePath = URI.parse(item.uri).fsPath;

    let parseResult = getCachedFileParseResult(filePath);
    if (!parseResult) {
      const text = readCachedFileText(filePath);
      if (text === undefined) return [];
      parseResult = parseBrs(text);
    }
    if (!parseResult) return [];

    const graph = buildCallGraph(parseResult.root);
    const callees = graph.findCallees(funcNameLower);

    // Group by callee name, accumulating call-site ranges
    const calleeMap = new Map<string, { original: string; ranges: Range[] }>();
    for (const site of callees) {
      const key = site.calleeName;
      const range = Range.create(site.line, site.column, site.line, site.column + site.calleeOriginal.length);
      const entry = calleeMap.get(key);
      if (entry) {
        entry.ranges.push(range);
      } else {
        calleeMap.set(key, { original: site.calleeOriginal, ranges: [range] });
      }
    }

    const result: CallHierarchyOutgoingCall[] = [];

    for (const [calleeName, { original, ranges }] of calleeMap) {
      const calleeDef = this._findFunctionDef(calleeName);
      const toUri = calleeDef ? URI.file(calleeDef.filePath).toString() : item.uri;
      const toLine = calleeDef?.line ?? ranges[0]?.start.line ?? 0;
      const toColumn = calleeDef?.column ?? 0;

      result.push({
        to: makeItem(original, toUri, toLine, toColumn),
        fromRanges: ranges,
      });
    }

    return result;
  }

  private _findFunctionDef(nameLower: string, preferFilePath?: string): FunctionDefinition | undefined {
    const all = this._index.getAllFunctions();
    if (preferFilePath) {
      const inFile = all.find(f => f.nameLower === nameLower && f.filePath === preferFilePath);
      if (inFile) return inFile;
    }
    return all.find(f => f.nameLower === nameLower);
  }
}

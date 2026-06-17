import * as path from 'path';
import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import fsWrapper from '../utils/fsWrapper';
import { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS } from 'brightscript-parser';
import {
  BRIGHTSCRIPT_COMPONENTS,
  findComponent,
  getComponentMethods,
  findMethodInterface,
} from 'brightscript-parser';
import { collectMtopItems, MtopField, MtopMethod } from '../brightscript/mtopResolver';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { KopytkoModuleCatalog } from '../kopytko/moduleCatalog';
import { getReceiverName, getInlineCreateObjectType, resolveReceiverType } from '../brightscript/typeInference';
import {
  CasingConfig,
  DEFAULT_CASING_CONFIG,
  applyCasing,
  applyCasingWithOverrides,
} from 'brightscript-parser';
import { applySnippetCasing } from '../brightscript/casingUtils';
import { getCachedTypeMap, getCachedAllFunctions, getCachedAllInnerMethods } from '../utils/documentCache';
import { InnerMethodDefinition } from '../brightscript/functionIndex';
import {
  isTestFile,
  EXPECT_MATCHERS,
  MOCK_FUNCTION_METHODS,
  TEST_SUITE_METHODS,
  ALL_TEST_GLOBALS,
  FAKE_CLOCK_METHODS,
  TestApiEntry,
} from '../kopytko/testFramework';

/**
 * Provides completion items for BrightScript + Kopytko files.
 *
 * Completion contexts (evaluated in priority order):
 *  1. `' @import … from ` → Kopytko module package names
 *  2. `' @import /…`      → BrightScript file paths — one directory level at a time.
 *                           Directories complete to `name/` and retrigger the list.
 *                           When a `from <package>` clause is present the walk is rooted
 *                           at that package's `kopytkoModuleDir` instead of `sourceDir`.
 *  3. `' @…`              → Kopytko annotation snippets
 *  4. `… as <type>`       → BrightScript type names + ro* component names
 *  5. `identifier.`       → Component member completions (via CreateObject type inference)
 *  6. Default             → Built-in functions + language keywords + CreateObject component names
 *
 * The optional `casing` parameter controls how identifier names are formatted
 * in the inserted text. Defaults to preserve for all categories.
 */
export class BrightScriptCompletionProvider {
  constructor(
    private readonly _importResolver: KopytkoImportResolver,
    private readonly _catalog?: KopytkoModuleCatalog,
  ) {}

  provideCompletions(
    document: TextDocument,
    position: Position,
    casing: CasingConfig = DEFAULT_CASING_CONFIG,
    siblingPatterns: string[][] = [],
  ): CompletionItem[] {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const currentLine = lines[position.line] ?? '';
    const documentPath = URI.parse(document.uri).fsPath;

    // 1. @import … from <package> context (must be checked before the path context)
    if (isImportPackageContext(currentLine, position.character)) {
      return this.importModuleCompletions(documentPath);
    }

    // 2. @import path context: `' @import /…`
    if (isImportPathContext(currentLine, position.character)) {
      const typedPrefix = extractImportPathPrefix(currentLine, position.character);
      const afterCursor = currentLine.substring(position.character);

      // The textEdit covers only the current *name fragment* — the portion after the
      // last `/`.  Inserting `entry.name/` into this narrow range means VS Code sees
      // a trailing `/` as a freshly typed character, which fires the trigger character
      // and auto-opens the next level without needing the retrigger command to work.
      const lastSlashInPrefix = typedPrefix.lastIndexOf('/');
      const namePart = typedPrefix.substring(lastSlashInPrefix + 1);
      const nameStart = position.character - namePart.length;
      const trailingName = /^([^\s/'""]*)/.exec(afterCursor)?.[1] ?? '';
      const editRange: Range = {
        start: { line: position.line, character: nameStart },
        end: { line: position.line, character: position.character + trailingName.length },
      };

      // Detect an optional `from <package>` clause after the full path token
      const trailingPath = /^([^\s'"]*)/.exec(afterCursor)?.[1] ?? '';
      const afterPathToken = currentLine.substring(position.character + trailingPath.length);
      const fromMatch = /^\s+from\s+(\S+)/.exec(afterPathToken);
      const fromPackage = fromMatch?.[1];
      return this.importPathCompletions(typedPrefix, editRange, documentPath, fromPackage);
    }

    // 3. Kopytko annotation context: `' @` or bare `@`
    if (isKopytkoAnnotationContext(currentLine, position.character)) {
      const editRange = computeAnnotationEditRange(currentLine, position);
      return this.kopytkoAnnotationCompletions(editRange, documentPath);
    }

    // 4. Type annotation context: `param as `, `function foo() as `
    if (isTypeAnnotationContext(currentLine, position.character)) {
      return this.typeAnnotationCompletions(casing);
    }

    // 5. CreateObject("...") context — suggest component names inside the string
    const createObjCtx = getCreateObjectStringContext(currentLine, position.character);
    if (createObjCtx) {
      return this.createObjectStringCompletions(createObjCtx, position.line);
    }

    // 5b. Test framework dot-access: expect(). / expect().not. / mockFunction().
    const testDotContext = getTestDotContext(currentLine, position.character);
    if (testDotContext) {
      return this.testFrameworkDotCompletions(testDotContext);
    }

    // 6. Member access: `someVar.` or `CreateObject("roXxx").`
    // First check for inline CreateObject("roXxx").method pattern
    const inlineType = getInlineCreateObjectType(currentLine, position.character);
    if (inlineType) {
      return this.memberCompletions(inlineType, casing);
    }

    // Check for inline function call: `Something().` → show methods owned by Something
    const inlineFuncCall = getInlineFunctionCallName(currentLine, position.character);
    if (inlineFuncCall) {
      const allMethods = getCachedAllInnerMethods(document, documentPath, this._importResolver, siblingPatterns);
      const methodItems = this.innerMethodCompletions(inlineFuncCall, allMethods);
      if (methodItems.length > 0) return methodItems;
    }

    const receiverName = getReceiverName(currentLine, position.character);
    if (receiverName !== null) {
      // Special handling: m.top. → SceneGraph component self-reference
      if (isMtopAccess(currentLine, position.character)) {
        return this.mtopCompletions(documentPath, casing);
      }
      const typeMap = getCachedTypeMap(document);
      const componentType = resolveReceiverType(receiverName, typeMap);
      if (componentType) {
        return this.memberCompletions(componentType, casing);
      }

      // User-defined inner methods: resolve receiver's constructor, filter by owner
      const allMethods = getCachedAllInnerMethods(document, documentPath, this._importResolver, siblingPatterns);
      const ownerFunc = resolveReceiverOwnerFunction(receiverName, lines, position.line);
      const methodItems = this.innerMethodCompletions(ownerFunc, allMethods);
      if (methodItems.length > 0) return methodItems;

      return [];
    }

    // If cursor is right after a dot (e.g. typing `.` on an unrecognized receiver),
    // don't show default completions — they would be irrelevant noise.
    if (isDotAccessContext(currentLine, position.character)) {
      return [];
    }

    // 7. Default completions
    const defaults = [
      ...this.builtinCompletions(casing),
      ...this.keywordCompletions(casing),
      ...this.kopytkoExportCompletions(document.uri, documentPath),
      ...this.userFunctionCompletions(document, documentPath, siblingPatterns),
      ...this.localVariableCompletions(lines, position.line),
    ];

    // Add test framework globals for test files
    if (isTestFile(document.uri)) {
      defaults.push(...this.testGlobalCompletions());
    }

    // Deduplicate by label (case-insensitive), keeping the first (higher-priority) entry
    const seen = new Set<string>();
    return defaults.filter((item) => {
      const key = (item.label as string).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Member completions
  // ---------------------------------------------------------------------------

  memberCompletions(componentType: string, casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
    const component = findComponent(componentType);
    if (!component) return [];

    const methods = getComponentMethods(componentType);
    return methods
      .filter((m) => !m.deprecated)
      .map((method) => {
        const iface = findMethodInterface(componentType, method.name);
        const detail = iface
          ? `${method.returnType} — ${iface.name}`
          : method.returnType;

        const label = applyCasingWithOverrides(method.name, casing.method, casing.exact);
        const snippet = applySnippetCasing(buildMethodSnippet(method.signature), casing.method);

        return {
          label,
          kind: CompletionItemKind.Method,
          detail,
          insertText: snippet,
          insertTextFormat: InsertTextFormat.Snippet,
          documentation: {
            kind: MarkupKind.Markdown,
            value: buildMethodDoc(method, iface?.name, component.name),
          },
          sortText: `0_${method.name}`,
        };
      });
  }

  // ---------------------------------------------------------------------------
  // m.top completions
  // ---------------------------------------------------------------------------

  private mtopCompletions(documentPath: string, casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
    const { fields, methods } = collectMtopItems(documentPath, this._importResolver);
    const items: CompletionItem[] = [];

    for (const f of fields) {
      items.push(buildMtopFieldItem(f));
    }
    for (const m of methods) {
      items.push(buildMtopMethodItem(m, casing));
    }
    return items;
  }

  // ---------------------------------------------------------------------------
  // Type annotation completions (`param as <type>`, `function() as <type>`)
  // ---------------------------------------------------------------------------

  typeAnnotationCompletions(casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
    const primitiveTypes = [
      'Boolean', 'Double', 'Dynamic', 'Float', 'Function',
      'Integer', 'Interface', 'LongInteger', 'Object', 'String', 'Void',
    ];

    const primitives: CompletionItem[] = primitiveTypes.map((t) => {
      const label = applyCasing(t, casing.keyword);
      return {
        label,
        kind: CompletionItemKind.TypeParameter,
        insertText: label,
        sortText: `0_${t}`,
        detail: 'BrightScript type',
      };
    });

    // ro* component names are valid parameter types and must never be re-cased
    const components: CompletionItem[] = BRIGHTSCRIPT_COMPONENTS
      .filter((c) => !c.deprecated)
      .map((c) => ({
        label: c.name,
        kind: CompletionItemKind.Class,
        detail: c.description,
        insertText: c.name,
        sortText: `1_${c.name}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: buildComponentDoc(c),
        },
      }));

    return [...primitives, ...components];
  }

  // ---------------------------------------------------------------------------
  // CreateObject completions (suggest component names)
  // ---------------------------------------------------------------------------

  private createObjectCompletions(): CompletionItem[] {
    // Component names are string literals — the Roku runtime is case-sensitive
    // for them, so we never transform their casing.
    return BRIGHTSCRIPT_COMPONENTS.filter((c) => !c.deprecated).map((c) => ({
      label: c.name,
      kind: CompletionItemKind.Class,
      detail: `CreateObject("${c.name}")`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildComponentDoc(c),
      },
      sortText: `1_${c.name}`,
    }));
  }

  /**
   * Returns component name completions when the cursor is inside the first
   * string argument of `CreateObject("…")`. The textEdit replaces only the
   * string content so the surrounding quotes are preserved.
   */
  private createObjectStringCompletions(
    ctx: CreateObjectStringContext,
    lineIdx: number,
  ): CompletionItem[] {
    const editRange = Range.create(
      { line: lineIdx, character: ctx.contentStart },
      { line: lineIdx, character: ctx.contentEnd },
    );
    return BRIGHTSCRIPT_COMPONENTS.filter((c) => !c.deprecated).map((c) => ({
      label: c.name,
      kind: CompletionItemKind.Class,
      detail: c.description,
      filterText: c.name,
      textEdit: TextEdit.replace(editRange, c.name),
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildComponentDoc(c),
      },
      sortText: `0_${c.name}`,
    }));
  }

  // ---------------------------------------------------------------------------
  // Kopytko / import completions
  // ---------------------------------------------------------------------------

  private kopytkoAnnotationCompletions(editRange: Range, documentPath: string): CompletionItem[] {
    // Cursor lands right after the `/`, and the retrigger command opens path completions
    // immediately — same trick used by directory items in importPathCompletions.
    const importItem: CompletionItem = {
      label: '@import',
      kind: CompletionItemKind.Keyword,
      detail: 'Kopytko internal import',
      documentation: {
        kind: MarkupKind.Markdown,
        value: "Import an internal BrightScript file.\n\n```brightscript\n' @import /components/MyComponent.brs\n```",
      },
      textEdit: TextEdit.replace(editRange, "' @import /"),
      command: { title: 'Re-trigger completions', command: 'editor.action.triggerSuggest' },
    };

    const mockItem: CompletionItem = {
      label: '@mock',
      kind: CompletionItemKind.Keyword,
      detail: 'Kopytko test mock dependency',
      documentation: {
        kind: MarkupKind.Markdown,
        value: "Mock a dependency in tests. Functions from this file can be controlled via `mockFunction()`.\n\n```brightscript\n' @mock /components/MyService.brs\n' @mock /components/Router.brs from @dazn/kopytko-framework\n```",
      },
      textEdit: TextEdit.replace(editRange, "' @mock /"),
      command: { title: 'Re-trigger completions', command: 'editor.action.triggerSuggest' },
    };

    const packageItems = this._buildPackageAnnotationItems(editRange, documentPath);
    return [importItem, mockItem, ...packageItems];
  }

  private importPathCompletions(
    typedPrefix: string,
    editRange: Range,
    documentPath: string,
    fromPackage?: string,
  ): CompletionItem[] {
    // Split the typed prefix at the last '/' to get the directory level and the
    // name fragment being typed (e.g. '/components/Bu' → dir='/components/', name='Bu').
    const lastSlash = typedPrefix.lastIndexOf('/');
    const dirPart = typedPrefix.substring(0, lastSlash + 1); // e.g. '/' or '/components/'
    const namePart = typedPrefix.substring(lastSlash + 1).toLowerCase();

    // Determine the base directories to search.
    const baseDirs: string[] = fromPackage
      ? (() => {
          const d = this._importResolver.resolvePackageBaseDir(fromPackage, documentPath);
          return d ? [d] : [];
        })()
      : this._importResolver.getWorkspaceFolders()
          .map((ws) => path.join(ws, this._importResolver.getSourceDir()));

    const results: CompletionItem[] = [];
    for (const baseDir of baseDirs) {
      // Resolve the directory portion of the import path to an absolute fs path.
      const relDir = dirPart.length > 1 ? dirPart.slice(1, -1) : ''; // strip leading / and trailing /
      const absDir = relDir ? path.join(baseDir, relDir) : baseDir;

      let entries: ReturnType<typeof fsWrapper.readdirTyped>;
      try {
        entries = fsWrapper.readdirTyped(absDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (!entry.name.toLowerCase().startsWith(namePart)) continue;

        if (entry.isDirectory) {
          // Insert only `entryName/` (not the full path from `/`).  This means VS Code
          // sees the trailing `/` as a newly placed trigger character and auto-opens the
          // next level's completion list without relying solely on the retrigger command.
          const newText = entry.name + '/';
          results.push({
            label: entry.name + '/',
            kind: CompletionItemKind.Folder,
            detail: 'directory',
            filterText: entry.name + '/',
            insertText: newText,
            textEdit: TextEdit.replace(editRange, newText),
            sortText: '0_' + entry.name,
            command: { title: 'Re-trigger completions', command: 'editor.action.triggerSuggest' },
          });
        } else if (entry.name.endsWith('.brs')) {
          results.push({
            label: entry.name,
            kind: CompletionItemKind.File,
            detail: entry.name,
            filterText: entry.name,
            insertText: entry.name,
            textEdit: TextEdit.replace(editRange, entry.name),
            sortText: '1_' + entry.name,
          });
        }
      }
    }
    results.sort((a, b) => {
      const sa = a.sortText ?? a.label;
      const sb = b.sortText ?? b.label;
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    return results;
  }

  private importModuleCompletions(documentPath: string): CompletionItem[] {
    return this._importResolver.getInstalledKopytkoPackages(documentPath).map((pkg) => ({
      label: pkg,
      kind: CompletionItemKind.Module,
      detail: pkg,
    }));
  }

  private _buildPackageAnnotationItems(editRange: Range, documentPath: string): CompletionItem[] {
    return this._importResolver.getInstalledKopytkoPackages(documentPath).map((pkg) => ({
      label: `@import … from ${pkg}`,
      kind: CompletionItemKind.Module,
      insertTextFormat: InsertTextFormat.Snippet,
      detail: `Kopytko module: ${pkg}`,
      textEdit: TextEdit.replace(editRange, `' @import /$0 from ${pkg}`),
      command: { title: 'Re-trigger completions', command: 'editor.action.triggerSuggest' },
    }));
  }

  // ---------------------------------------------------------------------------
  // Global completions
  // ---------------------------------------------------------------------------

  private kopytkoExportCompletions(documentUri: string, _documentPath: string): CompletionItem[] {
    // Use the pre-built catalog instead of re-scanning packages on every completion
    if (!this._catalog || this._catalog.size === 0) return [];
    const items: CompletionItem[] = [];

    for (const entry of this._catalog.getEntries()) {
      items.push({
        label: entry.name,
        kind: CompletionItemKind.Function,
        detail: entry.npmPackage,
        sortText: `2_${entry.name}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `\`\`\`brightscript\n${entry.signature}\n\`\`\`\n\n*${entry.npmPackage}*`,
        },
        data: {
          kind: 'kopytkoExport',
          documentUri,
          importPath: entry.importPath,
          npmPackage: entry.npmPackage,
        },
      });
    }
    return items;
  }

  private builtinCompletions(casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
    return BRIGHTSCRIPT_BUILTINS.map((b) => {
      const label = applyCasingWithOverrides(b.name, casing.builtin, casing.exact);
      return {
        label,
        kind: CompletionItemKind.Function,
        detail: b.signature,
        insertText: label,
        sortText: `2_${b.name}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**${b.name}** *(${b.category})*\n\n${b.description}`,
        },
      };
    });
  }

  private keywordCompletions(casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
    return BRIGHTSCRIPT_KEYWORDS.map((kw) => {
      const label = applyCasingWithOverrides(kw, casing.keyword, casing.exact);
      return {
        label,
        kind: CompletionItemKind.Keyword,
        insertText: label,
        sortText: `3_${kw}`,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Test framework completions
  // ---------------------------------------------------------------------------

  private testFrameworkDotCompletions(ctx: TestDotContext): CompletionItem[] {
    let entries: TestApiEntry[];
    switch (ctx) {
      case 'expect':
      case 'expect.not':
        entries = EXPECT_MATCHERS.filter(e => e.name !== 'not');
        break;
      case 'mockFunction':
        entries = MOCK_FUNCTION_METHODS;
        break;
      case 'fakeClock':
        entries = FAKE_CLOCK_METHODS;
        break;
      case 'testSuite':
        entries = TEST_SUITE_METHODS;
        break;
      default:
        return [];
    }

    return entries.map((entry) => ({
      label: entry.name,
      kind: CompletionItemKind.Method,
      detail: entry.signature,
      sortText: `0_${entry.name}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `**${entry.name}**\n\n\`\`\`brightscript\n${entry.signature}\n\`\`\`\n\n${entry.description}`,
      },
    }));
  }

  private testGlobalCompletions(): CompletionItem[] {
    return ALL_TEST_GLOBALS.map((entry) => ({
      label: entry.name,
      kind: entry.name === 'expect' || entry.name === 'mockFunction'
        ? CompletionItemKind.Function
        : CompletionItemKind.Function,
      detail: entry.signature,
      sortText: `1_${entry.name}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `**${entry.name}** *(kopytko-unit-testing-framework)*\n\n${entry.description}`,
      },
    }));
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

  private innerMethodCompletions(
    ownerFunc: string | null,
    allMethods: InnerMethodDefinition[],
  ): CompletionItem[] {
    if (!ownerFunc) return [];
    const ownerLower = ownerFunc.toLowerCase();
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    for (const method of allMethods) {
      if (method.ownerFunction?.toLowerCase() !== ownerLower) continue;
      if (seen.has(method.nameLower)) continue;
      seen.add(method.nameLower);
      items.push({
        label: method.name,
        kind: CompletionItemKind.Method,
        sortText: `0_${method.name}`,
      });
    }
    return items;
  }

  private localVariableCompletions(lines: string[], cursorLine: number): CompletionItem[] {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    // Find the enclosing function/sub to scope the search
    let funcStartLine = -1;
    for (let i = cursorLine; i >= 0; i--) {
      if (/^\s*(?:function|sub)\b/i.test(lines[i])) {
        funcStartLine = i;
        break;
      }
    }
    if (funcStartLine < 0) return items;

    // Extract parameters from the function declaration
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

    // Scan lines from function start to cursor for local assignments
    for (let i = funcStartLine + 1; i < cursorLine; i++) {
      const line = lines[i];
      if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) continue;

      // Assignment: `varName = ...` (not preceded by dot)
      const assignMatch = /^\s*(\w+)\s*[+\-*\/\\]?=\s/i.exec(line);
      if (assignMatch && !seen.has(assignMatch[1].toLowerCase())) {
        seen.add(assignMatch[1].toLowerCase());
        items.push({
          label: assignMatch[1],
          kind: CompletionItemKind.Variable,
          sortText: `1_${assignMatch[1]}`,
        });
      }

      // For-loop variable: `for varName = ...` or `for each varName in ...`
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Given a receiver variable name (e.g. `obj` in `obj.method()`), scan backwards
 * from the cursor line to find the assignment `obj = SomeConstructor(...)` and
 * return the constructor function name. Returns null if not found.
 */
function resolveReceiverOwnerFunction(
  receiverName: string,
  lines: string[],
  cursorLine: number,
): string | null {
  // Pattern: `receiverName = FunctionName(` — variable assigned from a function call
  const assignRe = new RegExp(
    `^\\s*${receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(\\w+)\\s*\\(`,
    'i'
  );
  for (let i = cursorLine - 1; i >= 0; i--) {
    const m = assignRe.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

/**
 * Returns true if the cursor is positioned immediately after a `.` character,
 * meaning we're in a member-access context even if we can't resolve the receiver.
 */
function isDotAccessContext(line: string, charPos: number): boolean {
  let pos = charPos;
  // Skip any partial identifier the user may have typed after the dot
  while (pos > 0 && /\w/.test(line[pos - 1])) pos--;
  return pos > 0 && line[pos - 1] === '.';
}

/**
 * Detects an inline function call pattern: `FunctionName().` or `FunctionName(args).`
 * Returns the function name, or null if not matched.
 */
function getInlineFunctionCallName(line: string, charPos: number): string | null {
  let pos = charPos;
  while (pos > 0 && /\w/.test(line[pos - 1])) pos--;
  if (pos <= 0 || line[pos - 1] !== '.') return null;

  const beforeDot = line.substring(0, pos - 1);
  // Match `FunctionName(...)` at the end — handle nested parens
  const match = /\b(\w+)\s*\([^)]*\)\s*$/.exec(beforeDot);
  if (!match) return null;

  // Exclude CreateObject (handled separately) and keywords
  const name = match[1];
  if (/^CreateObject$/i.test(name)) return null;
  if (/^(?:if|while|for|return|print|sub|function)$/i.test(name)) return null;

  return name;
}

type TestDotContext = 'expect' | 'expect.not' | 'mockFunction' | 'fakeClock' | 'testSuite';

/**
 * Detects test framework dot-access patterns:
 * - expect(value).  /  expect(value).not.
 * - mockFunction("name").
 * - fakeClock(m).
 * - ts().
 */
function getTestDotContext(line: string, charPos: number): TestDotContext | null {
  const before = line.substring(0, charPos);
  // expect(...).not.
  if (/expect\s*\([^)]*\)\s*\.\s*not\s*\.\s*$/i.test(before)) return 'expect.not';
  // expect(...).
  if (/expect\s*\([^)]*\)\s*\.\s*$/i.test(before)) return 'expect';
  // mockFunction(...).
  if (/mockFunction\s*\([^)]*\)\s*\.\s*$/i.test(before)) return 'mockFunction';
  // fakeClock(...).
  if (/fakeClock\s*\([^)]*\)\s*\.\s*$/i.test(before)) return 'fakeClock';
  // ts().
  if (/\bts\s*\(\s*\)\s*\.\s*$/i.test(before)) return 'testSuite';
  return null;
}

function isKopytkoAnnotationContext(line: string, charPos: number): boolean {
  return /^\s*'?\s*@/.test(line.substring(0, charPos));
}

/**
 * Returns the edit range for an annotation completion item.
 * The range starts after any leading whitespace (preserving indentation) and ends
 * at the cursor, so the textEdit replaces the `' @…` (or bare `@…`) typed so far.
 */
function computeAnnotationEditRange(line: string, position: Position): Range {
  const upToCursor = line.substring(0, position.character);
  const leadingWhitespace = /^\s*/.exec(upToCursor)?.[0].length ?? 0;
  return {
    start: { line: position.line, character: leadingWhitespace },
    end: { line: position.line, character: position.character },
  };
}

function isImportPackageContext(line: string, charPos: number): boolean {
  return /^\s*'\s*@import\s+\S+\s+from\s+/.test(line.substring(0, charPos));
}

/** True when the cursor is inside the path portion of `' @import /…` (before any `from` clause). */
function isImportPathContext(line: string, charPos: number): boolean {
  return /^\s*'\s*@import\s+\/[^\s'"]*$/.test(line.substring(0, charPos));
}

/** Returns the path token typed so far (including the leading `/`). */
function extractImportPathPrefix(line: string, charPos: number): string {
  const match = /^\s*'\s*@import\s+(\/[^\s'"]*)$/.exec(line.substring(0, charPos));
  return match ? match[1] : '/';
}

// Triggers when the cursor is positioned right after `as ` (with optional partial
// type already typed), which only occurs in function parameter or return-type position.
function isTypeAnnotationContext(line: string, charPos: number): boolean {
  return /\bas\s+\w*$/.test(line.substring(0, charPos));
}

/**
 * Converts a method signature into a VS Code snippet string.
 * Parameters are turned into tab stops: `Push(${1:a as Dynamic})`.
 * No-arg methods get a plain `MethodName()` with the cursor inside.
 */
function buildMethodSnippet(signature: string): string {
  const match = /^(\w+)\(([^)]*)\)/.exec(signature);
  if (!match) return signature;

  const name = match[1];
  const paramStr = match[2].trim();

  if (paramStr === '') {
    return `${name}()`;
  }

  const params = paramStr.split(',').map((p, i) => `\${${i + 1}:${p.trim()}}`);
  return `${name}(${params.join(', ')})`;
}

function buildMethodDoc(
  method: { name: string; signature: string; description: string; since?: string; deprecated?: boolean; deprecationNote?: string },
  ifaceName: string | undefined,
  componentName: string
): string {
  const lines: string[] = [];

  lines.push(`**${method.name}** — \`${componentName}\``);
  if (ifaceName) lines.push(`*Interface: ${ifaceName}*`);
  lines.push('');
  lines.push(`\`\`\`brightscript\n${method.signature}\n\`\`\``);
  lines.push('');
  lines.push(method.description);

  if (method.since) {
    lines.push('');
    lines.push(`*Available since firmware ${method.since}*`);
  }
  if (method.deprecated) {
    lines.push('');
    lines.push(`> ⚠️ **Deprecated.** ${method.deprecationNote ?? ''}`);
  }

  return lines.join('\n');
}

function isMtopAccess(line: string, charPos: number): boolean {
  let pos = charPos;
  while (pos > 0 && /\w/.test(line[pos - 1])) pos--;
  if (pos <= 0 || line[pos - 1] !== '.') return false;
  return /\bm\.top$/i.test(line.substring(0, pos - 1));
}

/** Context info when the cursor is inside a CreateObject("...") string argument. */
interface CreateObjectStringContext {
  /** Start column of the string content (after the opening quote). */
  contentStart: number;
  /** End column of the string content (before the closing quote, or end of line). */
  contentEnd: number;
  /** Text typed so far inside the quotes. */
  prefix: string;
}

/**
 * Returns context info when the cursor is inside the first string argument
 * of a `CreateObject("...")` call. Returns undefined otherwise.
 */
function getCreateObjectStringContext(
  line: string,
  charPos: number,
): CreateObjectStringContext | undefined {
  // Match CreateObject( possibly with spaces, then opening quote
  const re = /\bCreateObject\s*\(\s*"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const contentStart = m.index + m[0].length; // position right after the opening "
    // Find the closing quote
    const closingQuote = line.indexOf('"', contentStart);
    const contentEnd = closingQuote >= 0 ? closingQuote : line.length;

    // Check if cursor is within this string
    if (charPos >= contentStart && charPos <= contentEnd) {
      return {
        contentStart,
        contentEnd,
        prefix: line.substring(contentStart, charPos),
      };
    }
  }
  return undefined;
}

function buildMtopFieldItem(f: MtopField): CompletionItem {
  const detail = f.readonly ? `${f.type} (read-only)` : f.type;
  return {
    label: f.name,
    kind: f.type === 'function' ? CompletionItemKind.Function : CompletionItemKind.Field,
    detail,
    insertText: f.name,
    sortText: `0_${f.name}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${f.name}** — \`${f.type}\`\n\n${f.description}`,
    },
  };
}

function buildMtopMethodItem(m: MtopMethod, casing: CasingConfig): CompletionItem {
  const label = applyCasingWithOverrides(m.name, casing.method, casing.exact);
  const snippet = applySnippetCasing(buildMethodSnippet(m.signature), casing.method);
  const ifaceLine = m.interface ? `*Interface: ${m.interface}*\n\n` : '';
  return {
    label,
    kind: CompletionItemKind.Method,
    detail: m.returnType,
    insertText: snippet,
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: `1_${m.name}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${m.name}**\n\n${ifaceLine}\`\`\`brightscript\n${m.signature}\n\`\`\`\n\n${m.description}`,
    },
  };
}

function buildComponentDoc(c: { name: string; description: string; interfaces: string[]; docsUrl: string }): string {
  return [
    `**${c.name}**`,
    '',
    c.description,
    '',
    `*Interfaces:* ${c.interfaces.join(', ')}`,
    '',
    `[Roku docs](${c.docsUrl})`,
  ].join('\n');
}

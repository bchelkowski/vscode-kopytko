import { Hover, MarkupKind, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  getComponentMethods,
  CATALOG_LAST_VERIFIED,
} from 'kopytko-brightscript-parser';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { KopytkoModuleCatalog } from '../kopytko/moduleCatalog';
import { inferNumericLiteralType } from 'kopytko-brightscript-parser';
import { getCachedTypeMap, getCachedLines } from '../utils/documentCache';
import {
  isTestFile,
  buildTestApiMap,
  EXPECT_MATCHERS,
  MOCK_FUNCTION_METHODS,
  TestApiEntry,
} from '../kopytko/testFramework';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { ResolvedSymbol, SymbolResolver, resolveWordContext } from './shared/symbolResolver';

/**
 * Provides hover documentation for:
 *   - BrightScript component names  (roArray, roUrlTransfer, …)
 *   - BrightScript component methods (Push, GetToString, …) — type-inferred from CreateObject
 *   - BrightScript built-in functions (Abs, Len, …)
 *   - Kopytko module exports (setState, navigate, …)
 */
export class BrightScriptHoverProvider {
  private readonly symbolResolver: SymbolResolver;

  constructor(
    catalog: KopytkoModuleCatalog,
    importResolver?: KopytkoImportResolver,
    workspaceIndex?: WorkspaceFunctionIndex,
  ) {
    this.symbolResolver = new SymbolResolver(catalog, importResolver, workspaceIndex);
  }

  provideHover(document: TextDocument, position: Position, siblingPatterns: string[][] = []): Hover | null {
    const lines = getCachedLines(document);
    const line = lines[position.line];
    if (!line) return null;

    // ── 0. Numeric literal hover (e.g. user hovers over "&HFF" or "2.3#") ────
    const numLiteral = getNumericLiteralAtPosition(line, position.character);
    if (numLiteral) {
      const numType = inferNumericLiteralType(numLiteral.literal);
      if (numType) {
        return markdown([
          `**${numType}** *(BrightScript numeric literal)*`,
          '',
          `\`${numLiteral.literal}\` → *${numType}*`,
        ]);
      }
    }

    const word = resolveWordContext(document, position);
    if (!word) return null;

    const primary = this.symbolResolver.resolveAtPosition(document, position, siblingPatterns, {
      includeUserFunctions: false,
      includeWorkspaceFunctions: false,
    });
    const primaryHover = primary ? hoverForResolvedSymbol(primary) : null;
    if (primaryHover) return primaryHover;

    // ── 4b. Test framework functions (expect matchers, mockFunction, etc.) ────
    if (isTestFile(document.uri)) {
      const testHover = tryTestFrameworkHover(line, word.word, word.start);
      if (testHover) return testHover;
    }

    const functionSymbol = this.symbolResolver.resolveFunctionSymbol(document, word.word, siblingPatterns);
    const functionHover = functionSymbol ? hoverForResolvedSymbol(functionSymbol) : null;
    if (functionHover) return functionHover;

    // ── 6. Variable with inferred type (numeric literal assignments) ────────
    const typeMap = getCachedTypeMap(document);
    const varType = typeMap.get(word.word.toLowerCase());
    if (varType && isPrimitiveType(varType)) {
      return markdown([
        `**${word.word}**: *${varType}*`,
      ]);
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function markdown(lines: string[]): Hover {
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: lines.filter((l) => l !== undefined).join('\n'),
    },
  };
}


function hoverForResolvedSymbol(symbol: ResolvedSymbol): Hover | null {
  switch (symbol.kind) {
    case 'component': {
      const ifaceList = symbol.component.interfaces.join(', ');
      const methodCount = getComponentMethods(symbol.component.name).length;
      return markdown([
        `**${symbol.component.name}** *(BrightScript component)*`,
        '',
        symbol.component.description,
        '',
        `*Interfaces:* \`${ifaceList}\`  ·  *${methodCount} methods*`,
        '',
        `[Roku docs](${symbol.component.docsUrl})`,
        '',
        `*Catalog verified: ${CATALOG_LAST_VERIFIED}*`,
      ]);
    }
    case 'componentMethod':
      return buildMethodHover(symbol.method, symbol.componentType, symbol.iface);
    case 'builtin':
      return markdown([
        `**${symbol.builtin.name}** *(BrightScript built-in · ${symbol.builtin.category})*`,
        '',
        `\`\`\`brightscript
${symbol.builtin.signature}
\`\`\``,
        '',
        symbol.builtin.description,
      ]);
    case 'kopytkoExport':
      return markdown([
        `**${symbol.entry.name}** *(${symbol.moduleName} — \`${symbol.entry.npmPackage}\`)*`,
        '',
        `\`\`\`brightscript
${symbol.entry.signature}
\`\`\``,
      ]);
    case 'userFunction': {
      const relativePath = symbol.definition.filePath.replace(/\\/g, '/').replace(/.*\/app\//, '');
      return markdown([
        `**${symbol.definition.name}** *(${relativePath})*`,
        '',
        `\`\`\`brightscript
${symbol.definition.signature}
\`\`\``,
      ]);
    }
    case 'sourceFunction': {
      const rel = symbol.definition.filePath.replace(/\\/g, '/').replace(/.*\/source\//, 'source/');
      return markdown([
        `**${symbol.definition.name}** *(${rel})*`,
        '',
        `\`\`\`brightscript
${symbol.definition.signature}
\`\`\``,
      ]);
    }
    default:
      return null;
  }
}

function buildMethodHover(
  method: { name: string; signature: string; description: string; deprecated?: boolean; deprecationNote?: string; since?: string },
  componentType: string,
  iface?: { name: string; docsUrl: string },
): Hover {
  const deprecationNote = method.deprecated
    ? `\n\n> ⚠️ **Deprecated.** ${method.deprecationNote ?? ''}`
    : '';
  const sinceNote = method.since
    ? `\n\n*Available since firmware ${method.since}*`
    : '';

  return markdown([
    `**${method.name}** — \`${componentType}\`${iface ? ` *(${iface.name})*` : ''}`,
    '',
    `\`\`\`brightscript\n${method.signature}\n\`\`\``,
    '',
    method.description,
    sinceNote,
    deprecationNote,
    iface ? `\n[Roku docs — ${iface.name}](${iface.docsUrl})` : '',
  ]);
}

// ---------------------------------------------------------------------------
// Test framework hover
// ---------------------------------------------------------------------------

const _testApiMap = buildTestApiMap();

/**
 * Provides hover for test framework identifiers:
 * - Global functions: it, test, expect, mockFunction, beforeEach, etc.
 * - Chained methods: expect().toBe, mockFunction().returnValue, etc.
 */
function tryTestFrameworkHover(line: string, word: string, wordStart: number): Hover | null {
  const lower = word.toLowerCase();

  // Check if preceded by dot → matcher or mock method
  const beforeWord = line.substring(0, wordStart);
  if (/\.\s*$/.test(beforeWord)) {
    // Determine context: expect(). or mockFunction(). or ts().
    if (/expect\s*\([^)]*\)\s*\.\s*(?:not\s*\.\s*)?$/i.test(beforeWord)) {
      const entry = EXPECT_MATCHERS.find(e => e.name.toLowerCase() === lower);
      if (entry) return buildTestApiHover(entry);
    }
    if (/mockFunction\s*\([^)]*\)\s*\.\s*$/i.test(beforeWord)) {
      const entry = MOCK_FUNCTION_METHODS.find(e => e.name.toLowerCase() === lower);
      if (entry) return buildTestApiHover(entry);
    }
  }

  // Global test function
  const entry = _testApiMap.get(lower);
  if (entry && entry.context === 'global') {
    return buildTestApiHover(entry);
  }

  return null;
}

function buildTestApiHover(entry: TestApiEntry): Hover {
  const contextLabel = entry.context === 'expect' ? 'expect matcher'
    : entry.context === 'mockFunction' ? 'mock method'
    : entry.context === 'testSuite' ? 'test suite method'
    : 'kopytko-unit-testing-framework';

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: [
        `**${entry.name}** *(${contextLabel})*`,
        '',
        `\`\`\`brightscript\n${entry.signature}\n\`\`\``,
        '',
        entry.description,
      ].join('\n'),
    },
  };
}

// ---------------------------------------------------------------------------
// Numeric literal helpers
// ---------------------------------------------------------------------------

import { NUMERIC_LITERAL_GLOBAL_RE } from 'kopytko-brightscript-parser';

const PRIMITIVE_TYPES = new Set(['Integer', 'Float', 'Double', 'LongInteger', 'Boolean', 'String']);

function isPrimitiveType(typeName: string): boolean {
  return PRIMITIVE_TYPES.has(typeName);
}

/**
 * Finds the numeric literal at the given character position, or null.
 * Scans the line for all numeric literal occurrences and returns the one
 * that contains the cursor.
 */
function getNumericLiteralAtPosition(line: string, character: number): { literal: string; start: number; end: number } | null {
  NUMERIC_LITERAL_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMERIC_LITERAL_GLOBAL_RE.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character < end) {
      return { literal: match[0], start, end };
    }
  }
  return null;
}

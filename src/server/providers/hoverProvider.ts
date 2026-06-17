import { Hover, MarkupKind, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findBuiltin } from 'brightscript-parser';
import {
  findComponent,
  getComponentMethods,
  findMethodInterface,
  CATALOG_LAST_VERIFIED,
} from 'brightscript-parser';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { KopytkoModuleCatalog } from '../kopytko/moduleCatalog';
import { resolveReceiverType, getInlineCreateObjectType } from '../brightscript/typeInference';
import { inferNumericLiteralType } from 'brightscript-parser';
import { getDocumentPath } from '../utils/textUtils';
import { getWordAtPosition } from 'brightscript-parser';
import { getCachedTypeMap, getCachedAllFunctions } from '../utils/documentCache';
import {
  isTestFile,
  buildTestApiMap,
  EXPECT_MATCHERS,
  MOCK_FUNCTION_METHODS,
  TestApiEntry,
} from '../kopytko/testFramework';

/**
 * Provides hover documentation for:
 *   - BrightScript component names  (roArray, roUrlTransfer, …)
 *   - BrightScript component methods (Push, GetToString, …) — type-inferred from CreateObject
 *   - BrightScript built-in functions (Abs, Len, …)
 *   - Kopytko module exports (setState, navigate, …)
 */
export class BrightScriptHoverProvider {
  constructor(
    private readonly _catalog: KopytkoModuleCatalog,
    private readonly _importResolver?: KopytkoImportResolver,
  ) {}

  provideHover(document: TextDocument, position: Position, siblingPatterns: string[][] = []): Hover | null {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
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

    const word = getWordAtPosition(line, position.character);
    if (!word) return null;

    // ── 1. Component name hover (e.g. user hovers over "roUrlTransfer") ──────
    const component = findComponent(word.word);
    if (component) {
      const ifaceList = component.interfaces.join(', ');
      const methodCount = getComponentMethods(word.word).length;
      return markdown([
        `**${component.name}** *(BrightScript component)*`,
        '',
        component.description,
        '',
        `*Interfaces:* \`${ifaceList}\`  ·  *${methodCount} methods*`,
        '',
        `[Roku docs](${component.docsUrl})`,
        '',
        `*Catalog verified: ${CATALOG_LAST_VERIFIED}*`,
      ]);
    }

    // ── 2. Component member hover — infer receiver type from context ──────────
    // Check inline CreateObject("roXxx").method pattern first
    const inlineType = getInlineCreateObjectType(line, word.start);
    if (inlineType) {
      const methods = getComponentMethods(inlineType);
      const method = methods.find((m) => m.name.toLowerCase() === word.word.toLowerCase());
      if (method) {
        const iface = findMethodInterface(inlineType, method.name);
        return buildMethodHover(method, inlineType, iface);
      }
    }

    const typeMap = getCachedTypeMap(document);
    const memberHover = tryMemberHover(line, word, typeMap);
    if (memberHover) return memberHover;

    // ── 3. BrightScript built-in function ─────────────────────────────────────
    const builtin = findBuiltin(word.word);
    if (builtin) {
      return markdown([
        `**${builtin.name}** *(BrightScript built-in · ${builtin.category})*`,
        '',
        `\`\`\`brightscript\n${builtin.signature}\n\`\`\``,
        '',
        builtin.description,
      ]);
    }

    // ── 4. Kopytko module export ───────────────────────────────────────────────
    const kopytkoExport = this._catalog.findExport(word.word);
    if (kopytkoExport) {
      const moduleName = deriveModuleName(kopytkoExport.importPath);
      return markdown([
        `**${kopytkoExport.name}** *(${moduleName} — \`${kopytkoExport.npmPackage}\`)*`,
        '',
        `\`\`\`brightscript\n${kopytkoExport.signature}\n\`\`\``,
      ]);
    }

    // ── 4b. Test framework functions (expect matchers, mockFunction, etc.) ────
    if (isTestFile(document.uri)) {
      const testHover = tryTestFrameworkHover(line, word.word, word.start);
      if (testHover) return testHover;
    }

    // ── 5. User-defined function (same file + @import chain + siblings) ──────
    if (this._importResolver) {
      const documentPath = getDocumentPath(document);
      const allFunctions = getCachedAllFunctions(document, documentPath, this._importResolver, siblingPatterns);
      const userFunc = allFunctions.find((f) => f.nameLower === word.word.toLowerCase());
      if (userFunc) {
        const relativePath = userFunc.filePath.replace(/\\/g, '/').replace(/.*\/app\//, '');
        return markdown([
          `**${userFunc.name}** *(${relativePath})*`,
          '',
          `\`\`\`brightscript\n${userFunc.signature}\n\`\`\``,
        ]);
      }
    }

    // ── 6. Variable with inferred type (numeric literal assignments) ────────
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

/**
 * Attempts to show method documentation when the cursor is on a method name
 * that follows a dot whose receiver has a known type.
 *
 * Strategy: scan left from the current word to find `receiverName.methodName`.
 */
function tryMemberHover(
  line: string,
  wordInfo: { word: string; start: number; end: number },
  typeMap: Map<string, string>
): Hover | null {
  if (wordInfo.start <= 0) return null;

  // Check that the character immediately before the word is a dot
  if (line[wordInfo.start - 1] !== '.') return null;

  // Extract the receiver identifier before the dot
  const beforeDot = line.substring(0, wordInfo.start - 1);
  const receiverMatch = /(\w+)$/.exec(beforeDot);
  if (!receiverMatch) return null;

  const receiverName = receiverMatch[1];
  const componentType = resolveReceiverType(receiverName, typeMap);
  if (!componentType) return null;

  // Find the method on that component
  const methods = getComponentMethods(componentType);
  const method = methods.find((m) => m.name.toLowerCase() === wordInfo.word.toLowerCase());
  if (!method) return null;

  const iface = findMethodInterface(componentType, method.name);
  return buildMethodHover(method, componentType, iface);
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

/** Derives a human-readable module name from an import path, e.g. `/Renderer.brs` → `Renderer`. */
function deriveModuleName(importPath: string): string {
  const base = importPath.split('/').pop() ?? importPath;
  return base.endsWith('.brs') ? base.slice(0, -4) : base;
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

import { NUMERIC_LITERAL_GLOBAL_RE } from 'brightscript-parser';

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

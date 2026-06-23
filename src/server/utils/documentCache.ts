import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoImportResolver, KopytkoImport } from '../kopytko/importResolver';
import { FunctionDefinition, collectFunctionsFromImports, collectFunctionsFromExtends, collectAllFunctions, collectAllInnerMethods, InnerMethodDefinition, resolveTestedFiles, findTestSiblings, parseFunctionDefs } from '../brightscript/functionIndex';
import { TypeMap } from '../brightscript/typeInference';
import { findSiblingFiles } from '../brightscript/patternSiblings';
import * as nodePath from 'path';
import fsWrapper from './fsWrapper';
import { isTestFile } from '../kopytko/testFramework';
import { parse, inferTypesFromAst, getVariableType, buildScopes } from 'kopytko-brightscript-parser';
import type { ParseResult, Scope } from 'kopytko-brightscript-parser';
import { clearFileParseCache } from './fileParseCache';
import { clearComponentXmlCache } from '../brightscript/xmlScriptParser';

/**
 * Per-document cache that stores parsed/computed results keyed by
 * {uri, version, contentLength}. When the document changes, the cache entry
 * is automatically invalidated on next access.
 */

interface CacheEntry {
  version: number;
  contentLength: number;
  lines?: string[];
  imports?: KopytkoImport[];
  typeMap?: TypeMap;
  knownFuncNames?: Set<string>;
  knownFuncSiblingKey?: string;
  allFunctions?: FunctionDefinition[];
  allFuncSiblingKey?: string;
  allInnerMethods?: InnerMethodDefinition[];
  allMethodsSiblingKey?: string;
  /** Parsed CST from brightscript-parser (cached per version). */
  parseResult?: ParseResult;
  /** Scope tree built from the CST (cached per version). */
  scopeTree?: Scope;
}

const _cache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 100;

function getEntry(document: TextDocument): CacheEntry {
  const uri = document.uri;
  const version = document.version;
  const contentLength = document.getText().length;
  const existing = _cache.get(uri);
  if (existing && existing.version === version && existing.contentLength === contentLength) {
    // Cache hit — re-insert so this entry moves to the most-recently-used end.
    // (A Map preserves insertion order, so eviction below can drop the truly
    // least-recently-used document instead of the oldest-inserted one.)
    _cache.delete(uri);
    _cache.set(uri, existing);
    return existing;
  }

  // Drop any stale entry for this uri first so the fresh one is re-inserted at
  // the MRU position rather than keeping the stale entry's slot.
  if (existing) _cache.delete(uri);

  if (_cache.size >= MAX_CACHE_SIZE) {
    const oldest = _cache.keys().next().value;
    if (oldest) _cache.delete(oldest);
  }

  const entry: CacheEntry = { version, contentLength };
  _cache.set(uri, entry);
  return entry;
}

/** Returns the document text split into lines (cached per version). */
export function getCachedLines(document: TextDocument): string[] {
  const entry = getEntry(document);
  if (!entry.lines) {
    entry.lines = document.getText().split(/\r?\n/);
  }
  return entry.lines;
}

/**
 * Returns the parsed CST from brightscript-parser (cached per version).
 * This is the shared parse result that all AST-based providers can use.
 */
export function getCachedParseResult(document: TextDocument): ParseResult {
  const entry = getEntry(document);
  if (!entry.parseResult) {
    entry.parseResult = parse(document.getText());
  }
  return entry.parseResult;
}

/**
 * Returns the scope tree built from the parsed CST (cached per version).
 * Provides per-function declarations (params, locals, functions) and references
 * for scope-aware providers (semantic tokens, future call hierarchy, etc.).
 */
export function getCachedScopeTree(document: TextDocument): Scope {
  const entry = getEntry(document);
  if (!entry.scopeTree) {
    entry.scopeTree = buildScopes(getCachedParseResult(document).root);
  }
  return entry.scopeTree;
}

/** Returns parsed @import annotations (cached per version). */
export function getCachedImports(document: TextDocument, importResolver: KopytkoImportResolver): KopytkoImport[] {
  const entry = getEntry(document);
  if (!entry.imports) {
    entry.imports = importResolver.parseImports(document.getText());
  }
  return entry.imports;
}

/** Returns the type inference map (cached per version). */
export function getCachedTypeMap(document: TextDocument): TypeMap {
  const entry = getEntry(document);
  if (!entry.typeMap) {
    // Use parser-based type inference
    const parseResult = getCachedParseResult(document);
    const parserTypeMap = inferTypesFromAst(parseResult.root);
    // Convert parser TypeMap to extension TypeMap format
    const typeMap: TypeMap = new Map();
    for (const [name] of parserTypeMap) {
      const best = getVariableType(parserTypeMap, name);
      if (best) typeMap.set(name, best);
    }
    entry.typeMap = typeMap;
  }
  return entry.typeMap;
}

/**
 * Returns the set of known function names from @import chain + pattern siblings +
 * extends chain (cached per version + siblingPatterns). Used by diagnostics.
 */
export function getCachedKnownFuncNames(
  document: TextDocument,
  documentPath: string,
  importResolver: KopytkoImportResolver,
  siblingPatterns: string[][],
): Set<string> {
  const entry = getEntry(document);
  const siblingKey = JSON.stringify(siblingPatterns);
  if (!entry.knownFuncNames || entry.knownFuncSiblingKey !== siblingKey) {
    const text = document.getText();
    // Use collectAllFunctions so the main file sees its own XML siblings + pattern siblings + imports
    const allFunctions = collectAllFunctions(documentPath, text, importResolver, new Set(), siblingPatterns);
    const names = new Set(allFunctions.map((f) => f.nameLower));

    for (const fn of collectFunctionsFromExtends(documentPath, importResolver)) {
      names.add(fn.nameLower);
    }

    // Also check extends chains of pattern siblings (e.g. view.brs may extend a component)
    for (const siblingPath of findSiblingFiles(documentPath, siblingPatterns)) {
      for (const fn of collectFunctionsFromExtends(siblingPath, importResolver)) {
        names.add(fn.nameLower);
      }
    }

    // For test files: include the tested file's full scope (imports, XML siblings, extends)
    if (isTestFile(documentPath)) {
      // Auto-import mock config files (*.config.brs) for @mock annotations
      const imports = importResolver.parseImports(text);
      for (const imp of imports) {
        if (!imp.isMock) continue;
        const resolved = importResolver.resolveImportPath(imp, documentPath);
        if (!resolved) continue;
        const dir = nodePath.dirname(resolved);
        const basename = nodePath.basename(resolved, '.brs');
        const configPath = nodePath.join(dir, '_mocks', `${basename}.config.brs`);
        try {
          const configText = fsWrapper.readFileSync(configPath, 'utf-8');
          for (const fn of parseFunctionDefs(configText, configPath)) {
            names.add(fn.nameLower);
          }
        } catch { /* no config file */ }

        // Also auto-import mock implementation files (_mocks/*.mock.brs)
        // The build replaces the original with the mock, which may define new functions
        const mockPath = nodePath.join(dir, '_mocks', `${basename}.mock.brs`);
        try {
          const mockText = fsWrapper.readFileSync(mockPath, 'utf-8');
          for (const fn of parseFunctionDefs(mockText, mockPath)) {
            names.add(fn.nameLower);
          }
        } catch { /* no mock file */ }
      }

      for (const testedPath of resolveTestedFiles(documentPath)) {
        try {
          const testedText = fsWrapper.readFileSync(testedPath, 'utf-8');
          // Use collectAllFunctions to include XML siblings + pattern siblings + imports
          for (const fn of collectAllFunctions(testedPath, testedText, importResolver, new Set(), siblingPatterns)) {
            names.add(fn.nameLower);
          }
        } catch { /* skip */ }
        for (const fn of collectFunctionsFromExtends(testedPath, importResolver)) {
          names.add(fn.nameLower);
        }
      }

      // Include sibling test files (Foo.test.brs ↔ Foo_Bar.test.brs share scope)
      for (const siblingTest of findTestSiblings(documentPath)) {
        try {
          const sibText = fsWrapper.readFileSync(siblingTest, 'utf-8');
          for (const fn of collectFunctionsFromImports(siblingTest, sibText, importResolver)) {
            names.add(fn.nameLower);
          }
        } catch { /* skip */ }
      }
    }

    entry.knownFuncNames = names;
    entry.knownFuncSiblingKey = siblingKey;
  }
  return entry.knownFuncNames;
}

/**
 * Returns all visible function definitions (cached per version + siblingPatterns).
 * Used by definition, hover, signature help, rename.
 */
export function getCachedAllFunctions(
  document: TextDocument,
  documentPath: string,
  importResolver: KopytkoImportResolver,
  siblingPatterns: string[][],
): FunctionDefinition[] {
  const entry = getEntry(document);
  const siblingKey = JSON.stringify(siblingPatterns);
  if (!entry.allFunctions || entry.allFuncSiblingKey !== siblingKey) {
    entry.allFunctions = collectAllFunctions(
      documentPath, document.getText(), importResolver, new Set(), siblingPatterns, getCachedLines(document),
    );
    entry.allFuncSiblingKey = siblingKey;
  }
  return entry.allFunctions;
}

/**
 * Returns all visible inner method definitions (cached per version + siblingPatterns).
 * Used by definition provider.
 */
export function getCachedAllInnerMethods(
  document: TextDocument,
  documentPath: string,
  importResolver: KopytkoImportResolver,
  siblingPatterns: string[][],
): InnerMethodDefinition[] {
  const entry = getEntry(document);
  const siblingKey = JSON.stringify(siblingPatterns);
  if (!entry.allInnerMethods || entry.allMethodsSiblingKey !== siblingKey) {
    entry.allInnerMethods = collectAllInnerMethods(
      documentPath, document.getText(), importResolver, new Set(), siblingPatterns, getCachedLines(document),
    );
    entry.allMethodsSiblingKey = siblingKey;
  }
  return entry.allInnerMethods;
}

/**
 * Invalidate all cached entries (e.g. on config change or any watched-file
 * change). Also clears the cross-document file parse cache — this is the single
 * point that keeps the file-level cache from outliving a disk/config change.
 */
export function invalidateAllCaches(): void {
  _cache.clear();
  clearFileParseCache();
  clearComponentXmlCache();
}

/**
 * Clears per-document derived caches (lines, parse results, type maps, collected
 * functions) and the component-XML resolution cache, but leaves the
 * cross-document file parse cache intact.
 *
 * Used on watched-file changes: the changed files are evicted from the file
 * parse cache individually (see server.ts), so unaffected files stay warm while
 * every open document recomputes its derived state on next access — picking up
 * the fresh content of the files that actually changed.
 */
export function invalidateDocumentCaches(): void {
  _cache.clear();
  clearComponentXmlCache();
}

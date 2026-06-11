import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoImportResolver, KopytkoImport } from '../kopytko/importResolver';
import { FunctionDefinition, collectFunctionsFromImports, collectFunctionsFromExtends, collectAllFunctions, collectAllInnerMethods, InnerMethodDefinition, resolveTestedFiles, findTestSiblings, parseFunctionDefs } from '../brightscript/functionIndex';
import { TypeMap, inferTypes } from '../brightscript/typeInference';
import { findSiblingFiles } from '../brightscript/patternSiblings';
import * as nodePath from 'path';
import fsWrapper from './fsWrapper';
import { isTestFile } from '../kopytko/testFramework';

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
}

const _cache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 50;

function getEntry(document: TextDocument): CacheEntry {
  const uri = document.uri;
  const version = document.version;
  const contentLength = document.getText().length;
  const existing = _cache.get(uri);
  if (existing && existing.version === version && existing.contentLength === contentLength) {
    return existing;
  }

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
    entry.typeMap = inferTypes(document.getText());
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
      documentPath, document.getText(), importResolver, new Set(), siblingPatterns,
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
      documentPath, document.getText(), importResolver, new Set(), siblingPatterns,
    );
    entry.allMethodsSiblingKey = siblingKey;
  }
  return entry.allInnerMethods;
}

/** Invalidate all cached entries (e.g. on config change). */
export function invalidateAllCaches(): void {
  _cache.clear();
}

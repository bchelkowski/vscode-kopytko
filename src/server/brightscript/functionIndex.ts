import * as nodePath from 'path';
import fsWrapper from '../utils/fsWrapper';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { getScriptPathsFromXml, getXmlSiblingPaths, findComponentXml, parseXmlExtends } from './xmlScriptParser';
import { findSiblingFiles } from './patternSiblings';
import { buildSearchRoots } from '../utils/workspaceUtils';
import { isTestFile, getTestBaseName } from '../kopytko/testFramework';
import { parse, walk, FunctionDeclaration, analyzeContext } from 'kopytko-brightscript-parser';
import type { SyntaxNode } from 'kopytko-brightscript-parser';
import { readCachedFileText, getCachedFunctionDefs, getCachedInnerMethodDefs } from '../utils/fileParseCache';

/**
 * Normalizes a file path for use in visited/dedup sets.
 * On case-insensitive file systems (macOS, Windows) the path is lowercased
 * so that different casings of the same file are recognized as identical.
 */
function normalizePathKey(p: string): string {
  const n = nodePath.normalize(p);
  return process.platform === 'linux' ? n : n.toLowerCase();
}

export interface FunctionDefinition {
  name: string;
  nameLower: string;
  /** 0-based line number */
  line: number;
  /** 0-based column of the first character of the name */
  column: number;
  filePath: string;
  /** Full declaration line (trimmed). Used for signature help. */
  signature: string;
}

export interface InnerMethodDefinition {
  name: string;
  nameLower: string;
  /** 0-based line number of the assignment */
  line: number;
  /** 0-based column of the method name in the assignment line */
  column: number;
  filePath: string;
  /** Name of the top-level function that contains this assignment (the "class" that owns the method) */
  ownerFunction?: string;
}

/** Removes duplicate definitions that share the same file, line, and column. */
function deduplicateByLocation<T extends { filePath: string; line: number; column: number }>(defs: T[]): T[] {
  const seen = new Set<string>();
  return defs.filter(d => {
    const key = `${normalizePathKey(d.filePath)}:${d.line}:${d.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parses all top-level function/sub definitions from a BrightScript text.
 * Uses the brightscript-parser CST for accurate function detection.
 */
export function parseFunctionDefs(text: string, filePath: string, preLines?: string[]): FunctionDefinition[] {
  const result = parse(text);
  // Open documents pass cached lines from documentCache; cold file-walk callers
  // legitimately split raw on-disk text here because no TextDocument cache exists.
  const lines = preLines ?? text.split(/\r?\n/);
  return functionDefsFromRoot(result.root, filePath, lines);
}

/**
 * Same as `parseFunctionDefs`, but takes an already-parsed CST root instead of
 * raw text — for callers that already hold a cached `ParseResult` (e.g. the
 * open document's `getCachedParseResult`) and would otherwise re-parse the
 * same text a second time just to get its function defs.
 */
export function functionDefsFromRoot(root: SyntaxNode, filePath: string, lines: string[]): FunctionDefinition[] {
  const defs: FunctionDefinition[] = [];

  walk(root, {
    visitFunctionDeclaration(node: InstanceType<typeof FunctionDeclaration>) {
      const nameToken = node.nameToken;
      if (!nameToken) return;
      const signature = lines[nameToken.line]?.trim() ?? '';
      defs.push({
        name: nameToken.text,
        nameLower: nameToken.text.toLowerCase(),
        line: nameToken.line,
        column: nameToken.column,
        filePath,
        signature,
      });
      return false; // don't recurse into nested functions
    },
  });

  return defs;
}

/**
 * Collects all function definitions reachable from a given .brs file strictly
 * via `@import` annotations (transitively).  XML component sibling files are
 * intentionally excluded so the result reflects the developer's explicit import
 * declarations — the same boundary that Kopytko's `@import` mechanism enforces.
 *
 * Used by the undefined-function diagnostic so that functions accessible only
 * through the SceneGraph XML component tree (e.g. deployed framework scripts)
 * do not silently suppress warnings.
 */
export function collectFunctionsFromImports(
  filePath: string,
  fileText: string,
  importResolver: KopytkoImportResolver,
  visited: Set<string> = new Set(),
): FunctionDefinition[] {
  return _collectFunctionsFromImports(filePath, fileText, importResolver, visited, true);
}

function _collectFunctionsFromImports(
  filePath: string,
  fileText: string,
  importResolver: KopytkoImportResolver,
  visited: Set<string>,
  isEntry: boolean,
): FunctionDefinition[] {
  const normalPath = normalizePathKey(filePath);
  if (visited.has(normalPath)) return [];
  visited.add(normalPath);

  const defs: FunctionDefinition[] = [...ownFunctionDefs(filePath, fileText, isEntry)];

  const imports = importResolver.parseImports(fileText);
  for (const imp of imports) {
    const resolved = importResolver.resolveImportPath(imp, nodePath.normalize(filePath));
    if (resolved && !visited.has(normalizePathKey(resolved)) && fsWrapper.existsSync(resolved)) {
      const text = readCachedFileText(resolved);
      if (text !== undefined) {
        defs.push(..._collectFunctionsFromImports(resolved, text, importResolver, visited, false));
      }
    }
  }

  return defs;
}

/**
 * Returns a file's own top-level function/sub definitions.
 *
 * The **entry** document (the file under the cursor) parses the live `fileText`
 * it was handed — which may differ from what's on disk when the buffer is dirty.
 * A **non-entry** file (reached via @import / XML sibling / extends) uses the
 * shared, memoized parse of its on-disk text, so the same imported file is read
 * and parsed once across every document and provider that depends on it.
 *
 * The result is always spread into a fresh array by callers before mutation, so
 * the memoized array is never modified in place.
 */
function ownFunctionDefs(filePath: string, fileText: string, isEntry: boolean, entryLines?: string[]): FunctionDefinition[] {
  if (isEntry) return parseFunctionDefs(fileText, nodePath.normalize(filePath), entryLines);
  return getCachedFunctionDefs(filePath) ?? parseFunctionDefs(fileText, nodePath.normalize(filePath));
}

/** Inner-method counterpart of {@link ownFunctionDefs}. */
function ownInnerMethodDefs(filePath: string, fileText: string, isEntry: boolean): InnerMethodDefinition[] {
  if (isEntry) return parseInnerMethodDefs(fileText, nodePath.normalize(filePath));
  return getCachedInnerMethodDefs(filePath) ?? parseInnerMethodDefs(fileText, nodePath.normalize(filePath));
}

/**
 * Collects all function definitions visible from a given .brs file:
 *   1. Definitions in the file itself
 *   2. Definitions in files transitively imported via @import annotations
 *   3. Definitions in BrightScript sibling files listed in the same XML component
 */
export function collectAllFunctions(
  filePath: string,
  fileText: string,
  importResolver: KopytkoImportResolver,
  visited: Set<string> = new Set(),
  siblingPatterns: string[][] = [],
  entryLines?: string[],
): FunctionDefinition[] {
  return _collectAllFunctions(filePath, fileText, importResolver, visited, siblingPatterns, true, entryLines);
}

function _collectAllFunctions(
  filePath: string,
  fileText: string,
  importResolver: KopytkoImportResolver,
  visited: Set<string>,
  siblingPatterns: string[][],
  isEntry: boolean,
  entryLines?: string[],
): FunctionDefinition[] {
  const normalPath = nodePath.normalize(filePath);
  const pathKey = normalizePathKey(filePath);
  if (visited.has(pathKey)) return [];
  visited.add(pathKey);

  const defs: FunctionDefinition[] = [...ownFunctionDefs(filePath, fileText, isEntry, entryLines)];

  // 1. Collect from @import annotations
  const imports = importResolver.parseImports(fileText);
  for (const imp of imports) {
    const resolved = importResolver.resolveImportPath(imp, normalPath);
    if (resolved && !visited.has(normalizePathKey(resolved)) && fsWrapper.existsSync(resolved)) {
      const text = readCachedFileText(resolved);
      if (text !== undefined) {
        defs.push(..._collectAllFunctions(resolved, text, importResolver, visited, siblingPatterns, false));
      }
    }
  }

  // 2. Collect from XML sibling BrightScript files
  const workspaceFolders = importResolver.getWorkspaceFolders();
  const sourceDir = importResolver.getSourceDir();
  const siblings = getXmlSiblingPaths(normalPath, workspaceFolders, sourceDir);
  for (const sibling of siblings) {
    if (visited.has(normalizePathKey(sibling))) continue;
    if (!fsWrapper.existsSync(sibling)) continue;
    const text = readCachedFileText(sibling);
    if (text !== undefined) {
      defs.push(..._collectAllFunctions(sibling, text, importResolver, visited, siblingPatterns, false));
    }
  }

  // 3. Collect from pattern-based sibling files (e.g. *.component.brs ↔ *.template.brs)
  for (const siblingPath of findSiblingFiles(normalPath, siblingPatterns)) {
    if (visited.has(normalizePathKey(siblingPath))) continue;
    if (!fsWrapper.existsSync(siblingPath)) continue;
    const text = readCachedFileText(siblingPath);
    if (text !== undefined) {
      defs.push(..._collectAllFunctions(siblingPath, text, importResolver, visited, siblingPatterns, false));
    }
  }

  // 4. For test files: include tested file scope, extends chain, and test siblings
  if (isTestFile(normalPath)) {
    for (const testedPath of resolveTestedFiles(normalPath)) {
      if (visited.has(normalizePathKey(testedPath))) continue;
      if (!fsWrapper.existsSync(testedPath)) continue;
      const text = readCachedFileText(testedPath);
      if (text !== undefined) {
        defs.push(..._collectAllFunctions(testedPath, text, importResolver, visited, siblingPatterns, false));
      }
      defs.push(...collectFunctionsFromExtends(testedPath, importResolver));
    }

    // Include sibling test files (e.g. Foo.test.brs ↔ Foo_Bar.test.brs share scope)
    for (const siblingTest of findTestSiblings(normalPath)) {
      if (visited.has(normalizePathKey(siblingTest))) continue;
      if (!fsWrapper.existsSync(siblingTest)) continue;
      const text = readCachedFileText(siblingTest);
      if (text !== undefined) {
        defs.push(..._collectFunctionsFromImports(siblingTest, text, importResolver, visited, false));
      }
    }
  }

  return deduplicateByLocation(defs);
}

/**
 * Parses all associative-array method assignments — both
 * `<obj>.<name> = function|sub (...)` (including `m.<name> = ...`, the
 * standard SceneGraph event-handler pattern) and `<name>: function|sub (...)`
 * inside an AA literal — from a BrightScript text.
 *
 * Backed by the parser's `analyzeContext()`, whose traversal tracks the real
 * enclosing function via the AST (a `functionStack`), not "the nearest
 * top-level declaration by line number" — the old regex-based version's
 * heuristic for `ownerFunction` was wrong for a method assignment that
 * appears after a function but outside any function, or inside a nested
 * function. `analyzeContext()` also can't match inside a comment or string
 * literal, unlike the two regexes this replaces.
 */
export function parseInnerMethodDefs(text: string, filePath: string): InnerMethodDefinition[] {
  const result = parse(text);
  const ctx = analyzeContext(result.root);
  const defs: InnerMethodDefinition[] = [];

  for (const f of ctx.dotAssignedFunctions) {
    defs.push({
      name: f.fieldName,
      nameLower: f.fieldName.toLowerCase(),
      line: f.line,
      column: f.column,
      filePath,
      ownerFunction: f.enclosingFunction || undefined,
    });
  }
  for (const f of ctx.inlineAAFunctions) {
    defs.push({
      name: f.aaFieldNameOriginal,
      nameLower: f.aaFieldName,
      line: f.line,
      column: f.column,
      filePath,
      ownerFunction: f.enclosingFunction || undefined,
    });
  }

  // Document order, matching the old line-scan's output order.
  defs.sort((a, b) => a.line - b.line || a.column - b.column);
  return defs;
}

/**
 * Collects all associative-array method definitions visible from a given .brs file
 * using the same scope as `collectAllFunctions` (current file + @import chain + XML siblings).
 */
export function collectAllInnerMethods(
  filePath: string,
  fileText: string,
  importResolver: KopytkoImportResolver,
  visited: Set<string> = new Set(),
  siblingPatterns: string[][] = [],
): InnerMethodDefinition[] {
  return _collectAllInnerMethods(filePath, fileText, importResolver, visited, siblingPatterns, true);
}

function _collectAllInnerMethods(
  filePath: string,
  fileText: string,
  importResolver: KopytkoImportResolver,
  visited: Set<string>,
  siblingPatterns: string[][],
  isEntry: boolean,
): InnerMethodDefinition[] {
  const normalPath = nodePath.normalize(filePath);
  const pathKey = normalizePathKey(filePath);
  if (visited.has(pathKey)) return [];
  visited.add(pathKey);

  const defs: InnerMethodDefinition[] = [...ownInnerMethodDefs(filePath, fileText, isEntry)];

  const imports = importResolver.parseImports(fileText);
  for (const imp of imports) {
    const resolved = importResolver.resolveImportPath(imp, normalPath);
    if (resolved && !visited.has(normalizePathKey(resolved)) && fsWrapper.existsSync(resolved)) {
      const importedText = readCachedFileText(resolved);
      if (importedText !== undefined) {
        defs.push(..._collectAllInnerMethods(resolved, importedText, importResolver, visited, siblingPatterns, false));
      }
    }
  }

  const workspaceFolders = importResolver.getWorkspaceFolders();
  const sourceDir = importResolver.getSourceDir();
  const siblings = getXmlSiblingPaths(normalPath, workspaceFolders, sourceDir);
  for (const sibling of siblings) {
    if (visited.has(normalizePathKey(sibling))) continue;
    if (!fsWrapper.existsSync(sibling)) continue;
    const siblingText = readCachedFileText(sibling);
    if (siblingText !== undefined) {
      defs.push(..._collectAllInnerMethods(sibling, siblingText, importResolver, visited, siblingPatterns, false));
    }
  }

  // Collect from pattern-based sibling files
  for (const siblingPath of findSiblingFiles(normalPath, siblingPatterns)) {
    if (visited.has(normalizePathKey(siblingPath))) continue;
    if (!fsWrapper.existsSync(siblingPath)) continue;
    const siblingText = readCachedFileText(siblingPath);
    if (siblingText !== undefined) {
      defs.push(..._collectAllInnerMethods(siblingPath, siblingText, importResolver, visited, siblingPatterns, false));
    }
  }

  // Deduplicate by location (normalize path for case-insensitive FS)
  const seen = new Set<string>();
  return defs.filter(d => {
    const key = `${normalizePathKey(d.filePath)}:${d.line}:${d.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Collects all function definitions from a SceneGraph XML file and its @import
 * chain (recursively following `extends` up the inheritance hierarchy).
 *
 * Used by `collectFunctionsFromExtends` to populate the known-function scope
 * so that functions inherited from a parent component are not flagged as
 * `identifier/undefined-function`.
 */
function _collectFromXmlChain(
  xmlPath: string,
  importResolver: KopytkoImportResolver,
  visitedXmls: Set<string>,
): FunctionDefinition[] {
  if (visitedXmls.has(xmlPath)) return [];
  visitedXmls.add(xmlPath);

  const xmlText = readCachedFileText(xmlPath);
  if (xmlText === undefined) return [];

  const workspaceFolders = importResolver.getWorkspaceFolders();
  const sourceDir = importResolver.getSourceDir();
  const defs: FunctionDefinition[] = [];

  // Collect from all BRS files listed in this XML's <script> tags
  const visitedBrs = new Set<string>();
  for (const brsPath of getScriptPathsFromXml(xmlPath, workspaceFolders, sourceDir)) {
    if (visitedBrs.has(brsPath) || !fsWrapper.existsSync(brsPath)) continue;
    const brsText = readCachedFileText(brsPath);
    if (brsText !== undefined) {
      defs.push(..._collectFunctionsFromImports(brsPath, brsText, importResolver, visitedBrs, false));
    }
  }

  // Walk up the extends chain
  const parentName = parseXmlExtends(xmlText);
  if (parentName) {
    const searchRoots = buildSearchRoots(importResolver, xmlPath);
    const parentXml = findComponentXml(parentName, searchRoots);
    if (parentXml) {
      defs.push(..._collectFromXmlChain(parentXml, importResolver, visitedXmls));
    }
  }

  return defs;
}

/**
 * Returns all function definitions inherited by the given .brs file through
 * SceneGraph component `extends` chains.
 *
 * Steps:
 *   1. Find parent XML files that list `brsPath` via <script> tags.
 *   2. For each such XML, parse its `extends` attribute.
 *   3. Locate the parent component's XML file and recursively collect functions
 *      from its BRS scripts and their @import chains, following further `extends`
 *      up the hierarchy.
 */
export function collectFunctionsFromExtends(
  brsPath: string,
  importResolver: KopytkoImportResolver,
  visitedXmls: Set<string> = new Set(),
): FunctionDefinition[] {
  const workspaceFolders = importResolver.getWorkspaceFolders();
  const sourceDir = importResolver.getSourceDir();
  const searchRoots = buildSearchRoots(importResolver, brsPath);
  const defs: FunctionDefinition[] = [];

  // Find XML files that declare this brs file
  const brsDir = nodePath.dirname(brsPath);
  let xmlCandidates: string[] = [];
  try {
    xmlCandidates = fsWrapper.readdirSync(brsDir)
      .filter((f) => f.endsWith('.xml'))
      .map((f) => nodePath.join(brsDir, f));
  } catch { /* ignore */ }

  const brsBasename = nodePath.basename(brsPath);
  const normalizedBrsPath = nodePath.normalize(brsPath).toLowerCase();
  for (const xmlPath of xmlCandidates) {
    if (visitedXmls.has(xmlPath)) continue;
    const xmlText = readCachedFileText(xmlPath);
    if (xmlText === undefined) continue;
    if (!xmlText.includes(brsBasename)) continue;

    // Check this xml lists brsPath (case-insensitive for Windows path comparison)
    const listed = getScriptPathsFromXml(xmlPath, workspaceFolders, sourceDir);
    const isListed = listed.some((p) => nodePath.normalize(p).toLowerCase() === normalizedBrsPath);
    if (!isListed) continue;

    const parentName = parseXmlExtends(xmlText);
    if (!parentName) continue;

    const parentXml = findComponentXml(parentName, searchRoots);
    if (!parentXml) continue;

    defs.push(..._collectFromXmlChain(parentXml, importResolver, visitedXmls));
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Test file → tested file resolution
// ---------------------------------------------------------------------------

/**
 * Known Kopytko component suffixes used to resolve tested files when the test
 * filename exactly matches the source base name (e.g. `Foo.test.brs` →
 * `Foo.component.brs`). This list does NOT gate the PascalCase-split path —
 * any suffix works there (see `splitAtUpperCaseBoundaries`).
 */
const COMPONENT_SUFFIXES = ['', '.component', '.view', '.template', '.facade', '.service'];

/**
 * Splits a PascalCase name at every uppercase-letter boundary and returns all
 * `{base, dotSuffix}` pairs — one per possible split point.
 *
 * This implements the general convention that any source file named
 * `Something.<anything>.brs` has its test named `Something<Anything>.test.brs`:
 *
 *   `SomePageView`          → `{ base: 'SomePage',    dotSuffix: '.view' }`
 *   `SomeServiceService`    → `{ base: 'SomeService', dotSuffix: '.service' }`
 *   `FooCustomWidget`       → `{ base: 'FooCustom',   dotSuffix: '.widget' }`
 *                             `{ base: 'Foo',          dotSuffix: '.customwidget' }`
 *
 * All candidates are returned; callers filter by `existsSync`.
 */
function splitAtUpperCaseBoundaries(name: string): { base: string; dotSuffix: string }[] {
  const results: { base: string; dotSuffix: string }[] = [];
  for (let i = 1; i < name.length; i++) {
    if (name[i] >= 'A' && name[i] <= 'Z') {
      results.push({
        base: name.slice(0, i),
        dotSuffix: '.' + name.slice(i).toLowerCase(),
      });
    }
  }
  return results;
}

/**
 * Resolves which source files a test file is testing.
 *
 * Handles both flat and nested `_tests` layouts:
 *   - `_tests/Foo.test.brs`                         → `../Foo.brs`, `../Foo.component.brs`, …
 *   - `_tests/Foo/Foo_Bar.test.brs`                 → `../Foo.brs`, `../Foo.component.brs`, …
 *   - `_tests/RailsService/RailsService_fetch.test.brs` → looks in the directory *above* `_tests/`
 *
 * Also handles the PascalCase-concatenated suffix convention:
 *   - `_tests/SomePageView.test.brs`                → `../SomePage.view.brs`
 *   - `_tests/SomeServiceService.test.brs`          → `../SomeService.service.brs`
 *   - `_tests/SomeServiceService_fetch.test.brs`    → `../SomeService.service.brs`
 *
 * Returns all matching paths that exist on disk.
 */
export function resolveTestedFiles(testFilePath: string): string[] {
  const normalized = testFilePath.replace(/\\/g, '/');
  const testsIdx = normalized.lastIndexOf('/_tests/');
  // Use the directory that *contains* _tests/ as the source root
  const parentDir = testsIdx >= 0
    ? normalized.substring(0, testsIdx)
    : nodePath.dirname(nodePath.dirname(testFilePath));
  const basename = nodePath.basename(testFilePath, '.test.brs');

  const candidates: string[] = [];

  const addCandidates = (name: string): void => {
    // Same-base-name variants: Name.brs, Name.component.brs, Name.view.brs, …
    for (const suffix of COMPONENT_SUFFIXES) {
      candidates.push(nodePath.join(parentDir, `${name}${suffix}.brs`));
    }
    // General PascalCase-suffix split: SomePageView → SomePage.view.brs,
    // SomeFooBar → SomeFoo.bar.brs, SomeFooBar → Some.foobar.brs, …
    for (const { base, dotSuffix } of splitAtUpperCaseBoundaries(name)) {
      candidates.push(nodePath.join(parentDir, `${base}${dotSuffix}.brs`));
    }
  };

  // Try the full basename first (covers both exact matches and suffix-concatenated names)
  addCandidates(basename);

  // For split suites (Foo_Bar.test.brs → Foo.brs, SomePageView_fetch.test.brs → SomePage.view.brs)
  const underscoreIdx = basename.indexOf('_');
  if (underscoreIdx > 0) {
    addCandidates(basename.substring(0, underscoreIdx));
  }

  return candidates.filter(p => fsWrapper.existsSync(p));
}

/**
 * Finds sibling test files that share the same base name.
 *
 * `Foo.test.brs` ↔ `Foo_Bar.test.brs` ↔ `Foo_Baz.test.brs` all share scope.
 * Returns paths of sibling test files (excluding the input file itself).
 */
export function findTestSiblings(testFilePath: string): string[] {
  const dir = nodePath.dirname(testFilePath);
  const baseName = getTestBaseName(testFilePath);
  if (!baseName) return [];

  const normalizedSelf = normalizePathKey(testFilePath);
  const siblings: string[] = [];

  try {
    for (const entry of fsWrapper.readdirSync(dir)) {
      if (!entry.toLowerCase().endsWith('.test.brs')) continue;
      const entryBase = getTestBaseName(entry);
      if (entryBase.toLowerCase() !== baseName.toLowerCase()) continue;
      const fullPath = nodePath.join(dir, entry);
      if (normalizePathKey(fullPath) !== normalizedSelf) {
        siblings.push(fullPath);
      }
    }
  } catch { /* skip */ }

  return siblings;
}

import * as nodePath from 'path';
import fsWrapper from '../utils/fsWrapper';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { getScriptPathsFromXml, getXmlSiblingPaths, findComponentXml, parseXmlExtends } from './xmlScriptParser';
import { findSiblingFiles } from './patternSiblings';
import { buildSearchRoots } from '../utils/workspaceUtils';
import { isTestFile, getTestBaseName } from '../kopytko/testFramework';

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

const FUNC_PREFIX_RE = /^\s*(?:function|sub)\s+/i;
const FUNC_FULL_RE = /^\s*(?:function|sub)\s+(\w+)\s*\(/i;
const INNER_METHOD_RE = /^\s*\w+\.(\w+)\s*=\s*(?:function|sub)\s*\(/i;
const INNER_COLON_METHOD_RE = /^\s*(\w+)\s*:\s*(?:function|sub)\s*\(/i;

/** Removes duplicate definitions that share the same file, line, and column. */
function deduplicateByLocation<T extends { filePath: string; line: number; column: number }>(defs: T[]): T[] {
  const seen = new Set<string>();
  return defs.filter(d => {
    const key = `${d.filePath}:${d.line}:${d.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parses all top-level function/sub definitions from a BrightScript text.
 * Accepts optional pre-split lines to avoid redundant splitting.
 */
export function parseFunctionDefs(text: string, filePath: string, preLines?: string[]): FunctionDefinition[] {
  const lines = preLines ?? text.split(/\r?\n/);
  const defs: FunctionDefinition[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = FUNC_FULL_RE.exec(lines[i]);
    if (!match) continue;
    const prefixMatch = FUNC_PREFIX_RE.exec(lines[i]);
    const column = prefixMatch ? prefixMatch[0].length : 0;
    defs.push({
      name: match[1],
      nameLower: match[1].toLowerCase(),
      line: i,
      column,
      filePath,
      signature: lines[i].trim(),
    });
  }
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
  const normalPath = nodePath.normalize(filePath);
  if (visited.has(normalPath)) return [];
  visited.add(normalPath);

  const defs: FunctionDefinition[] = [...parseFunctionDefs(fileText, normalPath)];

  const imports = importResolver.parseImports(fileText);
  for (const imp of imports) {
    const resolved = importResolver.resolveImportPath(imp, normalPath);
    if (resolved && !visited.has(nodePath.normalize(resolved)) && fsWrapper.existsSync(resolved)) {
      try {
        const text = fsWrapper.readFileSync(resolved, 'utf-8');
        defs.push(...collectFunctionsFromImports(resolved, text, importResolver, visited));
      } catch { /* skip unreadable files */ }
    }
  }

  return defs;
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
): FunctionDefinition[] {
  const normalPath = nodePath.normalize(filePath);
  if (visited.has(normalPath)) return [];
  visited.add(normalPath);

  const defs: FunctionDefinition[] = [...parseFunctionDefs(fileText, normalPath)];

  // 1. Collect from @import annotations
  const imports = importResolver.parseImports(fileText);
  for (const imp of imports) {
    const resolved = importResolver.resolveImportPath(imp, normalPath);
    if (resolved && !visited.has(nodePath.normalize(resolved)) && fsWrapper.existsSync(resolved)) {
      try {
        const text = fsWrapper.readFileSync(resolved, 'utf-8');
        defs.push(...collectAllFunctions(resolved, text, importResolver, visited, siblingPatterns));
      } catch { /* skip unreadable files */ }
    }
  }

  // 2. Collect from XML sibling BrightScript files
  const workspaceFolders = importResolver.getWorkspaceFolders();
  const sourceDir = importResolver.getSourceDir();
  const siblings = getXmlSiblingPaths(normalPath, workspaceFolders, sourceDir);
  for (const sibling of siblings) {
    if (visited.has(nodePath.normalize(sibling))) continue;
    if (!fsWrapper.existsSync(sibling)) continue;
    try {
      const text = fsWrapper.readFileSync(sibling, 'utf-8');
      defs.push(...collectAllFunctions(sibling, text, importResolver, visited, siblingPatterns));
    } catch { /* skip unreadable files */ }
  }

  // 3. Collect from pattern-based sibling files (e.g. *.component.brs ↔ *.template.brs)
  for (const siblingPath of findSiblingFiles(normalPath, siblingPatterns)) {
    if (visited.has(nodePath.normalize(siblingPath))) continue;
    if (!fsWrapper.existsSync(siblingPath)) continue;
    try {
      const text = fsWrapper.readFileSync(siblingPath, 'utf-8');
      defs.push(...collectAllFunctions(siblingPath, text, importResolver, visited, siblingPatterns));
    } catch { /* skip unreadable files */ }
  }

  // 4. For test files: include tested file scope, extends chain, and test siblings
  if (isTestFile(normalPath)) {
    for (const testedPath of resolveTestedFiles(normalPath)) {
      if (visited.has(nodePath.normalize(testedPath))) continue;
      if (!fsWrapper.existsSync(testedPath)) continue;
      try {
        const text = fsWrapper.readFileSync(testedPath, 'utf-8');
        defs.push(...collectAllFunctions(testedPath, text, importResolver, visited, siblingPatterns));
      } catch { /* skip unreadable files */ }
      defs.push(...collectFunctionsFromExtends(testedPath, importResolver));
    }

    // Include sibling test files (e.g. Foo.test.brs ↔ Foo_Bar.test.brs share scope)
    for (const siblingTest of findTestSiblings(normalPath)) {
      if (visited.has(nodePath.normalize(siblingTest))) continue;
      if (!fsWrapper.existsSync(siblingTest)) continue;
      try {
        const text = fsWrapper.readFileSync(siblingTest, 'utf-8');
        defs.push(...collectFunctionsFromImports(siblingTest, text, importResolver, visited));
      } catch { /* skip */ }
    }
  }

  return deduplicateByLocation(defs);
}

/**
 * Parses all associative-array method assignments of the form
 * `<obj>.<name> = function|sub (...)` from a BrightScript text.
 */
export function parseInnerMethodDefs(text: string, filePath: string): InnerMethodDefinition[] {
  const lines = text.split(/\r?\n/);
  const funcDefs = parseFunctionDefs(text, filePath, lines);
  const defs: InnerMethodDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*'/.test(line)) continue;

    let name: string, column: number;

    const dotMatch = INNER_METHOD_RE.exec(line);
    if (dotMatch) {
      name = dotMatch[1];
      const dotIdx = line.indexOf('.');
      column = line.indexOf(name, dotIdx >= 0 ? dotIdx : 0);
    } else {
      const colonMatch = INNER_COLON_METHOD_RE.exec(line);
      if (!colonMatch) continue;
      name = colonMatch[1];
      column = line.search(/\S/);
    }

    // Owner = last top-level function whose declaration line is <= i
    let ownerFunction: string | undefined;
    for (let j = funcDefs.length - 1; j >= 0; j--) {
      if (funcDefs[j].line <= i) { ownerFunction = funcDefs[j].name; break; }
    }

    defs.push({ name, nameLower: name.toLowerCase(), line: i, column, filePath, ownerFunction });
  }
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
  const normalPath = nodePath.normalize(filePath);
  if (visited.has(normalPath)) return [];
  visited.add(normalPath);

  const defs: InnerMethodDefinition[] = [...parseInnerMethodDefs(fileText, normalPath)];

  const imports = importResolver.parseImports(fileText);
  for (const imp of imports) {
    const resolved = importResolver.resolveImportPath(imp, normalPath);
    if (resolved && !visited.has(nodePath.normalize(resolved)) && fsWrapper.existsSync(resolved)) {
      try {
        const importedText = fsWrapper.readFileSync(resolved, 'utf-8');
        defs.push(...collectAllInnerMethods(resolved, importedText, importResolver, visited, siblingPatterns));
      } catch { /* skip unreadable files */ }
    }
  }

  const workspaceFolders = importResolver.getWorkspaceFolders();
  const sourceDir = importResolver.getSourceDir();
  const siblings = getXmlSiblingPaths(normalPath, workspaceFolders, sourceDir);
  for (const sibling of siblings) {
    if (visited.has(nodePath.normalize(sibling))) continue;
    if (!fsWrapper.existsSync(sibling)) continue;
    try {
      const siblingText = fsWrapper.readFileSync(sibling, 'utf-8');
      defs.push(...collectAllInnerMethods(sibling, siblingText, importResolver, visited, siblingPatterns));
    } catch { /* skip unreadable files */ }
  }

  // Collect from pattern-based sibling files
  for (const siblingPath of findSiblingFiles(normalPath, siblingPatterns)) {
    if (visited.has(nodePath.normalize(siblingPath))) continue;
    if (!fsWrapper.existsSync(siblingPath)) continue;
    try {
      const siblingText = fsWrapper.readFileSync(siblingPath, 'utf-8');
      defs.push(...collectAllInnerMethods(siblingPath, siblingText, importResolver, visited, siblingPatterns));
    } catch { /* skip unreadable files */ }
  }

  // Deduplicate by location
  const seen = new Set<string>();
  return defs.filter(d => {
    const key = `${d.filePath}:${d.line}:${d.column}`;
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

  let xmlText: string;
  try {
    xmlText = fsWrapper.readFileSync(xmlPath, 'utf-8');
  } catch {
    return [];
  }

  const workspaceFolders = importResolver.getWorkspaceFolders();
  const sourceDir = importResolver.getSourceDir();
  const defs: FunctionDefinition[] = [];

  // Collect from all BRS files listed in this XML's <script> tags
  const visitedBrs = new Set<string>();
  for (const brsPath of getScriptPathsFromXml(xmlPath, workspaceFolders, sourceDir)) {
    if (visitedBrs.has(brsPath) || !fsWrapper.existsSync(brsPath)) continue;
    try {
      const brsText = fsWrapper.readFileSync(brsPath, 'utf-8');
      defs.push(...collectFunctionsFromImports(brsPath, brsText, importResolver, visitedBrs));
    } catch { /* skip */ }
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
    let xmlText: string;
    try {
      xmlText = fsWrapper.readFileSync(xmlPath, 'utf-8');
    } catch {
      continue;
    }
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

  const normalizedSelf = nodePath.normalize(testFilePath);
  const siblings: string[] = [];

  try {
    for (const entry of fsWrapper.readdirSync(dir)) {
      if (!entry.toLowerCase().endsWith('.test.brs')) continue;
      const entryBase = getTestBaseName(entry);
      if (entryBase.toLowerCase() !== baseName.toLowerCase()) continue;
      const fullPath = nodePath.join(dir, entry);
      if (nodePath.normalize(fullPath) !== normalizedSelf) {
        siblings.push(fullPath);
      }
    }
  } catch { /* skip */ }

  return siblings;
}

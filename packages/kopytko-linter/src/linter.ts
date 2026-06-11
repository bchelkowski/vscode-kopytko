import * as nodePath from 'path';
import type { LintDiagnostic, LintResult, RuleContext, KopytkoImport } from './types';
import type { LintContext } from './context';
import type { LinterConfig } from './config';
import { resolveConfig } from './config';
import { ALL_RULE_GROUPS } from './rules/index';
import { parseImports, ImportResolver } from './analysis/importParser';
import { parseFunctionDefs } from './analysis/functionIndex';
import { findSiblingFiles } from './analysis/patternSiblings';
import { findTestSiblings, isTestFile, resolveTestedFiles } from './analysis/testUtils';
import { TEST_FRAMEWORK_GLOBALS } from './catalog/testGlobals';
import fsWrapper from './analysis/fsWrapper';

/**
 * Lints a single file with a pre-built context.
 * Used by the extension (library mode) and internally by lintProject.
 */
export function lintFile(
  filePath: string,
  content: string,
  context: LintContext,
  config: LinterConfig,
): LintDiagnostic[] {
  const lines = content.split(/\r?\n/);
  const imports = context.parseImports(content);

  const ruleContext: RuleContext = {
    filePath,
    lines,
    imports,
    config: config.rules,
    lintContext: context,
  };

  const diagnostics: LintDiagnostic[] = [];

  for (const ruleGroup of ALL_RULE_GROUPS) {
    try {
      diagnostics.push(...ruleGroup.fn(ruleContext));
    } catch {
      // Never let a rule crash the entire lint run
    }
  }

  return diagnostics;
}

/**
 * Lints all .brs files in a project directory.
 * Used by the CLI (standalone mode).
 */
export function lintProject(
  projectRoot: string,
  configOverride?: Partial<LinterConfig>,
): LintResult {
  const config = {
    ...resolveConfig(projectRoot),
    ...configOverride,
  };

  const { context, brsFiles, fileContentsCache } = buildProjectContext(projectRoot, config);

  const allDiagnostics: LintDiagnostic[] = [];

  for (const file of brsFiles) {
    const content = fileContentsCache.get(nodePath.normalize(file));
    if (!content) continue;

    const fileContext = createFileContext(context, file);
    const diagnostics = lintFile(file, content, fileContext, config);
    allDiagnostics.push(...diagnostics);
  }

  return {
    diagnostics: allDiagnostics,
    fileCount: brsFiles.length,
    errorCount: allDiagnostics.filter(d => d.severity === 'error').length,
    warningCount: allDiagnostics.filter(d => d.severity === 'warning').length,
    infoCount: allDiagnostics.filter(d => d.severity === 'info').length,
    hintCount: allDiagnostics.filter(d => d.severity === 'hint').length,
  };
}

interface ProjectContextResult {
  context: LintContext;
  brsFiles: string[];
  fileContentsCache: Map<string, string>;
}

function buildProjectContext(projectRoot: string, config: LinterConfig): ProjectContextResult {
  const importResolver = new ImportResolver({
    workspaceFolders: [projectRoot],
    sourceDir: config.sourceDir,
    resolveModules: config.resolveModules,
  });

  // Build a project-wide function index — single pass over all files
  const brsFiles = collectBrsFiles(projectRoot, config.sourceDir);
  const allFunctions = new Map<string, Set<string>>();
  const fileFunctions = new Map<string, string[]>();
  const fileImports = new Map<string, KopytkoImport[]>();
  const fileContentsCache = new Map<string, string>();

  for (const file of brsFiles) {
    try {
      const text = fsWrapper.readFileSync(file, 'utf-8');
      const normalized = nodePath.normalize(file);
      fileContentsCache.set(normalized, text);
      fileFunctions.set(normalized, parseFunctionDefs(text, file).map(f => f.nameLower));
      fileImports.set(normalized, parseImports(text));
    } catch { /* skip */ }
  }

  // Helper: read a file, using cache when available
  const readFileCached = (filePath: string): string | null => {
    const normalized = nodePath.normalize(filePath);
    const cached = fileContentsCache.get(normalized);
    if (cached !== undefined) return cached;
    try {
      const text = fsWrapper.readFileSync(filePath, 'utf-8');
      fileContentsCache.set(normalized, text);
      return text;
    } catch {
      return null;
    }
  };

  // Helper: get parsed functions for a file, using cache
  const getFunctions = (filePath: string): string[] => {
    const normalized = nodePath.normalize(filePath);
    const cached = fileFunctions.get(normalized);
    if (cached) return cached;
    const text = readFileCached(filePath);
    if (!text) return [];
    const fns = parseFunctionDefs(text, filePath).map(f => f.nameLower);
    fileFunctions.set(normalized, fns);
    return fns;
  };

  // Helper: get parsed imports for a file, using cache
  const getImports = (filePath: string): KopytkoImport[] => {
    const normalized = nodePath.normalize(filePath);
    const cached = fileImports.get(normalized);
    if (cached) return cached;
    const text = readFileCached(filePath);
    if (!text) return [];
    const imports = parseImports(text);
    fileImports.set(normalized, imports);
    return imports;
  };

  // For each file, compute its known function names from imports + siblings + self
  for (const file of brsFiles) {
    const normalizedFile = nodePath.normalize(file);
    const known = new Set<string>();
    for (const fn of (fileFunctions.get(normalizedFile) ?? [])) known.add(fn);

    // Add test framework globals for test files
    if (isTestFile(file)) {
      for (const fn of TEST_FRAMEWORK_GLOBALS) known.add(fn);
    }

    // Collect functions from imports (transitively)
    const visited = new Set<string>();
    const collectFromImports = (sourceFile: string, imps: KopytkoImport[]): void => {
      for (const imp of imps) {
        if (imp.isMock) continue;
        const resolved = importResolver.resolveImportPath(imp, sourceFile);
        if (!resolved) continue;
        const normalizedResolved = nodePath.normalize(resolved);
        if (visited.has(normalizedResolved)) continue;
        visited.add(normalizedResolved);

        for (const fn of getFunctions(resolved)) known.add(fn);
        collectFromImports(resolved, getImports(resolved));
      }
    };
    collectFromImports(file, getImports(file));

    // Add sibling functions (and their imports)
    for (const siblingPath of findSiblingFiles(file, config.siblingPatterns)) {
      const normalizedSibling = nodePath.normalize(siblingPath);
      if (!visited.has(normalizedSibling)) {
        visited.add(normalizedSibling);
        for (const fn of getFunctions(siblingPath)) known.add(fn);
        collectFromImports(siblingPath, getImports(siblingPath));
      }
    }

    // For test files, add tested file functions and test siblings
    if (isTestFile(file)) {
      for (const testedPath of resolveTestedFiles(file)) {
        const normalizedTested = nodePath.normalize(testedPath);
        if (!visited.has(normalizedTested)) {
          visited.add(normalizedTested);
          for (const fn of getFunctions(testedPath)) known.add(fn);
          collectFromImports(testedPath, getImports(testedPath));
        }
      }
      for (const siblingTest of findTestSiblings(file)) {
        const normalizedSibTest = nodePath.normalize(siblingTest);
        if (!visited.has(normalizedSibTest)) {
          visited.add(normalizedSibTest);
          for (const fn of getFunctions(siblingTest)) known.add(fn);
          collectFromImports(siblingTest, getImports(siblingTest));
        }
      }
    }

    allFunctions.set(normalizedFile, known);
  }

  const context: LintContext = {
    get knownFuncNames() { return new Set<string>(); },

    parseImports(text: string): KopytkoImport[] {
      return parseImports(text);
    },

    resolveImportPath(importPath: string, documentPath: string, fromModule?: string): string | null {
      const imp: KopytkoImport = { raw: '', importPath, fromModule, line: 0 };
      return importResolver.resolveImportPath(imp, documentPath) ?? null;
    },

    importExists(importPath: string, documentPath: string, fromModule?: string): boolean {
      return this.resolveImportPath(importPath, documentPath, fromModule) !== null;
    },

    readFile(filePath: string): string | null {
      return readFileCached(filePath);
    },

    parseFunctionsFromFile(filePath: string): string[] {
      return getFunctions(filePath);
    },

    getSiblingFiles(filePath: string): string[] {
      return findSiblingFiles(filePath, config.siblingPatterns);
    },

    getTestSiblings(filePath: string): string[] {
      return findTestSiblings(filePath);
    },

    isTestFile(filePath: string): boolean {
      return isTestFile(filePath);
    },

    generatedPaths: config.generatedPaths,
    generatedModules: config.generatedModules,
    siblingPatterns: config.siblingPatterns,
  };

  return {
    context: Object.assign(context, { _allFunctions: allFunctions }) as LintContext,
    brsFiles,
    fileContentsCache,
  };
}

/**
 * Overrides the context's knownFuncNames for a specific file.
 * Called from lintFile to provide per-file known names.
 */
export function createFileContext(baseContext: LintContext, filePath: string): LintContext {
  const contextWithFunctions = baseContext as LintContext & { _allFunctions?: Map<string, Set<string>> };
  const fileKnown = contextWithFunctions._allFunctions?.get(nodePath.normalize(filePath)) ?? new Set<string>();

  return {
    ...baseContext,
    knownFuncNames: fileKnown,
  };
}

function collectBrsFiles(dir: string, sourceDir: string): string[] {
  const sourceRoot = nodePath.join(dir, sourceDir);
  const files: string[] = [];

  function walk(currentDir: string): void {
    let entries;
    try {
      entries = fsWrapper.readdirTyped(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = nodePath.join(currentDir, entry.name);
      if (entry.isDirectory) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(fullPath);
      } else if (entry.name.endsWith('.brs')) {
        files.push(fullPath);
      }
    }
  }

  if (fsWrapper.existsSync(sourceRoot)) {
    walk(sourceRoot);
  } else {
    walk(dir);
  }

  return files;
}

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

  const context = buildProjectContext(projectRoot, config);
  const brsFiles = collectBrsFiles(projectRoot, config.sourceDir);

  const allDiagnostics: LintDiagnostic[] = [];

  for (const file of brsFiles) {
    try {
      const content = fsWrapper.readFileSync(file, 'utf-8');
      const fileContext = createFileContext(context, file);
      const diagnostics = lintFile(file, content, fileContext, config);
      allDiagnostics.push(...diagnostics);
    } catch {
      // skip unreadable files
    }
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

function buildProjectContext(projectRoot: string, config: LinterConfig): LintContext {
  const importResolver = new ImportResolver({
    workspaceFolders: [projectRoot],
    sourceDir: config.sourceDir,
    resolveModules: config.resolveModules,
  });

  // Build a project-wide function index
  const brsFiles = collectBrsFiles(projectRoot, config.sourceDir);
  const allFunctions = new Map<string, Set<string>>();
  const fileFunctions = new Map<string, string[]>();

  for (const file of brsFiles) {
    try {
      const text = fsWrapper.readFileSync(file, 'utf-8');
      const fns = parseFunctionDefs(text, file);
      fileFunctions.set(file, fns.map(f => f.nameLower));
    } catch { /* skip */ }
  }

  // For each file, compute its known function names from imports + siblings + self
  for (const file of brsFiles) {
    const known = new Set<string>();
    const selfFns = fileFunctions.get(file) ?? [];
    for (const fn of selfFns) known.add(fn);

    try {
      const text = fsWrapper.readFileSync(file, 'utf-8');
      const imports = parseImports(text);

      for (const imp of imports) {
        if (imp.isMock) continue;
        const resolved = importResolver.resolveImportPath(imp, file);
        if (resolved) {
          const importedFns = fileFunctions.get(resolved);
          if (importedFns) {
            for (const fn of importedFns) known.add(fn);
          } else {
            // File not in our scan (external package) — read and parse
            try {
              const impText = fsWrapper.readFileSync(resolved, 'utf-8');
              for (const fn of parseFunctionDefs(impText, resolved)) known.add(fn.nameLower);
            } catch { /* skip */ }
          }
        }
      }

      // Add sibling functions
      for (const siblingPath of findSiblingFiles(file, config.siblingPatterns)) {
        const siblingFns = fileFunctions.get(siblingPath);
        if (siblingFns) {
          for (const fn of siblingFns) known.add(fn);
        }
      }

      // For test files, add tested file functions and test siblings
      if (isTestFile(file)) {
        for (const testedPath of resolveTestedFiles(file)) {
          const testedFns = fileFunctions.get(testedPath);
          if (testedFns) {
            for (const fn of testedFns) known.add(fn);
          }
        }
        for (const siblingTest of findTestSiblings(file)) {
          const siblingFns = fileFunctions.get(siblingTest);
          if (siblingFns) {
            for (const fn of siblingFns) known.add(fn);
          }
        }
      }
    } catch { /* skip */ }

    allFunctions.set(file, known);
  }

  return {
    get knownFuncNames() { return new Set<string>(); },

    parseImports(text: string): KopytkoImport[] {
      return parseImports(text);
    },

    resolveImportPath(importPath: string, fromModule?: string): string | null {
      const imp: KopytkoImport = { raw: '', importPath, fromModule, line: 0 };
      return importResolver.resolveImportPath(imp, projectRoot) ?? null;
    },

    importExists(importPath: string, fromModule?: string): boolean {
      return this.resolveImportPath(importPath, fromModule) !== null;
    },

    readFile(filePath: string): string | null {
      try {
        return fsWrapper.readFileSync(filePath, 'utf-8');
      } catch {
        return null;
      }
    },

    parseFunctionsFromFile(filePath: string): string[] {
      const fns = fileFunctions.get(filePath);
      if (fns) return fns;
      try {
        const text = fsWrapper.readFileSync(filePath, 'utf-8');
        return parseFunctionDefs(text, filePath).map(f => f.nameLower);
      } catch {
        return [];
      }
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

    _allFunctions: allFunctions,
  } as LintContext & { _allFunctions: Map<string, Set<string>> };
}

/**
 * Overrides the context's knownFuncNames for a specific file.
 * Called from lintFile to provide per-file known names.
 */
export function createFileContext(baseContext: LintContext, filePath: string): LintContext {
  const contextWithFunctions = baseContext as LintContext & { _allFunctions?: Map<string, Set<string>> };
  const fileKnown = contextWithFunctions._allFunctions?.get(filePath) ?? new Set<string>();

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

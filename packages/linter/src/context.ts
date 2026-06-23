import type { GeneratedModuleConfig, KopytkoImport } from './types';

/**
 * Abstraction over cross-file project data.
 *
 * - **CLI mode**: built by ProjectContextBuilder from disk scanning
 * - **Extension mode**: built from LSP caches (documentCache, importResolver, workspaceFunctionIndex)
 */
export interface LintContext {
  knownFuncNames: Set<string>;
  /** Workspace-wide union of all function names that appear as call targets in any .brs file.
   * Undefined in CLI mode — rules must degrade gracefully when this is absent. */
  calledWorkwideFuncNames?: Set<string>;
  /** Functions inherited via the component `extends` chain that may be overridden without error.
   * Undefined in CLI mode or for files without a companion XML — rules skip the override exemption. */
  ancestorFuncNames?: Set<string>;
  /**
   * Returns the set of valid lowercased `m.top` field names for a component `.brs` file,
   * including all ancestor component and Roku SG node fields.
   * Returns `null` when the file has no companion XML or in CLI mode.
   * Undefined in CLI mode — the `mtop/undefined-field` rule is skipped entirely.
   */
  getMtopFields?: (filePath: string) => Set<string> | null;

  parseImports(text: string): KopytkoImport[];
  resolveImportPath(importPath: string, documentPath: string, fromModule?: string): string | null;
  importExists(importPath: string, documentPath: string, fromModule?: string): boolean;
  readFile(filePath: string): string | null;
  parseFunctionsFromFile(filePath: string): string[];
  getSiblingFiles(filePath: string): string[];
  getTestSiblings(filePath: string): string[];
  isTestFile(filePath: string): boolean;

  generatedPaths: string[];
  generatedModules: GeneratedModuleConfig[];
  siblingPatterns: string[][];
}

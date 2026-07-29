import type { GeneratedModuleConfig, KopytkoImport } from './types';
import type { ComponentDeclaration } from './analysis/duplicateComponents';

/**
 * Abstraction over cross-file project data.
 *
 * - **CLI mode**: built by ProjectContextBuilder from disk scanning
 * - **Extension mode**: built from LSP caches (documentCache, importResolver, workspaceFunctionIndex)
 */
export interface LintContext {
  knownFuncNames: Set<string>;
  /**
   * Every `<component name>` declaration in the project and its Kopytko packages.
   * Set in CLI mode only — the extension runs the same check against its own live
   * component index, so `runLint`'s project pass skips it when this is absent.
   */
  componentDeclarations?: ComponentDeclaration[];
  /** Workspace-wide union of all function names that appear as call targets in any .brs file.
   * Undefined in CLI mode — rules must degrade gracefully when this is absent. */
  calledWorkwideFuncNames?: Set<string>;
  /** Functions inherited via the component `extends` chain that may be overridden without error.
   * Undefined in CLI mode or for files without a companion XML — rules skip the override exemption. */
  ancestorFuncNames?: Set<string>;
  /**
   * Function names reachable from EXTERNAL sources only (imports, sibling files, /source/).
   * Does NOT include the current file's own function names, unlike `knownFuncNames`.
   * When set (extension mode), `identifier/duplicate-function` uses this for cross-scope collision
   * detection to avoid false positives on the file's own declarations.
   * When absent (tests, CLI), the rule falls back to `knownFuncNames`.
   */
  externalFuncNames?: Set<string>;
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

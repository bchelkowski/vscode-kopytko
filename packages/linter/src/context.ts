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
   * In CLI mode, populated by `collectCalledWorkwideFuncNames` (analysis/calledFunctionNames.ts)
   * when `identifier/unused-function` is enabled — a deliberate mirror of the extension's
   * WorkspaceCallIndex extraction (direct calls, observeField/observeFieldScoped/callFunc string
   * dispatch, the Kopytko events-AA pattern, and XML interface functions; see that file's doc
   * comment). Undefined when the rule is off (CLI) or before the extension's WorkspaceCallIndex
   * has built (extension) — rules must degrade gracefully. */
  calledWorkwideFuncNames?: Set<string>;
  /**
   * Functions inherited via the component `extends` chain that may be overridden without error.
   * Populated in both CLI mode (`projectIndexer.ts`'s `buildKnownFunctions`) and extension mode
   * (`diagnosticsProvider.ts`, gated on `identifier/duplicate-function` being active). Undefined
   * for a file with no companion XML, or no ancestor functions to report — rules must skip the
   * override exemption gracefully when absent, not assume one mode always has it.
   */
  ancestorFuncNames?: Set<string>;
  /**
   * Function names reachable from EXTERNAL sources only (imports, sibling files, /source/).
   * Does NOT include the current file's own function names, unlike `knownFuncNames`.
   * Populated in both CLI mode and extension mode; `identifier/duplicate-function` uses it for
   * cross-scope collision detection to avoid false positives on the file's own declarations.
   * When absent (e.g. tests, or a mock context), the rule falls back to `knownFuncNames`.
   */
  externalFuncNames?: Set<string>;
  /**
   * Returns the set of valid lowercased `m.top` field names for a component `.brs` file,
   * including all ancestor component and Roku SG node fields.
   * Returns `null` when the file has no companion XML. Populated in both CLI mode
   * (`projectIndexer.ts`) and extension mode (`diagnosticsProvider.ts`) — undefined only for a
   * mock/test context that doesn't provide it, in which case `mtop/undefined-field` is skipped.
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

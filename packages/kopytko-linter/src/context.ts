import type { GeneratedModuleConfig, KopytkoImport } from './types';

/**
 * Abstraction over cross-file project data.
 *
 * - **CLI mode**: built by ProjectContextBuilder from disk scanning
 * - **Extension mode**: built from LSP caches (documentCache, importResolver, workspaceFunctionIndex)
 */
export interface LintContext {
  knownFuncNames: Set<string>;

  parseImports(text: string): KopytkoImport[];
  resolveImportPath(importPath: string, fromModule?: string): string | null;
  importExists(importPath: string, fromModule?: string): boolean;
  readFile(filePath: string): string | null;
  parseFunctionsFromFile(filePath: string): string[];
  getSiblingFiles(filePath: string): string[];
  getTestSiblings(filePath: string): string[];
  isTestFile(filePath: string): boolean;

  generatedPaths: string[];
  generatedModules: GeneratedModuleConfig[];
  siblingPatterns: string[][];
}

import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { matchesGlob } from 'kopytko-brightscript-parser';
import { getDocumentPath } from '../utils/textUtils';
import { getCachedLines, getCachedImports, getCachedKnownFuncNames } from '../utils/documentCache';
import { isTestFile } from '../kopytko/testFramework';
import fsWrapper from '../utils/fsWrapper';
import { parseFunctionDefs as extParseFunctionDefs } from '../brightscript/functionIndex';
import { findSiblingFiles } from '../brightscript/patternSiblings';
import { findTestSiblings } from '../brightscript/functionIndex';
import {
  lintFile,
  parseImports,
  DEFAULT_LINTER_CONFIG,
  type LintContext,
  type LintDiagnostic,
  type LintSeverity,
  type LinterConfig,
  type KopytkoImport,
} from 'kopytko-linter';

export interface GeneratedModuleConfig {
  path: string;
  functions: string[];
}

const SEVERITY_MAP: Record<LintSeverity, typeof DiagnosticSeverity[keyof typeof DiagnosticSeverity]> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

/**
 * Thin LSP adapter wrapping the standalone kopytko-linter engine.
 * Builds a LintContext from extension caches and maps results to LSP Diagnostics.
 */
export class BrightScriptDiagnosticsProvider {
  constructor(
    private readonly importResolver: KopytkoImportResolver,
  ) {}

  provideDiagnostics(
    document: TextDocument,
    generatedPaths: string[] = [],
    generatedModules: GeneratedModuleConfig[] = [],
    siblingPatterns: string[][] = [],
  ): Diagnostic[] {
    const documentPath = getDocumentPath(document);
    const content = document.getText();
    const cachedLines = getCachedLines(document);
    const cachedImports = getCachedImports(document, this.importResolver);

    // Build per-file known function names from extension caches
    const cachedKnownFuncNames = getCachedKnownFuncNames(document, documentPath, this.importResolver, siblingPatterns);

    // Extend with generated module functions
    let knownFuncNames = cachedKnownFuncNames;
    if (generatedModules.length > 0) {
      const extra = new Set<string>();
      for (const imp of cachedImports) {
        const mod = generatedModules.find((m) => matchesGlob(imp.importPath, m.path));
        if (mod) {
          for (const fn of mod.functions) {
            extra.add(fn.toLowerCase());
          }
        }
      }
      if (extra.size > 0) {
        knownFuncNames = new Set([...cachedKnownFuncNames, ...extra]);
      }
    }

    const context: LintContext = {
      knownFuncNames,

      parseImports: (text: string): KopytkoImport[] => {
        // When called with sibling content, parse it; for the current document use the cache
        if (text === content) return cachedImports;
        return parseImports(text);
      },

      resolveImportPath: (importPath: string, _docPath: string, fromModule?: string): string | null => {
        const imp = { raw: '', importPath, fromModule, line: 0, isMock: false };
        return this.importResolver.resolveImportPath(imp, documentPath) ?? null;
      },

      importExists: (importPath: string, _docPath: string, fromModule?: string): boolean => {
        const imp = { raw: '', importPath, fromModule, line: 0, isMock: false };
        return this.importResolver.resolveImportPath(imp, documentPath) !== undefined;
      },

      readFile: (filePath: string): string | null => {
        try {
          return fsWrapper.readFileSync(filePath, 'utf-8');
        } catch {
          return null;
        }
      },

      parseFunctionsFromFile: (filePath: string): string[] => {
        try {
          const text = fsWrapper.readFileSync(filePath, 'utf-8');
          return extParseFunctionDefs(text, filePath).map(f => f.nameLower);
        } catch {
          return [];
        }
      },

      getSiblingFiles: (filePath: string): string[] => {
        return findSiblingFiles(filePath, siblingPatterns);
      },

      getTestSiblings: (filePath: string): string[] => {
        return findTestSiblings(filePath);
      },

      isTestFile: (filePath: string): boolean => {
        return isTestFile(filePath);
      },

      generatedPaths,
      generatedModules,
      siblingPatterns,
    };

    const config: LinterConfig = { ...DEFAULT_LINTER_CONFIG, generatedPaths, generatedModules, siblingPatterns };

    // Pass cached lines directly to avoid re-splitting content inside lintFile
    const lintDiagnostics = lintFile(documentPath, content, context, config, cachedLines);

    return lintDiagnostics.map((d) => this.toLspDiagnostic(d));
  }

  private toLspDiagnostic(d: LintDiagnostic): Diagnostic {
    return {
      severity: SEVERITY_MAP[d.severity] ?? DiagnosticSeverity.Warning,
      range: {
        start: { line: d.line, character: d.column },
        end: { line: d.endLine ?? d.line, character: d.endColumn ?? Number.MAX_SAFE_INTEGER },
      },
      message: d.message,
      source: 'kopytko',
      code: d.code,
    };
  }
}

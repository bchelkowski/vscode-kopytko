import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { matchesGlob } from '../brightscript/globMatcher';
import { getDocumentPath } from '../utils/textUtils';
import { getCachedLines, getCachedImports, getCachedKnownFuncNames } from '../utils/documentCache';
import { isTestFile } from '../kopytko/testFramework';
import fsWrapper from '../utils/fsWrapper';
import { parseFunctionDefs as extParseFunctionDefs } from '../brightscript/functionIndex';
import { findSiblingFiles } from '../brightscript/patternSiblings';
import { findTestSiblings } from '../brightscript/functionIndex';
import {
  lintFile,
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
    const fileLines = getCachedLines(document);
    const documentPath = getDocumentPath(document);
    const content = document.getText();

    // Build per-file known function names from extension caches
    const cachedKnownFuncNames = getCachedKnownFuncNames(document, documentPath, this.importResolver, siblingPatterns);

    // Extend with generated module functions
    let knownFuncNames = cachedKnownFuncNames;
    if (generatedModules.length > 0) {
      const imports = getCachedImports(document, this.importResolver);
      const extra = new Set<string>();
      for (const imp of imports) {
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
        return this.importResolver.parseImports(text);
      },

      resolveImportPath: (importPath: string, fromModule?: string): string | null => {
        const imp = { raw: '', importPath, fromModule, line: 0, isMock: false };
        return this.importResolver.resolveImportPath(imp, documentPath) ?? null;
      },

      importExists: (importPath: string, fromModule?: string): boolean => {
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
    const lintDiagnostics = lintFile(documentPath, content, context, config);

    return lintDiagnostics.map((d) => this.toLspDiagnostic(d, fileLines));
  }

  private toLspDiagnostic(d: LintDiagnostic, _lines: string[]): Diagnostic {
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

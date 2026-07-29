import { Diagnostic } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { matchesGlob } from 'kopytko-brightscript-parser';
import type { ParseResult } from 'kopytko-brightscript-parser';
import { getDocumentPath } from '../utils/textUtils';
import { getCachedLines, getCachedImports, getCachedKnownFuncNames, getCachedParseResult } from '../utils/documentCache';
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
  type LinterConfig,
  type KopytkoImport,
  type RuleConfig,
} from 'kopytko-linter';
import { toLspDiagnostic } from './shared/lintDiagnostic';
import { collectFunctionsFromExtends } from '../brightscript/functionIndex';
import { collectMtopItems } from '../brightscript/mtopResolver';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { WorkspaceCallIndex } from '../utils/workspaceCallIndex';
import { KopytkoModuleCatalog } from '../kopytko/moduleCatalog';

/**
 * `kopytko-linter`'s `lintFile` gained an optional 6th `preParseResult` argument
 * (reuse an already-computed CST) in a release after the version currently
 * pinned here. This forward-compatible signature lets the diagnostics path pass
 * the extension's cached parse instead of making the linter re-parse the same
 * text: older installed builds simply ignore the extra argument at runtime, and
 * the optimization activates automatically once the dependency is bumped.
 */
type LintFileWithPreParse = (
  filePath: string,
  content: string,
  context: LintContext,
  config: LinterConfig,
  preLines?: string[],
  preParseResult?: ParseResult,
) => LintDiagnostic[];

export interface GeneratedModuleConfig {
  path: string;
  functions: string[];
}

/**
 * Thin LSP adapter wrapping the standalone kopytko-linter engine.
 * Builds a LintContext from extension caches and maps results to LSP Diagnostics.
 */
export class BrightScriptDiagnosticsProvider {
  constructor(
    private readonly importResolver: KopytkoImportResolver,
    private readonly workspaceIndex?: WorkspaceFunctionIndex,
    private readonly catalog?: KopytkoModuleCatalog,
    private readonly callIndex?: WorkspaceCallIndex,
  ) {}

  provideDiagnostics(
    document: TextDocument,
    generatedPaths: string[] = [],
    generatedModules: GeneratedModuleConfig[] = [],
    siblingPatterns: string[][] = [],
    lintRuleOverrides: Partial<RuleConfig> = {},
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
        knownFuncNames = new Set([...knownFuncNames, ...extra]);
      }
    }

    // Project source/ functions are globally accessible at runtime (O(1) — cached in workspaceIndex)
    if (this.workspaceIndex) {
      const sourceNames = this.workspaceIndex.getSourceDirNames();
      if (sourceNames.size > 0) knownFuncNames = new Set([...knownFuncNames, ...sourceNames]);
    }

    // Kopytko module source/ functions (O(1) — cached in catalog)
    if (this.catalog) {
      const moduleSourceNames = this.catalog.getSourceDirNamesLower();
      if (moduleSourceNames.size > 0) knownFuncNames = new Set([...knownFuncNames, ...moduleSourceNames]);
    }

    // Compute externalFuncNames (imports + siblings + source, NOT own-file functions)
    // and ancestorFuncNames (extends chain only) for identifier/duplicate-function.
    // Both are only needed when the rule is active; collectFunctionsFromExtends does
    // a readdirSync per component so guard it against the default severity.
    let ancestorFuncNames: Set<string> | undefined;
    let externalFuncNames: Set<string> | undefined;
    if (DEFAULT_LINTER_CONFIG.rules['identifier/duplicate-function'] !== 'off') {
      // Own-file function names (lowercased) — used to exclude them from crossScopeNames.
      const ownFuncNamesLower = new Set(
        extParseFunctionDefs(content, documentPath).map(f => f.nameLower),
      );
      // External = everything knownFuncNames provides EXCEPT the current file's own functions.
      externalFuncNames = new Set([...knownFuncNames].filter(n => !ownFuncNamesLower.has(n)));

      const ancestorDefs = [...collectFunctionsFromExtends(documentPath, this.importResolver)];
      // Template/component files may share a directory XML (e.g. view.xml) with sibling BRS
      // files. collectFunctionsFromExtends already scans all XMLs in the directory, but the
      // sibling's XML may resolve a different extends chain. Mirror what getCachedKnownFuncNames
      // does so ancestorFuncNames is symmetric with knownFuncNames.
      for (const sibPath of findSiblingFiles(documentPath, siblingPatterns)) {
        ancestorDefs.push(...collectFunctionsFromExtends(sibPath, this.importResolver));
      }
      ancestorFuncNames = ancestorDefs.length > 0
        ? new Set(ancestorDefs.map(f => f.nameLower))
        : undefined;
    }

    // Memoize m.top field collection within this single provideDiagnostics call,
    // keyed by filePath so that each component .brs file gets its own field set.
    const mtopFieldsCache = new Map<string, Set<string> | null>();
    const getMtopFields = (filePath: string): Set<string> | null => {
      if (mtopFieldsCache.has(filePath)) return mtopFieldsCache.get(filePath)!;
      const { fields, methods } = collectMtopItems(filePath, this.importResolver);
      const result = fields.length > 0
        ? new Set([...fields.map(f => f.name.toLowerCase()), ...methods.map(m => m.name.toLowerCase())])
        : null;
      mtopFieldsCache.set(filePath, result);
      return result;
    };

    const context: LintContext = {
      knownFuncNames,
      calledWorkwideFuncNames: this.callIndex?.getCalledNames(),
      ancestorFuncNames,
      externalFuncNames,
      getMtopFields,

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

    // Partial<RuleConfig> re-adds `| undefined` to the index-signature values,
    // which cannot be spread back into RuleConfig — and an explicit undefined
    // override would clobber a default anyway, so drop those entries.
    const rules = { ...DEFAULT_LINTER_CONFIG.rules };
    for (const [rule, severity] of Object.entries(lintRuleOverrides)) {
      if (severity !== undefined) rules[rule] = severity;
    }

    const config: LinterConfig = {
      ...DEFAULT_LINTER_CONFIG,
      rules,
      generatedPaths,
      generatedModules,
      siblingPatterns,
    };

    // Pass cached lines (avoid re-splitting) and the extension's cached CST
    // (avoid a redundant parse) into the linter. `content === document.getText()`,
    // so the cached parse corresponds exactly to what is being linted.
    const lint: LintFileWithPreParse = lintFile;
    const lintDiagnostics = lint(documentPath, content, context, config, cachedLines, getCachedParseResult(document));

    return lintDiagnostics.map(toLspDiagnostic);
  }
}

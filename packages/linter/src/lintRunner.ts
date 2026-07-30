import * as nodePath from 'path';
import type { LintDiagnostic, LintResult, RuleContext } from './types';
import type { LintContext } from './context';
import type { LinterConfig } from './config';
import { ALL_RULE_GROUPS } from './rules/index';
import { parseSuppressionMap, isSuppressed } from './suppression';
import { DUPLICATE_COMPONENT_RULE, duplicateComponentDiagnostics } from './analysis/duplicateComponents';
import { matchesGlob, parse } from 'kopytko-brightscript-parser';
import { analyzeFile } from './analysis/fileAnalysis';
import type { ParseResult } from 'kopytko-brightscript-parser';

/** Lints a single file with a pre-built context. */
export function lintFile(
  filePath: string,
  content: string,
  context: LintContext,
  config: LinterConfig,
  preLines?: string[],
  preParseResult?: ParseResult,
): LintDiagnostic[] {
  const lines = preLines ?? content.split(/\r?\n/);
  const imports = context.parseImports(content);
  const parseResult = preParseResult ?? parse(content);

  const ruleContext: RuleContext = {
    filePath,
    lines,
    imports,
    config: config.rules,
    lintContext: context,
    parseResult,
    analysis: analyzeFile(parseResult),
  };

  const diagnostics: LintDiagnostic[] = [];
  for (const ruleGroup of ALL_RULE_GROUPS) {
    try {
      diagnostics.push(...ruleGroup.fn(ruleContext));
    } catch {
      // Never let a rule crash the entire lint run.
    }
  }

  const suppressionMap = parseSuppressionMap(lines);
  return suppressionMap.size === 0
    ? diagnostics
    : diagnostics.filter(d => !isSuppressed(suppressionMap, d));
}

export function runLint(
  brsFiles: string[],
  fileContentsCache: Map<string, string>,
  context: LintContext,
  config: LinterConfig,
): LintResult {
  const allDiagnostics: LintDiagnostic[] = [];

  for (const file of brsFiles) {
    if (config.readOnlyPaths.length > 0 && config.readOnlyPaths.some(p => matchesGlob(file, p))) continue;

    const content = fileContentsCache.get(nodePath.normalize(file));
    if (!content) continue;

    const fileContext = createFileContext(context, file);
    allDiagnostics.push(...lintFile(file, content, fileContext, config));
  }

  allDiagnostics.push(...lintProjectWide(context, config));

  return {
    diagnostics: allDiagnostics,
    fileCount: brsFiles.length,
    errorCount: allDiagnostics.filter(d => d.severity === 'error').length,
    warningCount: allDiagnostics.filter(d => d.severity === 'warning').length,
    infoCount: allDiagnostics.filter(d => d.severity === 'info').length,
    hintCount: allDiagnostics.filter(d => d.severity === 'hint').length,
  };
}

/**
 * Checks that span the whole project rather than one file.
 *
 * These cannot be rules: a rule receives one file's `RuleContext` and cannot see
 * a second file, let alone an XML one. They run once per `runLint`, after the
 * per-file pass, and may attach diagnostics to any file — including `.xml`,
 * which is never linted directly.
 */
function lintProjectWide(context: LintContext, config: LinterConfig): LintDiagnostic[] {
  const declarations = context.componentDeclarations;
  const severity = config.rules[DUPLICATE_COMPONENT_RULE];
  if (!declarations || !severity || severity === 'off') return [];

  return duplicateComponentDiagnostics(declarations, {
    severity,
    isExcluded: (filePath) =>
      config.readOnlyPaths.length > 0 && config.readOnlyPaths.some((p) => matchesGlob(filePath, p)),
  });
}

/** Overrides the context's knownFuncNames, externalFuncNames, and ancestorFuncNames for a specific file. */
export function createFileContext(baseContext: LintContext, filePath: string): LintContext {
  const ctx = baseContext as LintContext & {
    _allFunctions?: Map<string, Set<string>>;
    _ownFunctions?: Map<string, string[]>;
    _ancestorFunctions?: Map<string, Set<string>>;
  };
  const normalizedPath = nodePath.normalize(filePath);
  const fileKnown = ctx._allFunctions?.get(normalizedPath) ?? new Set<string>();
  const fileOwn = ctx._ownFunctions?.get(normalizedPath);
  const fileAncestors = ctx._ancestorFunctions?.get(normalizedPath);

  // externalFuncNames = everything knownFuncNames provides EXCEPT the current file's own
  // functions. This prevents the duplicate-function rule from flagging a function as a
  // cross-scope duplicate of itself when knownFuncNames includes the file's own functions.
  const externalFuncNames = fileOwn
    ? new Set([...fileKnown].filter(n => !fileOwn.includes(n)))
    : undefined;

  return {
    ...baseContext,
    knownFuncNames: fileKnown,
    externalFuncNames,
    ancestorFuncNames: fileAncestors?.size ? fileAncestors : undefined,
  };
}

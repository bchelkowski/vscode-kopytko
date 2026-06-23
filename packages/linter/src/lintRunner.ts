import * as nodePath from 'path';
import type { LintDiagnostic, LintResult, RuleContext } from './types';
import type { LintContext } from './context';
import type { LinterConfig } from './config';
import { ALL_RULE_GROUPS } from './rules/index';
import { parseSuppressionMap, isSuppressed } from './suppression';
import { matchesGlob } from './analysis/globMatcher';
import { parse } from 'kopytko-brightscript-parser';
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

  return {
    diagnostics: allDiagnostics,
    fileCount: brsFiles.length,
    errorCount: allDiagnostics.filter(d => d.severity === 'error').length,
    warningCount: allDiagnostics.filter(d => d.severity === 'warning').length,
    infoCount: allDiagnostics.filter(d => d.severity === 'info').length,
    hintCount: allDiagnostics.filter(d => d.severity === 'hint').length,
  };
}

/** Overrides the context's knownFuncNames for a specific file. */
export function createFileContext(baseContext: LintContext, filePath: string): LintContext {
  const contextWithFunctions = baseContext as LintContext & { _allFunctions?: Map<string, Set<string>> };
  const fileKnown = contextWithFunctions._allFunctions?.get(nodePath.normalize(filePath)) ?? new Set<string>();

  return {
    ...baseContext,
    knownFuncNames: fileKnown,
  };
}

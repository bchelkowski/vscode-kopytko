/**
 * kopytko-linter — BrightScript linter for the Kopytko ecosystem.
 *
 * @example
 * ```ts
 * import { lintProject, lintFile, DEFAULT_LINTER_CONFIG } from 'kopytko-linter';
 *
 * // CLI mode: lint a whole project
 * const result = lintProject('/path/to/project');
 *
 * // Library mode: lint a single file with pre-built context
 * const diagnostics = lintFile(filePath, content, context, config);
 * ```
 */

export { lintFile, lintProject, createFileContext } from './linter';
export { LinterConfig, DEFAULT_LINTER_CONFIG, DEFAULT_RULE_CONFIG, parseLinterConfig, resolveConfig } from './config';
export type { LintDiagnostic, LintResult, LintSeverity, GeneratedModuleConfig, KopytkoImport, FunctionDefinition, RuleContext, RuleConfig, RuleFn, RuleDefinition } from './types';
export type { LintContext } from './context';
export { formatText } from './output/textFormatter';
export { formatJson } from './output/jsonFormatter';
export { formatSarif } from './output/sarifFormatter';
export { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS, findBuiltin, builtinNames, keywordNames } from './catalog/builtins';
export { findComponent } from './catalog/components';
export { parseImports, ImportResolver } from './analysis/importParser';
export { parseFunctionDefs, parseInnerMethodDefs } from './analysis/functionIndex';
export { isTestFile, getTestBaseName, findTestSiblings } from './analysis/testUtils';
export { stripStringLiterals, escapeRegex } from './analysis/textUtils';

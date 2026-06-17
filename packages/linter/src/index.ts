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

export { lintFile, lintProject, lintProjectAsync, createFileContext } from './linter';
export { LinterConfig, DEFAULT_LINTER_CONFIG, DEFAULT_RULE_CONFIG, parseLinterConfig, resolveConfig } from './config';
export type { LintDiagnostic, LintFix, LintResult, LintSeverity, GeneratedModuleConfig, KopytkoImport, FunctionDefinition, RuleContext, RuleConfig, RuleFn, RuleDefinition } from './types';
export type { LintContext } from './context';
export { applyFixes } from './fixer';export { formatText } from './output/textFormatter';
export { formatJson } from './output/jsonFormatter';
export { formatSarif } from './output/sarifFormatter';
// Re-export from brightscript-parser (canonical source)
export { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS, findBuiltin, builtinNames, keywordNames } from 'kopytko-brightscript-parser';
export { matchesGlob, findMatchingGlob } from 'kopytko-brightscript-parser';
export { inferNumericLiteralType, isNumericLiteral, stripNumericLiterals, NUMERIC_LITERAL_GLOBAL_RE } from 'kopytko-brightscript-parser';
export type { NumericType } from 'kopytko-brightscript-parser';

export { findComponent } from 'kopytko-brightscript-parser';
export { escapeRegex } from 'kopytko-brightscript-parser';
export { parseImports, ImportResolver } from './analysis/importParser';
export { parseFunctionDefs, parseInnerMethodDefs } from './analysis/functionIndex';
export { isTestFile, isMockFile, isTestRelatedFile, getTestBaseName, findTestSiblings } from './analysis/testUtils';
export { stripStringLiterals } from './analysis/textUtils';

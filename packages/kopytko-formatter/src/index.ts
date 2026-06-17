/**
 * kopytko-formatter — BrightScript formatter for the Kopytko ecosystem.
 *
 * @example
 * ```ts
 * import { formatText, checkFormatting, DEFAULT_FORMATTING_CONFIG } from 'kopytko-formatter';
 *
 * const formatted = formatText(source, { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2 });
 * const isClean = checkFormatting(source, DEFAULT_FORMATTING_CONFIG);
 * ```
 */

export { formatText, checkFormatting } from './formatter';
export { FormattingConfig, DEFAULT_FORMATTING_CONFIG, parseFormattingConfig } from './config';
export { FunctionDefinition } from './types';

// Re-export from brightscript-parser (canonical source)
export { CasingConfig, CasingOption, DEFAULT_CASING_CONFIG, applyCasing, applyCasingWithOverrides, resolveKeywordCasing } from 'brightscript-parser';
export { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS, findBuiltin, getKeywordCategory } from 'brightscript-parser';
export type { BrightScriptBuiltin, KeywordCategory } from 'brightscript-parser';

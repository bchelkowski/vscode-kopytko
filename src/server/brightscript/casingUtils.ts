export type CasingOption =
  | 'preserve'
  | 'upper-case'
  | 'lower-case'
  | 'capitalize'
  | 'camel-case'
  | 'pascal-case';

export interface CasingConfig {
  /** Casing for BrightScript built-in global functions (Abs, CreateObject, …). */
  builtin: CasingOption;
  /** Casing for BrightScript language keywords (function, sub, if, …). Falls back for all sub-categories when their specific setting is not defined. */
  keyword: CasingOption;
  /** Casing for ro* component interface methods (Push, SetUrl, …). */
  method: CasingOption;
  /** Casing for type names (boolean, integer, string, …). Falls back to `keyword`. */
  type?: CasingOption;
  /** Casing for literal values (true, false, invalid). Falls back to `keyword`. */
  literal?: CasingOption;
  /** Casing for logic operators (and, or, not). Falls back to `keyword`. */
  logicOperator?: CasingOption;
  /** Casing for math operators (mod). Falls back to `keyword`. */
  mathOperator?: CasingOption;
  /** Casing for user-defined top-level function/sub names. */
  userFunction?: CasingOption;
  /** Casing for user-defined AA methods (this.doWork = function …). */
  userMethod?: CasingOption;
  /** Per-identifier overrides applied after all other rules. Key = lowercase name, value = exact output. */
  exact?: Record<string, string>;
}

export const DEFAULT_CASING_CONFIG: CasingConfig = {
  builtin: 'preserve',
  keyword: 'preserve',
  method:  'preserve',
};

/**
 * Applies a casing transformation to a single identifier.
 *
 *  preserve   → unchanged                ("SetUrl"  → "SetUrl")
 *  upper-case → ALL CAPS                 ("SetUrl"  → "SETURL")
 *  lower-case → all lowercase            ("SetUrl"  → "seturl")
 *  capitalize → first letter up, rest ↓  ("SetUrl"  → "Seturl")
 *  pascal-case→ word-split, each word    ("setUrl"  → "SetUrl")
 *               first-up rest-down
 *  camel-case → pascal-case but first    ("SetUrl"  → "setUrl")
 *               word all-lowercase
 *
 * Word boundaries are detected by capital letters in the source string so
 * that catalog-cased identifiers like "GetToString" round-trip correctly.
 */
export function applyCasing(name: string, option: CasingOption): string {
  switch (option) {
    case 'upper-case':  return name.toUpperCase();
    case 'lower-case':  return name.toLowerCase();
    case 'capitalize':  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    case 'pascal-case': return splitWords(name).map(capitalizeWord).join('');
    case 'camel-case': {
      const words = splitWords(name);
      return words.map((w, i) => i === 0 ? w.toLowerCase() : capitalizeWord(w)).join('');
    }
    case 'preserve':
    default:            return name;
  }
}

/**
 * Applies casing to the identifier portion of a VS Code snippet string,
 * leaving snippet tab-stop syntax (${1:…}) untouched.
 *
 * e.g. applySnippetCasing("SetUrl(${1:url as String})", 'lower-case')
 *      → "seturl(${1:url as String})"
 */
export function applySnippetCasing(snippet: string, option: CasingOption): string {
  if (option === 'preserve') return snippet;
  const parenIdx = snippet.indexOf('(');
  if (parenIdx === -1) return applyCasing(snippet, option);
  return applyCasing(snippet.substring(0, parenIdx), option) + snippet.substring(parenIdx);
}

/**
 * Applies casing with exact-override support. If `exact` contains a
 * mapping for the lowercase form of `name`, that exact string is returned
 * instead of the computed casing.
 */
export function applyCasingWithOverrides(
  name: string,
  option: CasingOption,
  exact?: Record<string, string>,
): string {
  if (exact) {
    const lower = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(exact, lower)) {
      return exact[lower];
    }
  }
  return applyCasing(name, option);
}

import type { KeywordCategory } from 'brightscript-parser';

/**
 * Resolves the effective casing option for a keyword sub-category.
 * Falls back to the general `keyword` casing when the specific setting is not defined.
 */
export function resolveKeywordCasing(category: KeywordCategory, config: CasingConfig): CasingOption {
  switch (category) {
    case 'type': return config.type ?? config.keyword;
    case 'literal': return config.literal ?? config.keyword;
    case 'logicOperator': return config.logicOperator ?? config.keyword;
    case 'mathOperator': return config.mathOperator ?? config.keyword;
    default: return config.keyword;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Splits an identifier on camelCase/PascalCase word boundaries.
 * "CreateObject" → ["Create", "Object"]
 * "GetCRC32"     → ["Get", "C", "R", "C32"]
 * "for"          → ["for"]
 */
function splitWords(name: string): string[] {
  return name.split(/(?=[A-Z])/).filter((w) => w.length > 0);
}

function capitalizeWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

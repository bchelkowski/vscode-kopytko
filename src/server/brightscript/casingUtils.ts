export type CasingOption =
  | 'NoChange'
  | 'UpperCase'
  | 'LowerCase'
  | 'Capitalize'
  | 'CamelCase'
  | 'PascalCase';

export interface CasingConfig {
  /** Casing for BrightScript built-in global functions (Abs, CreateObject, …). */
  builtins: CasingOption;
  /** Casing for BrightScript language keywords (function, sub, if, …). Falls back for all sub-categories when their specific setting is not defined. */
  keywords: CasingOption;
  /** Casing for ro* component interface methods (Push, SetUrl, …). */
  methods: CasingOption;
  /** Casing for type names (boolean, integer, string, …). Falls back to `keywords`. */
  types?: CasingOption;
  /** Casing for literal values (true, false, invalid). Falls back to `keywords`. */
  literals?: CasingOption;
  /** Casing for logic operators (and, or, not). Falls back to `keywords`. */
  logicOperators?: CasingOption;
  /** Casing for math operators (mod). Falls back to `keywords`. */
  mathOperators?: CasingOption;
  /** Casing for user-defined top-level function/sub names. */
  userFunctions?: CasingOption;
  /** Casing for user-defined AA methods (this.doWork = function …). */
  userMethods?: CasingOption;
  /** Per-identifier overrides applied after all other rules. Key = lowercase name, value = exact output. */
  exactCasing?: Record<string, string>;
}

export const DEFAULT_CASING_CONFIG: CasingConfig = {
  builtins: 'NoChange',
  keywords: 'NoChange',
  methods:  'NoChange',
};

/**
 * Applies a casing transformation to a single identifier.
 *
 *  NoChange   → unchanged                ("SetUrl"  → "SetUrl")
 *  UpperCase  → ALL CAPS                 ("SetUrl"  → "SETURL")
 *  LowerCase  → all lowercase            ("SetUrl"  → "seturl")
 *  Capitalize → first letter up, rest ↓  ("SetUrl"  → "Seturl")
 *  PascalCase → word-split, each word    ("setUrl"  → "SetUrl")
 *               first-up rest-down
 *  CamelCase  → PascalCase but first     ("SetUrl"  → "setUrl")
 *               word all-lowercase
 *
 * Word boundaries are detected by capital letters in the source string so
 * that catalog-cased identifiers like "GetToString" round-trip correctly.
 */
export function applyCasing(name: string, option: CasingOption): string {
  switch (option) {
    case 'UpperCase':   return name.toUpperCase();
    case 'LowerCase':   return name.toLowerCase();
    case 'Capitalize':  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    case 'PascalCase':  return splitWords(name).map(capitalizeWord).join('');
    case 'CamelCase': {
      const words = splitWords(name);
      return words.map((w, i) => i === 0 ? w.toLowerCase() : capitalizeWord(w)).join('');
    }
    case 'NoChange':
    default:            return name;
  }
}

/**
 * Applies casing to the identifier portion of a VS Code snippet string,
 * leaving snippet tab-stop syntax (${1:…}) untouched.
 *
 * e.g. applySnippetCasing("SetUrl(${1:url as String})", 'LowerCase')
 *      → "seturl(${1:url as String})"
 */
export function applySnippetCasing(snippet: string, option: CasingOption): string {
  if (option === 'NoChange') return snippet;
  const parenIdx = snippet.indexOf('(');
  if (parenIdx === -1) return applyCasing(snippet, option);
  return applyCasing(snippet.substring(0, parenIdx), option) + snippet.substring(parenIdx);
}

/**
 * Applies casing with exact-override support. If `exactCasing` contains a
 * mapping for the lowercase form of `name`, that exact string is returned
 * instead of the computed casing.
 */
export function applyCasingWithOverrides(
  name: string,
  option: CasingOption,
  exactCasing?: Record<string, string>,
): string {
  if (exactCasing) {
    const lower = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(exactCasing, lower)) {
      return exactCasing[lower];
    }
  }
  return applyCasing(name, option);
}

import type { KeywordCategory } from './builtins';

/**
 * Resolves the effective casing option for a keyword sub-category.
 * Falls back to the general `keywords` casing when the specific setting is not defined.
 */
export function resolveKeywordCasing(category: KeywordCategory, config: CasingConfig): CasingOption {
  switch (category) {
    case 'type': return config.types ?? config.keywords;
    case 'literal': return config.literals ?? config.keywords;
    case 'logicOperator': return config.logicOperators ?? config.keywords;
    case 'mathOperator': return config.mathOperators ?? config.keywords;
    case 'keyword': return config.keywords;
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

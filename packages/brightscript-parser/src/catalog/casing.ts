import { KeywordCategory } from './builtins';

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

export function resolveKeywordCasing(category: KeywordCategory, config: CasingConfig): CasingOption {
  switch (category) {
    case 'type': return config.type ?? config.keyword;
    case 'literal': return config.literal ?? config.keyword;
    case 'logicOperator': return config.logicOperator ?? config.keyword;
    case 'mathOperator': return config.mathOperator ?? config.keyword;
    default: return config.keyword;
  }
}

function splitWords(name: string): string[] {
  return name.split(/(?=[A-Z])/).filter((w) => w.length > 0);
}

function capitalizeWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

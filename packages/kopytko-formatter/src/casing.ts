import { KeywordCategory } from './builtins';

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

export function resolveKeywordCasing(category: KeywordCategory, config: CasingConfig): CasingOption {
  switch (category) {
    case 'type': return config.types ?? config.keywords;
    case 'literal': return config.literals ?? config.keywords;
    case 'logicOperator': return config.logicOperators ?? config.keywords;
    case 'mathOperator': return config.mathOperators ?? config.keywords;
    case 'keyword': return config.keywords;
  }
}

function splitWords(name: string): string[] {
  return name.split(/(?=[A-Z])/).filter((w) => w.length > 0);
}

function capitalizeWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

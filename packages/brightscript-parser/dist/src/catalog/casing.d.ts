import { KeywordCategory } from './builtins';
export type CasingOption = 'preserve' | 'upper-case' | 'lower-case' | 'capitalize' | 'camel-case' | 'pascal-case';
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
export declare const DEFAULT_CASING_CONFIG: CasingConfig;
export declare function applyCasing(name: string, option: CasingOption): string;
export declare function applyCasingWithOverrides(name: string, option: CasingOption, exact?: Record<string, string>): string;
export declare function resolveKeywordCasing(category: KeywordCategory, config: CasingConfig): CasingOption;
//# sourceMappingURL=casing.d.ts.map
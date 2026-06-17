/**
 * BrightScript built-in functions and keywords.
 *
 * Kept in sync with the extension's src/server/brightscript/builtins.ts and
 * the formatter's packages/kopytko-formatter/src/builtins.ts.
 */
export interface BrightScriptBuiltin {
    name: string;
    signature: string;
    returnType: string;
    description: string;
    docsUrl: string;
    category: 'math' | 'string' | 'type' | 'utility' | 'io' | 'filesystem';
}
export declare const BRIGHTSCRIPT_BUILTINS: BrightScriptBuiltin[];
export declare function findBuiltin(name: string): BrightScriptBuiltin | undefined;
export declare const BRIGHTSCRIPT_KEYWORDS: string[];
/** Pre-built sets for O(1) lookup */
export declare const builtinNames: Set<string>;
export declare const keywordNames: Set<string>;
/** Maps lowercased builtin name → { min, max } expected argument counts. */
export declare const builtinArity: Map<string, {
    min: number;
    max: number;
}>;
export type KeywordCategory = 'keyword' | 'type' | 'literal' | 'logicOperator' | 'mathOperator';
/** Returns the category of a keyword (lowercase). */
export declare function getKeywordCategory(keyword: string): KeywordCategory;
//# sourceMappingURL=builtins.d.ts.map
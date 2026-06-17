/**
 * Minimal glob matcher supporting `*` (any chars except `/`) and `**` (any chars including `/`).
 * Used to match @import paths against user-configured generated-file patterns.
 */
export declare function matchesGlob(str: string, pattern: string): boolean;
/** Returns the first pattern that matches, or undefined if none match. */
export declare function findMatchingGlob(str: string, patterns: string[]): string | undefined;
//# sourceMappingURL=globMatcher.d.ts.map
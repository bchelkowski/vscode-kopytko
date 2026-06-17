"use strict";
/**
 * Minimal glob matcher supporting `*` (any chars except `/`) and `**` (any chars including `/`).
 * Used to match @import paths against user-configured generated-file patterns.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesGlob = matchesGlob;
exports.findMatchingGlob = findMatchingGlob;
const _globRegexCache = new Map();
function matchesGlob(str, pattern) {
    let regex = _globRegexCache.get(pattern);
    if (!regex) {
        const regexSource = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex metacharacters
            .replace(/\*\*/g, '\x00') // placeholder for **
            .replace(/\*/g, '[^/]*') // * → any non-slash chars
            .replace(/\x00/g, '.*'); // ** → any chars (including /)
        regex = new RegExp('^' + regexSource + '$');
        _globRegexCache.set(pattern, regex);
    }
    return regex.test(str);
}
/** Returns the first pattern that matches, or undefined if none match. */
function findMatchingGlob(str, patterns) {
    return patterns.find((p) => matchesGlob(str, p));
}
//# sourceMappingURL=globMatcher.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CASING_CONFIG = void 0;
exports.applyCasing = applyCasing;
exports.applyCasingWithOverrides = applyCasingWithOverrides;
exports.resolveKeywordCasing = resolveKeywordCasing;
exports.DEFAULT_CASING_CONFIG = {
    builtin: 'preserve',
    keyword: 'preserve',
    method: 'preserve',
};
function applyCasing(name, option) {
    switch (option) {
        case 'upper-case': return name.toUpperCase();
        case 'lower-case': return name.toLowerCase();
        case 'capitalize': return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        case 'pascal-case': return splitWords(name).map(capitalizeWord).join('');
        case 'camel-case': {
            const words = splitWords(name);
            return words.map((w, i) => i === 0 ? w.toLowerCase() : capitalizeWord(w)).join('');
        }
        case 'preserve':
        default: return name;
    }
}
function applyCasingWithOverrides(name, option, exact) {
    if (exact) {
        const lower = name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(exact, lower)) {
            return exact[lower];
        }
    }
    return applyCasing(name, option);
}
function resolveKeywordCasing(category, config) {
    switch (category) {
        case 'type': return config.type ?? config.keyword;
        case 'literal': return config.literal ?? config.keyword;
        case 'logicOperator': return config.logicOperator ?? config.keyword;
        case 'mathOperator': return config.mathOperator ?? config.keyword;
        default: return config.keyword;
    }
}
function splitWords(name) {
    return name.split(/(?=[A-Z])/).filter((w) => w.length > 0);
}
function capitalizeWord(word) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
//# sourceMappingURL=casing.js.map
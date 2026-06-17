"use strict";
/**
 * Symbol information aggregation for BrightScript.
 *
 * Provides rich symbol info for hover, go-to-definition, and find-references:
 * - Full function signature with parameter types and return type
 * - Source location (file, line, column)
 * - Documentation (from builtins catalog for built-in functions)
 * - All references to the symbol
 * - Whether the symbol is a builtin, user-defined, or parameter
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSymbolInfo = getSymbolInfo;
const visitor_js_1 = require("../visitor.js");
const builtins_js_1 = require("../catalog/builtins.js");
const scope_js_1 = require("../scope.js");
/**
 * Gets symbol info for a function by name.
 * Searches builtins first, then user-defined functions in the AST.
 */
function getSymbolInfo(name, root) {
    const lower = name.toLowerCase();
    // Check builtins
    const builtin = (0, builtins_js_1.findBuiltin)(lower);
    if (builtin) {
        return {
            name: builtin.name,
            kind: 'builtin',
            signature: `${builtin.name}(${builtin.signature})`,
            returnType: builtin.returnType,
            description: builtin.description,
            docsUrl: builtin.docsUrl,
            references: collectReferences(lower, root),
        };
    }
    // Check user-defined functions
    let found = null;
    (0, visitor_js_1.walk)(root, {
        visitFunctionDeclaration(node) {
            if (node.name.toLowerCase() !== lower)
                return;
            const params = node.params;
            const paramSigs = params.map(p => p.typeName ? `${p.name} as ${p.typeName}` : p.name);
            const retType = node.returnType;
            const keyword = node.isSub ? 'sub' : 'function';
            const sig = retType
                ? `${keyword} ${node.name}(${paramSigs.join(', ')}) as ${retType}`
                : `${keyword} ${node.name}(${paramSigs.join(', ')})`;
            found = {
                name: node.name,
                kind: 'function',
                signature: sig,
                params: params.map(p => p.name),
                paramTypes: params.map(p => p.typeName),
                returnType: retType,
                location: node.nameToken ? { line: node.nameToken.line, column: node.nameToken.column } : undefined,
                references: collectReferences(lower, root),
            };
        },
    });
    if (found)
        return found;
    // Check scope declarations (variables, parameters)
    const scope = (0, scope_js_1.buildScopes)(root);
    const decl = findDeclarationInScopes(lower, scope);
    if (decl) {
        return {
            name: decl.name,
            kind: decl.kind === 'parameter' ? 'parameter' : 'variable',
            location: { line: decl.line, column: decl.column },
            references: collectReferences(lower, root),
        };
    }
    return null;
}
function collectReferences(nameLower, root) {
    const refs = [];
    (0, visitor_js_1.walk)(root, {
        visitIdentifierExpression(node) {
            if (node.name.toLowerCase() === nameLower) {
                const t = node.nameToken;
                if (t)
                    refs.push({ line: t.line, column: t.column });
            }
        },
    });
    return refs;
}
function findDeclarationInScopes(nameLower, scope) {
    const decl = scope.declarations.get(nameLower);
    if (decl)
        return decl;
    for (const child of scope.children) {
        const found = findDeclarationInScopes(nameLower, child);
        if (found)
            return found;
    }
    return undefined;
}
//# sourceMappingURL=symbolInfo.js.map
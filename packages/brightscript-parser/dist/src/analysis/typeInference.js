"use strict";
/**
 * AST-based type inference for BrightScript.
 *
 * Tracks the possible types of variables through:
 * - CreateObject("roFoo") → type is "roFoo"
 * - Parameter type annotations: `param as Integer` → "Integer"
 * - Numeric/string/boolean literal assignments
 * - Return type annotations on functions
 * - Type designator suffixes: `x$` → String, `x%` → Integer, etc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferTypesFromAst = inferTypesFromAst;
exports.getVariableType = getVariableType;
const tokenKind_js_1 = require("../tokenKind.js");
const visitor_js_1 = require("../visitor.js");
const ast_js_1 = require("../ast.js");
function inferTypesFromAst(root) {
    const typeMap = new Map();
    (0, visitor_js_1.walk)(root, {
        visitAssignmentStatement(node) {
            const target = node.target;
            if (!target)
                return;
            let varName;
            let varLine = 0, varCol = 0;
            if (target instanceof ast_js_1.IdentifierExpression) {
                varName = target.name.toLowerCase();
                const t = target.nameToken;
                if (t) {
                    varLine = t.line;
                    varCol = t.column;
                }
            }
            else if (target instanceof ast_js_1.DotExpression) {
                const obj = target.object;
                if (obj instanceof ast_js_1.IdentifierExpression && obj.name.toLowerCase() === 'm') {
                    varName = target.member.toLowerCase();
                    const t = target.memberToken;
                    if (t) {
                        varLine = t.line;
                        varCol = t.column;
                    }
                }
            }
            if (!varName)
                return;
            const value = node.value;
            if (!value)
                return;
            if (value instanceof ast_js_1.CallExpression) {
                const callee = value.callee;
                if (callee instanceof ast_js_1.IdentifierExpression && callee.name.toLowerCase() === 'createobject') {
                    const args = value.args;
                    if (args.length > 0 && args[0] instanceof ast_js_1.LiteralExpression) {
                        const token = args[0].token;
                        if (token && token.kind === tokenKind_js_1.TokenKind.StringLiteral) {
                            addType(typeMap, varName, { name: varName, typeName: token.text.slice(1, -1), source: 'createobject', line: varLine, column: varCol });
                        }
                    }
                }
            }
            if (value instanceof ast_js_1.LiteralExpression && value.token) {
                const litType = inferLiteralType(value.token);
                if (litType) {
                    addType(typeMap, varName, { name: varName, typeName: litType, source: 'literal', line: varLine, column: varCol });
                }
            }
        },
        visitFunctionDeclaration(node) {
            for (const param of node.params) {
                if (param.typeName) {
                    const t = param.nameToken;
                    addType(typeMap, param.name.toLowerCase(), {
                        name: param.name.toLowerCase(), typeName: param.typeName,
                        source: 'param-annotation', line: t?.line ?? 0, column: t?.column ?? 0,
                    });
                }
            }
        },
        visitFunctionExpression(node) {
            for (const param of node.params) {
                if (param.typeName) {
                    const t = param.nameToken;
                    addType(typeMap, param.name.toLowerCase(), {
                        name: param.name.toLowerCase(), typeName: param.typeName,
                        source: 'param-annotation', line: t?.line ?? 0, column: t?.column ?? 0,
                    });
                }
            }
        },
    });
    return typeMap;
}
function addType(map, name, binding) {
    const existing = map.get(name);
    if (existing)
        existing.push(binding);
    else
        map.set(name, [binding]);
}
function inferLiteralType(token) {
    switch (token.kind) {
        case tokenKind_js_1.TokenKind.IntegerLiteral: return 'Integer';
        case tokenKind_js_1.TokenKind.LongIntegerLiteral: return 'LongInteger';
        case tokenKind_js_1.TokenKind.FloatLiteral: return 'Float';
        case tokenKind_js_1.TokenKind.DoubleLiteral: return 'Double';
        case tokenKind_js_1.TokenKind.StringLiteral: return 'String';
        case tokenKind_js_1.TokenKind.True:
        case tokenKind_js_1.TokenKind.False: return 'Boolean';
        case tokenKind_js_1.TokenKind.Invalid: return 'Invalid';
        default: return undefined;
    }
}
function getVariableType(typeMap, varName) {
    const bindings = typeMap.get(varName.toLowerCase());
    if (!bindings || bindings.length === 0)
        return undefined;
    const createObj = bindings.find(b => b.source === 'createobject');
    if (createObj)
        return createObj.typeName;
    const paramAnnotation = bindings.find(b => b.source === 'param-annotation');
    if (paramAnnotation)
        return paramAnnotation.typeName;
    return bindings[0].typeName;
}
//# sourceMappingURL=typeInference.js.map
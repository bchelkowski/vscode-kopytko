"use strict";
/**
 * Context (`m`) analysis for BrightScript.
 *
 * In BrightScript, `m` is a special variable:
 * - When a function is called from a SceneGraph component → `m` = component scope
 * - When called from an associative array → `m` = that AA
 * - When called standalone → `m` = module-level global AA
 *
 * This module tracks:
 * 1. What fields are assigned to `m` (m.field = value)
 * 2. Where functions are stored in AAs (aa.func = myFunc)
 * 3. The possible `m` contexts for each function based on call patterns
 *
 * This enables the extension to show:
 * - "m.top" is available because this function runs in a component context
 * - "m.data" was assigned in init() → type is roArray
 * - Warnings when m.field types are inconsistent
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeContext = analyzeContext;
const tokenKind_js_1 = require("../tokenKind.js");
const visitor_js_1 = require("../visitor.js");
const ast_js_1 = require("../ast.js");
/**
 * Analyzes `m` context usage across the file.
 */
function analyzeContext(root) {
    const contextFields = [];
    const functionBindings = [];
    const inlineAAFunctions = [];
    let currentFunction = '';
    (0, visitor_js_1.walk)(root, {
        visitFunctionDeclaration(node) {
            currentFunction = node.name.toLowerCase();
        },
        visitAssignmentStatement(node) {
            const target = node.target;
            if (!target)
                return;
            // m.field = value → context field assignment
            if (target instanceof ast_js_1.DotExpression) {
                const obj = target.object;
                if (obj instanceof ast_js_1.IdentifierExpression && obj.name.toLowerCase() === 'm') {
                    const fieldName = target.member;
                    const t = target.memberToken;
                    const typeName = inferSimpleType(node.value);
                    contextFields.push({
                        name: fieldName.toLowerCase(),
                        originalName: fieldName,
                        typeName,
                        assignedInFunction: currentFunction,
                        line: t?.line ?? 0,
                        column: t?.column ?? 0,
                    });
                }
                // aa.field = someFunction → function binding
                if (obj instanceof ast_js_1.IdentifierExpression && obj.name.toLowerCase() !== 'm') {
                    const value = node.value;
                    if (value instanceof ast_js_1.IdentifierExpression) {
                        functionBindings.push({
                            aaName: obj.name.toLowerCase(),
                            fieldName: target.member.toLowerCase(),
                            functionName: value.name.toLowerCase(),
                            line: target.memberToken?.line ?? 0,
                        });
                    }
                }
            }
        },
        visitAAField(node) {
            // { key: function() ... } → inline AA function
            const value = node.value;
            if (value instanceof ast_js_1.FunctionExpression) {
                inlineAAFunctions.push({
                    aaFieldName: node.key.toLowerCase(),
                    line: node.keyToken?.line ?? 0,
                });
            }
        },
    });
    return {
        contextFields,
        functionBindings,
        inlineAAFunctions,
        getFieldsInFunction(funcName) {
            return contextFields.filter(f => f.assignedInFunction === funcName.toLowerCase());
        },
        getAllFields() {
            return contextFields;
        },
    };
}
function inferSimpleType(node) {
    if (!node)
        return undefined;
    if (node instanceof ast_js_1.LiteralExpression && node.token) {
        switch (node.token.kind) {
            case tokenKind_js_1.TokenKind.StringLiteral: return 'String';
            case tokenKind_js_1.TokenKind.IntegerLiteral: return 'Integer';
            case tokenKind_js_1.TokenKind.FloatLiteral: return 'Float';
            case tokenKind_js_1.TokenKind.True:
            case tokenKind_js_1.TokenKind.False: return 'Boolean';
            case tokenKind_js_1.TokenKind.Invalid: return 'Invalid';
        }
    }
    if (node instanceof ast_js_1.CallExpression) {
        const callee = node.callee;
        if (callee instanceof ast_js_1.IdentifierExpression && callee.name.toLowerCase() === 'createobject') {
            const args = node.args;
            if (args.length > 0 && args[0] instanceof ast_js_1.LiteralExpression && args[0].token?.kind === tokenKind_js_1.TokenKind.StringLiteral) {
                return args[0].token.text.slice(1, -1);
            }
        }
    }
    return undefined;
}
//# sourceMappingURL=contextAnalysis.js.map
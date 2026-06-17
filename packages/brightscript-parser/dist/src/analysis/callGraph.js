"use strict";
/**
 * Call graph builder for BrightScript.
 *
 * Builds a graph of which functions call which other functions,
 * recording argument expressions at each call site. This enables:
 * - Tracing data flow through function calls
 * - Finding all callers of a function
 * - Understanding argument passing chains
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCallGraph = buildCallGraph;
const visitor_js_1 = require("../visitor.js");
const ast_js_1 = require("../ast.js");
/**
 * Builds a call graph from a parsed source file.
 */
function buildCallGraph(root) {
    const functions = new Map();
    const allCalls = [];
    let currentFunction = '';
    // First pass: collect all function declarations
    (0, visitor_js_1.walk)(root, {
        visitFunctionDeclaration(node) {
            const name = node.name.toLowerCase();
            functions.set(name, {
                name,
                originalName: node.name,
                params: node.params.map(p => p.name),
                paramTypes: node.params.map(p => p.typeName),
                returnType: node.returnType,
                isSub: node.isSub,
                line: node.nameToken?.line ?? 0,
                calls: [],
            });
        },
    });
    // Second pass: collect all call sites
    (0, visitor_js_1.walk)(root, {
        visitFunctionDeclaration(node) {
            currentFunction = node.name.toLowerCase();
        },
        visitCallExpression(node) {
            const callee = node.callee;
            if (!callee)
                return;
            let calleeName = '';
            let calleeOriginal = '';
            let isMethodCall = false;
            let receiver;
            let line = 0, column = 0;
            if (callee instanceof ast_js_1.IdentifierExpression) {
                calleeName = callee.name.toLowerCase();
                calleeOriginal = callee.name;
                const t = callee.nameToken;
                if (t) {
                    line = t.line;
                    column = t.column;
                }
            }
            else if (callee instanceof ast_js_1.DotExpression) {
                calleeName = callee.member.toLowerCase();
                calleeOriginal = callee.member;
                isMethodCall = true;
                const obj = callee.object;
                if (obj instanceof ast_js_1.IdentifierExpression) {
                    receiver = obj.name.toLowerCase();
                }
                const t = callee.memberToken;
                if (t) {
                    line = t.line;
                    column = t.column;
                }
            }
            if (!calleeName)
                return;
            const site = {
                calleeName, calleeOriginal,
                argCount: node.args.length,
                line, column,
                enclosingFunction: currentFunction,
                isMethodCall,
                receiver,
            };
            allCalls.push(site);
            const fnInfo = functions.get(currentFunction);
            if (fnInfo)
                fnInfo.calls.push(site);
        },
    });
    return {
        functions,
        allCalls,
        findCallers(funcName) {
            const lower = funcName.toLowerCase();
            return allCalls.filter(c => c.calleeName === lower);
        },
        findCallees(funcName) {
            const fn = functions.get(funcName.toLowerCase());
            return fn ? fn.calls : [];
        },
    };
}
//# sourceMappingURL=callGraph.js.map
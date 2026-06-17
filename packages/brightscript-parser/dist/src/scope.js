"use strict";
/**
 * Scope analysis — builds a scope tree from a parsed BrightScript file.
 *
 * BrightScript scoping rules:
 * - Functions/subs create their own scope.
 * - Parameters are local to their function scope.
 * - Variables assigned with `=` are local to their function scope.
 * - `for` / `for each` loop variables are local to their function scope.
 * - `catch` variables are local to their function scope.
 * - `m` is a special variable: component scope (AA) in SceneGraph,
 *   module-level AA otherwise.
 * - `dim` declares an array variable local to the function scope.
 * - All identifiers are case-insensitive.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScopes = buildScopes;
exports.findScopeAtLine = findScopeAtLine;
exports.resolve = resolve;
const syntaxNode_js_1 = require("./syntaxNode.js");
const syntaxKind_js_1 = require("./syntaxKind.js");
const tokenKind_js_1 = require("./tokenKind.js");
const ALWAYS_VALID = new Set(['m', 'true', 'false', 'invalid', 'line_num']);
/**
 * Builds a scope tree from a parsed source file.
 *
 * @param root - The SourceFile CST node.
 * @returns The file-level scope with all nested scopes.
 */
function buildScopes(root) {
    const fileScope = {
        owner: null,
        ownerName: '',
        parent: null,
        declarations: new Map(),
        references: [],
        children: [],
    };
    collectFromNode(root, fileScope);
    return fileScope;
}
/**
 * Finds the innermost scope that contains the given line.
 */
function findScopeAtLine(scope, line) {
    for (const child of scope.children) {
        if (child.owner) {
            const ownerStart = getNodeLine(child.owner);
            const ownerEnd = getNodeEndLine(child.owner);
            if (line >= ownerStart && line <= ownerEnd) {
                return findScopeAtLine(child, line);
            }
        }
    }
    return scope;
}
/**
 * Resolves a name in the given scope, searching up the scope chain.
 * Returns the declaration or undefined if not found.
 */
function resolve(name, scope) {
    const lower = name.toLowerCase();
    if (ALWAYS_VALID.has(lower))
        return undefined; // implicitly valid
    const decl = scope.declarations.get(lower);
    if (decl)
        return decl;
    if (scope.parent)
        return resolve(name, scope.parent);
    return undefined;
}
// ─── Internal ───────────────────────────────────────────────────────────────
function collectFromNode(node, scope) {
    switch (node.kind) {
        case syntaxKind_js_1.SyntaxKind.FunctionDeclaration:
            collectFunctionDeclaration(node, scope);
            return; // don't recurse — child scope handles body
        case syntaxKind_js_1.SyntaxKind.FunctionExpression:
            collectFunctionExpression(node, scope);
            return;
        case syntaxKind_js_1.SyntaxKind.AssignmentStatement:
            collectAssignment(node, scope);
            break;
        case syntaxKind_js_1.SyntaxKind.ForStatement:
            collectForVariable(node, scope);
            break;
        case syntaxKind_js_1.SyntaxKind.ForEachStatement:
            collectForEachVariable(node, scope);
            break;
        case syntaxKind_js_1.SyntaxKind.CatchClause:
            collectCatchVariable(node, scope);
            break;
        case syntaxKind_js_1.SyntaxKind.DimStatement:
            collectDimVariable(node, scope);
            break;
        case syntaxKind_js_1.SyntaxKind.ConditionalCompilation:
            // Process body statements inside #if blocks (they contain real BrightScript)
            // but skip the condition expression (manifest constants like RALE, DEBUG)
            collectConditionalBody(node, scope);
            return;
        case syntaxKind_js_1.SyntaxKind.HashConstStatement:
        case syntaxKind_js_1.SyntaxKind.HashErrorStatement:
            // Skip entirely — #const and #error don't contain BrightScript code
            return;
        case syntaxKind_js_1.SyntaxKind.CallExpression:
        case syntaxKind_js_1.SyntaxKind.IdentifierExpression:
            collectReferences(node, scope);
            break;
        default:
            break;
    }
    // Recurse into children
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isNode)(child)) {
            collectFromNode(child, scope);
        }
    }
}
/**
 * Processes a ConditionalCompilation node: skips the condition identifiers
 * (#if RALE, #else if FLAG) but analyzes the body statements normally.
 */
function collectConditionalBody(node, scope) {
    // The children of ConditionalCompilation are:
    // - HashIf/HashElseIf/HashElse/HashEndIf tokens
    // - Condition expression node (skip — manifest constants)
    // - Body statements (process normally)
    let skipNextExpression = false;
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isToken)(child)) {
            // After #if or #else if, the next child node is the condition — skip it
            skipNextExpression = (child.kind === tokenKind_js_1.TokenKind.HashIf || child.kind === tokenKind_js_1.TokenKind.HashElseIf);
            continue;
        }
        if ((0, syntaxNode_js_1.isNode)(child)) {
            if (skipNextExpression) {
                // This is the condition expression (could be IdentifierExpression,
                // UnaryExpression like `NOT flag`, BinaryExpression, etc.) — skip entirely
                skipNextExpression = false;
                continue;
            }
            // Body statement — process normally
            collectFromNode(child, scope);
        }
    }
}
function collectFunctionDeclaration(node, parentScope) {
    const nameToken = node.findToken(tokenKind_js_1.TokenKind.Identifier);
    const name = nameToken?.text ?? '';
    // Register the function in the parent scope
    if (name) {
        parentScope.declarations.set(name.toLowerCase(), {
            name,
            nameLower: name.toLowerCase(),
            kind: 'function',
            line: nameToken.line,
            column: nameToken.column,
            node,
        });
    }
    // Create child scope
    const childScope = {
        owner: node,
        ownerName: name.toLowerCase(),
        parent: parentScope,
        declarations: new Map(),
        references: [],
        children: [],
    };
    parentScope.children.push(childScope);
    // Collect parameters
    const paramList = node.findChild(syntaxKind_js_1.SyntaxKind.ParameterList);
    if (paramList) {
        for (const param of paramList.findAllChildren(syntaxKind_js_1.SyntaxKind.Parameter)) {
            const pName = param.findToken(tokenKind_js_1.TokenKind.Identifier);
            if (pName) {
                childScope.declarations.set(pName.text.toLowerCase(), {
                    name: pName.text,
                    nameLower: pName.text.toLowerCase(),
                    kind: 'parameter',
                    line: pName.line,
                    column: pName.column,
                    node: param,
                });
            }
        }
    }
    // Collect body
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isNode)(child) && child.kind !== syntaxKind_js_1.SyntaxKind.ParameterList
            && child.kind !== syntaxKind_js_1.SyntaxKind.ReturnTypeClause) {
            collectFromNode(child, childScope);
        }
    }
}
function collectFunctionExpression(node, parentScope) {
    const childScope = {
        owner: node,
        ownerName: '',
        parent: parentScope,
        declarations: new Map(),
        references: [],
        children: [],
    };
    parentScope.children.push(childScope);
    const paramList = node.findChild(syntaxKind_js_1.SyntaxKind.ParameterList);
    if (paramList) {
        for (const param of paramList.findAllChildren(syntaxKind_js_1.SyntaxKind.Parameter)) {
            const pName = param.findToken(tokenKind_js_1.TokenKind.Identifier);
            if (pName) {
                childScope.declarations.set(pName.text.toLowerCase(), {
                    name: pName.text,
                    nameLower: pName.text.toLowerCase(),
                    kind: 'parameter',
                    line: pName.line,
                    column: pName.column,
                    node: param,
                });
            }
        }
    }
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isNode)(child) && child.kind !== syntaxKind_js_1.SyntaxKind.ParameterList
            && child.kind !== syntaxKind_js_1.SyntaxKind.ReturnTypeClause) {
            collectFromNode(child, childScope);
        }
    }
}
function collectAssignment(node, scope) {
    // The first child is the target — if it's a plain identifier, it's a variable declaration
    const firstChild = node.childNodes[0];
    if (firstChild && firstChild.kind === syntaxKind_js_1.SyntaxKind.IdentifierExpression) {
        const nameToken = firstChild.findToken(tokenKind_js_1.TokenKind.Identifier);
        if (nameToken && !scope.declarations.has(nameToken.text.toLowerCase())) {
            scope.declarations.set(nameToken.text.toLowerCase(), {
                name: nameToken.text,
                nameLower: nameToken.text.toLowerCase(),
                kind: 'variable',
                line: nameToken.line,
                column: nameToken.column,
                node: firstChild,
            });
        }
    }
}
function collectForVariable(node, scope) {
    const nameToken = node.findToken(tokenKind_js_1.TokenKind.Identifier);
    if (nameToken && !scope.declarations.has(nameToken.text.toLowerCase())) {
        scope.declarations.set(nameToken.text.toLowerCase(), {
            name: nameToken.text,
            nameLower: nameToken.text.toLowerCase(),
            kind: 'for-variable',
            line: nameToken.line,
            column: nameToken.column,
            node,
        });
    }
}
function collectForEachVariable(node, scope) {
    // Iterator variable is the identifier after 'each'
    let foundEach = false;
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isToken)(child) && child.kind === tokenKind_js_1.TokenKind.Each) {
            foundEach = true;
            continue;
        }
        if (foundEach && (0, syntaxNode_js_1.isToken)(child) && child.kind === tokenKind_js_1.TokenKind.Identifier) {
            if (!scope.declarations.has(child.text.toLowerCase())) {
                scope.declarations.set(child.text.toLowerCase(), {
                    name: child.text,
                    nameLower: child.text.toLowerCase(),
                    kind: 'for-variable',
                    line: child.line,
                    column: child.column,
                    node,
                });
            }
            break;
        }
    }
}
function collectCatchVariable(node, scope) {
    const nameToken = node.findToken(tokenKind_js_1.TokenKind.Identifier);
    if (nameToken && !scope.declarations.has(nameToken.text.toLowerCase())) {
        scope.declarations.set(nameToken.text.toLowerCase(), {
            name: nameToken.text,
            nameLower: nameToken.text.toLowerCase(),
            kind: 'catch-variable',
            line: nameToken.line,
            column: nameToken.column,
            node,
        });
    }
}
function collectDimVariable(node, scope) {
    const nameToken = node.findToken(tokenKind_js_1.TokenKind.Identifier);
    if (nameToken && !scope.declarations.has(nameToken.text.toLowerCase())) {
        scope.declarations.set(nameToken.text.toLowerCase(), {
            name: nameToken.text,
            nameLower: nameToken.text.toLowerCase(),
            kind: 'dim-variable',
            line: nameToken.line,
            column: nameToken.column,
            node,
        });
    }
}
function collectReferences(node, scope) {
    if (node.kind === syntaxKind_js_1.SyntaxKind.IdentifierExpression) {
        const token = node.findToken(tokenKind_js_1.TokenKind.Identifier);
        if (token) {
            scope.references.push({
                name: token.text,
                nameLower: token.text.toLowerCase(),
                line: token.line,
                column: token.column,
                node,
            });
        }
    }
    // For call expressions, collect the callee as a reference
    if (node.kind === syntaxKind_js_1.SyntaxKind.CallExpression) {
        const callee = node.childNodes[0];
        if (callee && callee.kind === syntaxKind_js_1.SyntaxKind.IdentifierExpression) {
            const token = callee.findToken(tokenKind_js_1.TokenKind.Identifier);
            if (token) {
                scope.references.push({
                    name: token.text,
                    nameLower: token.text.toLowerCase(),
                    line: token.line,
                    column: token.column,
                    node: callee,
                });
            }
        }
    }
}
function getNodeLine(node) {
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isToken)(child))
            return child.line;
        if ((0, syntaxNode_js_1.isNode)(child))
            return getNodeLine(child);
    }
    return 0;
}
function getNodeEndLine(node) {
    for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if ((0, syntaxNode_js_1.isToken)(child))
            return child.line;
        if ((0, syntaxNode_js_1.isNode)(child))
            return getNodeEndLine(child);
    }
    return 0;
}
//# sourceMappingURL=scope.js.map
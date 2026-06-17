"use strict";
/**
 * AST visitor — a pattern for walking the typed AST.
 *
 * Implement the methods you care about and call `walk()` on the root node.
 * The walker visits every node in the tree, depth-first.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.walk = walk;
exports.findAll = findAll;
const syntaxNode_js_1 = require("./syntaxNode.js");
const syntaxKind_js_1 = require("./syntaxKind.js");
const ast_js_1 = require("./ast.js");
/**
 * Walks the CST depth-first, calling the appropriate visitor method for
 * each node. If a visitor method returns `false`, children are skipped.
 */
function walk(root, visitor) {
    walkNode(root, visitor);
}
function walkNode(node, visitor) {
    const result = dispatchVisitor(node, visitor);
    if (result === false)
        return; // skip children
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isNode)(child)) {
            walkNode(child, visitor);
        }
    }
}
function dispatchVisitor(node, visitor) {
    switch (node.kind) {
        case syntaxKind_js_1.SyntaxKind.SourceFile: return visitor.visitSourceFile?.(new ast_js_1.SourceFile(node));
        case syntaxKind_js_1.SyntaxKind.FunctionDeclaration: return visitor.visitFunctionDeclaration?.(new ast_js_1.FunctionDeclaration(node));
        case syntaxKind_js_1.SyntaxKind.FunctionExpression: return visitor.visitFunctionExpression?.(new ast_js_1.FunctionExpression(node));
        case syntaxKind_js_1.SyntaxKind.IfStatement: return visitor.visitIfStatement?.(new ast_js_1.IfStatement(node));
        case syntaxKind_js_1.SyntaxKind.ElseIfClause: return visitor.visitElseIfClause?.(new ast_js_1.ElseIfClause(node));
        case syntaxKind_js_1.SyntaxKind.ElseClause: return visitor.visitElseClause?.(new ast_js_1.ElseClause(node));
        case syntaxKind_js_1.SyntaxKind.ForStatement: return visitor.visitForStatement?.(new ast_js_1.ForStatement(node));
        case syntaxKind_js_1.SyntaxKind.ForEachStatement: return visitor.visitForEachStatement?.(new ast_js_1.ForEachStatement(node));
        case syntaxKind_js_1.SyntaxKind.WhileStatement: return visitor.visitWhileStatement?.(new ast_js_1.WhileStatement(node));
        case syntaxKind_js_1.SyntaxKind.TryStatement: return visitor.visitTryStatement?.(new ast_js_1.TryStatement(node));
        case syntaxKind_js_1.SyntaxKind.CatchClause: return visitor.visitCatchClause?.(new ast_js_1.CatchClause(node));
        case syntaxKind_js_1.SyntaxKind.ReturnStatement: return visitor.visitReturnStatement?.(new ast_js_1.ReturnStatement(node));
        case syntaxKind_js_1.SyntaxKind.PrintStatement: return visitor.visitPrintStatement?.(new ast_js_1.PrintStatement(node));
        case syntaxKind_js_1.SyntaxKind.ThrowStatement: return visitor.visitThrowStatement?.(new ast_js_1.ThrowStatement(node));
        case syntaxKind_js_1.SyntaxKind.DimStatement: return visitor.visitDimStatement?.(new ast_js_1.DimStatement(node));
        case syntaxKind_js_1.SyntaxKind.GotoStatement: return visitor.visitGotoStatement?.(new ast_js_1.GotoStatement(node));
        case syntaxKind_js_1.SyntaxKind.LabelStatement: return visitor.visitLabelStatement?.(new ast_js_1.LabelStatement(node));
        case syntaxKind_js_1.SyntaxKind.StopStatement: return visitor.visitStopStatement?.(new ast_js_1.StopStatement(node));
        case syntaxKind_js_1.SyntaxKind.EndStatement: return visitor.visitEndStatement?.(new ast_js_1.EndStatement(node));
        case syntaxKind_js_1.SyntaxKind.ExitForStatement: return visitor.visitExitForStatement?.(new ast_js_1.ExitForStatement(node));
        case syntaxKind_js_1.SyntaxKind.ExitWhileStatement: return visitor.visitExitWhileStatement?.(new ast_js_1.ExitWhileStatement(node));
        case syntaxKind_js_1.SyntaxKind.ContinueForStatement: return visitor.visitContinueForStatement?.(new ast_js_1.ContinueForStatement(node));
        case syntaxKind_js_1.SyntaxKind.ContinueWhileStatement: return visitor.visitContinueWhileStatement?.(new ast_js_1.ContinueWhileStatement(node));
        case syntaxKind_js_1.SyntaxKind.AssignmentStatement: return visitor.visitAssignmentStatement?.(new ast_js_1.AssignmentStatement(node));
        case syntaxKind_js_1.SyntaxKind.ExpressionStatement: return visitor.visitExpressionStatement?.(new ast_js_1.ExpressionStatement(node));
        case syntaxKind_js_1.SyntaxKind.BinaryExpression: return visitor.visitBinaryExpression?.(new ast_js_1.BinaryExpression(node));
        case syntaxKind_js_1.SyntaxKind.UnaryExpression: return visitor.visitUnaryExpression?.(new ast_js_1.UnaryExpression(node));
        case syntaxKind_js_1.SyntaxKind.GroupingExpression: return visitor.visitGroupingExpression?.(new ast_js_1.GroupingExpression(node));
        case syntaxKind_js_1.SyntaxKind.CallExpression: return visitor.visitCallExpression?.(new ast_js_1.CallExpression(node));
        case syntaxKind_js_1.SyntaxKind.DotExpression: return visitor.visitDotExpression?.(new ast_js_1.DotExpression(node));
        case syntaxKind_js_1.SyntaxKind.IndexExpression: return visitor.visitIndexExpression?.(new ast_js_1.IndexExpression(node));
        case syntaxKind_js_1.SyntaxKind.OptionalChainingExpression: return visitor.visitOptionalChainingExpression?.(new ast_js_1.OptionalChainingExpression(node));
        case syntaxKind_js_1.SyntaxKind.IdentifierExpression: return visitor.visitIdentifierExpression?.(new ast_js_1.IdentifierExpression(node));
        case syntaxKind_js_1.SyntaxKind.LiteralExpression: return visitor.visitLiteralExpression?.(new ast_js_1.LiteralExpression(node));
        case syntaxKind_js_1.SyntaxKind.ArrayLiteral: return visitor.visitArrayLiteral?.(new ast_js_1.ArrayLiteral(node));
        case syntaxKind_js_1.SyntaxKind.AALiteral: return visitor.visitAALiteral?.(new ast_js_1.AALiteral(node));
        case syntaxKind_js_1.SyntaxKind.AAField: return visitor.visitAAField?.(new ast_js_1.AAField(node));
        default: return;
    }
}
/**
 * Collects all nodes of a specific type from the tree.
 * Convenience wrapper over `walk()`.
 */
function findAll(root, kind, wrapFn) {
    const results = [];
    for (const child of root.children) {
        if ((0, syntaxNode_js_1.isNode)(child)) {
            if (child.kind === kind)
                results.push(wrapFn(child));
            results.push(...findAll(child, kind, wrapFn));
        }
    }
    return results;
}
//# sourceMappingURL=visitor.js.map
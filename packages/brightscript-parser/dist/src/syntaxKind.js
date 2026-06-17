"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyntaxKind = void 0;
/**
 * Every CST node kind that the BrightScript parser can produce.
 *
 * These represent the *concrete* syntax — every token (including trivia)
 * is preserved in the tree. A SyntaxNode's children are an interleaved
 * sequence of child SyntaxNodes and Tokens.
 *
 * Grammar derived from:
 * - https://developer.roku.com/dev/docs/program-statements
 * - https://developer.roku.com/dev/docs/expressions-variables-types
 * - https://developer.roku.com/dev/docs/conditional-compilation
 */
var SyntaxKind;
(function (SyntaxKind) {
    // ── Top-level ───────────────────────────────────────────────────────────
    /** Root node of a parsed file. */
    SyntaxKind["SourceFile"] = "SourceFile";
    // ── Statements ──────────────────────────────────────────────────────────
    SyntaxKind["FunctionDeclaration"] = "FunctionDeclaration";
    SyntaxKind["ParameterList"] = "ParameterList";
    SyntaxKind["Parameter"] = "Parameter";
    SyntaxKind["ReturnTypeClause"] = "ReturnTypeClause";
    SyntaxKind["IfStatement"] = "IfStatement";
    SyntaxKind["ElseIfClause"] = "ElseIfClause";
    SyntaxKind["ElseClause"] = "ElseClause";
    SyntaxKind["ForStatement"] = "ForStatement";
    SyntaxKind["ForEachStatement"] = "ForEachStatement";
    SyntaxKind["WhileStatement"] = "WhileStatement";
    SyntaxKind["TryStatement"] = "TryStatement";
    SyntaxKind["CatchClause"] = "CatchClause";
    SyntaxKind["ReturnStatement"] = "ReturnStatement";
    SyntaxKind["PrintStatement"] = "PrintStatement";
    SyntaxKind["ThrowStatement"] = "ThrowStatement";
    SyntaxKind["DimStatement"] = "DimStatement";
    SyntaxKind["StopStatement"] = "StopStatement";
    SyntaxKind["EndStatement"] = "EndStatement";
    SyntaxKind["GotoStatement"] = "GotoStatement";
    SyntaxKind["LabelStatement"] = "LabelStatement";
    SyntaxKind["AssignmentStatement"] = "AssignmentStatement";
    SyntaxKind["ExpressionStatement"] = "ExpressionStatement";
    SyntaxKind["ExitForStatement"] = "ExitForStatement";
    SyntaxKind["ExitWhileStatement"] = "ExitWhileStatement";
    SyntaxKind["ContinueForStatement"] = "ContinueForStatement";
    SyntaxKind["ContinueWhileStatement"] = "ContinueWhileStatement";
    // ── Conditional compilation ─────────────────────────────────────────────
    SyntaxKind["ConditionalCompilation"] = "ConditionalCompilation";
    SyntaxKind["HashConstStatement"] = "HashConstStatement";
    SyntaxKind["HashErrorStatement"] = "HashErrorStatement";
    // ── Expressions ─────────────────────────────────────────────────────────
    SyntaxKind["BinaryExpression"] = "BinaryExpression";
    SyntaxKind["UnaryExpression"] = "UnaryExpression";
    SyntaxKind["GroupingExpression"] = "GroupingExpression";
    SyntaxKind["CallExpression"] = "CallExpression";
    SyntaxKind["DotExpression"] = "DotExpression";
    SyntaxKind["IndexExpression"] = "IndexExpression";
    SyntaxKind["OptionalChainingExpression"] = "OptionalChainingExpression";
    /** A function/sub expression used as an anonymous value. */
    SyntaxKind["FunctionExpression"] = "FunctionExpression";
    SyntaxKind["IdentifierExpression"] = "IdentifierExpression";
    SyntaxKind["LiteralExpression"] = "LiteralExpression";
    SyntaxKind["ArrayLiteral"] = "ArrayLiteral";
    SyntaxKind["AALiteral"] = "AALiteral";
    SyntaxKind["AAField"] = "AAField";
    SyntaxKind["ArgumentList"] = "ArgumentList";
    // ── Error recovery ──────────────────────────────────────────────────────
    /** Wraps one or more tokens that the parser could not understand. */
    SyntaxKind["ErrorNode"] = "ErrorNode";
})(SyntaxKind || (exports.SyntaxKind = SyntaxKind = {}));
//# sourceMappingURL=syntaxKind.js.map
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
export declare enum SyntaxKind {
    /** Root node of a parsed file. */
    SourceFile = "SourceFile",
    FunctionDeclaration = "FunctionDeclaration",
    ParameterList = "ParameterList",
    Parameter = "Parameter",
    ReturnTypeClause = "ReturnTypeClause",
    IfStatement = "IfStatement",
    ElseIfClause = "ElseIfClause",
    ElseClause = "ElseClause",
    ForStatement = "ForStatement",
    ForEachStatement = "ForEachStatement",
    WhileStatement = "WhileStatement",
    TryStatement = "TryStatement",
    CatchClause = "CatchClause",
    ReturnStatement = "ReturnStatement",
    PrintStatement = "PrintStatement",
    ThrowStatement = "ThrowStatement",
    DimStatement = "DimStatement",
    StopStatement = "StopStatement",
    EndStatement = "EndStatement",
    GotoStatement = "GotoStatement",
    LabelStatement = "LabelStatement",
    AssignmentStatement = "AssignmentStatement",
    ExpressionStatement = "ExpressionStatement",
    ExitForStatement = "ExitForStatement",
    ExitWhileStatement = "ExitWhileStatement",
    ContinueForStatement = "ContinueForStatement",
    ContinueWhileStatement = "ContinueWhileStatement",
    ConditionalCompilation = "ConditionalCompilation",
    HashConstStatement = "HashConstStatement",
    HashErrorStatement = "HashErrorStatement",
    BinaryExpression = "BinaryExpression",
    UnaryExpression = "UnaryExpression",
    GroupingExpression = "GroupingExpression",
    CallExpression = "CallExpression",
    DotExpression = "DotExpression",
    IndexExpression = "IndexExpression",
    OptionalChainingExpression = "OptionalChainingExpression",
    /** A function/sub expression used as an anonymous value. */
    FunctionExpression = "FunctionExpression",
    IdentifierExpression = "IdentifierExpression",
    LiteralExpression = "LiteralExpression",
    ArrayLiteral = "ArrayLiteral",
    AALiteral = "AALiteral",
    AAField = "AAField",
    ArgumentList = "ArgumentList",
    /** Wraps one or more tokens that the parser could not understand. */
    ErrorNode = "ErrorNode"
}
//# sourceMappingURL=syntaxKind.d.ts.map
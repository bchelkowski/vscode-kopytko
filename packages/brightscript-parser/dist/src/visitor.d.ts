/**
 * AST visitor — a pattern for walking the typed AST.
 *
 * Implement the methods you care about and call `walk()` on the root node.
 * The walker visits every node in the tree, depth-first.
 */
import { SyntaxNode } from './syntaxNode.js';
import { SyntaxKind } from './syntaxKind.js';
import { AstNode, SourceFile, FunctionDeclaration, FunctionExpression, IfStatement, ElseIfClause, ElseClause, ForStatement, ForEachStatement, WhileStatement, TryStatement, CatchClause, ReturnStatement, PrintStatement, ThrowStatement, DimStatement, GotoStatement, LabelStatement, StopStatement, EndStatement, ExitForStatement, ExitWhileStatement, ContinueForStatement, ContinueWhileStatement, AssignmentStatement, ExpressionStatement, BinaryExpression, UnaryExpression, GroupingExpression, CallExpression, DotExpression, IndexExpression, OptionalChainingExpression, IdentifierExpression, LiteralExpression, ArrayLiteral, AALiteral, AAField } from './ast.js';
/**
 * Visitor interface. Implement only the methods you need.
 * Each method receives the typed AST node.
 * Return `false` from any method to skip visiting that node's children.
 */
export interface AstVisitor {
    visitSourceFile?(node: SourceFile): void | false;
    visitFunctionDeclaration?(node: FunctionDeclaration): void | false;
    visitFunctionExpression?(node: FunctionExpression): void | false;
    visitIfStatement?(node: IfStatement): void | false;
    visitElseIfClause?(node: ElseIfClause): void | false;
    visitElseClause?(node: ElseClause): void | false;
    visitForStatement?(node: ForStatement): void | false;
    visitForEachStatement?(node: ForEachStatement): void | false;
    visitWhileStatement?(node: WhileStatement): void | false;
    visitTryStatement?(node: TryStatement): void | false;
    visitCatchClause?(node: CatchClause): void | false;
    visitReturnStatement?(node: ReturnStatement): void | false;
    visitPrintStatement?(node: PrintStatement): void | false;
    visitThrowStatement?(node: ThrowStatement): void | false;
    visitDimStatement?(node: DimStatement): void | false;
    visitGotoStatement?(node: GotoStatement): void | false;
    visitLabelStatement?(node: LabelStatement): void | false;
    visitStopStatement?(node: StopStatement): void | false;
    visitEndStatement?(node: EndStatement): void | false;
    visitExitForStatement?(node: ExitForStatement): void | false;
    visitExitWhileStatement?(node: ExitWhileStatement): void | false;
    visitContinueForStatement?(node: ContinueForStatement): void | false;
    visitContinueWhileStatement?(node: ContinueWhileStatement): void | false;
    visitAssignmentStatement?(node: AssignmentStatement): void | false;
    visitExpressionStatement?(node: ExpressionStatement): void | false;
    visitBinaryExpression?(node: BinaryExpression): void | false;
    visitUnaryExpression?(node: UnaryExpression): void | false;
    visitGroupingExpression?(node: GroupingExpression): void | false;
    visitCallExpression?(node: CallExpression): void | false;
    visitDotExpression?(node: DotExpression): void | false;
    visitIndexExpression?(node: IndexExpression): void | false;
    visitOptionalChainingExpression?(node: OptionalChainingExpression): void | false;
    visitIdentifierExpression?(node: IdentifierExpression): void | false;
    visitLiteralExpression?(node: LiteralExpression): void | false;
    visitArrayLiteral?(node: ArrayLiteral): void | false;
    visitAALiteral?(node: AALiteral): void | false;
    visitAAField?(node: AAField): void | false;
}
/**
 * Walks the CST depth-first, calling the appropriate visitor method for
 * each node. If a visitor method returns `false`, children are skipped.
 */
export declare function walk(root: SyntaxNode, visitor: AstVisitor): void;
/**
 * Collects all nodes of a specific type from the tree.
 * Convenience wrapper over `walk()`.
 */
export declare function findAll<T extends AstNode>(root: SyntaxNode, kind: SyntaxKind, wrapFn: (node: SyntaxNode) => T): T[];
//# sourceMappingURL=visitor.d.ts.map
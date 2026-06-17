/**
 * AST visitor — a pattern for walking the typed AST.
 *
 * Implement the methods you care about and call `walk()` on the root node.
 * The walker visits every node in the tree, depth-first.
 */

import { SyntaxNode, isNode } from './syntaxNode.js';
import { SyntaxKind } from './syntaxKind.js';
import {
  AstNode,
  SourceFile, FunctionDeclaration, FunctionExpression,
  IfStatement, ElseIfClause, ElseClause,
  ForStatement, ForEachStatement, WhileStatement,
  TryStatement, CatchClause,
  ReturnStatement, PrintStatement, ThrowStatement,
  DimStatement, GotoStatement, LabelStatement,
  StopStatement, EndStatement,
  ExitForStatement, ExitWhileStatement,
  ContinueForStatement, ContinueWhileStatement,
  AssignmentStatement, ExpressionStatement,
  BinaryExpression, UnaryExpression, GroupingExpression,
  CallExpression, DotExpression, IndexExpression,
  OptionalChainingExpression, IdentifierExpression, LiteralExpression,
  ArrayLiteral, AALiteral, AAField,
} from './ast.js';

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
export function walk(root: SyntaxNode, visitor: AstVisitor): void {
  walkNode(root, visitor);
}

function walkNode(node: SyntaxNode, visitor: AstVisitor): void {
  const result = dispatchVisitor(node, visitor);
  if (result === false) return; // skip children

  for (const child of node.children) {
    if (isNode(child)) {
      walkNode(child, visitor);
    }
  }
}

function dispatchVisitor(node: SyntaxNode, visitor: AstVisitor): void | false {
  switch (node.kind) {
    case SyntaxKind.SourceFile:                return visitor.visitSourceFile?.(new SourceFile(node));
    case SyntaxKind.FunctionDeclaration:       return visitor.visitFunctionDeclaration?.(new FunctionDeclaration(node));
    case SyntaxKind.FunctionExpression:        return visitor.visitFunctionExpression?.(new FunctionExpression(node));
    case SyntaxKind.IfStatement:               return visitor.visitIfStatement?.(new IfStatement(node));
    case SyntaxKind.ElseIfClause:              return visitor.visitElseIfClause?.(new ElseIfClause(node));
    case SyntaxKind.ElseClause:                return visitor.visitElseClause?.(new ElseClause(node));
    case SyntaxKind.ForStatement:              return visitor.visitForStatement?.(new ForStatement(node));
    case SyntaxKind.ForEachStatement:          return visitor.visitForEachStatement?.(new ForEachStatement(node));
    case SyntaxKind.WhileStatement:            return visitor.visitWhileStatement?.(new WhileStatement(node));
    case SyntaxKind.TryStatement:              return visitor.visitTryStatement?.(new TryStatement(node));
    case SyntaxKind.CatchClause:               return visitor.visitCatchClause?.(new CatchClause(node));
    case SyntaxKind.ReturnStatement:           return visitor.visitReturnStatement?.(new ReturnStatement(node));
    case SyntaxKind.PrintStatement:            return visitor.visitPrintStatement?.(new PrintStatement(node));
    case SyntaxKind.ThrowStatement:            return visitor.visitThrowStatement?.(new ThrowStatement(node));
    case SyntaxKind.DimStatement:              return visitor.visitDimStatement?.(new DimStatement(node));
    case SyntaxKind.GotoStatement:             return visitor.visitGotoStatement?.(new GotoStatement(node));
    case SyntaxKind.LabelStatement:            return visitor.visitLabelStatement?.(new LabelStatement(node));
    case SyntaxKind.StopStatement:             return visitor.visitStopStatement?.(new StopStatement(node));
    case SyntaxKind.EndStatement:              return visitor.visitEndStatement?.(new EndStatement(node));
    case SyntaxKind.ExitForStatement:          return visitor.visitExitForStatement?.(new ExitForStatement(node));
    case SyntaxKind.ExitWhileStatement:        return visitor.visitExitWhileStatement?.(new ExitWhileStatement(node));
    case SyntaxKind.ContinueForStatement:      return visitor.visitContinueForStatement?.(new ContinueForStatement(node));
    case SyntaxKind.ContinueWhileStatement:    return visitor.visitContinueWhileStatement?.(new ContinueWhileStatement(node));
    case SyntaxKind.AssignmentStatement:        return visitor.visitAssignmentStatement?.(new AssignmentStatement(node));
    case SyntaxKind.ExpressionStatement:        return visitor.visitExpressionStatement?.(new ExpressionStatement(node));
    case SyntaxKind.BinaryExpression:           return visitor.visitBinaryExpression?.(new BinaryExpression(node));
    case SyntaxKind.UnaryExpression:            return visitor.visitUnaryExpression?.(new UnaryExpression(node));
    case SyntaxKind.GroupingExpression:          return visitor.visitGroupingExpression?.(new GroupingExpression(node));
    case SyntaxKind.CallExpression:             return visitor.visitCallExpression?.(new CallExpression(node));
    case SyntaxKind.DotExpression:              return visitor.visitDotExpression?.(new DotExpression(node));
    case SyntaxKind.IndexExpression:            return visitor.visitIndexExpression?.(new IndexExpression(node));
    case SyntaxKind.OptionalChainingExpression: return visitor.visitOptionalChainingExpression?.(new OptionalChainingExpression(node));
    case SyntaxKind.IdentifierExpression:       return visitor.visitIdentifierExpression?.(new IdentifierExpression(node));
    case SyntaxKind.LiteralExpression:          return visitor.visitLiteralExpression?.(new LiteralExpression(node));
    case SyntaxKind.ArrayLiteral:              return visitor.visitArrayLiteral?.(new ArrayLiteral(node));
    case SyntaxKind.AALiteral:                 return visitor.visitAALiteral?.(new AALiteral(node));
    case SyntaxKind.AAField:                   return visitor.visitAAField?.(new AAField(node));
    default:                                   return;
  }
}

/**
 * Collects all nodes of a specific type from the tree.
 * Convenience wrapper over `walk()`.
 */
export function findAll<T extends AstNode>(
  root: SyntaxNode,
  kind: SyntaxKind,
  wrapFn: (node: SyntaxNode) => T,
): T[] {
  const results: T[] = [];
  for (const child of root.children) {
    if (isNode(child)) {
      if (child.kind === kind) results.push(wrapFn(child));
      results.push(...findAll(child, kind, wrapFn));
    }
  }
  return results;
}

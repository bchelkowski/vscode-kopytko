/**
 * Typed AST wrappers — zero-cost views over CST nodes.
 *
 * Each wrapper provides a convenient, type-safe API for accessing the
 * structural parts of a BrightScript construct without manually walking
 * the CST children array.
 *
 * The CST is always accessible via the `.syntax` property for cases
 * where the typed API is insufficient (e.g., formatting needs trivia).
 */
import { SyntaxNode } from './syntaxNode.js';
import { Token } from './token.js';
/** Base class for all typed AST wrappers. */
export declare abstract class AstNode {
    readonly syntax: SyntaxNode;
    constructor(syntax: SyntaxNode);
    get pos(): number;
    get end(): number;
    getText(): string;
}
export declare class SourceFile extends AstNode {
    get statements(): AstNode[];
}
export declare class FunctionDeclaration extends AstNode {
    get nameToken(): Token | undefined;
    get name(): string;
    get isFunction(): boolean;
    get isSub(): boolean;
    get parameterList(): ParameterList | undefined;
    get params(): Parameter[];
    get returnTypeClause(): ReturnTypeClause | undefined;
    get returnType(): string | undefined;
    get body(): AstNode[];
}
export declare class FunctionExpression extends AstNode {
    get isFunction(): boolean;
    get isSub(): boolean;
    get parameterList(): ParameterList | undefined;
    get params(): Parameter[];
    get returnType(): string | undefined;
    get body(): AstNode[];
}
export declare class ParameterList extends AstNode {
    get params(): Parameter[];
}
export declare class Parameter extends AstNode {
    get nameToken(): Token | undefined;
    get name(): string;
    get typeName(): string | undefined;
    get hasDefault(): boolean;
}
export declare class ReturnTypeClause extends AstNode {
    get typeName(): string;
}
export declare class IfStatement extends AstNode {
    get condition(): AstNode | null;
    get body(): AstNode[];
    get elseIfClauses(): ElseIfClause[];
    get elseClause(): ElseClause | undefined;
}
export declare class ElseIfClause extends AstNode {
    get condition(): AstNode | null;
    get body(): AstNode[];
}
export declare class ElseClause extends AstNode {
    get body(): AstNode[];
}
export declare class ForStatement extends AstNode {
    get variableToken(): Token | undefined;
    get variable(): string;
    get body(): AstNode[];
}
export declare class ForEachStatement extends AstNode {
    get variableToken(): Token | undefined;
    get variable(): string;
    get body(): AstNode[];
}
export declare class WhileStatement extends AstNode {
    get condition(): AstNode | null;
    get body(): AstNode[];
}
export declare class TryStatement extends AstNode {
    get body(): AstNode[];
    get catchClause(): CatchClause | undefined;
}
export declare class CatchClause extends AstNode {
    get variableToken(): Token | undefined;
    get variable(): string;
    get body(): AstNode[];
}
export declare class ReturnStatement extends AstNode {
    get value(): AstNode | null;
    get hasValue(): boolean;
}
export declare class PrintStatement extends AstNode {
    get expressions(): AstNode[];
}
export declare class ThrowStatement extends AstNode {
    get expression(): AstNode | null;
}
export declare class DimStatement extends AstNode {
    get variableToken(): Token | undefined;
    get variable(): string;
}
export declare class GotoStatement extends AstNode {
    get label(): string;
}
export declare class LabelStatement extends AstNode {
    get name(): string;
}
export declare class StopStatement extends AstNode {
}
export declare class EndStatement extends AstNode {
}
export declare class ExitForStatement extends AstNode {
}
export declare class ExitWhileStatement extends AstNode {
}
export declare class ContinueForStatement extends AstNode {
}
export declare class ContinueWhileStatement extends AstNode {
}
export declare class AssignmentStatement extends AstNode {
    get target(): AstNode | null;
    get operatorToken(): Token | undefined;
    get isCompound(): boolean;
    get value(): AstNode | null;
}
export declare class ExpressionStatement extends AstNode {
    get expression(): AstNode | null;
}
export declare class BinaryExpression extends AstNode {
    get left(): AstNode | null;
    get operatorToken(): Token | undefined;
    get operator(): string;
    get right(): AstNode | null;
}
export declare class UnaryExpression extends AstNode {
    get operatorToken(): Token | undefined;
    get operator(): string;
    get operand(): AstNode | null;
}
export declare class GroupingExpression extends AstNode {
    get expression(): AstNode | null;
}
export declare class CallExpression extends AstNode {
    get callee(): AstNode | null;
    get argumentList(): ArgumentList | undefined;
    get args(): AstNode[];
}
export declare class ArgumentList extends AstNode {
    get args(): AstNode[];
}
export declare class DotExpression extends AstNode {
    get object(): AstNode | null;
    get memberToken(): Token | undefined;
    get member(): string;
}
export declare class IndexExpression extends AstNode {
    get object(): AstNode | null;
    get indices(): AstNode[];
}
export declare class OptionalChainingExpression extends AstNode {
    get object(): AstNode | null;
}
export declare class IdentifierExpression extends AstNode {
    get nameToken(): Token | undefined;
    get name(): string;
}
export declare class LiteralExpression extends AstNode {
    get token(): Token | undefined;
    get value(): string;
}
export declare class ArrayLiteral extends AstNode {
    get elements(): AstNode[];
}
export declare class AALiteral extends AstNode {
    get fields(): AAField[];
}
export declare class AAField extends AstNode {
    get keyToken(): Token | undefined;
    get key(): string;
    get value(): AstNode | null;
}
export declare class ConditionalCompilation extends AstNode {
}
export declare class HashConstStatement extends AstNode {
}
export declare class HashErrorStatement extends AstNode {
}
export declare class ErrorNodeWrapper extends AstNode {
}
/** Wraps a raw CST SyntaxNode in the appropriate typed AST wrapper. */
export declare function wrapNode(node: SyntaxNode): AstNode | null;
//# sourceMappingURL=ast.d.ts.map
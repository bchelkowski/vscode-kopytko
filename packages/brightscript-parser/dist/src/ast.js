"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorNodeWrapper = exports.HashErrorStatement = exports.HashConstStatement = exports.ConditionalCompilation = exports.AAField = exports.AALiteral = exports.ArrayLiteral = exports.LiteralExpression = exports.IdentifierExpression = exports.OptionalChainingExpression = exports.IndexExpression = exports.DotExpression = exports.ArgumentList = exports.CallExpression = exports.GroupingExpression = exports.UnaryExpression = exports.BinaryExpression = exports.ExpressionStatement = exports.AssignmentStatement = exports.ContinueWhileStatement = exports.ContinueForStatement = exports.ExitWhileStatement = exports.ExitForStatement = exports.EndStatement = exports.StopStatement = exports.LabelStatement = exports.GotoStatement = exports.DimStatement = exports.ThrowStatement = exports.PrintStatement = exports.ReturnStatement = exports.CatchClause = exports.TryStatement = exports.WhileStatement = exports.ForEachStatement = exports.ForStatement = exports.ElseClause = exports.ElseIfClause = exports.IfStatement = exports.ReturnTypeClause = exports.Parameter = exports.ParameterList = exports.FunctionExpression = exports.FunctionDeclaration = exports.SourceFile = exports.AstNode = void 0;
exports.wrapNode = wrapNode;
const syntaxKind_js_1 = require("./syntaxKind.js");
const syntaxNode_js_1 = require("./syntaxNode.js");
const tokenKind_js_1 = require("./tokenKind.js");
// ─── Base ───────────────────────────────────────────────────────────────────
/** Base class for all typed AST wrappers. */
class AstNode {
    syntax;
    constructor(syntax) {
        this.syntax = syntax;
    }
    get pos() { return this.syntax.pos; }
    get end() { return this.syntax.end; }
    getText() { return this.syntax.getText(); }
}
exports.AstNode = AstNode;
// ─── Top-level ──────────────────────────────────────────────────────────────
class SourceFile extends AstNode {
    get statements() {
        return this.syntax.childNodes
            .filter(n => n.kind !== syntaxKind_js_1.SyntaxKind.ErrorNode)
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.SourceFile = SourceFile;
// ─── Function / Sub ─────────────────────────────────────────────────────────
class FunctionDeclaration extends AstNode {
    get nameToken() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Identifier);
    }
    get name() {
        return this.nameToken?.text ?? '';
    }
    get isFunction() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Function) !== undefined;
    }
    get isSub() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Sub) !== undefined;
    }
    get parameterList() {
        const node = this.syntax.findChild(syntaxKind_js_1.SyntaxKind.ParameterList);
        return node ? new ParameterList(node) : undefined;
    }
    get params() {
        return this.parameterList?.params ?? [];
    }
    get returnTypeClause() {
        const node = this.syntax.findChild(syntaxKind_js_1.SyntaxKind.ReturnTypeClause);
        return node ? new ReturnTypeClause(node) : undefined;
    }
    get returnType() {
        return this.returnTypeClause?.typeName;
    }
    get body() {
        return this.syntax.childNodes
            .filter(n => n.kind !== syntaxKind_js_1.SyntaxKind.ParameterList && n.kind !== syntaxKind_js_1.SyntaxKind.ReturnTypeClause)
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.FunctionDeclaration = FunctionDeclaration;
class FunctionExpression extends AstNode {
    get isFunction() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Function) !== undefined;
    }
    get isSub() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Sub) !== undefined;
    }
    get parameterList() {
        const node = this.syntax.findChild(syntaxKind_js_1.SyntaxKind.ParameterList);
        return node ? new ParameterList(node) : undefined;
    }
    get params() {
        return this.parameterList?.params ?? [];
    }
    get returnType() {
        const clause = this.syntax.findChild(syntaxKind_js_1.SyntaxKind.ReturnTypeClause);
        return clause ? new ReturnTypeClause(clause).typeName : undefined;
    }
    get body() {
        return this.syntax.childNodes
            .filter(n => n.kind !== syntaxKind_js_1.SyntaxKind.ParameterList && n.kind !== syntaxKind_js_1.SyntaxKind.ReturnTypeClause)
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.FunctionExpression = FunctionExpression;
class ParameterList extends AstNode {
    get params() {
        return this.syntax.findAllChildren(syntaxKind_js_1.SyntaxKind.Parameter).map(n => new Parameter(n));
    }
}
exports.ParameterList = ParameterList;
class Parameter extends AstNode {
    get nameToken() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Identifier);
    }
    get name() {
        return this.nameToken?.text ?? '';
    }
    get typeName() {
        const asToken = this.syntax.findToken(tokenKind_js_1.TokenKind.As);
        if (!asToken)
            return undefined;
        // The type name is the token after 'as'
        const children = this.syntax.children;
        const asIdx = children.indexOf(asToken);
        if (asIdx >= 0 && asIdx + 1 < children.length) {
            const typeToken = children[asIdx + 1];
            if ((0, syntaxNode_js_1.isToken)(typeToken))
                return typeToken.text;
        }
        return undefined;
    }
    get hasDefault() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Equal) !== undefined;
    }
}
exports.Parameter = Parameter;
class ReturnTypeClause extends AstNode {
    get typeName() {
        const children = this.syntax.children;
        // Second child after 'as' keyword
        if (children.length >= 2 && (0, syntaxNode_js_1.isToken)(children[1]))
            return children[1].text;
        return '';
    }
}
exports.ReturnTypeClause = ReturnTypeClause;
// ─── If / Else ──────────────────────────────────────────────────────────────
class IfStatement extends AstNode {
    get condition() {
        // First child node that is an expression (skip the 'if' token)
        for (const child of this.syntax.childNodes) {
            if (child.kind !== syntaxKind_js_1.SyntaxKind.ElseIfClause && child.kind !== syntaxKind_js_1.SyntaxKind.ElseClause) {
                const wrapped = wrapNode(child);
                if (wrapped)
                    return wrapped;
            }
        }
        return null;
    }
    get body() {
        return this.syntax.childNodes
            .filter(n => n.kind !== syntaxKind_js_1.SyntaxKind.ElseIfClause && n.kind !== syntaxKind_js_1.SyntaxKind.ElseClause
            && !isExpressionKind(n.kind))
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
    get elseIfClauses() {
        return this.syntax.findAllChildren(syntaxKind_js_1.SyntaxKind.ElseIfClause).map(n => new ElseIfClause(n));
    }
    get elseClause() {
        const node = this.syntax.findChild(syntaxKind_js_1.SyntaxKind.ElseClause);
        return node ? new ElseClause(node) : undefined;
    }
}
exports.IfStatement = IfStatement;
class ElseIfClause extends AstNode {
    get condition() {
        for (const child of this.syntax.childNodes) {
            const wrapped = wrapNode(child);
            if (wrapped)
                return wrapped;
        }
        return null;
    }
    get body() {
        return this.syntax.childNodes
            .filter(n => !isExpressionKind(n.kind))
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.ElseIfClause = ElseIfClause;
class ElseClause extends AstNode {
    get body() {
        return this.syntax.childNodes
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.ElseClause = ElseClause;
// ─── Loops ──────────────────────────────────────────────────────────────────
class ForStatement extends AstNode {
    get variableToken() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Identifier);
    }
    get variable() {
        return this.variableToken?.text ?? '';
    }
    get body() {
        return getBodyStatements(this.syntax);
    }
}
exports.ForStatement = ForStatement;
class ForEachStatement extends AstNode {
    get variableToken() {
        // The iterator variable is the first identifier after 'each'
        let foundEach = false;
        for (const child of this.syntax.children) {
            if ((0, syntaxNode_js_1.isToken)(child) && child.kind === tokenKind_js_1.TokenKind.Each) {
                foundEach = true;
                continue;
            }
            if (foundEach && (0, syntaxNode_js_1.isToken)(child) && child.kind === tokenKind_js_1.TokenKind.Identifier)
                return child;
        }
        return undefined;
    }
    get variable() {
        return this.variableToken?.text ?? '';
    }
    get body() {
        return getBodyStatements(this.syntax);
    }
}
exports.ForEachStatement = ForEachStatement;
class WhileStatement extends AstNode {
    get condition() {
        for (const child of this.syntax.childNodes) {
            const wrapped = wrapNode(child);
            if (wrapped)
                return wrapped;
        }
        return null;
    }
    get body() {
        return getBodyStatements(this.syntax);
    }
}
exports.WhileStatement = WhileStatement;
// ─── Try / Catch ────────────────────────────────────────────────────────────
class TryStatement extends AstNode {
    get body() {
        return this.syntax.childNodes
            .filter(n => n.kind !== syntaxKind_js_1.SyntaxKind.CatchClause)
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
    get catchClause() {
        const node = this.syntax.findChild(syntaxKind_js_1.SyntaxKind.CatchClause);
        return node ? new CatchClause(node) : undefined;
    }
}
exports.TryStatement = TryStatement;
class CatchClause extends AstNode {
    get variableToken() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Identifier);
    }
    get variable() {
        return this.variableToken?.text ?? '';
    }
    get body() {
        return getBodyStatements(this.syntax);
    }
}
exports.CatchClause = CatchClause;
// ─── Simple statements ──────────────────────────────────────────────────────
class ReturnStatement extends AstNode {
    get value() {
        const expr = this.syntax.childNodes[0];
        return expr ? wrapNode(expr) : null;
    }
    get hasValue() {
        return this.syntax.childNodes.length > 0;
    }
}
exports.ReturnStatement = ReturnStatement;
class PrintStatement extends AstNode {
    get expressions() {
        return this.syntax.childNodes
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.PrintStatement = PrintStatement;
class ThrowStatement extends AstNode {
    get expression() {
        const expr = this.syntax.childNodes[0];
        return expr ? wrapNode(expr) : null;
    }
}
exports.ThrowStatement = ThrowStatement;
class DimStatement extends AstNode {
    get variableToken() {
        return this.syntax.findToken(tokenKind_js_1.TokenKind.Identifier);
    }
    get variable() {
        return this.variableToken?.text ?? '';
    }
}
exports.DimStatement = DimStatement;
class GotoStatement extends AstNode {
    get label() {
        const id = this.syntax.findToken(tokenKind_js_1.TokenKind.Identifier);
        return id?.text ?? '';
    }
}
exports.GotoStatement = GotoStatement;
class LabelStatement extends AstNode {
    get name() {
        const id = this.syntax.findToken(tokenKind_js_1.TokenKind.Identifier);
        return id?.text ?? '';
    }
}
exports.LabelStatement = LabelStatement;
class StopStatement extends AstNode {
}
exports.StopStatement = StopStatement;
class EndStatement extends AstNode {
}
exports.EndStatement = EndStatement;
class ExitForStatement extends AstNode {
}
exports.ExitForStatement = ExitForStatement;
class ExitWhileStatement extends AstNode {
}
exports.ExitWhileStatement = ExitWhileStatement;
class ContinueForStatement extends AstNode {
}
exports.ContinueForStatement = ContinueForStatement;
class ContinueWhileStatement extends AstNode {
}
exports.ContinueWhileStatement = ContinueWhileStatement;
// ─── Assignment ─────────────────────────────────────────────────────────────
class AssignmentStatement extends AstNode {
    get target() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
    get operatorToken() {
        for (const child of this.syntax.children) {
            if ((0, syntaxNode_js_1.isToken)(child) && (child.kind === tokenKind_js_1.TokenKind.Equal
                || child.kind === tokenKind_js_1.TokenKind.PlusEqual || child.kind === tokenKind_js_1.TokenKind.MinusEqual
                || child.kind === tokenKind_js_1.TokenKind.StarEqual || child.kind === tokenKind_js_1.TokenKind.SlashEqual
                || child.kind === tokenKind_js_1.TokenKind.BackslashEqual
                || child.kind === tokenKind_js_1.TokenKind.LeftShiftEqual || child.kind === tokenKind_js_1.TokenKind.RightShiftEqual)) {
                return child;
            }
        }
        return undefined;
    }
    get isCompound() {
        const op = this.operatorToken;
        return op !== undefined && op.kind !== tokenKind_js_1.TokenKind.Equal;
    }
    get value() {
        const nodes = this.syntax.childNodes;
        return nodes.length >= 2 ? wrapNode(nodes[nodes.length - 1]) : null;
    }
}
exports.AssignmentStatement = AssignmentStatement;
class ExpressionStatement extends AstNode {
    get expression() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
}
exports.ExpressionStatement = ExpressionStatement;
// ─── Expressions ────────────────────────────────────────────────────────────
class BinaryExpression extends AstNode {
    get left() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
    get operatorToken() {
        for (const child of this.syntax.children) {
            if ((0, syntaxNode_js_1.isToken)(child) && child.kind !== tokenKind_js_1.TokenKind.LeftParen && child.kind !== tokenKind_js_1.TokenKind.RightParen) {
                return child;
            }
        }
        return undefined;
    }
    get operator() {
        return this.operatorToken?.text ?? '';
    }
    get right() {
        const nodes = this.syntax.childNodes;
        return nodes.length >= 2 ? wrapNode(nodes[nodes.length - 1]) : null;
    }
}
exports.BinaryExpression = BinaryExpression;
class UnaryExpression extends AstNode {
    get operatorToken() {
        for (const child of this.syntax.children) {
            if ((0, syntaxNode_js_1.isToken)(child))
                return child;
        }
        return undefined;
    }
    get operator() {
        return this.operatorToken?.text ?? '';
    }
    get operand() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
}
exports.UnaryExpression = UnaryExpression;
class GroupingExpression extends AstNode {
    get expression() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
}
exports.GroupingExpression = GroupingExpression;
class CallExpression extends AstNode {
    get callee() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
    get argumentList() {
        const node = this.syntax.findChild(syntaxKind_js_1.SyntaxKind.ArgumentList);
        return node ? new ArgumentList(node) : undefined;
    }
    get args() {
        return this.argumentList?.args ?? [];
    }
}
exports.CallExpression = CallExpression;
class ArgumentList extends AstNode {
    get args() {
        return this.syntax.childNodes
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.ArgumentList = ArgumentList;
class DotExpression extends AstNode {
    get object() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
    get memberToken() {
        const children = this.syntax.children;
        // Member name is the last token (after the dot)
        for (let i = children.length - 1; i >= 0; i--) {
            if ((0, syntaxNode_js_1.isToken)(children[i]) && children[i].kind !== tokenKind_js_1.TokenKind.Dot) {
                return children[i];
            }
        }
        return undefined;
    }
    get member() {
        return this.memberToken?.text ?? '';
    }
}
exports.DotExpression = DotExpression;
class IndexExpression extends AstNode {
    get object() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
    get indices() {
        return this.syntax.childNodes.slice(1)
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.IndexExpression = IndexExpression;
class OptionalChainingExpression extends AstNode {
    get object() {
        const first = this.syntax.childNodes[0];
        return first ? wrapNode(first) : null;
    }
}
exports.OptionalChainingExpression = OptionalChainingExpression;
class IdentifierExpression extends AstNode {
    get nameToken() {
        for (const child of this.syntax.children) {
            if ((0, syntaxNode_js_1.isToken)(child))
                return child;
        }
        return undefined;
    }
    get name() {
        return this.nameToken?.text ?? '';
    }
}
exports.IdentifierExpression = IdentifierExpression;
class LiteralExpression extends AstNode {
    get token() {
        for (const child of this.syntax.children) {
            if ((0, syntaxNode_js_1.isToken)(child))
                return child;
        }
        return undefined;
    }
    get value() {
        return this.token?.text ?? '';
    }
}
exports.LiteralExpression = LiteralExpression;
class ArrayLiteral extends AstNode {
    get elements() {
        return this.syntax.childNodes
            .map(n => wrapNode(n))
            .filter((n) => n !== null);
    }
}
exports.ArrayLiteral = ArrayLiteral;
class AALiteral extends AstNode {
    get fields() {
        return this.syntax.findAllChildren(syntaxKind_js_1.SyntaxKind.AAField).map(n => new AAField(n));
    }
}
exports.AALiteral = AALiteral;
class AAField extends AstNode {
    get keyToken() {
        for (const child of this.syntax.children) {
            if ((0, syntaxNode_js_1.isToken)(child) && child.kind !== tokenKind_js_1.TokenKind.Colon)
                return child;
        }
        return undefined;
    }
    get key() {
        return this.keyToken?.text ?? '';
    }
    get value() {
        const nodes = this.syntax.childNodes;
        return nodes.length > 0 ? wrapNode(nodes[nodes.length - 1]) : null;
    }
}
exports.AAField = AAField;
class ConditionalCompilation extends AstNode {
}
exports.ConditionalCompilation = ConditionalCompilation;
class HashConstStatement extends AstNode {
}
exports.HashConstStatement = HashConstStatement;
class HashErrorStatement extends AstNode {
}
exports.HashErrorStatement = HashErrorStatement;
class ErrorNodeWrapper extends AstNode {
}
exports.ErrorNodeWrapper = ErrorNodeWrapper;
// ─── Utilities ──────────────────────────────────────────────────────────────
function isExpressionKind(kind) {
    return kind === syntaxKind_js_1.SyntaxKind.BinaryExpression || kind === syntaxKind_js_1.SyntaxKind.UnaryExpression
        || kind === syntaxKind_js_1.SyntaxKind.GroupingExpression || kind === syntaxKind_js_1.SyntaxKind.CallExpression
        || kind === syntaxKind_js_1.SyntaxKind.DotExpression || kind === syntaxKind_js_1.SyntaxKind.IndexExpression
        || kind === syntaxKind_js_1.SyntaxKind.OptionalChainingExpression || kind === syntaxKind_js_1.SyntaxKind.FunctionExpression
        || kind === syntaxKind_js_1.SyntaxKind.IdentifierExpression || kind === syntaxKind_js_1.SyntaxKind.LiteralExpression
        || kind === syntaxKind_js_1.SyntaxKind.ArrayLiteral || kind === syntaxKind_js_1.SyntaxKind.AALiteral;
}
function getBodyStatements(node) {
    return node.childNodes
        .filter(n => !isExpressionKind(n.kind))
        .map(n => wrapNode(n))
        .filter((n) => n !== null);
}
/** Wraps a raw CST SyntaxNode in the appropriate typed AST wrapper. */
function wrapNode(node) {
    switch (node.kind) {
        case syntaxKind_js_1.SyntaxKind.SourceFile: return new SourceFile(node);
        case syntaxKind_js_1.SyntaxKind.FunctionDeclaration: return new FunctionDeclaration(node);
        case syntaxKind_js_1.SyntaxKind.FunctionExpression: return new FunctionExpression(node);
        case syntaxKind_js_1.SyntaxKind.ParameterList: return new ParameterList(node);
        case syntaxKind_js_1.SyntaxKind.Parameter: return new Parameter(node);
        case syntaxKind_js_1.SyntaxKind.ReturnTypeClause: return new ReturnTypeClause(node);
        case syntaxKind_js_1.SyntaxKind.IfStatement: return new IfStatement(node);
        case syntaxKind_js_1.SyntaxKind.ElseIfClause: return new ElseIfClause(node);
        case syntaxKind_js_1.SyntaxKind.ElseClause: return new ElseClause(node);
        case syntaxKind_js_1.SyntaxKind.ForStatement: return new ForStatement(node);
        case syntaxKind_js_1.SyntaxKind.ForEachStatement: return new ForEachStatement(node);
        case syntaxKind_js_1.SyntaxKind.WhileStatement: return new WhileStatement(node);
        case syntaxKind_js_1.SyntaxKind.TryStatement: return new TryStatement(node);
        case syntaxKind_js_1.SyntaxKind.CatchClause: return new CatchClause(node);
        case syntaxKind_js_1.SyntaxKind.ReturnStatement: return new ReturnStatement(node);
        case syntaxKind_js_1.SyntaxKind.PrintStatement: return new PrintStatement(node);
        case syntaxKind_js_1.SyntaxKind.ThrowStatement: return new ThrowStatement(node);
        case syntaxKind_js_1.SyntaxKind.DimStatement: return new DimStatement(node);
        case syntaxKind_js_1.SyntaxKind.StopStatement: return new StopStatement(node);
        case syntaxKind_js_1.SyntaxKind.EndStatement: return new EndStatement(node);
        case syntaxKind_js_1.SyntaxKind.GotoStatement: return new GotoStatement(node);
        case syntaxKind_js_1.SyntaxKind.LabelStatement: return new LabelStatement(node);
        case syntaxKind_js_1.SyntaxKind.ExitForStatement: return new ExitForStatement(node);
        case syntaxKind_js_1.SyntaxKind.ExitWhileStatement: return new ExitWhileStatement(node);
        case syntaxKind_js_1.SyntaxKind.ContinueForStatement: return new ContinueForStatement(node);
        case syntaxKind_js_1.SyntaxKind.ContinueWhileStatement: return new ContinueWhileStatement(node);
        case syntaxKind_js_1.SyntaxKind.AssignmentStatement: return new AssignmentStatement(node);
        case syntaxKind_js_1.SyntaxKind.ExpressionStatement: return new ExpressionStatement(node);
        case syntaxKind_js_1.SyntaxKind.BinaryExpression: return new BinaryExpression(node);
        case syntaxKind_js_1.SyntaxKind.UnaryExpression: return new UnaryExpression(node);
        case syntaxKind_js_1.SyntaxKind.GroupingExpression: return new GroupingExpression(node);
        case syntaxKind_js_1.SyntaxKind.CallExpression: return new CallExpression(node);
        case syntaxKind_js_1.SyntaxKind.DotExpression: return new DotExpression(node);
        case syntaxKind_js_1.SyntaxKind.IndexExpression: return new IndexExpression(node);
        case syntaxKind_js_1.SyntaxKind.OptionalChainingExpression: return new OptionalChainingExpression(node);
        case syntaxKind_js_1.SyntaxKind.IdentifierExpression: return new IdentifierExpression(node);
        case syntaxKind_js_1.SyntaxKind.LiteralExpression: return new LiteralExpression(node);
        case syntaxKind_js_1.SyntaxKind.ArrayLiteral: return new ArrayLiteral(node);
        case syntaxKind_js_1.SyntaxKind.AALiteral: return new AALiteral(node);
        case syntaxKind_js_1.SyntaxKind.AAField: return new AAField(node);
        case syntaxKind_js_1.SyntaxKind.ArgumentList: return new ArgumentList(node);
        case syntaxKind_js_1.SyntaxKind.ConditionalCompilation: return new ConditionalCompilation(node);
        case syntaxKind_js_1.SyntaxKind.HashConstStatement: return new HashConstStatement(node);
        case syntaxKind_js_1.SyntaxKind.HashErrorStatement: return new HashErrorStatement(node);
        case syntaxKind_js_1.SyntaxKind.ErrorNode: return new ErrorNodeWrapper(node);
        default: return null;
    }
}
//# sourceMappingURL=ast.js.map
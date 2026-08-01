/**
 * Typed AST wrappers — views over CST nodes.
 *
 * Each wrapper provides a convenient, type-safe API for accessing the
 * structural parts of a BrightScript construct without manually walking
 * the CST children array.
 *
 * The CST is always accessible via the `.syntax` property for cases
 * where the typed API is insufficient (e.g., formatting needs trivia).
 *
 * Two caches make repeated access cheap:
 * - `wrapNode()` caches the wrapper instance per `SyntaxNode` (a `WeakMap`,
 *   so it never prevents the node from being collected). Calling
 *   `wrapNode(sameNode)` twice returns the *same* wrapper object.
 * - Each wrapper memoizes its own getters on first access via `AstNode.memo`.
 *
 * Together these make a getter like `.body` or `.params` pay its filter/map/
 * `wrapNode` cost once per underlying `SyntaxNode`, not once per access —
 * memoizing only the getter would not be enough on its own, since without
 * the `wrapNode` cache every call site that re-wraps the same node still
 * gets a fresh, empty wrapper instance.
 */

import { SyntaxKind } from './syntaxKind.js';
import { SyntaxNode, isNode, isToken, firstToken } from './syntaxNode.js';
import { TokenKind } from './tokenKind.js';
import { Token } from './token.js';
import { Trivia, TriviaKind } from './trivia.js';

// ─── Base ───────────────────────────────────────────────────────────────────

/** Base class for all typed AST wrappers. */
export abstract class AstNode {
  private _memo?: Map<string, unknown>;

  constructor(readonly syntax: SyntaxNode) {}

  get pos(): number { return this.syntax.pos; }
  get end(): number { return this.syntax.end; }
  getText(): string { return this.syntax.getText(); }

  /**
   * Comment trivia (`'` or `rem`) attached before this node's first token —
   * e.g. a `' @import ...` line directly above a statement. Empty for a
   * childless node or one with no leading comment.
   */
  get leadingComments(): readonly Trivia[] {
    return this.memo('leadingComments', () => {
      const tok = firstToken(this.syntax);
      if (!tok) return [];
      return tok.leadingTrivia.filter(t => t.kind === TriviaKind.Comment || t.kind === TriviaKind.RemComment);
    });
  }

  /** Per-instance memoization for a getter's computed value. See file header. */
  protected memo<T>(key: string, compute: () => T): T {
    this._memo ??= new Map();
    if (this._memo.has(key)) return this._memo.get(key) as T;
    const value = compute();
    this._memo.set(key, value);
    return value;
  }
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export class SourceFile extends AstNode {
  get statements(): AstNode[] {
    return this.memo('statements', () => this.syntax.childNodes
      .filter(n => n.kind !== SyntaxKind.ErrorNode)
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

// ─── Function / Sub ─────────────────────────────────────────────────────────

export class FunctionDeclaration extends AstNode {
  get nameToken(): Token | undefined {
    return this.memo('nameToken', () => this.syntax.findToken(TokenKind.Identifier));
  }

  get name(): string {
    return this.nameToken?.text ?? '';
  }

  get isFunction(): boolean {
    return this.memo('isFunction', () => this.syntax.findToken(TokenKind.Function) !== undefined);
  }

  get isSub(): boolean {
    return this.memo('isSub', () => this.syntax.findToken(TokenKind.Sub) !== undefined);
  }

  get parameterList(): ParameterList | undefined {
    return this.memo('parameterList', () => {
      const node = this.syntax.findChild(SyntaxKind.ParameterList);
      return node ? new ParameterList(node) : undefined;
    });
  }

  get params(): Parameter[] {
    return this.parameterList?.params ?? [];
  }

  get returnTypeClause(): ReturnTypeClause | undefined {
    return this.memo('returnTypeClause', () => {
      const node = this.syntax.findChild(SyntaxKind.ReturnTypeClause);
      return node ? new ReturnTypeClause(node) : undefined;
    });
  }

  get returnType(): string | undefined {
    return this.returnTypeClause?.typeName;
  }

  get body(): AstNode[] {
    return this.memo('body', () => this.syntax.childNodes
      .filter(n => n.kind !== SyntaxKind.ParameterList && n.kind !== SyntaxKind.ReturnTypeClause)
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

export class FunctionExpression extends AstNode {
  get isFunction(): boolean {
    return this.memo('isFunction', () => this.syntax.findToken(TokenKind.Function) !== undefined);
  }

  get isSub(): boolean {
    return this.memo('isSub', () => this.syntax.findToken(TokenKind.Sub) !== undefined);
  }

  get parameterList(): ParameterList | undefined {
    return this.memo('parameterList', () => {
      const node = this.syntax.findChild(SyntaxKind.ParameterList);
      return node ? new ParameterList(node) : undefined;
    });
  }

  get params(): Parameter[] {
    return this.parameterList?.params ?? [];
  }

  get returnType(): string | undefined {
    return this.memo('returnType', () => {
      const clause = this.syntax.findChild(SyntaxKind.ReturnTypeClause);
      return clause ? new ReturnTypeClause(clause).typeName : undefined;
    });
  }

  get body(): AstNode[] {
    return this.memo('body', () => this.syntax.childNodes
      .filter(n => n.kind !== SyntaxKind.ParameterList && n.kind !== SyntaxKind.ReturnTypeClause)
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

export class ParameterList extends AstNode {
  get params(): Parameter[] {
    return this.memo('params', () =>
      this.syntax.findAllChildren(SyntaxKind.Parameter).map(n => new Parameter(n)));
  }
}

export class Parameter extends AstNode {
  get nameToken(): Token | undefined {
    return this.memo('nameToken', () => this.syntax.findToken(TokenKind.Identifier));
  }

  get name(): string {
    return this.nameToken?.text ?? '';
  }

  get typeName(): string | undefined {
    return this.memo('typeName', () => {
      const asToken = this.syntax.findToken(TokenKind.As);
      if (!asToken) return undefined;
      // The type name is the token after 'as'
      const children = this.syntax.children;
      const asIdx = children.indexOf(asToken);
      if (asIdx >= 0 && asIdx + 1 < children.length) {
        const typeToken = children[asIdx + 1];
        if (isToken(typeToken)) return typeToken.text;
      }
      return undefined;
    });
  }

  get hasDefault(): boolean {
    return this.memo('hasDefault', () => this.syntax.findToken(TokenKind.Equal) !== undefined);
  }
}

export class ReturnTypeClause extends AstNode {
  get typeName(): string {
    return this.memo('typeName', () => {
      const children = this.syntax.children;
      // Second child after 'as' keyword
      if (children.length >= 2 && isToken(children[1])) return children[1].text;
      return '';
    });
  }
}

// ─── If / Else ──────────────────────────────────────────────────────────────

export class IfStatement extends AstNode {
  get condition(): AstNode | null {
    return this.memo('condition', () => {
      // First child node that is an expression (skip the 'if' token)
      for (const child of this.syntax.childNodes) {
        if (child.kind !== SyntaxKind.ElseIfClause && child.kind !== SyntaxKind.ElseClause) {
          const wrapped = wrapNode(child);
          if (wrapped) return wrapped;
        }
      }
      return null;
    });
  }

  get body(): AstNode[] {
    return this.memo('body', () => this.syntax.childNodes
      .filter(n => n.kind !== SyntaxKind.ElseIfClause && n.kind !== SyntaxKind.ElseClause
                && !isExpressionKind(n.kind))
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }

  get elseIfClauses(): ElseIfClause[] {
    return this.memo('elseIfClauses', () =>
      this.syntax.findAllChildren(SyntaxKind.ElseIfClause).map(n => new ElseIfClause(n)));
  }

  get elseClause(): ElseClause | undefined {
    return this.memo('elseClause', () => {
      const node = this.syntax.findChild(SyntaxKind.ElseClause);
      return node ? new ElseClause(node) : undefined;
    });
  }
}

export class ElseIfClause extends AstNode {
  get condition(): AstNode | null {
    return this.memo('condition', () => {
      for (const child of this.syntax.childNodes) {
        const wrapped = wrapNode(child);
        if (wrapped) return wrapped;
      }
      return null;
    });
  }

  get body(): AstNode[] {
    return this.memo('body', () => this.syntax.childNodes
      .filter(n => !isExpressionKind(n.kind))
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

export class ElseClause extends AstNode {
  get body(): AstNode[] {
    return this.memo('body', () => this.syntax.childNodes
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

// ─── Loops ──────────────────────────────────────────────────────────────────

export class ForStatement extends AstNode {
  get variableToken(): Token | undefined {
    return this.memo('variableToken', () => this.syntax.findToken(TokenKind.Identifier));
  }

  get variable(): string {
    return this.variableToken?.text ?? '';
  }

  get body(): AstNode[] {
    return this.memo('body', () => getBodyStatements(this.syntax));
  }
}

export class ForEachStatement extends AstNode {
  get variableToken(): Token | undefined {
    return this.memo('variableToken', () => {
      // The iterator variable is the first identifier after 'each'
      let foundEach = false;
      for (const child of this.syntax.children) {
        if (isToken(child) && child.kind === TokenKind.Each) { foundEach = true; continue; }
        if (foundEach && isToken(child) && child.kind === TokenKind.Identifier) return child;
      }
      return undefined;
    });
  }

  get variable(): string {
    return this.variableToken?.text ?? '';
  }

  get body(): AstNode[] {
    return this.memo('body', () => getBodyStatements(this.syntax));
  }
}

export class WhileStatement extends AstNode {
  get condition(): AstNode | null {
    return this.memo('condition', () => {
      for (const child of this.syntax.childNodes) {
        const wrapped = wrapNode(child);
        if (wrapped) return wrapped;
      }
      return null;
    });
  }

  get body(): AstNode[] {
    return this.memo('body', () => getBodyStatements(this.syntax));
  }
}

// ─── Try / Catch ────────────────────────────────────────────────────────────

export class TryStatement extends AstNode {
  get body(): AstNode[] {
    return this.memo('body', () => this.syntax.childNodes
      .filter(n => n.kind !== SyntaxKind.CatchClause)
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }

  get catchClause(): CatchClause | undefined {
    return this.memo('catchClause', () => {
      const node = this.syntax.findChild(SyntaxKind.CatchClause);
      return node ? new CatchClause(node) : undefined;
    });
  }
}

export class CatchClause extends AstNode {
  get variableToken(): Token | undefined {
    return this.memo('variableToken', () => this.syntax.findToken(TokenKind.Identifier));
  }

  get variable(): string {
    return this.variableToken?.text ?? '';
  }

  get body(): AstNode[] {
    return this.memo('body', () => getBodyStatements(this.syntax));
  }
}

// ─── Simple statements ──────────────────────────────────────────────────────

export class ReturnStatement extends AstNode {
  get value(): AstNode | null {
    return this.memo('value', () => {
      const expr = this.syntax.childNodes[0];
      return expr ? wrapNode(expr) : null;
    });
  }

  get hasValue(): boolean {
    return this.memo('hasValue', () => this.syntax.childNodes.length > 0);
  }
}

export class PrintStatement extends AstNode {
  get expressions(): AstNode[] {
    return this.memo('expressions', () => this.syntax.childNodes
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

export class ThrowStatement extends AstNode {
  get expression(): AstNode | null {
    return this.memo('expression', () => {
      const expr = this.syntax.childNodes[0];
      return expr ? wrapNode(expr) : null;
    });
  }
}

export class DimStatement extends AstNode {
  get variableToken(): Token | undefined {
    return this.memo('variableToken', () => this.syntax.findToken(TokenKind.Identifier));
  }

  get variable(): string {
    return this.variableToken?.text ?? '';
  }
}

export class GotoStatement extends AstNode {
  get label(): string {
    return this.memo('label', () => this.syntax.findToken(TokenKind.Identifier)?.text ?? '');
  }
}

export class LabelStatement extends AstNode {
  get name(): string {
    return this.memo('name', () => this.syntax.findToken(TokenKind.Identifier)?.text ?? '');
  }
}

export class StopStatement extends AstNode {}
export class EndStatement extends AstNode {}
export class ExitForStatement extends AstNode {}
export class ExitWhileStatement extends AstNode {}
export class ContinueForStatement extends AstNode {}
export class ContinueWhileStatement extends AstNode {}

// ─── Assignment ─────────────────────────────────────────────────────────────

export class AssignmentStatement extends AstNode {
  get target(): AstNode | null {
    return this.memo('target', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }

  get operatorToken(): Token | undefined {
    return this.memo('operatorToken', () => {
      for (const child of this.syntax.children) {
        if (isToken(child) && (child.kind === TokenKind.Equal
            || child.kind === TokenKind.PlusEqual || child.kind === TokenKind.MinusEqual
            || child.kind === TokenKind.StarEqual || child.kind === TokenKind.SlashEqual
            || child.kind === TokenKind.BackslashEqual
            || child.kind === TokenKind.LeftShiftEqual || child.kind === TokenKind.RightShiftEqual)) {
          return child;
        }
      }
      return undefined;
    });
  }

  get isCompound(): boolean {
    const op = this.operatorToken;
    return op !== undefined && op.kind !== TokenKind.Equal;
  }

  get value(): AstNode | null {
    return this.memo('value', () => {
      const nodes = this.syntax.childNodes;
      return nodes.length >= 2 ? wrapNode(nodes[nodes.length - 1]) : null;
    });
  }
}

export class ExpressionStatement extends AstNode {
  get expression(): AstNode | null {
    return this.memo('expression', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }
}

// ─── Expressions ────────────────────────────────────────────────────────────

export class BinaryExpression extends AstNode {
  get left(): AstNode | null {
    return this.memo('left', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }

  get operatorToken(): Token | undefined {
    return this.memo('operatorToken', () => {
      for (const child of this.syntax.children) {
        if (isToken(child) && child.kind !== TokenKind.LeftParen && child.kind !== TokenKind.RightParen) {
          return child;
        }
      }
      return undefined;
    });
  }

  get operator(): string {
    return this.operatorToken?.text ?? '';
  }

  get right(): AstNode | null {
    return this.memo('right', () => {
      const nodes = this.syntax.childNodes;
      return nodes.length >= 2 ? wrapNode(nodes[nodes.length - 1]) : null;
    });
  }
}

export class UnaryExpression extends AstNode {
  get operatorToken(): Token | undefined {
    return this.memo('operatorToken', () => {
      for (const child of this.syntax.children) {
        if (isToken(child)) return child;
      }
      return undefined;
    });
  }

  get operator(): string {
    return this.operatorToken?.text ?? '';
  }

  get operand(): AstNode | null {
    return this.memo('operand', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }
}

export class GroupingExpression extends AstNode {
  get expression(): AstNode | null {
    return this.memo('expression', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }
}

export class CallExpression extends AstNode {
  get callee(): AstNode | null {
    return this.memo('callee', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }

  get argumentList(): ArgumentList | undefined {
    return this.memo('argumentList', () => {
      const node = this.syntax.findChild(SyntaxKind.ArgumentList);
      return node ? new ArgumentList(node) : undefined;
    });
  }

  get args(): AstNode[] {
    return this.argumentList?.args ?? [];
  }
}

export class ArgumentList extends AstNode {
  get args(): AstNode[] {
    return this.memo('args', () => this.syntax.childNodes
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

export class DotExpression extends AstNode {
  get object(): AstNode | null {
    return this.memo('object', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }

  get memberToken(): Token | undefined {
    return this.memo('memberToken', () => {
      const children = this.syntax.children;
      // Member name is the last token (after the dot)
      for (let i = children.length - 1; i >= 0; i--) {
        if (isToken(children[i]) && children[i].kind !== TokenKind.Dot) {
          return children[i] as Token;
        }
      }
      return undefined;
    });
  }

  get member(): string {
    return this.memberToken?.text ?? '';
  }

  /**
   * True if this dot access is actually an `@attr` XML attribute access.
   * The parser produces a `DotExpression` node for both `.` and `@` — see
   * `parsePostfixExpression` — so this is the only way to tell them apart
   * from the typed API. `false` for an ordinary `.member` access.
   */
  get isAttributeAccess(): boolean {
    return this.memo('isAttributeAccess', () => this.syntax.findToken(TokenKind.At) !== undefined);
  }
}

export class IndexExpression extends AstNode {
  get object(): AstNode | null {
    return this.memo('object', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }

  get indices(): AstNode[] {
    return this.memo('indices', () => this.syntax.childNodes.slice(1)
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

export class OptionalChainingExpression extends AstNode {
  get object(): AstNode | null {
    return this.memo('object', () => {
      const first = this.syntax.childNodes[0];
      return first ? wrapNode(first) : null;
    });
  }

  /** The `?.`, `?[`, `?(`, or `?@` token that opens this expression. */
  get operatorToken(): Token | undefined {
    return this.memo('operatorToken', () => {
      for (const child of this.syntax.children) {
        if (isToken(child) && (child.kind === TokenKind.QuestionDot
            || child.kind === TokenKind.QuestionBracket
            || child.kind === TokenKind.QuestionParen
            || child.kind === TokenKind.QuestionAt)) {
          return child;
        }
      }
      return undefined;
    });
  }

  get operator(): string {
    return this.operatorToken?.text ?? '';
  }

  /** The member name token for `?.member` / `?@attr`, if this is that form. */
  get memberToken(): Token | undefined {
    return this.memo('memberToken', () => {
      const op = this.operatorToken;
      if (!op || (op.kind !== TokenKind.QuestionDot && op.kind !== TokenKind.QuestionAt)) return undefined;
      const children = this.syntax.children;
      const opIdx = children.indexOf(op);
      const next = opIdx >= 0 ? children[opIdx + 1] : undefined;
      return next && isToken(next) ? next : undefined;
    });
  }

  get member(): string {
    return this.memberToken?.text ?? '';
  }

  /**
   * The index expression for `?[index]`, or the argument expressions for
   * `?(args)`. Empty for the `?.member` / `?@attr` forms. There is no
   * separate `ArgumentList` node for `?(...)` — unlike a plain call, the
   * parser interleaves the argument expressions directly into this node's
   * own children (see `parseOptionalChaining` in parser.ts).
   */
  get args(): AstNode[] {
    return this.memo('args', () => this.syntax.childNodes.slice(1)
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

export class IdentifierExpression extends AstNode {
  get nameToken(): Token | undefined {
    return this.memo('nameToken', () => {
      for (const child of this.syntax.children) {
        if (isToken(child)) return child;
      }
      return undefined;
    });
  }

  get name(): string {
    return this.nameToken?.text ?? '';
  }
}

export class LiteralExpression extends AstNode {
  get token(): Token | undefined {
    return this.memo('token', () => {
      for (const child of this.syntax.children) {
        if (isToken(child)) return child;
      }
      return undefined;
    });
  }

  get value(): string {
    return this.token?.text ?? '';
  }
}

export class ArrayLiteral extends AstNode {
  get elements(): AstNode[] {
    return this.memo('elements', () => this.syntax.childNodes
      .map(n => wrapNode(n))
      .filter((n): n is AstNode => n !== null));
  }
}

export class AALiteral extends AstNode {
  get fields(): AAField[] {
    return this.memo('fields', () =>
      this.syntax.findAllChildren(SyntaxKind.AAField).map(n => new AAField(n)));
  }
}

export class AAField extends AstNode {
  get keyToken(): Token | undefined {
    return this.memo('keyToken', () => {
      for (const child of this.syntax.children) {
        if (isToken(child) && child.kind !== TokenKind.Colon) return child;
      }
      return undefined;
    });
  }

  get key(): string {
    return this.keyToken?.text ?? '';
  }

  get value(): AstNode | null {
    return this.memo('value', () => {
      const nodes = this.syntax.childNodes;
      return nodes.length > 0 ? wrapNode(nodes[nodes.length - 1]) : null;
    });
  }
}

/** A `#elseif <condition> ... ` branch of a `ConditionalCompilation` node. */
export interface ConditionalCompilationBranch {
  condition: AstNode | null;
  body: AstNode[];
}

/**
 * `#if <condition> ... [#elseif <condition> ...]* [#else ...] #end if`.
 *
 * Unlike `IfStatement`, the parser does NOT wrap `#elseif`/`#else` branches
 * in their own child nodes (there is no `ConditionalCompilation` nesting) —
 * the whole construct is one flat, token-interleaved children list:
 * `[#if, condition, ...body, #elseif?, condition?, ...body?, ..., #else?,
 * ...body?, #end if]` (see `parseConditionalCompilation` in parser.ts).
 * These getters scan that flat list once and cache the split.
 */
export class ConditionalCompilation extends AstNode {
  private parts(): {
    condition: AstNode | null;
    body: AstNode[];
    elseIfBranches: ConditionalCompilationBranch[];
    elseBody: AstNode[] | undefined;
  } {
    return this.memo('parts', () => {
      const children = this.syntax.children;
      let i = 0;
      if (i < children.length && isToken(children[i]) && children[i].kind === TokenKind.HashIf) i++;

      const readCondition = (): AstNode | null => {
        if (i < children.length && isNode(children[i])) {
          const wrapped = wrapNode(children[i] as SyntaxNode);
          i++;
          return wrapped;
        }
        return null;
      };
      const readBody = (): AstNode[] => {
        const body: AstNode[] = [];
        while (i < children.length) {
          const c = children[i];
          if (isToken(c) && (c.kind === TokenKind.HashElseIf || c.kind === TokenKind.HashElse
              || c.kind === TokenKind.HashEndIf)) {
            break;
          }
          if (isNode(c)) {
            const wrapped = wrapNode(c);
            if (wrapped) body.push(wrapped);
          }
          i++;
        }
        return body;
      };

      const condition = readCondition();
      const body = readBody();

      const elseIfBranches: ConditionalCompilationBranch[] = [];
      while (i < children.length && isToken(children[i]) && children[i].kind === TokenKind.HashElseIf) {
        i++; // consume #elseif
        elseIfBranches.push({ condition: readCondition(), body: readBody() });
      }

      let elseBody: AstNode[] | undefined;
      if (i < children.length && isToken(children[i]) && children[i].kind === TokenKind.HashElse) {
        i++; // consume #else
        elseBody = readBody();
      }

      return { condition, body, elseIfBranches, elseBody };
    });
  }

  /** The `#if` branch's condition expression. */
  get condition(): AstNode | null { return this.parts().condition; }
  /** Statements in the `#if` branch, before any `#elseif`/`#else`. */
  get body(): AstNode[] { return this.parts().body; }
  /** Zero or more `#elseif` branches, in source order. */
  get elseIfBranches(): ConditionalCompilationBranch[] { return this.parts().elseIfBranches; }
  /** The trailing `#else` branch's statements, or `undefined` if there is none. */
  get elseBody(): AstNode[] | undefined { return this.parts().elseBody; }
}

export class HashConstStatement extends AstNode {
  get name(): string {
    return this.memo('name', () => this.syntax.findToken(TokenKind.Identifier)?.text ?? '');
  }

  get value(): AstNode | null {
    return this.memo('value', () => {
      const nodes = this.syntax.childNodes;
      return nodes.length > 0 ? wrapNode(nodes[nodes.length - 1]) : null;
    });
  }
}

export class HashErrorStatement extends AstNode {
  /** The error message text following `#error`, as written in source. */
  get message(): string {
    return this.memo('message', () => {
      const errToken = this.syntax.findToken(TokenKind.HashError);
      return errToken?.text.replace(/^#error\s*/i, '') ?? '';
    });
  }
}

export class ErrorNodeWrapper extends AstNode {}

// ─── Utilities ──────────────────────────────────────────────────────────────

function isExpressionKind(kind: SyntaxKind): boolean {
  return kind === SyntaxKind.BinaryExpression || kind === SyntaxKind.UnaryExpression
    || kind === SyntaxKind.GroupingExpression || kind === SyntaxKind.CallExpression
    || kind === SyntaxKind.DotExpression || kind === SyntaxKind.IndexExpression
    || kind === SyntaxKind.OptionalChainingExpression || kind === SyntaxKind.FunctionExpression
    || kind === SyntaxKind.IdentifierExpression || kind === SyntaxKind.LiteralExpression
    || kind === SyntaxKind.ArrayLiteral || kind === SyntaxKind.AALiteral;
}

function getBodyStatements(node: SyntaxNode): AstNode[] {
  return node.childNodes
    .filter(n => !isExpressionKind(n.kind))
    .map(n => wrapNode(n))
    .filter((n): n is AstNode => n !== null);
}

/**
 * Wraps a raw CST SyntaxNode in the appropriate typed AST wrapper.
 * Returns the same wrapper instance for the same node on repeated calls —
 * see the file header for why this matters for `AstNode.memo`.
 */
const wrapperCache = new WeakMap<SyntaxNode, AstNode>();

export function wrapNode(node: SyntaxNode): AstNode | null {
  const cached = wrapperCache.get(node);
  if (cached) return cached;
  const wrapped = wrapNodeUncached(node);
  if (wrapped) wrapperCache.set(node, wrapped);
  return wrapped;
}

function wrapNodeUncached(node: SyntaxNode): AstNode | null {
  switch (node.kind) {
    case SyntaxKind.SourceFile:                return new SourceFile(node);
    case SyntaxKind.FunctionDeclaration:       return new FunctionDeclaration(node);
    case SyntaxKind.FunctionExpression:        return new FunctionExpression(node);
    case SyntaxKind.ParameterList:             return new ParameterList(node);
    case SyntaxKind.Parameter:                 return new Parameter(node);
    case SyntaxKind.ReturnTypeClause:          return new ReturnTypeClause(node);
    case SyntaxKind.IfStatement:               return new IfStatement(node);
    case SyntaxKind.ElseIfClause:              return new ElseIfClause(node);
    case SyntaxKind.ElseClause:                return new ElseClause(node);
    case SyntaxKind.ForStatement:              return new ForStatement(node);
    case SyntaxKind.ForEachStatement:          return new ForEachStatement(node);
    case SyntaxKind.WhileStatement:            return new WhileStatement(node);
    case SyntaxKind.TryStatement:              return new TryStatement(node);
    case SyntaxKind.CatchClause:               return new CatchClause(node);
    case SyntaxKind.ReturnStatement:           return new ReturnStatement(node);
    case SyntaxKind.PrintStatement:            return new PrintStatement(node);
    case SyntaxKind.ThrowStatement:            return new ThrowStatement(node);
    case SyntaxKind.DimStatement:              return new DimStatement(node);
    case SyntaxKind.StopStatement:             return new StopStatement(node);
    case SyntaxKind.EndStatement:              return new EndStatement(node);
    case SyntaxKind.GotoStatement:             return new GotoStatement(node);
    case SyntaxKind.LabelStatement:            return new LabelStatement(node);
    case SyntaxKind.ExitForStatement:          return new ExitForStatement(node);
    case SyntaxKind.ExitWhileStatement:        return new ExitWhileStatement(node);
    case SyntaxKind.ContinueForStatement:      return new ContinueForStatement(node);
    case SyntaxKind.ContinueWhileStatement:    return new ContinueWhileStatement(node);
    case SyntaxKind.AssignmentStatement:        return new AssignmentStatement(node);
    case SyntaxKind.ExpressionStatement:        return new ExpressionStatement(node);
    case SyntaxKind.BinaryExpression:           return new BinaryExpression(node);
    case SyntaxKind.UnaryExpression:            return new UnaryExpression(node);
    case SyntaxKind.GroupingExpression:          return new GroupingExpression(node);
    case SyntaxKind.CallExpression:             return new CallExpression(node);
    case SyntaxKind.DotExpression:              return new DotExpression(node);
    case SyntaxKind.IndexExpression:            return new IndexExpression(node);
    case SyntaxKind.OptionalChainingExpression: return new OptionalChainingExpression(node);
    case SyntaxKind.IdentifierExpression:       return new IdentifierExpression(node);
    case SyntaxKind.LiteralExpression:          return new LiteralExpression(node);
    case SyntaxKind.ArrayLiteral:              return new ArrayLiteral(node);
    case SyntaxKind.AALiteral:                 return new AALiteral(node);
    case SyntaxKind.AAField:                   return new AAField(node);
    case SyntaxKind.ArgumentList:              return new ArgumentList(node);
    case SyntaxKind.ConditionalCompilation:    return new ConditionalCompilation(node);
    case SyntaxKind.HashConstStatement:        return new HashConstStatement(node);
    case SyntaxKind.HashErrorStatement:        return new HashErrorStatement(node);
    case SyntaxKind.ErrorNode:                 return new ErrorNodeWrapper(node);
    default:                                   return null;
  }
}

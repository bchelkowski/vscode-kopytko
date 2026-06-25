/**
 * Hand-written recursive descent parser for BrightScript.
 *
 * Consumes a token stream from the lexer and produces a lossless Concrete
 * Syntax Tree (CST). Every byte of the original source is represented in
 * the tree — calling `root.getText()` reproduces the original source.
 *
 * Error-tolerant: always produces a tree, even for malformed input.
 * Invalid tokens are wrapped in ErrorNode nodes.
 *
 * BrightScript grammar reference:
 * - https://developer.roku.com/dev/docs/program-statements
 * - https://developer.roku.com/dev/docs/expressions-variables-types
 * - https://developer.roku.com/dev/docs/conditional-compilation
 */

import { TokenKind } from './tokenKind.js';
import { Token } from './token.js';
import { SyntaxKind } from './syntaxKind.js';
import { SyntaxNode, SyntaxChild, isNode } from './syntaxNode.js';
import { ParseDiagnostic } from './diagnostics.js';
import { tokenize } from './lexer.js';

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ParseResult {
  /** The root CST node. */
  readonly root: SyntaxNode;
  /** Parse diagnostics (errors). */
  readonly diagnostics: readonly ParseDiagnostic[];
  /** The token stream that was parsed. */
  readonly tokens: readonly Token[];
}

/**
 * Parses BrightScript source code into a lossless CST.
 *
 * @param source - The complete BrightScript source text.
 * @returns The parse result containing the root node, diagnostics, and tokens.
 */
export function parse(source: string): ParseResult {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const root = parser.parseSourceFile();
  return {
    root,
    diagnostics: parser.diagnostics,
    tokens,
  };
}

// ─── Token classification helpers ───────────────────────────────────────────

const _STATEMENT_START_KINDS = new Set<TokenKind>([
  TokenKind.Function, TokenKind.Sub,
  TokenKind.If,
  TokenKind.For,
  TokenKind.While,
  TokenKind.Try,
  TokenKind.Return,
  TokenKind.Print, TokenKind.QuestionMark,
  TokenKind.Throw,
  TokenKind.Dim,
  TokenKind.Stop,
  TokenKind.End,
  TokenKind.Goto,
  TokenKind.Exit,
  TokenKind.ExitWhile,
  TokenKind.Continue,
  TokenKind.HashIf, TokenKind.HashConst, TokenKind.HashError,
]);

const COMPOUND_ASSIGN_OPS = new Set<TokenKind>([
  TokenKind.PlusEqual, TokenKind.MinusEqual,
  TokenKind.StarEqual, TokenKind.SlashEqual,
  TokenKind.BackslashEqual,
  TokenKind.LeftShiftEqual, TokenKind.RightShiftEqual,
]);

const COMPARISON_OPS = new Set<TokenKind>([
  TokenKind.Less, TokenKind.Greater, TokenKind.Equal,
  TokenKind.LessGreater, TokenKind.LessEqual, TokenKind.GreaterEqual,
]);

const ADDITIVE_OPS = new Set<TokenKind>([TokenKind.Plus, TokenKind.Minus]);

const MULTIPLICATIVE_OPS = new Set<TokenKind>([
  TokenKind.Star, TokenKind.Slash, TokenKind.Backslash, TokenKind.Mod,
]);

const SHIFT_OPS = new Set<TokenKind>([TokenKind.LeftShift, TokenKind.RightShift]);

/** Block-ending keywords that terminate a statement list. */
const BLOCK_ENDERS = new Set<TokenKind>([
  TokenKind.EndFunction, TokenKind.EndSub,
  TokenKind.EndIf, TokenKind.EndFor, TokenKind.EndWhile, TokenKind.EndTry,
  TokenKind.Else, TokenKind.ElseIf,
  TokenKind.Catch,
  TokenKind.Next,
  TokenKind.Eof,
  // Compound forms handled as single tokens by the lexer
]);

function isBlockEnder(kind: TokenKind): boolean {
  return BLOCK_ENDERS.has(kind);
}

// ─── Parser ─────────────────────────────────────────────────────────────────

class Parser {
  private readonly tokens: readonly Token[];
  private current = 0;
  readonly diagnostics: ParseDiagnostic[] = [];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  // ── Token access ──────────────────────────────────────────────────────

  private peek(): Token {
    return this.tokens[this.current];
  }

  private peekKind(): TokenKind {
    return this.peek().kind;
  }

  private peekAt(offset: number): Token {
    const idx = this.current + offset;
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
  }

  private isAtEnd(): boolean {
    return this.peekKind() === TokenKind.Eof;
  }

  private advance(): Token {
    const tok = this.peek();
    if (!this.isAtEnd()) this.current++;
    return tok;
  }

  /** Advance and re-classify the consumed token as TypeName, preserving all other fields. */
  private advanceAsTypeName(): Token {
    const tok = this.advance();
    return { ...tok, kind: TokenKind.TypeName };
  }

  private check(kind: TokenKind): boolean {
    return this.peekKind() === kind;
  }

  private match(...kinds: TokenKind[]): boolean {
    for (const kind of kinds) {
      if (this.check(kind)) return true;
    }
    return false;
  }

  private expect(kind: TokenKind, message?: string): Token {
    if (this.check(kind)) return this.advance();
    const tok = this.peek();
    this.error(message ?? `Expected ${kind} but found ${tok.kind}`, tok);
    // Return the current token as-is for error recovery (don't advance)
    return tok;
  }

  private consume(kind: TokenKind): Token | null {
    if (this.check(kind)) return this.advance();
    return null;
  }

  private error(message: string, token: Token): void {
    this.diagnostics.push({
      message,
      pos: token.pos,
      end: token.end,
      line: token.line,
      column: token.column,
    });
  }

  /** Skips newline tokens (they're significant tokens, not trivia) if present. */
  private skipNewlines(): Token[] {
    // Newlines are trivia in our lexer — nothing to skip as tokens.
    return [];
  }

  /**
   * Returns true if the current token is on a different line than the
   * previous token. In BrightScript, newlines act as statement terminators.
   */
  private isAfterNewline(): boolean {
    if (this.current === 0) return false;
    const prev = this.tokens[this.current - 1];
    const curr = this.peek();
    // If the previous token has a LineBreak in its trailing trivia, we crossed a line
    return prev.trailingTrivia.some(t => t.kind === 'LineBreak') ||
           curr.leadingTrivia.some(t => t.kind === 'LineBreak') ||
           curr.line > prev.line;
  }

  /** Returns true if the next token is on the same line as the current one. */
  private isOnSameLine(): boolean {
    if (this.current === 0) return true;
    const prev = this.tokens[this.current - 1];
    return this.peek().line === prev.line && !prev.trailingTrivia.some(t => t.kind === 'LineBreak');
  }

  /** Consumes a statement terminator (colon) if present. Returns it or null. */
  private consumeTerminator(): Token | null {
    if (this.check(TokenKind.Colon)) return this.advance();
    // Newlines are trivia — they don't produce tokens to consume.
    return null;
  }

  // ── Top-level ─────────────────────────────────────────────────────────

  parseSourceFile(): SyntaxNode {
    const children: SyntaxChild[] = [];

    while (!this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) children.push(stmt);

      // Consume colon separator if present
      const term = this.consumeTerminator();
      if (term) children.push(term);

      // Safety: if we didn't make progress, skip one token
      if (!this.isAtEnd() && children.length === 0) {
        children.push(this.makeErrorNode([this.advance()]));
      }
    }

    // Attach EOF
    if (this.check(TokenKind.Eof)) {
      children.push(this.advance());
    }

    return new SyntaxNode(SyntaxKind.SourceFile, children);
  }

  // ── Statement parsing ─────────────────────────────────────────────────

  private parseStatement(): SyntaxNode | null {
    const kind = this.peekKind();

    const declaration = this.parseDeclarationStatement(kind);
    if (declaration) return declaration;

    const block = this.parseBlockStatement(kind);
    if (block) return block;

    const controlFlow = this.parseControlFlowStatement(kind);
    if (controlFlow) return controlFlow;

    const simple = this.parseSimpleStatement(kind);
    if (simple) return simple;

    const conditional = this.parseConditionalCompilationStatement(kind);
    if (conditional) return conditional;

    if (kind === TokenKind.Eof) return null;

    // Could be: assignment, label, or expression statement
    return this.parseAssignmentOrExpressionStatement();
  }

  private parseDeclarationStatement(kind: TokenKind): SyntaxNode | undefined {
    switch (kind) {
      case TokenKind.Function:
      case TokenKind.Sub:
        // Could be a named declaration (statement) or anonymous expression
        return this.parseFunctionOrExpressionStatement();
      default:
        return undefined;
    }
  }

  private parseBlockStatement(kind: TokenKind): SyntaxNode | undefined {
    switch (kind) {
      case TokenKind.If:
        return this.parseIfStatement();

      case TokenKind.For:
        return this.parseForStatement();

      case TokenKind.While:
        return this.parseWhileStatement();

      case TokenKind.Try:
        return this.parseTryStatement();
      default:
        return undefined;
    }
  }

  private parseControlFlowStatement(kind: TokenKind): SyntaxNode | undefined {
    switch (kind) {
      case TokenKind.Return:
        return this.parseReturnStatement();

      case TokenKind.Throw:
        return this.parseThrowStatement();

      case TokenKind.Goto:
        return this.parseGotoStatement();

      case TokenKind.Exit:
        return this.parseExitStatement();

      case TokenKind.ExitWhile:
        return new SyntaxNode(SyntaxKind.ExitWhileStatement, [this.advance()]);

      case TokenKind.Continue:
        return this.parseContinueStatement();
      default:
        return undefined;
    }
  }

  private parseSimpleStatement(kind: TokenKind): SyntaxNode | undefined {
    switch (kind) {
      case TokenKind.Print:
      case TokenKind.QuestionMark:
        return this.parsePrintStatement();

      case TokenKind.Dim:
        return this.parseDimStatement();

      case TokenKind.Stop:
        return new SyntaxNode(SyntaxKind.StopStatement, [this.advance()]);

      case TokenKind.End:
        return new SyntaxNode(SyntaxKind.EndStatement, [this.advance()]);
      default:
        return undefined;
    }
  }

  private parseConditionalCompilationStatement(kind: TokenKind): SyntaxNode | undefined {
    switch (kind) {
      case TokenKind.HashIf:
        return this.parseConditionalCompilation();

      case TokenKind.HashConst:
        return this.parseHashConst();

      case TokenKind.HashError:
        return new SyntaxNode(SyntaxKind.HashErrorStatement, [this.advance()]);
      default:
        return undefined;
    }
  }

  // ── Function / Sub declaration ────────────────────────────────────────

  private parseFunctionOrExpressionStatement(): SyntaxNode {
    // Peek ahead: `function name(` or `sub name(` → named declaration
    // `function(` or `sub(` → anonymous (expression)
    const nextKind = this.peekAt(1).kind;
    if (nextKind === TokenKind.Identifier) {
      return this.parseFunctionDeclaration();
    }
    // Anonymous function as expression statement
    return this.parseExpressionStatement();
  }

  private parseFunctionDeclaration(): SyntaxNode {
    const children: SyntaxChild[] = [];

    // function | sub
    children.push(this.advance());

    // name
    children.push(this.expect(TokenKind.Identifier, 'Expected function name'));

    // parameter list
    children.push(this.parseParameterList());

    // optional return type: as Type
    if (this.check(TokenKind.As)) {
      children.push(this.parseReturnTypeClause());
    }

    // body statements
    this.parseBodyStatements(children);

    // end function | end sub | endfunction | endsub
    if (this.match(TokenKind.EndFunction, TokenKind.EndSub)) {
      children.push(this.advance());
    } else {
      this.error('Expected "end function" or "end sub"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.FunctionDeclaration, children);
  }

  private parseFunctionExpression(): SyntaxNode {
    const children: SyntaxChild[] = [];

    // function | sub
    children.push(this.advance());

    // parameter list
    children.push(this.parseParameterList());

    // optional return type
    if (this.check(TokenKind.As)) {
      children.push(this.parseReturnTypeClause());
    }

    // body
    this.parseBodyStatements(children);

    // end function | end sub
    if (this.match(TokenKind.EndFunction, TokenKind.EndSub)) {
      children.push(this.advance());
    } else {
      this.error('Expected "end function" or "end sub"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.FunctionExpression, children);
  }

  private parseParameterList(): SyntaxNode {
    const children: SyntaxChild[] = [];

    // (
    const openParen = this.expect(TokenKind.LeftParen, 'Expected "("');
    children.push(openParen);
    const openLine = openParen.line;

    // Parameters — no trailing comma, must all be on the same line as (
    // Exception: default values can contain multi-line AA/array/function literals
    if (!this.check(TokenKind.RightParen) && !this.isAtEnd()) {
      children.push(this.parseParameter());
      while (this.check(TokenKind.Comma)) {
        children.push(this.advance()); // ,
        children.push(this.parseParameter());
      }
    }

    // )
    if (this.check(TokenKind.RightParen)) {
      const closeParen = this.advance();
      children.push(closeParen);
      // Validate: closing paren must be on same line as opening (unless default values span lines)
      if (closeParen.line !== openLine) {
        // Check if any parameter has a multi-line default (AA, array, or function)
        const hasMultiLineDefault = children.some(c =>
          isNode(c) && c.kind === SyntaxKind.Parameter && hasMultiLineExpression(c)
        );
        if (!hasMultiLineDefault) {
          this.error('Function parameters must be on one line', closeParen);
        }
      }
    } else {
      this.error('Expected ")"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.ParameterList, children);
  }

  private parseParameter(): SyntaxNode {
    const children: SyntaxChild[] = [];

    // parameter name
    children.push(this.expect(TokenKind.Identifier, 'Expected parameter name'));

    // optional default value: = expression
    if (this.check(TokenKind.Equal)) {
      children.push(this.advance()); // =
      children.push(this.nodeFromExpr(this.parseExpression()));
    }

    // optional type annotation: as Type
    if (this.check(TokenKind.As)) {
      children.push(this.advance()); // as
      // Re-classify whatever follows as a TypeName token so formatters and
      // linters can identify type-annotation positions by token kind alone.
      children.push(this.advanceAsTypeName());
    }

    return new SyntaxNode(SyntaxKind.Parameter, children);
  }

  private parseReturnTypeClause(): SyntaxNode {
    const children: SyntaxChild[] = [];
    children.push(this.advance()); // as
    children.push(this.advanceAsTypeName()); // type name → re-classified as TypeName
    return new SyntaxNode(SyntaxKind.ReturnTypeClause, children);
  }

  /** Parses body statements until a block-ending keyword is found. */
  private parseBodyStatements(into: SyntaxChild[]): void {
    // Consume leading colon separators (for single-line blocks like `for i = 0 to 5 : end for`)
    while (this.check(TokenKind.Colon) && !this.isAtEnd()) {
      into.push(this.advance());
    }

    while (!this.isAtEnd() && !isBlockEnder(this.peekKind())) {
      const beforePos = this.current;
      const stmt = this.parseStatement();
      if (stmt) {
        into.push(stmt);
      }

      // Consume colon separator(s) between statements
      while (this.check(TokenKind.Colon) && !this.isAtEnd()) {
        into.push(this.advance());
      }

      // Safety: prevent infinite loop
      if (this.current === beforePos) {
        if (!this.isAtEnd() && !isBlockEnder(this.peekKind())) {
          into.push(this.makeErrorNode([this.advance()]));
        } else {
          break;
        }
      }
    }
  }

  // ── If / Else If / Else ───────────────────────────────────────────────

  private parseIfStatement(): SyntaxNode {
    const children: SyntaxChild[] = [];

    // if
    children.push(this.advance());

    // condition
    children.push(this.nodeFromExpr(this.parseExpression()));

    // optional 'then'
    const thenToken = this.consume(TokenKind.Then);
    if (thenToken) children.push(thenToken);

    // Decide: single-line or multi-line if
    if (this.isSingleLineIf()) {
      // Single-line: if cond then stmt [else stmt]
      this.parseSingleLineIfBody(children);
    } else {
      // Multi-line: terminated by end if
      this.parseBodyStatements(children);

      // else if / elseif clauses
      while (this.check(TokenKind.ElseIf)) {
        children.push(this.parseElseIfClause());
      }

      // else clause
      if (this.check(TokenKind.Else)) {
        children.push(this.parseElseClause());
      }

      // end if / endif
      if (this.match(TokenKind.EndIf)) {
        children.push(this.advance());
      } else {
        this.error('Expected "end if"', this.peek());
      }
    }

    return new SyntaxNode(SyntaxKind.IfStatement, children);
  }

  /** Determines if the current if is single-line (has code after then on same line). */
  private isSingleLineIf(): boolean {
    // If next token is on a different line, or is EOF → multi-line
    if (this.isAtEnd()) return false;
    // If next token is a colon → it's a "compact block" form (if x then : ... : end if)
    // Treat as multi-line (block form) because it has end if
    if (this.check(TokenKind.Colon)) return false;
    // If the current token is on a new line compared to the if keyword → multi-line
    return !this.isAfterNewline();
  }

  private parseSingleLineIfBody(children: SyntaxChild[]): void {
    // Parse the "then" part statement(s) (can be separated by :)
    const stmt = this.parseStatement();
    if (stmt) children.push(stmt);

    // Handle colon-separated statements before else
    while (this.check(TokenKind.Colon)) {
      const next = this.peekAt(1).kind;
      if (next === TokenKind.Else || next === TokenKind.ElseIf) break;
      // Stop if what follows the colon is a block ender for an outer block
      if (isBlockEnder(next)) break;
      children.push(this.advance()); // :
      const s = this.parseStatement();
      if (s) children.push(s);
    }

    // Optional else
    if (this.check(TokenKind.Colon) && this.peekAt(1).kind === TokenKind.Else) {
      children.push(this.advance()); // :
    }
    if (this.check(TokenKind.Else)) {
      const elseChildren: SyntaxChild[] = [this.advance()]; // else
      const elseStmt = this.parseStatement();
      if (elseStmt) elseChildren.push(elseStmt);
      children.push(new SyntaxNode(SyntaxKind.ElseClause, elseChildren));
    }
  }

  private parseElseIfClause(): SyntaxNode {
    const children: SyntaxChild[] = [];
    children.push(this.advance()); // elseif / else if

    // condition
    children.push(this.nodeFromExpr(this.parseExpression()));

    // optional then
    const thenToken = this.consume(TokenKind.Then);
    if (thenToken) children.push(thenToken);

    // body
    this.parseBodyStatements(children);

    return new SyntaxNode(SyntaxKind.ElseIfClause, children);
  }

  private parseElseClause(): SyntaxNode {
    const children: SyntaxChild[] = [];
    children.push(this.advance()); // else

    this.parseBodyStatements(children);

    return new SyntaxNode(SyntaxKind.ElseClause, children);
  }

  // ── For / For Each ────────────────────────────────────────────────────

  private parseForStatement(): SyntaxNode {
    // Peek: `for each` → ForEach, otherwise → For
    if (this.peekAt(1).kind === TokenKind.Each) {
      return this.parseForEachStatement();
    }

    const children: SyntaxChild[] = [];
    children.push(this.advance()); // for

    // counter = start to end [step increment]
    children.push(this.expect(TokenKind.Identifier, 'Expected loop variable'));

    if (this.check(TokenKind.Equal)) {
      children.push(this.advance()); // =
    }

    // start expression
    children.push(this.nodeFromExpr(this.parseExpression()));

    // to
    if (this.check(TokenKind.To)) {
      children.push(this.advance());
    } else {
      this.error('Expected "to"', this.peek());
    }

    // end expression
    children.push(this.nodeFromExpr(this.parseExpression()));

    // optional step
    if (this.check(TokenKind.Step)) {
      children.push(this.advance()); // step
      children.push(this.nodeFromExpr(this.parseExpression()));
    }

    // body
    this.parseBodyStatements(children);

    // end for | endfor | next
    if (this.match(TokenKind.EndFor, TokenKind.Next)) {
      children.push(this.advance());
    } else {
      this.error('Expected "end for", "endfor", or "next"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.ForStatement, children);
  }

  private parseForEachStatement(): SyntaxNode {
    const children: SyntaxChild[] = [];
    children.push(this.advance()); // for
    children.push(this.advance()); // each

    // item variable
    children.push(this.expect(TokenKind.Identifier, 'Expected iterator variable'));

    // in
    if (this.check(TokenKind.In)) {
      children.push(this.advance());
    } else {
      this.error('Expected "in"', this.peek());
    }

    // collection expression
    children.push(this.nodeFromExpr(this.parseExpression()));

    // body
    this.parseBodyStatements(children);

    // end for | endfor | next
    if (this.match(TokenKind.EndFor, TokenKind.Next)) {
      children.push(this.advance());
    } else {
      this.error('Expected "end for", "endfor", or "next"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.ForEachStatement, children);
  }

  // ── While ─────────────────────────────────────────────────────────────

  private parseWhileStatement(): SyntaxNode {
    const children: SyntaxChild[] = [];
    children.push(this.advance()); // while

    // condition
    children.push(this.nodeFromExpr(this.parseExpression()));

    // body
    this.parseBodyStatements(children);

    // end while | endwhile
    if (this.match(TokenKind.EndWhile)) {
      children.push(this.advance());
    } else {
      this.error('Expected "end while"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.WhileStatement, children);
  }

  // ── Try / Catch ───────────────────────────────────────────────────────

  private parseTryStatement(): SyntaxNode {
    const children: SyntaxChild[] = [];
    children.push(this.advance()); // try

    // try body
    this.parseBodyStatements(children);

    // catch clause
    if (this.check(TokenKind.Catch)) {
      children.push(this.parseCatchClause());
    } else {
      this.error('Expected "catch"', this.peek());
    }

    // end try | endtry
    if (this.match(TokenKind.EndTry)) {
      children.push(this.advance());
    } else {
      this.error('Expected "end try"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.TryStatement, children);
  }

  private parseCatchClause(): SyntaxNode {
    const children: SyntaxChild[] = [];
    children.push(this.advance()); // catch

    // exception variable name (simple identifier only per Roku docs)
    children.push(this.expect(TokenKind.Identifier, 'Expected exception variable name'));

    // catch body
    this.parseBodyStatements(children);

    return new SyntaxNode(SyntaxKind.CatchClause, children);
  }

  // ── Simple statements ─────────────────────────────────────────────────

  private parseReturnStatement(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // return

    // Optional return value — only if something follows on the same line
    if (!this.isAtEnd() && !isBlockEnder(this.peekKind())
        && this.isOnSameLine()) {
      children.push(this.nodeFromExpr(this.parseExpression()));
    }

    return new SyntaxNode(SyntaxKind.ReturnStatement, children);
  }

  private parsePrintStatement(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // print | ?

    // Print arguments (separated by ; or ,)
    while (!this.isAtEnd() && !isBlockEnder(this.peekKind())
           && this.isOnSameLine()) {
      children.push(this.nodeFromExpr(this.parseExpression()));

      // Separator: ; or ,
      if (this.match(TokenKind.Semicolon, TokenKind.Comma)) {
        children.push(this.advance());
      } else {
        break;
      }
    }

    return new SyntaxNode(SyntaxKind.PrintStatement, children);
  }

  private parseThrowStatement(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // throw

    if (!this.isAtEnd() && this.isOnSameLine()) {
      children.push(this.nodeFromExpr(this.parseExpression()));
    }

    return new SyntaxNode(SyntaxKind.ThrowStatement, children);
  }

  private parseDimStatement(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // dim

    // variable name
    children.push(this.expect(TokenKind.Identifier, 'Expected variable name'));

    // [dimensions]
    if (this.check(TokenKind.LeftBracket)) {
      children.push(this.advance()); // [
      // dimensions separated by commas
      if (!this.check(TokenKind.RightBracket)) {
        children.push(this.nodeFromExpr(this.parseExpression()));
        while (this.check(TokenKind.Comma)) {
          children.push(this.advance()); // ,
          children.push(this.nodeFromExpr(this.parseExpression()));
        }
      }
      if (this.check(TokenKind.RightBracket)) {
        children.push(this.advance()); // ]
      }
    }

    return new SyntaxNode(SyntaxKind.DimStatement, children);
  }

  private parseGotoStatement(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // goto
    children.push(this.expect(TokenKind.Identifier, 'Expected label name'));
    return new SyntaxNode(SyntaxKind.GotoStatement, children);
  }

  private parseExitStatement(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // exit

    if (this.check(TokenKind.For)) {
      children.push(this.advance());
      return new SyntaxNode(SyntaxKind.ExitForStatement, children);
    }
    if (this.check(TokenKind.While)) {
      children.push(this.advance());
      return new SyntaxNode(SyntaxKind.ExitWhileStatement, children);
    }

    this.error('Expected "for" or "while" after "exit"', this.peek());
    return new SyntaxNode(SyntaxKind.ExitForStatement, children);
  }

  private parseContinueStatement(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // continue

    if (this.check(TokenKind.For)) {
      children.push(this.advance());
      return new SyntaxNode(SyntaxKind.ContinueForStatement, children);
    }
    if (this.check(TokenKind.While)) {
      children.push(this.advance());
      return new SyntaxNode(SyntaxKind.ContinueWhileStatement, children);
    }

    this.error('Expected "for" or "while" after "continue"', this.peek());
    return new SyntaxNode(SyntaxKind.ContinueForStatement, children);
  }

  // ── Conditional compilation ───────────────────────────────────────────

  private parseConditionalCompilation(): SyntaxNode {
    const children: SyntaxChild[] = [];
    children.push(this.advance()); // #if

    // condition expression
    children.push(this.nodeFromExpr(this.parseExpression()));

    // body — consume everything until #else, #else if, #end if, or EOF
    this.parseConditionalBody(children);

    // #else if clauses
    while (this.check(TokenKind.HashElseIf)) {
      children.push(this.advance()); // #else if
      children.push(this.nodeFromExpr(this.parseExpression()));
      this.parseConditionalBody(children);
    }

    // #else
    if (this.check(TokenKind.HashElse)) {
      children.push(this.advance());
      this.parseConditionalBody(children);
    }

    // #end if / #endif
    if (this.check(TokenKind.HashEndIf)) {
      children.push(this.advance());
    } else {
      this.error('Expected "#end if"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.ConditionalCompilation, children);
  }

  private parseConditionalBody(into: SyntaxChild[]): void {
    while (!this.isAtEnd()
           && !this.match(TokenKind.HashElseIf, TokenKind.HashElse, TokenKind.HashEndIf)) {
      const beforePos = this.current;
      const stmt = this.parseStatement();
      if (stmt) {
        into.push(stmt);
      }

      const term = this.consumeTerminator();
      if (term) into.push(term);

      if (this.current === beforePos) {
        if (!this.isAtEnd()
            && !this.match(TokenKind.HashElseIf, TokenKind.HashElse, TokenKind.HashEndIf)) {
          into.push(this.makeErrorNode([this.advance()]));
        } else {
          break;
        }
      }
    }
  }

  private parseHashConst(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // #const

    // name = value (rest of line was NOT consumed by lexer for #const)
    children.push(this.expect(TokenKind.Identifier, 'Expected constant name'));

    if (this.check(TokenKind.Equal)) {
      children.push(this.advance()); // =
      children.push(this.nodeFromExpr(this.parseExpression()));
    }

    return new SyntaxNode(SyntaxKind.HashConstStatement, children);
  }

  // ── Assignment or expression statement ────────────────────────────────

  private parseAssignmentOrExpressionStatement(): SyntaxNode {
    const label = this.parseLabelStatementIfPresent();
    if (label) return label;

    const lhsNode = this.parseAssignmentLeftHandSide();

    const assignment = this.parseAssignmentStatementIfPresent(lhsNode);
    if (assignment) return assignment;

    const increment = this.parseIncrementExpressionStatementIfPresent(lhsNode);
    if (increment) return increment;

    return this.parseExpressionStatementFromParsedLeft(lhsNode);
  }

  private parseLabelStatementIfPresent(): SyntaxNode | undefined {
    if (this.check(TokenKind.Identifier) && this.peekAt(1).kind === TokenKind.Colon) {
      const afterColon = this.peekAt(2);
      if (afterColon.kind === TokenKind.Eof || afterColon.line > this.peekAt(1).line) {
        const children: SyntaxChild[] = [this.advance(), this.advance()]; // name, :
        return new SyntaxNode(SyntaxKind.LabelStatement, children);
      }
    }
    return undefined;
  }

  private parseAssignmentLeftHandSide(): SyntaxChild {
    // Parse the left-hand side as a postfix expression only (not full expression).
    // This avoids consuming `=` as a comparison operator.
    const lhs = this.parsePostfixExpression();
    return this.nodeFromExpr(lhs);
  }

  private parseAssignmentStatementIfPresent(lhsNode: SyntaxChild): SyntaxNode | undefined {
    if (this.isAssignmentOperator(this.peekKind())) {
      const children: SyntaxChild[] = [lhsNode];
      children.push(this.advance()); // = or +=, etc.
      children.push(this.nodeFromExpr(this.parseExpression()));
      return new SyntaxNode(SyntaxKind.AssignmentStatement, children);
    }
    return undefined;
  }

  private isAssignmentOperator(kind: TokenKind): boolean {
    return kind === TokenKind.Equal || COMPOUND_ASSIGN_OPS.has(kind);
  }

  private parseIncrementExpressionStatementIfPresent(lhsNode: SyntaxChild): SyntaxNode | undefined {
    if (this.match(TokenKind.PlusPlus, TokenKind.MinusMinus)) {
      const children: SyntaxChild[] = [lhsNode, this.advance()];
      return new SyntaxNode(SyntaxKind.ExpressionStatement, children);
    }
    return undefined;
  }

  private parseExpressionStatementFromParsedLeft(lhsNode: SyntaxChild): SyntaxNode {
    // Not an assignment — this could be a bare function call or an expression
    // that uses binary operators. We already parsed the LHS as postfix only,
    // so if there are binary operators remaining on this line, we need to
    // continue parsing them.
    let expr: SyntaxChild = lhsNode;
    if (this.shouldContinueExpressionOnSameLine()) {
      // There are more tokens — wrap lhs into a full binary expression parse.
      // We can't re-parse, so just consume remaining operators on this line.
      expr = this.continueAsBinaryExpression(expr);
    }

    return new SyntaxNode(SyntaxKind.ExpressionStatement, [expr]);
  }

  private shouldContinueExpressionOnSameLine(): boolean {
    return !this.isAtEnd()
      && this.isOnSameLine()
      && !this.check(TokenKind.Colon)
      && !isBlockEnder(this.peekKind());
  }

  /**
   * Continues parsing binary operators after a left-hand side has already
   * been parsed as a postfix expression. Used when we initially parsed for
   * assignment but found no `=`, and the expression continues with operators.
   */
  private continueAsBinaryExpression(left: SyntaxChild): SyntaxChild {
    // Check for binary operators and continue parsing
    while (!this.isAtEnd() && this.isOnSameLine() && !this.check(TokenKind.Colon)
           && !isBlockEnder(this.peekKind())) {
      const kind = this.peekKind();
      if (COMPARISON_OPS.has(kind) || ADDITIVE_OPS.has(kind) || MULTIPLICATIVE_OPS.has(kind)
          || SHIFT_OPS.has(kind) || kind === TokenKind.Caret
          || kind === TokenKind.And || kind === TokenKind.Or) {
        const op = this.advance();
        const right = this.parseUnaryExpression();
        left = new SyntaxNode(SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
      } else {
        break;
      }
    }
    return left;
  }

  private parseExpressionStatement(): SyntaxNode {
    const expr = this.parseExpression();
    return new SyntaxNode(SyntaxKind.ExpressionStatement, [this.nodeFromExpr(expr)]);
  }

  // ── Expression parsing (precedence climbing) ──────────────────────────

  /**
   * Expression precedence (lowest to highest, from Roku docs):
   *  1. OR
   *  2. AND
   *  3. NOT (unary)
   *  4. Comparisons: < > = <> <= >=
   *  5. Bitshift: << >>
   *  6. Additive: + -
   *  7. Multiplicative: * / \ MOD
   *  8. Unary: - +
   *  9. Exponentiation: ^ (right-associative)
   * 10. Postfix: . [] () ?. ?[ ?( ?@ ++ --
   * 11. Primary: literals, identifiers, grouping, array/AA literals, function expr
   */

  private parseExpression(): SyntaxChild {
    return this.parseOrExpression();
  }

  private parseOrExpression(): SyntaxChild {
    let left = this.parseAndExpression();
    while (this.check(TokenKind.Or)) {
      const op = this.advance();
      const right = this.parseAndExpression();
      left = new SyntaxNode(SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
    }
    return left;
  }

  private parseAndExpression(): SyntaxChild {
    let left = this.parseNotExpression();
    while (this.check(TokenKind.And)) {
      const op = this.advance();
      const right = this.parseNotExpression();
      left = new SyntaxNode(SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
    }
    return left;
  }

  private parseNotExpression(): SyntaxChild {
    if (this.check(TokenKind.Not)) {
      const op = this.advance();
      const operand = this.parseNotExpression();
      return new SyntaxNode(SyntaxKind.UnaryExpression, [op, this.nodeFromExpr(operand)]);
    }
    return this.parseComparisonExpression();
  }

  private parseComparisonExpression(): SyntaxChild {
    let left = this.parseShiftExpression();
    while (COMPARISON_OPS.has(this.peekKind())) {
      const op = this.advance();
      const right = this.parseShiftExpression();
      left = new SyntaxNode(SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
    }
    return left;
  }

  private parseShiftExpression(): SyntaxChild {
    let left = this.parseAdditiveExpression();
    while (SHIFT_OPS.has(this.peekKind())) {
      const op = this.advance();
      const right = this.parseAdditiveExpression();
      left = new SyntaxNode(SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
    }
    return left;
  }

  private parseAdditiveExpression(): SyntaxChild {
    let left = this.parseMultiplicativeExpression();
    while (ADDITIVE_OPS.has(this.peekKind())) {
      const op = this.advance();
      const right = this.parseMultiplicativeExpression();
      left = new SyntaxNode(SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
    }
    return left;
  }

  private parseMultiplicativeExpression(): SyntaxChild {
    let left = this.parseUnaryExpression();
    while (MULTIPLICATIVE_OPS.has(this.peekKind())) {
      const op = this.advance();
      const right = this.parseUnaryExpression();
      left = new SyntaxNode(SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
    }
    return left;
  }

  private parseUnaryExpression(): SyntaxChild {
    if (this.match(TokenKind.Minus, TokenKind.Plus)) {
      const op = this.advance();
      const operand = this.parseUnaryExpression();
      return new SyntaxNode(SyntaxKind.UnaryExpression, [op, this.nodeFromExpr(operand)]);
    }
    return this.parseExponentiationExpression();
  }

  private parseExponentiationExpression(): SyntaxChild {
    const left = this.parsePostfixExpression();
    // Right-associative
    if (this.check(TokenKind.Caret)) {
      const op = this.advance();
      const right = this.parseExponentiationExpression(); // recurse for right-assoc
      return new SyntaxNode(SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
    }
    return left;
  }

  // ── Postfix expressions ───────────────────────────────────────────────

  private parsePostfixExpression(): SyntaxChild {
    let expr = this.parsePrimaryExpression();

    while (true) {
      if (this.check(TokenKind.Dot)) {
        // Dot access: expr.member
        const dot = this.advance();
        const member = this.advance(); // identifier or keyword (for interface names)
        expr = new SyntaxNode(SyntaxKind.DotExpression, [this.nodeFromExpr(expr), dot, member]);
      } else if (this.check(TokenKind.LeftBracket)) {
        // Index access: expr[index]
        const children: SyntaxChild[] = [this.nodeFromExpr(expr), this.advance()]; // [
        if (!this.check(TokenKind.RightBracket)) {
          children.push(this.nodeFromExpr(this.parseExpression()));
          while (this.check(TokenKind.Comma)) {
            children.push(this.advance()); // ,
            children.push(this.nodeFromExpr(this.parseExpression()));
          }
        }
        if (this.check(TokenKind.RightBracket)) children.push(this.advance());
        expr = new SyntaxNode(SyntaxKind.IndexExpression, children);
      } else if (this.check(TokenKind.LeftParen)) {
        // Call: expr(args)
        expr = this.parseCallExpression(expr);
      } else if (this.check(TokenKind.At)) {
        // XML attribute access: node@attrName
        const at = this.advance();
        const attr = this.advance(); // attribute name identifier
        expr = new SyntaxNode(SyntaxKind.DotExpression, [this.nodeFromExpr(expr), at, attr]);
      } else if (this.match(TokenKind.QuestionDot, TokenKind.QuestionBracket,
                             TokenKind.QuestionParen, TokenKind.QuestionAt)) {
        // Optional chaining
        expr = this.parseOptionalChaining(expr);
      } else {
        break;
      }
    }

    return expr;
  }

  private parseCallExpression(callee: SyntaxChild): SyntaxNode {
    const children: SyntaxChild[] = [this.nodeFromExpr(callee)];
    children.push(this.parseArgumentList());
    return new SyntaxNode(SyntaxKind.CallExpression, children);
  }

  private parseArgumentList(): SyntaxNode {
    const openParen = this.advance(); // (
    const children: SyntaxChild[] = [openParen];
    this.parseDelimitedExpressionList(children, TokenKind.RightParen, {
      openLine: openParen.line,
      multilineErrorMessage: 'Function call arguments must be on one line',
      missingCloseMessage: 'Expected ")"',
    });

    return new SyntaxNode(SyntaxKind.ArgumentList, children);
  }

  private parseOptionalChaining(left: SyntaxChild): SyntaxNode {
    const children: SyntaxChild[] = [this.nodeFromExpr(left)];
    const op = this.advance(); // ?. ?[ ?( ?@
    children.push(op);

    if (op.kind === TokenKind.QuestionDot || op.kind === TokenKind.QuestionAt) {
      // ?.member or ?@attr
      children.push(this.advance()); // member/attr name
    } else if (op.kind === TokenKind.QuestionBracket) {
      // ?[index]
      children.push(this.nodeFromExpr(this.parseExpression()));
      if (this.check(TokenKind.RightBracket)) children.push(this.advance());
    } else if (op.kind === TokenKind.QuestionParen) {
      // ?(args) — parse like argument list but ?( was already consumed as one token
      this.parseDelimitedExpressionList(children, TokenKind.RightParen, {
        openLine: op.line,
        multilineErrorMessage: 'Function call arguments must be on one line',
      });
    }

    return new SyntaxNode(SyntaxKind.OptionalChainingExpression, children);
  }

  private parseDelimitedExpressionList(
    children: SyntaxChild[],
    closeKind: TokenKind,
    options: {
      openLine?: number;
      multilineErrorMessage?: string;
      missingCloseMessage?: string;
    } = {},
  ): void {
    if (!this.check(closeKind) && !this.isAtEnd()) {
      children.push(this.nodeFromExpr(this.parseExpression()));
      while (this.check(TokenKind.Comma)) {
        children.push(this.advance()); // ,
        children.push(this.nodeFromExpr(this.parseExpression()));
      }
    }

    if (this.check(closeKind)) {
      const closeToken = this.advance();
      children.push(closeToken);
      if (options.openLine !== undefined
          && options.multilineErrorMessage
          && closeToken.line !== options.openLine) {
        const hasMultiLine = children.some(c =>
          isNode(c) && containsMultiLineConstruct(c)
        );
        if (!hasMultiLine) {
          this.error(options.multilineErrorMessage, closeToken);
        }
      }
    } else if (options.missingCloseMessage) {
      this.error(options.missingCloseMessage, this.peek());
    }
  }

  // ── Primary expressions ───────────────────────────────────────────────

  private parsePrimaryExpression(): SyntaxChild {
    const kind = this.peekKind();

    // Grouping: (expr)
    if (kind === TokenKind.LeftParen) {
      return this.parseGroupingExpression();
    }

    // Array literal: [...]
    if (kind === TokenKind.LeftBracket) {
      return this.parseArrayLiteral();
    }

    // AA literal: {...}
    if (kind === TokenKind.LeftBrace) {
      return this.parseAALiteral();
    }

    // Anonymous function/sub
    if (kind === TokenKind.Function || kind === TokenKind.Sub) {
      // Anonymous if next token is ( (not an identifier name)
      if (this.peekAt(1).kind === TokenKind.LeftParen) {
        return this.parseFunctionExpression();
      }
      // Named function used as value: `myFunc = FunctionName` — just an identifier
    }

    // Literals
    if (kind === TokenKind.IntegerLiteral || kind === TokenKind.LongIntegerLiteral ||
        kind === TokenKind.FloatLiteral || kind === TokenKind.DoubleLiteral ||
        kind === TokenKind.StringLiteral) {
      return new SyntaxNode(SyntaxKind.LiteralExpression, [this.advance()]);
    }

    // Boolean and special literals
    if (kind === TokenKind.True || kind === TokenKind.False || kind === TokenKind.Invalid) {
      return new SyntaxNode(SyntaxKind.LiteralExpression, [this.advance()]);
    }

    // LINE_NUM
    if (kind === TokenKind.LineNum) {
      return new SyntaxNode(SyntaxKind.LiteralExpression, [this.advance()]);
    }

    // Identifier (including keyword-identifiers used as values)
    if (kind === TokenKind.Identifier) {
      return new SyntaxNode(SyntaxKind.IdentifierExpression, [this.advance()]);
    }

    // Some keywords can appear in expression position as function calls
    // (e.g. CreateObject, Type, GetGlobalAA, Box, Eval, Run, Tab, Pos)
    if (this.isCallableKeyword(kind)) {
      return new SyntaxNode(SyntaxKind.IdentifierExpression, [this.advance()]);
    }

    // Error recovery: unexpected token
    const tok = this.advance();
    this.error(`Unexpected token "${tok.text}"`, tok);
    return this.makeErrorNode([tok]);
  }

  private isCallableKeyword(kind: TokenKind): boolean {
    return kind === TokenKind.CreateObject || kind === TokenKind.Type ||
           kind === TokenKind.GetGlobalAA || kind === TokenKind.Box ||
           kind === TokenKind.Eval || kind === TokenKind.Run ||
           kind === TokenKind.Tab || kind === TokenKind.Pos ||
           kind === TokenKind.GetLastRunCompileError ||
           kind === TokenKind.GetLastRunRunTimeError ||
           kind === TokenKind.ObjFun || kind === TokenKind.Let;
  }

  private parseGroupingExpression(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // (
    children.push(this.nodeFromExpr(this.parseExpression()));
    if (this.check(TokenKind.RightParen)) {
      children.push(this.advance());
    } else {
      this.error('Expected ")"', this.peek());
    }
    return new SyntaxNode(SyntaxKind.GroupingExpression, children);
  }

  private parseArrayLiteral(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // [

    // Skip newlines (multi-line array)
    children.push(...this.skipNewlines());

    while (!this.check(TokenKind.RightBracket) && !this.isAtEnd()) {
      children.push(this.nodeFromExpr(this.parseExpression()));

      // Optional comma between elements (BrightScript allows omitting commas in multi-line)
      if (this.check(TokenKind.Comma)) {
        children.push(this.advance());
      }
      children.push(...this.skipNewlines());
    }

    if (this.check(TokenKind.RightBracket)) {
      children.push(this.advance());
    } else {
      this.error('Expected "]"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.ArrayLiteral, children);
  }

  private parseAALiteral(): SyntaxNode {
    const children: SyntaxChild[] = [this.advance()]; // {

    children.push(...this.skipNewlines());

    while (!this.check(TokenKind.RightBrace) && !this.isAtEnd()) {
      children.push(this.parseAAField());

      if (this.check(TokenKind.Comma)) {
        children.push(this.advance());
      }
      children.push(...this.skipNewlines());
    }

    if (this.check(TokenKind.RightBrace)) {
      children.push(this.advance());
    } else {
      this.error('Expected "}"', this.peek());
    }

    return new SyntaxNode(SyntaxKind.AALiteral, children);
  }

  private parseAAField(): SyntaxNode {
    const children: SyntaxChild[] = [];

    // Key: identifier or string literal
    if (this.check(TokenKind.StringLiteral) || this.check(TokenKind.Identifier)) {
      children.push(this.advance());
    } else {
      // Keywords can also be used as AA keys
      children.push(this.advance());
    }

    // :
    if (this.check(TokenKind.Colon)) {
      children.push(this.advance());
    } else {
      this.error('Expected ":" after field name', this.peek());
    }

    // value expression
    children.push(this.nodeFromExpr(this.parseExpression()));

    return new SyntaxNode(SyntaxKind.AAField, children);
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Wraps a SyntaxChild in a node if it's a bare token, preserving nodes as-is. */
  private nodeFromExpr(child: SyntaxChild): SyntaxChild {
    // If it's already a SyntaxNode, return as-is
    if (isNode(child)) return child;
    // Bare token → wrap in a minimal expression node
    return new SyntaxNode(SyntaxKind.LiteralExpression, [child]);
  }

  private makeErrorNode(tokens: Token[]): SyntaxNode {
    return new SyntaxNode(SyntaxKind.ErrorNode, tokens);
  }
}

/** Checks if a Parameter node contains a multi-line default value (AA, array, or function). */
function hasMultiLineExpression(paramNode: SyntaxNode): boolean {
  return containsMultiLineConstruct(paramNode);
}

/**
 * Recursively checks if a node tree contains a multi-line construct
 * (anonymous function, AA literal, or array literal) that justifies
 * newlines appearing inside parentheses.
 */
function containsMultiLineConstruct(node: SyntaxNode): boolean {
  if (node.kind === SyntaxKind.AALiteral || node.kind === SyntaxKind.ArrayLiteral
      || node.kind === SyntaxKind.FunctionExpression || node.kind === SyntaxKind.FunctionDeclaration) {
    return true;
  }
  for (const child of node.children) {
    if (isNode(child) && containsMultiLineConstruct(child)) return true;
  }
  return false;
}

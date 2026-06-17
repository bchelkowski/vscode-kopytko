"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const tokenKind_js_1 = require("./tokenKind.js");
const syntaxKind_js_1 = require("./syntaxKind.js");
const syntaxNode_js_1 = require("./syntaxNode.js");
const lexer_js_1 = require("./lexer.js");
/**
 * Parses BrightScript source code into a lossless CST.
 *
 * @param source - The complete BrightScript source text.
 * @returns The parse result containing the root node, diagnostics, and tokens.
 */
function parse(source) {
    const tokens = (0, lexer_js_1.tokenize)(source);
    const parser = new Parser(tokens);
    const root = parser.parseSourceFile();
    return {
        root,
        diagnostics: parser.diagnostics,
        tokens,
    };
}
// ─── Token classification helpers ───────────────────────────────────────────
const _STATEMENT_START_KINDS = new Set([
    tokenKind_js_1.TokenKind.Function, tokenKind_js_1.TokenKind.Sub,
    tokenKind_js_1.TokenKind.If,
    tokenKind_js_1.TokenKind.For,
    tokenKind_js_1.TokenKind.While,
    tokenKind_js_1.TokenKind.Try,
    tokenKind_js_1.TokenKind.Return,
    tokenKind_js_1.TokenKind.Print, tokenKind_js_1.TokenKind.QuestionMark,
    tokenKind_js_1.TokenKind.Throw,
    tokenKind_js_1.TokenKind.Dim,
    tokenKind_js_1.TokenKind.Stop,
    tokenKind_js_1.TokenKind.End,
    tokenKind_js_1.TokenKind.Goto,
    tokenKind_js_1.TokenKind.Exit,
    tokenKind_js_1.TokenKind.ExitWhile,
    tokenKind_js_1.TokenKind.Continue,
    tokenKind_js_1.TokenKind.HashIf, tokenKind_js_1.TokenKind.HashConst, tokenKind_js_1.TokenKind.HashError,
]);
const COMPOUND_ASSIGN_OPS = new Set([
    tokenKind_js_1.TokenKind.PlusEqual, tokenKind_js_1.TokenKind.MinusEqual,
    tokenKind_js_1.TokenKind.StarEqual, tokenKind_js_1.TokenKind.SlashEqual,
    tokenKind_js_1.TokenKind.BackslashEqual,
    tokenKind_js_1.TokenKind.LeftShiftEqual, tokenKind_js_1.TokenKind.RightShiftEqual,
]);
const COMPARISON_OPS = new Set([
    tokenKind_js_1.TokenKind.Less, tokenKind_js_1.TokenKind.Greater, tokenKind_js_1.TokenKind.Equal,
    tokenKind_js_1.TokenKind.LessGreater, tokenKind_js_1.TokenKind.LessEqual, tokenKind_js_1.TokenKind.GreaterEqual,
]);
const ADDITIVE_OPS = new Set([tokenKind_js_1.TokenKind.Plus, tokenKind_js_1.TokenKind.Minus]);
const MULTIPLICATIVE_OPS = new Set([
    tokenKind_js_1.TokenKind.Star, tokenKind_js_1.TokenKind.Slash, tokenKind_js_1.TokenKind.Backslash, tokenKind_js_1.TokenKind.Mod,
]);
const SHIFT_OPS = new Set([tokenKind_js_1.TokenKind.LeftShift, tokenKind_js_1.TokenKind.RightShift]);
/** Block-ending keywords that terminate a statement list. */
const BLOCK_ENDERS = new Set([
    tokenKind_js_1.TokenKind.EndFunction, tokenKind_js_1.TokenKind.EndSub,
    tokenKind_js_1.TokenKind.EndIf, tokenKind_js_1.TokenKind.EndFor, tokenKind_js_1.TokenKind.EndWhile, tokenKind_js_1.TokenKind.EndTry,
    tokenKind_js_1.TokenKind.Else, tokenKind_js_1.TokenKind.ElseIf,
    tokenKind_js_1.TokenKind.Catch,
    tokenKind_js_1.TokenKind.Next,
    tokenKind_js_1.TokenKind.Eof,
    // Compound forms handled as single tokens by the lexer
]);
function isBlockEnder(kind) {
    return BLOCK_ENDERS.has(kind);
}
// ─── Parser ─────────────────────────────────────────────────────────────────
class Parser {
    tokens;
    current = 0;
    diagnostics = [];
    constructor(tokens) {
        this.tokens = tokens;
    }
    // ── Token access ──────────────────────────────────────────────────────
    peek() {
        return this.tokens[this.current];
    }
    peekKind() {
        return this.peek().kind;
    }
    peekAt(offset) {
        const idx = this.current + offset;
        return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
    }
    isAtEnd() {
        return this.peekKind() === tokenKind_js_1.TokenKind.Eof;
    }
    advance() {
        const tok = this.peek();
        if (!this.isAtEnd())
            this.current++;
        return tok;
    }
    check(kind) {
        return this.peekKind() === kind;
    }
    match(...kinds) {
        for (const kind of kinds) {
            if (this.check(kind))
                return true;
        }
        return false;
    }
    expect(kind, message) {
        if (this.check(kind))
            return this.advance();
        const tok = this.peek();
        this.error(message ?? `Expected ${kind} but found ${tok.kind}`, tok);
        // Return the current token as-is for error recovery (don't advance)
        return tok;
    }
    consume(kind) {
        if (this.check(kind))
            return this.advance();
        return null;
    }
    error(message, token) {
        this.diagnostics.push({
            message,
            pos: token.pos,
            end: token.end,
            line: token.line,
            column: token.column,
        });
    }
    /** Skips newline tokens (they're significant tokens, not trivia) if present. */
    skipNewlines() {
        // Newlines are trivia in our lexer — nothing to skip as tokens.
        return [];
    }
    /**
     * Returns true if the current token is on a different line than the
     * previous token. In BrightScript, newlines act as statement terminators.
     */
    isAfterNewline() {
        if (this.current === 0)
            return false;
        const prev = this.tokens[this.current - 1];
        const curr = this.peek();
        // If the previous token has a LineBreak in its trailing trivia, we crossed a line
        return prev.trailingTrivia.some(t => t.kind === 'LineBreak') ||
            curr.leadingTrivia.some(t => t.kind === 'LineBreak') ||
            curr.line > prev.line;
    }
    /** Returns true if the next token is on the same line as the current one. */
    isOnSameLine() {
        if (this.current === 0)
            return true;
        const prev = this.tokens[this.current - 1];
        return this.peek().line === prev.line && !prev.trailingTrivia.some(t => t.kind === 'LineBreak');
    }
    /** Consumes a statement terminator (colon) if present. Returns it or null. */
    consumeTerminator() {
        if (this.check(tokenKind_js_1.TokenKind.Colon))
            return this.advance();
        // Newlines are trivia — they don't produce tokens to consume.
        return null;
    }
    // ── Top-level ─────────────────────────────────────────────────────────
    parseSourceFile() {
        const children = [];
        while (!this.isAtEnd()) {
            const stmt = this.parseStatement();
            if (stmt)
                children.push(stmt);
            // Consume colon separator if present
            const term = this.consumeTerminator();
            if (term)
                children.push(term);
            // Safety: if we didn't make progress, skip one token
            if (!this.isAtEnd() && children.length === 0) {
                children.push(this.makeErrorNode([this.advance()]));
            }
        }
        // Attach EOF
        if (this.check(tokenKind_js_1.TokenKind.Eof)) {
            children.push(this.advance());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.SourceFile, children);
    }
    // ── Statement parsing ─────────────────────────────────────────────────
    parseStatement() {
        const kind = this.peekKind();
        switch (kind) {
            case tokenKind_js_1.TokenKind.Function:
            case tokenKind_js_1.TokenKind.Sub:
                // Could be a named declaration (statement) or anonymous expression
                return this.parseFunctionOrExpressionStatement();
            case tokenKind_js_1.TokenKind.If:
                return this.parseIfStatement();
            case tokenKind_js_1.TokenKind.For:
                return this.parseForStatement();
            case tokenKind_js_1.TokenKind.While:
                return this.parseWhileStatement();
            case tokenKind_js_1.TokenKind.Try:
                return this.parseTryStatement();
            case tokenKind_js_1.TokenKind.Return:
                return this.parseReturnStatement();
            case tokenKind_js_1.TokenKind.Print:
            case tokenKind_js_1.TokenKind.QuestionMark:
                return this.parsePrintStatement();
            case tokenKind_js_1.TokenKind.Throw:
                return this.parseThrowStatement();
            case tokenKind_js_1.TokenKind.Dim:
                return this.parseDimStatement();
            case tokenKind_js_1.TokenKind.Stop:
                return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.StopStatement, [this.advance()]);
            case tokenKind_js_1.TokenKind.End:
                return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.EndStatement, [this.advance()]);
            case tokenKind_js_1.TokenKind.Goto:
                return this.parseGotoStatement();
            case tokenKind_js_1.TokenKind.Exit:
                return this.parseExitStatement();
            case tokenKind_js_1.TokenKind.ExitWhile:
                return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ExitWhileStatement, [this.advance()]);
            case tokenKind_js_1.TokenKind.Continue:
                return this.parseContinueStatement();
            case tokenKind_js_1.TokenKind.HashIf:
                return this.parseConditionalCompilation();
            case tokenKind_js_1.TokenKind.HashConst:
                return this.parseHashConst();
            case tokenKind_js_1.TokenKind.HashError:
                return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.HashErrorStatement, [this.advance()]);
            case tokenKind_js_1.TokenKind.Eof:
                return null;
            default:
                // Could be: assignment, label, or expression statement
                return this.parseAssignmentOrExpressionStatement();
        }
    }
    // ── Function / Sub declaration ────────────────────────────────────────
    parseFunctionOrExpressionStatement() {
        // Peek ahead: `function name(` or `sub name(` → named declaration
        // `function(` or `sub(` → anonymous (expression)
        const nextKind = this.peekAt(1).kind;
        if (nextKind === tokenKind_js_1.TokenKind.Identifier) {
            return this.parseFunctionDeclaration();
        }
        // Anonymous function as expression statement
        return this.parseExpressionStatement();
    }
    parseFunctionDeclaration() {
        const children = [];
        // function | sub
        children.push(this.advance());
        // name
        children.push(this.expect(tokenKind_js_1.TokenKind.Identifier, 'Expected function name'));
        // parameter list
        children.push(this.parseParameterList());
        // optional return type: as Type
        if (this.check(tokenKind_js_1.TokenKind.As)) {
            children.push(this.parseReturnTypeClause());
        }
        // body statements
        this.parseBodyStatements(children);
        // end function | end sub | endfunction | endsub
        if (this.match(tokenKind_js_1.TokenKind.EndFunction, tokenKind_js_1.TokenKind.EndSub)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "end function" or "end sub"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.FunctionDeclaration, children);
    }
    parseFunctionExpression() {
        const children = [];
        // function | sub
        children.push(this.advance());
        // parameter list
        children.push(this.parseParameterList());
        // optional return type
        if (this.check(tokenKind_js_1.TokenKind.As)) {
            children.push(this.parseReturnTypeClause());
        }
        // body
        this.parseBodyStatements(children);
        // end function | end sub
        if (this.match(tokenKind_js_1.TokenKind.EndFunction, tokenKind_js_1.TokenKind.EndSub)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "end function" or "end sub"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.FunctionExpression, children);
    }
    parseParameterList() {
        const children = [];
        // (
        const openParen = this.expect(tokenKind_js_1.TokenKind.LeftParen, 'Expected "("');
        children.push(openParen);
        const openLine = openParen.line;
        // Parameters — no trailing comma, must all be on the same line as (
        // Exception: default values can contain multi-line AA/array/function literals
        if (!this.check(tokenKind_js_1.TokenKind.RightParen) && !this.isAtEnd()) {
            children.push(this.parseParameter());
            while (this.check(tokenKind_js_1.TokenKind.Comma)) {
                children.push(this.advance()); // ,
                children.push(this.parseParameter());
            }
        }
        // )
        if (this.check(tokenKind_js_1.TokenKind.RightParen)) {
            const closeParen = this.advance();
            children.push(closeParen);
            // Validate: closing paren must be on same line as opening (unless default values span lines)
            if (closeParen.line !== openLine) {
                // Check if any parameter has a multi-line default (AA, array, or function)
                const hasMultiLineDefault = children.some(c => (0, syntaxNode_js_1.isNode)(c) && c.kind === syntaxKind_js_1.SyntaxKind.Parameter && hasMultiLineExpression(c));
                if (!hasMultiLineDefault) {
                    this.error('Function parameters must be on one line', closeParen);
                }
            }
        }
        else {
            this.error('Expected ")"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ParameterList, children);
    }
    parseParameter() {
        const children = [];
        // parameter name
        children.push(this.expect(tokenKind_js_1.TokenKind.Identifier, 'Expected parameter name'));
        // optional default value: = expression
        if (this.check(tokenKind_js_1.TokenKind.Equal)) {
            children.push(this.advance()); // =
            children.push(this.nodeFromExpr(this.parseExpression()));
        }
        // optional type annotation: as Type
        if (this.check(tokenKind_js_1.TokenKind.As)) {
            children.push(this.advance()); // as
            // type name (identifier or keyword like Integer, String, Object, etc.)
            children.push(this.advance());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.Parameter, children);
    }
    parseReturnTypeClause() {
        const children = [];
        children.push(this.advance()); // as
        children.push(this.advance()); // type name
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ReturnTypeClause, children);
    }
    /** Parses body statements until a block-ending keyword is found. */
    parseBodyStatements(into) {
        // Consume leading colon separators (for single-line blocks like `for i = 0 to 5 : end for`)
        while (this.check(tokenKind_js_1.TokenKind.Colon) && !this.isAtEnd()) {
            into.push(this.advance());
        }
        while (!this.isAtEnd() && !isBlockEnder(this.peekKind())) {
            const beforePos = this.current;
            const stmt = this.parseStatement();
            if (stmt) {
                into.push(stmt);
            }
            // Consume colon separator(s) between statements
            while (this.check(tokenKind_js_1.TokenKind.Colon) && !this.isAtEnd()) {
                into.push(this.advance());
            }
            // Safety: prevent infinite loop
            if (this.current === beforePos) {
                if (!this.isAtEnd() && !isBlockEnder(this.peekKind())) {
                    into.push(this.makeErrorNode([this.advance()]));
                }
                else {
                    break;
                }
            }
        }
    }
    // ── If / Else If / Else ───────────────────────────────────────────────
    parseIfStatement() {
        const children = [];
        // if
        children.push(this.advance());
        // condition
        children.push(this.nodeFromExpr(this.parseExpression()));
        // optional 'then'
        const thenToken = this.consume(tokenKind_js_1.TokenKind.Then);
        if (thenToken)
            children.push(thenToken);
        // Decide: single-line or multi-line if
        if (this.isSingleLineIf()) {
            // Single-line: if cond then stmt [else stmt]
            this.parseSingleLineIfBody(children);
        }
        else {
            // Multi-line: terminated by end if
            this.parseBodyStatements(children);
            // else if / elseif clauses
            while (this.check(tokenKind_js_1.TokenKind.ElseIf)) {
                children.push(this.parseElseIfClause());
            }
            // else clause
            if (this.check(tokenKind_js_1.TokenKind.Else)) {
                children.push(this.parseElseClause());
            }
            // end if / endif
            if (this.match(tokenKind_js_1.TokenKind.EndIf)) {
                children.push(this.advance());
            }
            else {
                this.error('Expected "end if"', this.peek());
            }
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.IfStatement, children);
    }
    /** Determines if the current if is single-line (has code after then on same line). */
    isSingleLineIf() {
        // If next token is on a different line, or is EOF → multi-line
        if (this.isAtEnd())
            return false;
        // If next token is a colon → it's a "compact block" form (if x then : ... : end if)
        // Treat as multi-line (block form) because it has end if
        if (this.check(tokenKind_js_1.TokenKind.Colon))
            return false;
        // If the current token is on a new line compared to the if keyword → multi-line
        return !this.isAfterNewline();
    }
    parseSingleLineIfBody(children) {
        // Parse the "then" part statement(s) (can be separated by :)
        const stmt = this.parseStatement();
        if (stmt)
            children.push(stmt);
        // Handle colon-separated statements before else
        while (this.check(tokenKind_js_1.TokenKind.Colon)) {
            const next = this.peekAt(1).kind;
            if (next === tokenKind_js_1.TokenKind.Else || next === tokenKind_js_1.TokenKind.ElseIf)
                break;
            // Stop if what follows the colon is a block ender for an outer block
            if (isBlockEnder(next))
                break;
            children.push(this.advance()); // :
            const s = this.parseStatement();
            if (s)
                children.push(s);
        }
        // Optional else
        if (this.check(tokenKind_js_1.TokenKind.Colon) && this.peekAt(1).kind === tokenKind_js_1.TokenKind.Else) {
            children.push(this.advance()); // :
        }
        if (this.check(tokenKind_js_1.TokenKind.Else)) {
            const elseChildren = [this.advance()]; // else
            const elseStmt = this.parseStatement();
            if (elseStmt)
                elseChildren.push(elseStmt);
            children.push(new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ElseClause, elseChildren));
        }
    }
    parseElseIfClause() {
        const children = [];
        children.push(this.advance()); // elseif / else if
        // condition
        children.push(this.nodeFromExpr(this.parseExpression()));
        // optional then
        const thenToken = this.consume(tokenKind_js_1.TokenKind.Then);
        if (thenToken)
            children.push(thenToken);
        // body
        this.parseBodyStatements(children);
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ElseIfClause, children);
    }
    parseElseClause() {
        const children = [];
        children.push(this.advance()); // else
        this.parseBodyStatements(children);
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ElseClause, children);
    }
    // ── For / For Each ────────────────────────────────────────────────────
    parseForStatement() {
        // Peek: `for each` → ForEach, otherwise → For
        if (this.peekAt(1).kind === tokenKind_js_1.TokenKind.Each) {
            return this.parseForEachStatement();
        }
        const children = [];
        children.push(this.advance()); // for
        // counter = start to end [step increment]
        children.push(this.expect(tokenKind_js_1.TokenKind.Identifier, 'Expected loop variable'));
        if (this.check(tokenKind_js_1.TokenKind.Equal)) {
            children.push(this.advance()); // =
        }
        // start expression
        children.push(this.nodeFromExpr(this.parseExpression()));
        // to
        if (this.check(tokenKind_js_1.TokenKind.To)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "to"', this.peek());
        }
        // end expression
        children.push(this.nodeFromExpr(this.parseExpression()));
        // optional step
        if (this.check(tokenKind_js_1.TokenKind.Step)) {
            children.push(this.advance()); // step
            children.push(this.nodeFromExpr(this.parseExpression()));
        }
        // body
        this.parseBodyStatements(children);
        // end for | endfor | next
        if (this.match(tokenKind_js_1.TokenKind.EndFor, tokenKind_js_1.TokenKind.Next)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "end for", "endfor", or "next"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ForStatement, children);
    }
    parseForEachStatement() {
        const children = [];
        children.push(this.advance()); // for
        children.push(this.advance()); // each
        // item variable
        children.push(this.expect(tokenKind_js_1.TokenKind.Identifier, 'Expected iterator variable'));
        // in
        if (this.check(tokenKind_js_1.TokenKind.In)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "in"', this.peek());
        }
        // collection expression
        children.push(this.nodeFromExpr(this.parseExpression()));
        // body
        this.parseBodyStatements(children);
        // end for | endfor | next
        if (this.match(tokenKind_js_1.TokenKind.EndFor, tokenKind_js_1.TokenKind.Next)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "end for", "endfor", or "next"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ForEachStatement, children);
    }
    // ── While ─────────────────────────────────────────────────────────────
    parseWhileStatement() {
        const children = [];
        children.push(this.advance()); // while
        // condition
        children.push(this.nodeFromExpr(this.parseExpression()));
        // body
        this.parseBodyStatements(children);
        // end while | endwhile
        if (this.match(tokenKind_js_1.TokenKind.EndWhile)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "end while"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.WhileStatement, children);
    }
    // ── Try / Catch ───────────────────────────────────────────────────────
    parseTryStatement() {
        const children = [];
        children.push(this.advance()); // try
        // try body
        this.parseBodyStatements(children);
        // catch clause
        if (this.check(tokenKind_js_1.TokenKind.Catch)) {
            children.push(this.parseCatchClause());
        }
        else {
            this.error('Expected "catch"', this.peek());
        }
        // end try | endtry
        if (this.match(tokenKind_js_1.TokenKind.EndTry)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "end try"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.TryStatement, children);
    }
    parseCatchClause() {
        const children = [];
        children.push(this.advance()); // catch
        // exception variable name (simple identifier only per Roku docs)
        children.push(this.expect(tokenKind_js_1.TokenKind.Identifier, 'Expected exception variable name'));
        // catch body
        this.parseBodyStatements(children);
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.CatchClause, children);
    }
    // ── Simple statements ─────────────────────────────────────────────────
    parseReturnStatement() {
        const children = [this.advance()]; // return
        // Optional return value — only if something follows on the same line
        if (!this.isAtEnd() && !isBlockEnder(this.peekKind())
            && this.isOnSameLine()) {
            children.push(this.nodeFromExpr(this.parseExpression()));
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ReturnStatement, children);
    }
    parsePrintStatement() {
        const children = [this.advance()]; // print | ?
        // Print arguments (separated by ; or ,)
        while (!this.isAtEnd() && !isBlockEnder(this.peekKind())
            && this.isOnSameLine()) {
            children.push(this.nodeFromExpr(this.parseExpression()));
            // Separator: ; or ,
            if (this.match(tokenKind_js_1.TokenKind.Semicolon, tokenKind_js_1.TokenKind.Comma)) {
                children.push(this.advance());
            }
            else {
                break;
            }
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.PrintStatement, children);
    }
    parseThrowStatement() {
        const children = [this.advance()]; // throw
        if (!this.isAtEnd() && this.isOnSameLine()) {
            children.push(this.nodeFromExpr(this.parseExpression()));
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ThrowStatement, children);
    }
    parseDimStatement() {
        const children = [this.advance()]; // dim
        // variable name
        children.push(this.expect(tokenKind_js_1.TokenKind.Identifier, 'Expected variable name'));
        // [dimensions]
        if (this.check(tokenKind_js_1.TokenKind.LeftBracket)) {
            children.push(this.advance()); // [
            // dimensions separated by commas
            if (!this.check(tokenKind_js_1.TokenKind.RightBracket)) {
                children.push(this.nodeFromExpr(this.parseExpression()));
                while (this.check(tokenKind_js_1.TokenKind.Comma)) {
                    children.push(this.advance()); // ,
                    children.push(this.nodeFromExpr(this.parseExpression()));
                }
            }
            if (this.check(tokenKind_js_1.TokenKind.RightBracket)) {
                children.push(this.advance()); // ]
            }
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.DimStatement, children);
    }
    parseGotoStatement() {
        const children = [this.advance()]; // goto
        children.push(this.expect(tokenKind_js_1.TokenKind.Identifier, 'Expected label name'));
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.GotoStatement, children);
    }
    parseExitStatement() {
        const children = [this.advance()]; // exit
        if (this.check(tokenKind_js_1.TokenKind.For)) {
            children.push(this.advance());
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ExitForStatement, children);
        }
        if (this.check(tokenKind_js_1.TokenKind.While)) {
            children.push(this.advance());
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ExitWhileStatement, children);
        }
        this.error('Expected "for" or "while" after "exit"', this.peek());
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ExitForStatement, children);
    }
    parseContinueStatement() {
        const children = [this.advance()]; // continue
        if (this.check(tokenKind_js_1.TokenKind.For)) {
            children.push(this.advance());
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ContinueForStatement, children);
        }
        if (this.check(tokenKind_js_1.TokenKind.While)) {
            children.push(this.advance());
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ContinueWhileStatement, children);
        }
        this.error('Expected "for" or "while" after "continue"', this.peek());
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ContinueForStatement, children);
    }
    // ── Conditional compilation ───────────────────────────────────────────
    parseConditionalCompilation() {
        const children = [];
        children.push(this.advance()); // #if
        // condition expression
        children.push(this.nodeFromExpr(this.parseExpression()));
        // body — consume everything until #else, #else if, #end if, or EOF
        this.parseConditionalBody(children);
        // #else if clauses
        while (this.check(tokenKind_js_1.TokenKind.HashElseIf)) {
            children.push(this.advance()); // #else if
            children.push(this.nodeFromExpr(this.parseExpression()));
            this.parseConditionalBody(children);
        }
        // #else
        if (this.check(tokenKind_js_1.TokenKind.HashElse)) {
            children.push(this.advance());
            this.parseConditionalBody(children);
        }
        // #end if / #endif
        if (this.check(tokenKind_js_1.TokenKind.HashEndIf)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "#end if"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ConditionalCompilation, children);
    }
    parseConditionalBody(into) {
        while (!this.isAtEnd()
            && !this.match(tokenKind_js_1.TokenKind.HashElseIf, tokenKind_js_1.TokenKind.HashElse, tokenKind_js_1.TokenKind.HashEndIf)) {
            const beforePos = this.current;
            const stmt = this.parseStatement();
            if (stmt) {
                into.push(stmt);
            }
            const term = this.consumeTerminator();
            if (term)
                into.push(term);
            if (this.current === beforePos) {
                if (!this.isAtEnd()
                    && !this.match(tokenKind_js_1.TokenKind.HashElseIf, tokenKind_js_1.TokenKind.HashElse, tokenKind_js_1.TokenKind.HashEndIf)) {
                    into.push(this.makeErrorNode([this.advance()]));
                }
                else {
                    break;
                }
            }
        }
    }
    parseHashConst() {
        const children = [this.advance()]; // #const
        // name = value (rest of line was NOT consumed by lexer for #const)
        children.push(this.expect(tokenKind_js_1.TokenKind.Identifier, 'Expected constant name'));
        if (this.check(tokenKind_js_1.TokenKind.Equal)) {
            children.push(this.advance()); // =
            children.push(this.nodeFromExpr(this.parseExpression()));
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.HashConstStatement, children);
    }
    // ── Assignment or expression statement ────────────────────────────────
    parseAssignmentOrExpressionStatement() {
        // Check for label: `identifier:` (on its own line)
        if (this.check(tokenKind_js_1.TokenKind.Identifier) && this.peekAt(1).kind === tokenKind_js_1.TokenKind.Colon) {
            const afterColon = this.peekAt(2);
            if (afterColon.kind === tokenKind_js_1.TokenKind.Eof || afterColon.line > this.peekAt(1).line) {
                const children = [this.advance(), this.advance()]; // name, :
                return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.LabelStatement, children);
            }
        }
        // Parse the left-hand side as a postfix expression only (not full expression).
        // This avoids consuming `=` as a comparison operator.
        const lhs = this.parsePostfixExpression();
        const lhsNode = this.nodeFromExpr(lhs);
        // Check for assignment: =, +=, -=, etc.
        if (this.check(tokenKind_js_1.TokenKind.Equal) || COMPOUND_ASSIGN_OPS.has(this.peekKind())) {
            const children = [lhsNode];
            children.push(this.advance()); // = or +=, etc.
            children.push(this.nodeFromExpr(this.parseExpression()));
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.AssignmentStatement, children);
        }
        // Check for ++ / --
        if (this.match(tokenKind_js_1.TokenKind.PlusPlus, tokenKind_js_1.TokenKind.MinusMinus)) {
            const children = [lhsNode, this.advance()];
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ExpressionStatement, children);
        }
        // Not an assignment — this could be a bare function call or an expression
        // that uses binary operators. We already parsed the LHS as postfix only,
        // so if there are binary operators remaining on this line, we need to
        // continue parsing them.
        let expr = lhsNode;
        if (!this.isAtEnd() && this.isOnSameLine() && !this.check(tokenKind_js_1.TokenKind.Colon)
            && !isBlockEnder(this.peekKind())) {
            // There are more tokens — wrap lhs into a full binary expression parse.
            // We can't re-parse, so just consume remaining operators on this line.
            expr = this.continueAsBinaryExpression(expr);
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ExpressionStatement, [expr]);
    }
    /**
     * Continues parsing binary operators after a left-hand side has already
     * been parsed as a postfix expression. Used when we initially parsed for
     * assignment but found no `=`, and the expression continues with operators.
     */
    continueAsBinaryExpression(left) {
        // Check for binary operators and continue parsing
        while (!this.isAtEnd() && this.isOnSameLine() && !this.check(tokenKind_js_1.TokenKind.Colon)
            && !isBlockEnder(this.peekKind())) {
            const kind = this.peekKind();
            if (COMPARISON_OPS.has(kind) || ADDITIVE_OPS.has(kind) || MULTIPLICATIVE_OPS.has(kind)
                || SHIFT_OPS.has(kind) || kind === tokenKind_js_1.TokenKind.Caret
                || kind === tokenKind_js_1.TokenKind.And || kind === tokenKind_js_1.TokenKind.Or) {
                const op = this.advance();
                const right = this.parseUnaryExpression();
                left = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
            }
            else {
                break;
            }
        }
        return left;
    }
    parseExpressionStatement() {
        const expr = this.parseExpression();
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ExpressionStatement, [this.nodeFromExpr(expr)]);
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
    parseExpression() {
        return this.parseOrExpression();
    }
    parseOrExpression() {
        let left = this.parseAndExpression();
        while (this.check(tokenKind_js_1.TokenKind.Or)) {
            const op = this.advance();
            const right = this.parseAndExpression();
            left = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
        }
        return left;
    }
    parseAndExpression() {
        let left = this.parseNotExpression();
        while (this.check(tokenKind_js_1.TokenKind.And)) {
            const op = this.advance();
            const right = this.parseNotExpression();
            left = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
        }
        return left;
    }
    parseNotExpression() {
        if (this.check(tokenKind_js_1.TokenKind.Not)) {
            const op = this.advance();
            const operand = this.parseNotExpression();
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.UnaryExpression, [op, this.nodeFromExpr(operand)]);
        }
        return this.parseComparisonExpression();
    }
    parseComparisonExpression() {
        let left = this.parseShiftExpression();
        while (COMPARISON_OPS.has(this.peekKind())) {
            const op = this.advance();
            const right = this.parseShiftExpression();
            left = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
        }
        return left;
    }
    parseShiftExpression() {
        let left = this.parseAdditiveExpression();
        while (SHIFT_OPS.has(this.peekKind())) {
            const op = this.advance();
            const right = this.parseAdditiveExpression();
            left = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
        }
        return left;
    }
    parseAdditiveExpression() {
        let left = this.parseMultiplicativeExpression();
        while (ADDITIVE_OPS.has(this.peekKind())) {
            const op = this.advance();
            const right = this.parseMultiplicativeExpression();
            left = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
        }
        return left;
    }
    parseMultiplicativeExpression() {
        let left = this.parseUnaryExpression();
        while (MULTIPLICATIVE_OPS.has(this.peekKind())) {
            const op = this.advance();
            const right = this.parseUnaryExpression();
            left = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
        }
        return left;
    }
    parseUnaryExpression() {
        if (this.match(tokenKind_js_1.TokenKind.Minus, tokenKind_js_1.TokenKind.Plus)) {
            const op = this.advance();
            const operand = this.parseUnaryExpression();
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.UnaryExpression, [op, this.nodeFromExpr(operand)]);
        }
        return this.parseExponentiationExpression();
    }
    parseExponentiationExpression() {
        const left = this.parsePostfixExpression();
        // Right-associative
        if (this.check(tokenKind_js_1.TokenKind.Caret)) {
            const op = this.advance();
            const right = this.parseExponentiationExpression(); // recurse for right-assoc
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.BinaryExpression, [this.nodeFromExpr(left), op, this.nodeFromExpr(right)]);
        }
        return left;
    }
    // ── Postfix expressions ───────────────────────────────────────────────
    parsePostfixExpression() {
        let expr = this.parsePrimaryExpression();
        while (true) {
            if (this.check(tokenKind_js_1.TokenKind.Dot)) {
                // Dot access: expr.member
                const dot = this.advance();
                const member = this.advance(); // identifier or keyword (for interface names)
                expr = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.DotExpression, [this.nodeFromExpr(expr), dot, member]);
            }
            else if (this.check(tokenKind_js_1.TokenKind.LeftBracket)) {
                // Index access: expr[index]
                const children = [this.nodeFromExpr(expr), this.advance()]; // [
                if (!this.check(tokenKind_js_1.TokenKind.RightBracket)) {
                    children.push(this.nodeFromExpr(this.parseExpression()));
                    while (this.check(tokenKind_js_1.TokenKind.Comma)) {
                        children.push(this.advance()); // ,
                        children.push(this.nodeFromExpr(this.parseExpression()));
                    }
                }
                if (this.check(tokenKind_js_1.TokenKind.RightBracket))
                    children.push(this.advance());
                expr = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.IndexExpression, children);
            }
            else if (this.check(tokenKind_js_1.TokenKind.LeftParen)) {
                // Call: expr(args)
                expr = this.parseCallExpression(expr);
            }
            else if (this.check(tokenKind_js_1.TokenKind.At)) {
                // XML attribute access: node@attrName
                const at = this.advance();
                const attr = this.advance(); // attribute name identifier
                expr = new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.DotExpression, [this.nodeFromExpr(expr), at, attr]);
            }
            else if (this.match(tokenKind_js_1.TokenKind.QuestionDot, tokenKind_js_1.TokenKind.QuestionBracket, tokenKind_js_1.TokenKind.QuestionParen, tokenKind_js_1.TokenKind.QuestionAt)) {
                // Optional chaining
                expr = this.parseOptionalChaining(expr);
            }
            else {
                break;
            }
        }
        return expr;
    }
    parseCallExpression(callee) {
        const children = [this.nodeFromExpr(callee)];
        children.push(this.parseArgumentList());
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.CallExpression, children);
    }
    parseArgumentList() {
        const openParen = this.advance(); // (
        const children = [openParen];
        const openLine = openParen.line;
        if (!this.check(tokenKind_js_1.TokenKind.RightParen) && !this.isAtEnd()) {
            children.push(this.nodeFromExpr(this.parseExpression()));
            while (this.check(tokenKind_js_1.TokenKind.Comma)) {
                children.push(this.advance()); // ,
                children.push(this.nodeFromExpr(this.parseExpression()));
            }
        }
        if (this.check(tokenKind_js_1.TokenKind.RightParen)) {
            const closeParen = this.advance();
            children.push(closeParen);
            // Validate: args must be on one line unless they contain multi-line
            // constructs (anonymous function, AA literal, array literal)
            if (closeParen.line !== openLine) {
                const hasMultiLine = children.some(c => (0, syntaxNode_js_1.isNode)(c) && containsMultiLineConstruct(c));
                if (!hasMultiLine) {
                    this.error('Function call arguments must be on one line', closeParen);
                }
            }
        }
        else {
            this.error('Expected ")"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ArgumentList, children);
    }
    parseOptionalChaining(left) {
        const children = [this.nodeFromExpr(left)];
        const op = this.advance(); // ?. ?[ ?( ?@
        children.push(op);
        if (op.kind === tokenKind_js_1.TokenKind.QuestionDot || op.kind === tokenKind_js_1.TokenKind.QuestionAt) {
            // ?.member or ?@attr
            children.push(this.advance()); // member/attr name
        }
        else if (op.kind === tokenKind_js_1.TokenKind.QuestionBracket) {
            // ?[index]
            children.push(this.nodeFromExpr(this.parseExpression()));
            if (this.check(tokenKind_js_1.TokenKind.RightBracket))
                children.push(this.advance());
        }
        else if (op.kind === tokenKind_js_1.TokenKind.QuestionParen) {
            // ?(args) — parse like argument list but ?( was already consumed as one token
            const openLine = op.line;
            if (!this.check(tokenKind_js_1.TokenKind.RightParen) && !this.isAtEnd()) {
                children.push(this.nodeFromExpr(this.parseExpression()));
                while (this.check(tokenKind_js_1.TokenKind.Comma)) {
                    children.push(this.advance());
                    children.push(this.nodeFromExpr(this.parseExpression()));
                }
            }
            if (this.check(tokenKind_js_1.TokenKind.RightParen)) {
                const closeParen = this.advance();
                children.push(closeParen);
                if (closeParen.line !== openLine) {
                    const hasMultiLine = children.some(c => (0, syntaxNode_js_1.isNode)(c) && containsMultiLineConstruct(c));
                    if (!hasMultiLine) {
                        this.error('Function call arguments must be on one line', closeParen);
                    }
                }
            }
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.OptionalChainingExpression, children);
    }
    // ── Primary expressions ───────────────────────────────────────────────
    parsePrimaryExpression() {
        const kind = this.peekKind();
        // Grouping: (expr)
        if (kind === tokenKind_js_1.TokenKind.LeftParen) {
            return this.parseGroupingExpression();
        }
        // Array literal: [...]
        if (kind === tokenKind_js_1.TokenKind.LeftBracket) {
            return this.parseArrayLiteral();
        }
        // AA literal: {...}
        if (kind === tokenKind_js_1.TokenKind.LeftBrace) {
            return this.parseAALiteral();
        }
        // Anonymous function/sub
        if (kind === tokenKind_js_1.TokenKind.Function || kind === tokenKind_js_1.TokenKind.Sub) {
            // Anonymous if next token is ( (not an identifier name)
            if (this.peekAt(1).kind === tokenKind_js_1.TokenKind.LeftParen) {
                return this.parseFunctionExpression();
            }
            // Named function used as value: `myFunc = FunctionName` — just an identifier
        }
        // Literals
        if (kind === tokenKind_js_1.TokenKind.IntegerLiteral || kind === tokenKind_js_1.TokenKind.LongIntegerLiteral ||
            kind === tokenKind_js_1.TokenKind.FloatLiteral || kind === tokenKind_js_1.TokenKind.DoubleLiteral ||
            kind === tokenKind_js_1.TokenKind.StringLiteral) {
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.LiteralExpression, [this.advance()]);
        }
        // Boolean and special literals
        if (kind === tokenKind_js_1.TokenKind.True || kind === tokenKind_js_1.TokenKind.False || kind === tokenKind_js_1.TokenKind.Invalid) {
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.LiteralExpression, [this.advance()]);
        }
        // LINE_NUM
        if (kind === tokenKind_js_1.TokenKind.LineNum) {
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.LiteralExpression, [this.advance()]);
        }
        // Identifier (including keyword-identifiers used as values)
        if (kind === tokenKind_js_1.TokenKind.Identifier) {
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.IdentifierExpression, [this.advance()]);
        }
        // Some keywords can appear in expression position as function calls
        // (e.g. CreateObject, Type, GetGlobalAA, Box, Eval, Run, Tab, Pos)
        if (this.isCallableKeyword(kind)) {
            return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.IdentifierExpression, [this.advance()]);
        }
        // Error recovery: unexpected token
        const tok = this.advance();
        this.error(`Unexpected token "${tok.text}"`, tok);
        return this.makeErrorNode([tok]);
    }
    isCallableKeyword(kind) {
        return kind === tokenKind_js_1.TokenKind.CreateObject || kind === tokenKind_js_1.TokenKind.Type ||
            kind === tokenKind_js_1.TokenKind.GetGlobalAA || kind === tokenKind_js_1.TokenKind.Box ||
            kind === tokenKind_js_1.TokenKind.Eval || kind === tokenKind_js_1.TokenKind.Run ||
            kind === tokenKind_js_1.TokenKind.Tab || kind === tokenKind_js_1.TokenKind.Pos ||
            kind === tokenKind_js_1.TokenKind.GetLastRunCompileError ||
            kind === tokenKind_js_1.TokenKind.GetLastRunRunTimeError ||
            kind === tokenKind_js_1.TokenKind.ObjFun || kind === tokenKind_js_1.TokenKind.Let;
    }
    parseGroupingExpression() {
        const children = [this.advance()]; // (
        children.push(this.nodeFromExpr(this.parseExpression()));
        if (this.check(tokenKind_js_1.TokenKind.RightParen)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected ")"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.GroupingExpression, children);
    }
    parseArrayLiteral() {
        const children = [this.advance()]; // [
        // Skip newlines (multi-line array)
        children.push(...this.skipNewlines());
        while (!this.check(tokenKind_js_1.TokenKind.RightBracket) && !this.isAtEnd()) {
            children.push(this.nodeFromExpr(this.parseExpression()));
            // Optional comma between elements (BrightScript allows omitting commas in multi-line)
            if (this.check(tokenKind_js_1.TokenKind.Comma)) {
                children.push(this.advance());
            }
            children.push(...this.skipNewlines());
        }
        if (this.check(tokenKind_js_1.TokenKind.RightBracket)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "]"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ArrayLiteral, children);
    }
    parseAALiteral() {
        const children = [this.advance()]; // {
        children.push(...this.skipNewlines());
        while (!this.check(tokenKind_js_1.TokenKind.RightBrace) && !this.isAtEnd()) {
            children.push(this.parseAAField());
            if (this.check(tokenKind_js_1.TokenKind.Comma)) {
                children.push(this.advance());
            }
            children.push(...this.skipNewlines());
        }
        if (this.check(tokenKind_js_1.TokenKind.RightBrace)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected "}"', this.peek());
        }
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.AALiteral, children);
    }
    parseAAField() {
        const children = [];
        // Key: identifier or string literal
        if (this.check(tokenKind_js_1.TokenKind.StringLiteral) || this.check(tokenKind_js_1.TokenKind.Identifier)) {
            children.push(this.advance());
        }
        else {
            // Keywords can also be used as AA keys
            children.push(this.advance());
        }
        // :
        if (this.check(tokenKind_js_1.TokenKind.Colon)) {
            children.push(this.advance());
        }
        else {
            this.error('Expected ":" after field name', this.peek());
        }
        // value expression
        children.push(this.nodeFromExpr(this.parseExpression()));
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.AAField, children);
    }
    // ── Helpers ───────────────────────────────────────────────────────────
    /** Wraps a SyntaxChild in a node if it's a bare token, preserving nodes as-is. */
    nodeFromExpr(child) {
        // If it's already a SyntaxNode, return as-is
        if ('children' in child)
            return child;
        // Bare token → wrap in a minimal expression node
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.LiteralExpression, [child]);
    }
    makeErrorNode(tokens) {
        return new syntaxNode_js_1.SyntaxNode(syntaxKind_js_1.SyntaxKind.ErrorNode, tokens);
    }
}
/** Checks if a Parameter node contains a multi-line default value (AA, array, or function). */
function hasMultiLineExpression(paramNode) {
    return containsMultiLineConstruct(paramNode);
}
/**
 * Recursively checks if a node tree contains a multi-line construct
 * (anonymous function, AA literal, or array literal) that justifies
 * newlines appearing inside parentheses.
 */
function containsMultiLineConstruct(node) {
    if (node.kind === syntaxKind_js_1.SyntaxKind.AALiteral || node.kind === syntaxKind_js_1.SyntaxKind.ArrayLiteral
        || node.kind === syntaxKind_js_1.SyntaxKind.FunctionExpression || node.kind === syntaxKind_js_1.SyntaxKind.FunctionDeclaration) {
        return true;
    }
    for (const child of node.children) {
        if ((0, syntaxNode_js_1.isNode)(child) && containsMultiLineConstruct(child))
            return true;
    }
    return false;
}
//# sourceMappingURL=parser.js.map
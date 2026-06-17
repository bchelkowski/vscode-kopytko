/**
 * Public API for brightscript-parser.
 */
export { TokenKind, KEYWORD_MAP, isKeyword } from './tokenKind.js';
export type { Token } from './token.js';
export { tokenFullText, tokensToText } from './token.js';
export { TriviaKind } from './trivia.js';
export type { Trivia } from './trivia.js';
export { tokenize } from './lexer.js';
export { SyntaxKind } from './syntaxKind.js';
export { SyntaxNode, isNode, isToken } from './syntaxNode.js';
export type { SyntaxChild } from './syntaxNode.js';
export { parse } from './parser.js';
export type { ParseResult } from './parser.js';
export type { ParseDiagnostic } from './diagnostics.js';
export { wrapNode, AstNode, SourceFile, FunctionDeclaration, FunctionExpression, ParameterList, Parameter, ReturnTypeClause, IfStatement, ElseIfClause, ElseClause, ForStatement, ForEachStatement, WhileStatement, TryStatement, CatchClause, ReturnStatement, PrintStatement, ThrowStatement, DimStatement, GotoStatement, LabelStatement, StopStatement, EndStatement, ExitForStatement, ExitWhileStatement, ContinueForStatement, ContinueWhileStatement, AssignmentStatement, ExpressionStatement, BinaryExpression, UnaryExpression, GroupingExpression, CallExpression, DotExpression, IndexExpression, OptionalChainingExpression, IdentifierExpression, LiteralExpression, ArrayLiteral, AALiteral, AAField, ArgumentList, ConditionalCompilation, HashConstStatement, HashErrorStatement, } from './ast.js';
export { walk, findAll } from './visitor.js';
export type { AstVisitor } from './visitor.js';
export { buildScopes, findScopeAtLine, resolve } from './scope.js';
export type { Scope, Declaration, DeclarationKind, Reference } from './scope.js';
export { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS, builtinNames, keywordNames, builtinArity, findBuiltin, getKeywordCategory, } from './catalog/builtins.js';
export type { BrightScriptBuiltin, KeywordCategory } from './catalog/builtins.js';
export { inferNumericLiteralType, isNumericLiteral, stripNumericLiterals, NUMERIC_LITERAL_GLOBAL_RE, } from './catalog/numericLiterals.js';
export type { NumericType } from './catalog/numericLiterals.js';
export { CasingOption, CasingConfig, DEFAULT_CASING_CONFIG, applyCasing, applyCasingWithOverrides, resolveKeywordCasing, } from './catalog/casing.js';
export { matchesGlob, findMatchingGlob } from './utils/globMatcher.js';
export { findNodeAtPosition, findTokenAtPosition, getWordAtPosition, escapeRegex } from './utils/position.js';
export type { NodeAtPosition } from './utils/position.js';
export { BRIGHTSCRIPT_COMPONENTS, BRIGHTSCRIPT_INTERFACES, findComponent, findInterface, getComponentMethods, findMethodInterface, CATALOG_LAST_VERIFIED, } from './catalog/components.js';
export { parseXmlScriptUris, parseXmlInterface, parseXmlExtends, parseXmlComponentName, } from './utils/xmlParsing.js';
export type { XmlInterfaceField, XmlInterfaceFunction, ParsedXmlInterface } from './utils/xmlParsing.js';
export { inferTypesFromAst, getVariableType } from './analysis/typeInference.js';
export type { TypeBinding, TypeMap } from './analysis/typeInference.js';
export { buildCallGraph } from './analysis/callGraph.js';
export type { CallGraph, CallSite, FunctionInfo } from './analysis/callGraph.js';
export { analyzeContext } from './analysis/contextAnalysis.js';
export type { ContextAnalysis, ContextField, FunctionBinding, FunctionContext } from './analysis/contextAnalysis.js';
export { getSymbolInfo } from './analysis/symbolInfo.js';
export type { SymbolInfo } from './analysis/symbolInfo.js';
//# sourceMappingURL=index.d.ts.map
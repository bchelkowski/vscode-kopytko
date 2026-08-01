/**
 * Public API for brightscript-parser.
 */

// Token types
export { TokenKind, KEYWORD_MAP, isKeyword, isTypeKeyword } from './tokenKind.js';
export type { Token } from './token.js';
export { tokenFullText, tokensToText } from './token.js';
export { TriviaKind } from './trivia.js';
export type { Trivia } from './trivia.js';

// Lexer
export { tokenize } from './lexer.js';

// CST node types
export { SyntaxKind } from './syntaxKind.js';
export { SyntaxNode, isNode, isToken, firstToken, lastToken } from './syntaxNode.js';
export type { SyntaxChild } from './syntaxNode.js';

// Parser
export { parse } from './parser.js';
export type { ParseResult } from './parser.js';

// Diagnostics
export type { ParseDiagnostic } from './diagnostics.js';

// Typed AST
export {
  wrapNode, AstNode,
  SourceFile, FunctionDeclaration, FunctionExpression,
  ParameterList, Parameter, ReturnTypeClause,
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
  ArrayLiteral, AALiteral, AAField, ArgumentList,
  ConditionalCompilation, HashConstStatement, HashErrorStatement,
  ErrorNodeWrapper,
} from './ast.js';
export type { ConditionalCompilationBranch } from './ast.js';

// Visitor
export { walk, findAll } from './visitor.js';
export type { AstVisitor } from './visitor.js';

// Scope analysis
export { buildScopes, findScopeAtLine, resolve } from './scope.js';
export type { Scope, Declaration, DeclarationKind, Reference } from './scope.js';

// ── Shared catalogs (canonical source — consumed by formatter, linter, extension) ──

// BrightScript built-in functions catalog
export {
  BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS,
  builtinNames, keywordNames, builtinArity,
  findBuiltin, getKeywordCategory,
} from './catalog/builtins.js';
export type { BrightScriptBuiltin, KeywordCategory } from './catalog/builtins.js';

// Numeric literal type inference
export {
  inferNumericLiteralType, isNumericLiteral,
  stripNumericLiterals, NUMERIC_LITERAL_GLOBAL_RE,
} from './catalog/numericLiterals.js';
export type { NumericType } from './catalog/numericLiterals.js';

// Identifier casing transforms
export {
  CasingOption, CasingConfig, DEFAULT_CASING_CONFIG,
  applyCasing, applyCasingWithOverrides, resolveKeywordCasing,
} from './catalog/casing.js';

// ── Shared utilities ──

// Glob pattern matching
export { matchesGlob, findMatchingGlob } from './utils/globMatcher.js';

// Position-based node lookup (for LSP providers)
export { findNodeAtPosition, findTokenAtPosition, getWordAtPosition, escapeRegex } from './utils/position.js';
export type { NodeAtPosition } from './utils/position.js';

// Position/symbol indexes — build once per parse, reuse across many lookups
export {
  buildPositionIndex, findTokenAtPositionIndexed, findNodeAtPositionIndexed,
  buildSymbolIndex,
} from './utils/position.js';
export type { PositionIndex, SymbolIndex } from './utils/position.js';

// BrightScript component catalog (ro* objects, interfaces, methods)
export {
  BRIGHTSCRIPT_COMPONENTS, BRIGHTSCRIPT_INTERFACES,
  findComponent, findInterface, getComponentMethods, findMethodInterface,
  CATALOG_LAST_VERIFIED,
} from './catalog/components.js';

// ── SceneGraph XML — lossless CST (mirrors the BrightScript CST above) ──

// XML token/trivia types
export { XmlTokenKind } from './xml/xmlTokenKind.js';
export type { XmlToken } from './xml/xmlToken.js';
export { xmlTokenFullText, xmlTokensToText } from './xml/xmlToken.js';
export { XmlTriviaKind } from './xml/xmlTrivia.js';
export type { XmlTrivia } from './xml/xmlTrivia.js';

// XML lexer
export { xmlTokenize } from './xml/xmlLexer.js';

// XML CST node types
export { XmlSyntaxKind } from './xml/xmlSyntaxKind.js';
export { XmlSyntaxNode, isXmlNode, isXmlToken, firstXmlToken, lastXmlToken } from './xml/xmlSyntaxNode.js';
export type { XmlSyntaxChild } from './xml/xmlSyntaxNode.js';

// XML parser
export { parseXml } from './xml/xmlParser.js';
export type { XmlParseResult, XmlParseDiagnostic } from './xml/xmlParser.js';

// Typed XML AST
export { XmlDocument, XmlElement, XmlAttribute, parseSceneGraphXml } from './xml/xmlAst.js';

// SceneGraph-specific queries over the XML CST (pure functions — no file system)
export {
  parseXmlScriptUris, parseXmlInterface, parseXmlExtends, parseXmlComponentName,
  parseComponentTag, tokenizeXmlInterfaceElements,
} from './xml/sceneGraphQueries.js';
export type {
  XmlInterfaceField, XmlInterfaceFunction, ParsedXmlInterface,
  ComponentTagInfo, XmlInterfaceElement, XmlInterfaceChunk, TokenizedXmlInterface,
} from './xml/sceneGraphQueries.js';

// ── Analysis modules (for LSP features and advanced linting) ──

// AST-based type inference
export { inferTypesFromAst, getVariableType, getVariableTypeInScope } from './analysis/typeInference.js';
export type { TypeBinding, TypeMap, TypeScopeOwner } from './analysis/typeInference.js';

// Call graph (who calls whom, argument tracking)
export { buildCallGraph } from './analysis/callGraph.js';
export type { CallGraph, CallSite, FunctionInfo } from './analysis/callGraph.js';

// Context (m) analysis (m.field tracking, function binding to AAs)
export { analyzeContext } from './analysis/contextAnalysis.js';
export type {
  ContextAnalysis, ContextField, FunctionBinding, InlineAAFunction, DotAssignedFunction, FunctionContext,
} from './analysis/contextAnalysis.js';

// Symbol info (rich hover/definition data for builtins and user functions)
export { getSymbolInfo } from './analysis/symbolInfo.js';
export type { SymbolInfo } from './analysis/symbolInfo.js';

// Roku SceneGraph node catalog (Node, Group, Task, ContentNode, etc.)
export { SG_NODES, findSgNode, getAllSgNodeFields, getAllSgNodeMethods } from './catalog/sgNodes.js';
export type { SgNodeField, SgNodeMethod, SgNodeDefinition } from './catalog/sgNodes.js';

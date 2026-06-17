"use strict";
/**
 * Public API for brightscript-parser.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentifierExpression = exports.OptionalChainingExpression = exports.IndexExpression = exports.DotExpression = exports.CallExpression = exports.GroupingExpression = exports.UnaryExpression = exports.BinaryExpression = exports.ExpressionStatement = exports.AssignmentStatement = exports.ContinueWhileStatement = exports.ContinueForStatement = exports.ExitWhileStatement = exports.ExitForStatement = exports.EndStatement = exports.StopStatement = exports.LabelStatement = exports.GotoStatement = exports.DimStatement = exports.ThrowStatement = exports.PrintStatement = exports.ReturnStatement = exports.CatchClause = exports.TryStatement = exports.WhileStatement = exports.ForEachStatement = exports.ForStatement = exports.ElseClause = exports.ElseIfClause = exports.IfStatement = exports.ReturnTypeClause = exports.Parameter = exports.ParameterList = exports.FunctionExpression = exports.FunctionDeclaration = exports.SourceFile = exports.AstNode = exports.wrapNode = exports.parse = exports.isToken = exports.isNode = exports.SyntaxNode = exports.SyntaxKind = exports.tokenize = exports.TriviaKind = exports.tokensToText = exports.tokenFullText = exports.isKeyword = exports.KEYWORD_MAP = exports.TokenKind = void 0;
exports.getSymbolInfo = exports.analyzeContext = exports.buildCallGraph = exports.getVariableType = exports.inferTypesFromAst = exports.parseXmlComponentName = exports.parseXmlExtends = exports.parseXmlInterface = exports.parseXmlScriptUris = exports.CATALOG_LAST_VERIFIED = exports.findMethodInterface = exports.getComponentMethods = exports.findInterface = exports.findComponent = exports.BRIGHTSCRIPT_INTERFACES = exports.BRIGHTSCRIPT_COMPONENTS = exports.escapeRegex = exports.getWordAtPosition = exports.findTokenAtPosition = exports.findNodeAtPosition = exports.findMatchingGlob = exports.matchesGlob = exports.resolveKeywordCasing = exports.applyCasingWithOverrides = exports.applyCasing = exports.DEFAULT_CASING_CONFIG = exports.NUMERIC_LITERAL_GLOBAL_RE = exports.stripNumericLiterals = exports.isNumericLiteral = exports.inferNumericLiteralType = exports.getKeywordCategory = exports.findBuiltin = exports.builtinArity = exports.keywordNames = exports.builtinNames = exports.BRIGHTSCRIPT_KEYWORDS = exports.BRIGHTSCRIPT_BUILTINS = exports.resolve = exports.findScopeAtLine = exports.buildScopes = exports.findAll = exports.walk = exports.HashErrorStatement = exports.HashConstStatement = exports.ConditionalCompilation = exports.ArgumentList = exports.AAField = exports.AALiteral = exports.ArrayLiteral = exports.LiteralExpression = void 0;
// Token types
var tokenKind_js_1 = require("./tokenKind.js");
Object.defineProperty(exports, "TokenKind", { enumerable: true, get: function () { return tokenKind_js_1.TokenKind; } });
Object.defineProperty(exports, "KEYWORD_MAP", { enumerable: true, get: function () { return tokenKind_js_1.KEYWORD_MAP; } });
Object.defineProperty(exports, "isKeyword", { enumerable: true, get: function () { return tokenKind_js_1.isKeyword; } });
var token_js_1 = require("./token.js");
Object.defineProperty(exports, "tokenFullText", { enumerable: true, get: function () { return token_js_1.tokenFullText; } });
Object.defineProperty(exports, "tokensToText", { enumerable: true, get: function () { return token_js_1.tokensToText; } });
var trivia_js_1 = require("./trivia.js");
Object.defineProperty(exports, "TriviaKind", { enumerable: true, get: function () { return trivia_js_1.TriviaKind; } });
// Lexer
var lexer_js_1 = require("./lexer.js");
Object.defineProperty(exports, "tokenize", { enumerable: true, get: function () { return lexer_js_1.tokenize; } });
// CST node types
var syntaxKind_js_1 = require("./syntaxKind.js");
Object.defineProperty(exports, "SyntaxKind", { enumerable: true, get: function () { return syntaxKind_js_1.SyntaxKind; } });
var syntaxNode_js_1 = require("./syntaxNode.js");
Object.defineProperty(exports, "SyntaxNode", { enumerable: true, get: function () { return syntaxNode_js_1.SyntaxNode; } });
Object.defineProperty(exports, "isNode", { enumerable: true, get: function () { return syntaxNode_js_1.isNode; } });
Object.defineProperty(exports, "isToken", { enumerable: true, get: function () { return syntaxNode_js_1.isToken; } });
// Parser
var parser_js_1 = require("./parser.js");
Object.defineProperty(exports, "parse", { enumerable: true, get: function () { return parser_js_1.parse; } });
// Typed AST
var ast_js_1 = require("./ast.js");
Object.defineProperty(exports, "wrapNode", { enumerable: true, get: function () { return ast_js_1.wrapNode; } });
Object.defineProperty(exports, "AstNode", { enumerable: true, get: function () { return ast_js_1.AstNode; } });
Object.defineProperty(exports, "SourceFile", { enumerable: true, get: function () { return ast_js_1.SourceFile; } });
Object.defineProperty(exports, "FunctionDeclaration", { enumerable: true, get: function () { return ast_js_1.FunctionDeclaration; } });
Object.defineProperty(exports, "FunctionExpression", { enumerable: true, get: function () { return ast_js_1.FunctionExpression; } });
Object.defineProperty(exports, "ParameterList", { enumerable: true, get: function () { return ast_js_1.ParameterList; } });
Object.defineProperty(exports, "Parameter", { enumerable: true, get: function () { return ast_js_1.Parameter; } });
Object.defineProperty(exports, "ReturnTypeClause", { enumerable: true, get: function () { return ast_js_1.ReturnTypeClause; } });
Object.defineProperty(exports, "IfStatement", { enumerable: true, get: function () { return ast_js_1.IfStatement; } });
Object.defineProperty(exports, "ElseIfClause", { enumerable: true, get: function () { return ast_js_1.ElseIfClause; } });
Object.defineProperty(exports, "ElseClause", { enumerable: true, get: function () { return ast_js_1.ElseClause; } });
Object.defineProperty(exports, "ForStatement", { enumerable: true, get: function () { return ast_js_1.ForStatement; } });
Object.defineProperty(exports, "ForEachStatement", { enumerable: true, get: function () { return ast_js_1.ForEachStatement; } });
Object.defineProperty(exports, "WhileStatement", { enumerable: true, get: function () { return ast_js_1.WhileStatement; } });
Object.defineProperty(exports, "TryStatement", { enumerable: true, get: function () { return ast_js_1.TryStatement; } });
Object.defineProperty(exports, "CatchClause", { enumerable: true, get: function () { return ast_js_1.CatchClause; } });
Object.defineProperty(exports, "ReturnStatement", { enumerable: true, get: function () { return ast_js_1.ReturnStatement; } });
Object.defineProperty(exports, "PrintStatement", { enumerable: true, get: function () { return ast_js_1.PrintStatement; } });
Object.defineProperty(exports, "ThrowStatement", { enumerable: true, get: function () { return ast_js_1.ThrowStatement; } });
Object.defineProperty(exports, "DimStatement", { enumerable: true, get: function () { return ast_js_1.DimStatement; } });
Object.defineProperty(exports, "GotoStatement", { enumerable: true, get: function () { return ast_js_1.GotoStatement; } });
Object.defineProperty(exports, "LabelStatement", { enumerable: true, get: function () { return ast_js_1.LabelStatement; } });
Object.defineProperty(exports, "StopStatement", { enumerable: true, get: function () { return ast_js_1.StopStatement; } });
Object.defineProperty(exports, "EndStatement", { enumerable: true, get: function () { return ast_js_1.EndStatement; } });
Object.defineProperty(exports, "ExitForStatement", { enumerable: true, get: function () { return ast_js_1.ExitForStatement; } });
Object.defineProperty(exports, "ExitWhileStatement", { enumerable: true, get: function () { return ast_js_1.ExitWhileStatement; } });
Object.defineProperty(exports, "ContinueForStatement", { enumerable: true, get: function () { return ast_js_1.ContinueForStatement; } });
Object.defineProperty(exports, "ContinueWhileStatement", { enumerable: true, get: function () { return ast_js_1.ContinueWhileStatement; } });
Object.defineProperty(exports, "AssignmentStatement", { enumerable: true, get: function () { return ast_js_1.AssignmentStatement; } });
Object.defineProperty(exports, "ExpressionStatement", { enumerable: true, get: function () { return ast_js_1.ExpressionStatement; } });
Object.defineProperty(exports, "BinaryExpression", { enumerable: true, get: function () { return ast_js_1.BinaryExpression; } });
Object.defineProperty(exports, "UnaryExpression", { enumerable: true, get: function () { return ast_js_1.UnaryExpression; } });
Object.defineProperty(exports, "GroupingExpression", { enumerable: true, get: function () { return ast_js_1.GroupingExpression; } });
Object.defineProperty(exports, "CallExpression", { enumerable: true, get: function () { return ast_js_1.CallExpression; } });
Object.defineProperty(exports, "DotExpression", { enumerable: true, get: function () { return ast_js_1.DotExpression; } });
Object.defineProperty(exports, "IndexExpression", { enumerable: true, get: function () { return ast_js_1.IndexExpression; } });
Object.defineProperty(exports, "OptionalChainingExpression", { enumerable: true, get: function () { return ast_js_1.OptionalChainingExpression; } });
Object.defineProperty(exports, "IdentifierExpression", { enumerable: true, get: function () { return ast_js_1.IdentifierExpression; } });
Object.defineProperty(exports, "LiteralExpression", { enumerable: true, get: function () { return ast_js_1.LiteralExpression; } });
Object.defineProperty(exports, "ArrayLiteral", { enumerable: true, get: function () { return ast_js_1.ArrayLiteral; } });
Object.defineProperty(exports, "AALiteral", { enumerable: true, get: function () { return ast_js_1.AALiteral; } });
Object.defineProperty(exports, "AAField", { enumerable: true, get: function () { return ast_js_1.AAField; } });
Object.defineProperty(exports, "ArgumentList", { enumerable: true, get: function () { return ast_js_1.ArgumentList; } });
Object.defineProperty(exports, "ConditionalCompilation", { enumerable: true, get: function () { return ast_js_1.ConditionalCompilation; } });
Object.defineProperty(exports, "HashConstStatement", { enumerable: true, get: function () { return ast_js_1.HashConstStatement; } });
Object.defineProperty(exports, "HashErrorStatement", { enumerable: true, get: function () { return ast_js_1.HashErrorStatement; } });
// Visitor
var visitor_js_1 = require("./visitor.js");
Object.defineProperty(exports, "walk", { enumerable: true, get: function () { return visitor_js_1.walk; } });
Object.defineProperty(exports, "findAll", { enumerable: true, get: function () { return visitor_js_1.findAll; } });
// Scope analysis
var scope_js_1 = require("./scope.js");
Object.defineProperty(exports, "buildScopes", { enumerable: true, get: function () { return scope_js_1.buildScopes; } });
Object.defineProperty(exports, "findScopeAtLine", { enumerable: true, get: function () { return scope_js_1.findScopeAtLine; } });
Object.defineProperty(exports, "resolve", { enumerable: true, get: function () { return scope_js_1.resolve; } });
// ── Shared catalogs (canonical source — consumed by formatter, linter, extension) ──
// BrightScript built-in functions catalog
var builtins_js_1 = require("./catalog/builtins.js");
Object.defineProperty(exports, "BRIGHTSCRIPT_BUILTINS", { enumerable: true, get: function () { return builtins_js_1.BRIGHTSCRIPT_BUILTINS; } });
Object.defineProperty(exports, "BRIGHTSCRIPT_KEYWORDS", { enumerable: true, get: function () { return builtins_js_1.BRIGHTSCRIPT_KEYWORDS; } });
Object.defineProperty(exports, "builtinNames", { enumerable: true, get: function () { return builtins_js_1.builtinNames; } });
Object.defineProperty(exports, "keywordNames", { enumerable: true, get: function () { return builtins_js_1.keywordNames; } });
Object.defineProperty(exports, "builtinArity", { enumerable: true, get: function () { return builtins_js_1.builtinArity; } });
Object.defineProperty(exports, "findBuiltin", { enumerable: true, get: function () { return builtins_js_1.findBuiltin; } });
Object.defineProperty(exports, "getKeywordCategory", { enumerable: true, get: function () { return builtins_js_1.getKeywordCategory; } });
// Numeric literal type inference
var numericLiterals_js_1 = require("./catalog/numericLiterals.js");
Object.defineProperty(exports, "inferNumericLiteralType", { enumerable: true, get: function () { return numericLiterals_js_1.inferNumericLiteralType; } });
Object.defineProperty(exports, "isNumericLiteral", { enumerable: true, get: function () { return numericLiterals_js_1.isNumericLiteral; } });
Object.defineProperty(exports, "stripNumericLiterals", { enumerable: true, get: function () { return numericLiterals_js_1.stripNumericLiterals; } });
Object.defineProperty(exports, "NUMERIC_LITERAL_GLOBAL_RE", { enumerable: true, get: function () { return numericLiterals_js_1.NUMERIC_LITERAL_GLOBAL_RE; } });
// Identifier casing transforms
var casing_js_1 = require("./catalog/casing.js");
Object.defineProperty(exports, "DEFAULT_CASING_CONFIG", { enumerable: true, get: function () { return casing_js_1.DEFAULT_CASING_CONFIG; } });
Object.defineProperty(exports, "applyCasing", { enumerable: true, get: function () { return casing_js_1.applyCasing; } });
Object.defineProperty(exports, "applyCasingWithOverrides", { enumerable: true, get: function () { return casing_js_1.applyCasingWithOverrides; } });
Object.defineProperty(exports, "resolveKeywordCasing", { enumerable: true, get: function () { return casing_js_1.resolveKeywordCasing; } });
// ── Shared utilities ──
// Glob pattern matching
var globMatcher_js_1 = require("./utils/globMatcher.js");
Object.defineProperty(exports, "matchesGlob", { enumerable: true, get: function () { return globMatcher_js_1.matchesGlob; } });
Object.defineProperty(exports, "findMatchingGlob", { enumerable: true, get: function () { return globMatcher_js_1.findMatchingGlob; } });
// Position-based node lookup (for LSP providers)
var position_js_1 = require("./utils/position.js");
Object.defineProperty(exports, "findNodeAtPosition", { enumerable: true, get: function () { return position_js_1.findNodeAtPosition; } });
Object.defineProperty(exports, "findTokenAtPosition", { enumerable: true, get: function () { return position_js_1.findTokenAtPosition; } });
Object.defineProperty(exports, "getWordAtPosition", { enumerable: true, get: function () { return position_js_1.getWordAtPosition; } });
Object.defineProperty(exports, "escapeRegex", { enumerable: true, get: function () { return position_js_1.escapeRegex; } });
// BrightScript component catalog (ro* objects, interfaces, methods)
var components_js_1 = require("./catalog/components.js");
Object.defineProperty(exports, "BRIGHTSCRIPT_COMPONENTS", { enumerable: true, get: function () { return components_js_1.BRIGHTSCRIPT_COMPONENTS; } });
Object.defineProperty(exports, "BRIGHTSCRIPT_INTERFACES", { enumerable: true, get: function () { return components_js_1.BRIGHTSCRIPT_INTERFACES; } });
Object.defineProperty(exports, "findComponent", { enumerable: true, get: function () { return components_js_1.findComponent; } });
Object.defineProperty(exports, "findInterface", { enumerable: true, get: function () { return components_js_1.findInterface; } });
Object.defineProperty(exports, "getComponentMethods", { enumerable: true, get: function () { return components_js_1.getComponentMethods; } });
Object.defineProperty(exports, "findMethodInterface", { enumerable: true, get: function () { return components_js_1.findMethodInterface; } });
Object.defineProperty(exports, "CATALOG_LAST_VERIFIED", { enumerable: true, get: function () { return components_js_1.CATALOG_LAST_VERIFIED; } });
// SceneGraph XML parsing (pure functions — no file system)
var xmlParsing_js_1 = require("./utils/xmlParsing.js");
Object.defineProperty(exports, "parseXmlScriptUris", { enumerable: true, get: function () { return xmlParsing_js_1.parseXmlScriptUris; } });
Object.defineProperty(exports, "parseXmlInterface", { enumerable: true, get: function () { return xmlParsing_js_1.parseXmlInterface; } });
Object.defineProperty(exports, "parseXmlExtends", { enumerable: true, get: function () { return xmlParsing_js_1.parseXmlExtends; } });
Object.defineProperty(exports, "parseXmlComponentName", { enumerable: true, get: function () { return xmlParsing_js_1.parseXmlComponentName; } });
// ── Analysis modules (for LSP features and advanced linting) ──
// AST-based type inference
var typeInference_js_1 = require("./analysis/typeInference.js");
Object.defineProperty(exports, "inferTypesFromAst", { enumerable: true, get: function () { return typeInference_js_1.inferTypesFromAst; } });
Object.defineProperty(exports, "getVariableType", { enumerable: true, get: function () { return typeInference_js_1.getVariableType; } });
// Call graph (who calls whom, argument tracking)
var callGraph_js_1 = require("./analysis/callGraph.js");
Object.defineProperty(exports, "buildCallGraph", { enumerable: true, get: function () { return callGraph_js_1.buildCallGraph; } });
// Context (m) analysis (m.field tracking, function binding to AAs)
var contextAnalysis_js_1 = require("./analysis/contextAnalysis.js");
Object.defineProperty(exports, "analyzeContext", { enumerable: true, get: function () { return contextAnalysis_js_1.analyzeContext; } });
// Symbol info (rich hover/definition data for builtins and user functions)
var symbolInfo_js_1 = require("./analysis/symbolInfo.js");
Object.defineProperty(exports, "getSymbolInfo", { enumerable: true, get: function () { return symbolInfo_js_1.getSymbolInfo; } });
//# sourceMappingURL=index.js.map
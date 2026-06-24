import {
  buildScopes, walk, analyzeContext,
  CallExpression, DotExpression, FunctionDeclaration, FunctionExpression, IdentifierExpression,
  ThrowStatement, ReturnStatement, Parameter, LiteralExpression, AAField,
  ExitForStatement, ExitWhileStatement, ContinueForStatement, ContinueWhileStatement,
  ForStatement, ForEachStatement, WhileStatement,
  IfStatement, ElseIfClause, ElseClause, TryStatement, CatchClause,
} from 'kopytko-brightscript-parser';
import type { ParseResult, Scope, ContextAnalysis } from 'kopytko-brightscript-parser';

export interface FileAnalysis {
  rootScope: Scope;
  callExpressions: CallExpression[];
  dotExpressions: DotExpression[];
  functionDeclarations: FunctionDeclaration[];
  identifierExpressions: IdentifierExpression[];
  throwStatements: ThrowStatement[];
  parameters: Parameter[];
  literalExpressions: LiteralExpression[];
  forStatements: ForStatement[];
  forEachStatements: ForEachStatement[];
  whileStatements: WhileStatement[];
  ifStatements: IfStatement[];
  elseIfClauses: ElseIfClause[];
  elseClauses: ElseClause[];
  tryStatements: TryStatement[];
  catchClauses: CatchClause[];
  functionExpressions: FunctionExpression[];
  returnStatements: ReturnStatement[];
  aaFields: AAField[];
  exitForStatements: ExitForStatement[];
  exitWhileStatements: ExitWhileStatement[];
  continueForStatements: ContinueForStatement[];
  continueWhileStatements: ContinueWhileStatement[];
  contextAnalysis: ContextAnalysis;
}

export function analyzeFile(parseResult: ParseResult): FileAnalysis {
  const analysis: FileAnalysis = {
    rootScope: buildScopes(parseResult.root),
    callExpressions: [],
    dotExpressions: [],
    functionDeclarations: [],
    identifierExpressions: [],
    throwStatements: [],
    parameters: [],
    literalExpressions: [],
    forStatements: [],
    forEachStatements: [],
    whileStatements: [],
    ifStatements: [],
    elseIfClauses: [],
    elseClauses: [],
    tryStatements: [],
    catchClauses: [],
    functionExpressions: [],
    returnStatements: [],
    aaFields: [],
    exitForStatements: [],
    exitWhileStatements: [],
    continueForStatements: [],
    continueWhileStatements: [],
    contextAnalysis: analyzeContext(parseResult.root),
  };

  walk(parseResult.root, {
    visitCallExpression: node => { analysis.callExpressions.push(node); },
    visitDotExpression: node => { analysis.dotExpressions.push(node); },
    visitFunctionDeclaration: node => { analysis.functionDeclarations.push(node); },
    visitFunctionExpression: node => { analysis.functionExpressions.push(node); },
    visitIdentifierExpression: node => { analysis.identifierExpressions.push(node); },
    visitThrowStatement: node => { analysis.throwStatements.push(node); },
    visitReturnStatement: node => { analysis.returnStatements.push(node); },
    visitLiteralExpression: node => { analysis.literalExpressions.push(node); },
    visitForStatement: node => { analysis.forStatements.push(node); },
    visitForEachStatement: node => { analysis.forEachStatements.push(node); },
    visitWhileStatement: node => { analysis.whileStatements.push(node); },
    visitIfStatement: node => { analysis.ifStatements.push(node); },
    visitElseIfClause: node => { analysis.elseIfClauses.push(node); },
    visitElseClause: node => { analysis.elseClauses.push(node); },
    visitTryStatement: node => { analysis.tryStatements.push(node); },
    visitCatchClause: node => { analysis.catchClauses.push(node); },
    visitAAField: node => { analysis.aaFields.push(node); },
    visitExitForStatement: node => { analysis.exitForStatements.push(node); },
    visitExitWhileStatement: node => { analysis.exitWhileStatements.push(node); },
    visitContinueForStatement: node => { analysis.continueForStatements.push(node); },
    visitContinueWhileStatement: node => { analysis.continueWhileStatements.push(node); },
  });

  for (const fn of analysis.functionDeclarations) {
    analysis.parameters.push(...fn.params);
  }

  return analysis;
}

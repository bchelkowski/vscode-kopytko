/**
 * AST-based lint rules — migrated from regex to use brightscript-parser CST/AST.
 *
 * Advantages over regex:
 * - Cannot match inside string literals
 * - Structural context (is this inside a loop? a function?)
 * - Scope analysis for variable/function resolution
 * - No need for stripStringLiterals() or manual paren balancing
 */

import type { LintDiagnostic, LintSeverity, RuleContext } from '../../types';
import type { LintContext } from '../../context';
import {
  SyntaxKind, SyntaxNode, walk, TokenKind,
  CallExpression,
  IdentifierExpression, ThrowStatement, Parameter,
  AALiteral, LiteralExpression,
  DotExpression, FunctionDeclaration,
  ForStatement, ForEachStatement, WhileStatement,
  IfStatement, ElseIfClause, ElseClause, TryStatement, CatchClause,
  buildScopes, resolve, findScopeAtLine,
  isNode, isToken,
  findComponent, matchesGlob, parse as parseBrs,
} from 'kopytko-brightscript-parser';
import type { Scope, Declaration, ParseResult } from 'kopytko-brightscript-parser';
import { builtinNames, builtinArity, keywordNames } from 'kopytko-brightscript-parser';


function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

// ─── CreateObject unknown component ─────────────────────────────────────────

/**
 * AST-based: detect CreateObject calls with unknown component names.
 * Cannot false-positive on `"CreateObject"` inside strings.
 */
export function checkCreateObjectArgsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['createobject/unknown-component'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  

  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
      const callee = node.callee;
      if (!callee || !(callee instanceof IdentifierExpression)) continue;
      if (callee.name.toLowerCase() !== 'createobject') continue;

      const args = node.args;
      if (args.length === 0) continue;

      const firstArg = args[0];
      if (!firstArg || firstArg.syntax.kind !== SyntaxKind.LiteralExpression) continue;

      const token = firstArg.syntax.childTokens[0];
      if (!token || token.kind !== TokenKind.StringLiteral) continue;

      const componentName = token.text.slice(1, -1);
      if (!componentName || componentName.toLowerCase() === 'rosgnode') continue;

      if (!findComponent(componentName)) {
        diagnostics.push({
          severity: (config['createobject/unknown-component'] as LintSeverity) ?? 'warning',
          code: 'createobject/unknown-component',
          message: `Unknown BrightScript component "${componentName}". Check the component name spelling.`,
          line: token.line, column: token.column,
          endLine: token.line, endColumn: token.column + token.text.length,
          filePath,
        });
      }
  }

  return diagnostics;
}

// ─── Throw statement validation ─────────────────────────────────────────────

/**
 * AST-based: detect throw with invalid operands (numeric, array, AA without message).
 */
export function checkThrowStatementsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['throw/invalid-value'] === 'off' && config['throw/missing-message'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<ThrowStatement>(ctx, parseResult, 'throwStatements', 'visitThrowStatement')) {
      const expr = node.expression;
      if (!expr) continue;
      const exprSyntax = expr.syntax;

      if (config['throw/invalid-value'] !== 'off') {
        if (exprSyntax.kind === SyntaxKind.LiteralExpression) {
          const token = exprSyntax.childTokens[0];
          if (token && isNumericTokenKind(token.kind)) {
            diagnostics.push({
              severity: (config['throw/invalid-value'] as LintSeverity) ?? 'warning',
              code: 'throw/invalid-value',
              message: '`throw` requires a string or an associative array with a "message" field — numeric literals are not valid throw values.',
              line: token.line, column: token.column,
              endLine: token.line, endColumn: token.column + token.text.length,
              filePath,
            });
          }
          // throw invalid — the `invalid` keyword literal is not a valid throw value
          if (token && token.kind === TokenKind.Invalid) {
            diagnostics.push({
              severity: (config['throw/invalid-value'] as LintSeverity) ?? 'warning',
              code: 'throw/invalid-value',
              message: '`throw` requires a string or an associative array with a "message" field — `invalid` is not a valid throw value.',
              line: token.line, column: token.column,
              endLine: token.line, endColumn: token.column + token.text.length,
              filePath,
            });
          }
        }

        // Unary negation of a numeric literal: throw -1, throw -3.14
        if (exprSyntax.kind === SyntaxKind.UnaryExpression) {
          const operand = exprSyntax.findChild(SyntaxKind.LiteralExpression);
          if (operand) {
            const numToken = operand.childTokens[0];
            if (numToken && isNumericTokenKind(numToken.kind)) {
              const minusToken = exprSyntax.childTokens[0];
              const startToken = minusToken ?? numToken;
              diagnostics.push({
                severity: (config['throw/invalid-value'] as LintSeverity) ?? 'warning',
                code: 'throw/invalid-value',
                message: '`throw` requires a string or an associative array with a "message" field — numeric literals are not valid throw values.',
                line: startToken.line, column: startToken.column,
                endLine: numToken.line, endColumn: numToken.column + numToken.text.length,
                filePath,
              });
            }
          }
        }

        if (exprSyntax.kind === SyntaxKind.ArrayLiteral) {
          const firstToken = exprSyntax.childTokens[0];
          if (firstToken) {
            diagnostics.push({
              severity: (config['throw/invalid-value'] as LintSeverity) ?? 'warning',
              code: 'throw/invalid-value',
              message: '`throw` requires a string or an associative array with a "message" field — array literals are not valid throw values.',
              line: firstToken.line, column: firstToken.column,
              endLine: firstToken.line, endColumn: firstToken.column + 1,
              filePath,
            });
          }
        }
      }

      if (config['throw/missing-message'] !== 'off' && exprSyntax.kind === SyntaxKind.AALiteral) {
        const aaNode = new AALiteral(exprSyntax);
        const hasMessage = aaNode.fields.some(
          f => f.key.toLowerCase() === 'message' || f.key === '"message"'
        );
        if (!hasMessage) {
          const firstToken = exprSyntax.childTokens[0];
          if (firstToken) {
            diagnostics.push({
              severity: (config['throw/missing-message'] as LintSeverity) ?? 'warning',
              code: 'throw/missing-message',
              message: 'Thrown associative array should include a "message" field.',
              line: firstToken.line, column: firstToken.column,
              endLine: firstToken.line, endColumn: firstToken.column + 1,
              filePath,
            });
          }
        }
      }
  }

  return diagnostics;
}

function isNumericTokenKind(kind: TokenKind): boolean {
  return kind === TokenKind.IntegerLiteral || kind === TokenKind.FloatLiteral
      || kind === TokenKind.DoubleLiteral || kind === TokenKind.LongIntegerLiteral;
}

// ─── Flow control outside loop ──────────────────────────────────────────────

/**
 * AST-based: detect exit/continue for/while outside their corresponding loop.
 * Uses ancestor chain instead of manual stack tracking.
 */
export function checkLoopFlowControlAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['syntax/flow-outside-loop'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<import('kopytko-brightscript-parser').ExitForStatement>(ctx, parseResult, 'exitForStatements', 'visitExitForStatement')) {
    if (!hasLoopAncestor(node.syntax, SyntaxKind.ForStatement, SyntaxKind.ForEachStatement)) {
      reportFlowError(diagnostics, 'exit', 'for', node.syntax, config, filePath);
    }
  }
  for (const node of collectAst<import('kopytko-brightscript-parser').ExitWhileStatement>(ctx, parseResult, 'exitWhileStatements', 'visitExitWhileStatement')) {
    if (!hasLoopAncestor(node.syntax, SyntaxKind.WhileStatement)) {
      reportFlowError(diagnostics, 'exit', 'while', node.syntax, config, filePath);
    }
  }
  for (const node of collectAst<import('kopytko-brightscript-parser').ContinueForStatement>(ctx, parseResult, 'continueForStatements', 'visitContinueForStatement')) {
    if (!hasLoopAncestor(node.syntax, SyntaxKind.ForStatement, SyntaxKind.ForEachStatement)) {
      reportFlowError(diagnostics, 'continue', 'for', node.syntax, config, filePath);
    }
  }
  for (const node of collectAst<import('kopytko-brightscript-parser').ContinueWhileStatement>(ctx, parseResult, 'continueWhileStatements', 'visitContinueWhileStatement')) {
    if (!hasLoopAncestor(node.syntax, SyntaxKind.WhileStatement)) {
      reportFlowError(diagnostics, 'continue', 'while', node.syntax, config, filePath);
    }
  }

  return diagnostics;
}

/** Checks ancestors for a loop kind, stopping at function boundaries. */
function hasLoopAncestor(node: SyntaxNode, ...kinds: SyntaxKind[]): boolean {
  let current = node.parent;
  while (current) {
    if (kinds.includes(current.kind)) return true;
    if (current.kind === SyntaxKind.FunctionDeclaration || current.kind === SyntaxKind.FunctionExpression) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

function reportFlowError(
  diagnostics: LintDiagnostic[], keyword: string, loopType: string,
  node: SyntaxNode, config: Record<string, unknown>, filePath: string,
): void {
  const token = node.childTokens[0];
  if (!token) return;
  diagnostics.push({
    severity: (config['syntax/flow-outside-loop'] as LintSeverity) ?? 'error',
    code: 'syntax/flow-outside-loop',
    message: `\`${keyword} ${loopType}\` is only valid inside a \`${loopType}\` loop body.`,
    line: token.line, column: token.column,
    endLine: token.line, endColumn: token.column + token.text.length,
    filePath,
  });
}

// ─── Type annotation checks ────────────────────────────────────────────────

/**
 * AST-based: detect missing type annotations on parameters and return types.
 * Handles multi-line params, defaults with complex expressions, nested functions.
 */
export function checkMissingTypeAnnotationsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  const returnTypeOff = config['type/missing-return-type'] === 'off';
  const paramTypeOff = config['type/missing-param-type'] === 'off';
  if (returnTypeOff && paramTypeOff) return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<FunctionDeclaration>(ctx, parseResult, 'functionDeclarations', 'visitFunctionDeclaration')) {
      if (!returnTypeOff && node.isFunction && !node.returnType) {
        const t = node.nameToken;
        if (t) diagnostics.push({
          severity: (config['type/missing-return-type'] as LintSeverity) ?? 'warning',
          code: 'type/missing-return-type',
          message: `Function "${node.name}" is missing a return type annotation.`,
          line: t.line, column: t.column, endLine: t.line, endColumn: t.column + t.text.length, filePath,
        });
      }
      if (!paramTypeOff) checkParamTypes(node.params, diagnostics, config, filePath);
  }
  for (const node of collectAst<import('kopytko-brightscript-parser').FunctionExpression>(ctx, parseResult, 'functionExpressions', 'visitFunctionExpression')) {
      if (!paramTypeOff) checkParamTypes(node.params, diagnostics, config, filePath);
  }

  return diagnostics;
}

function checkParamTypes(
  params: Parameter[], diagnostics: LintDiagnostic[],
  config: Record<string, unknown>, filePath: string,
): void {
  for (const param of params) {
    if (!param.typeName) {
      const t = param.nameToken;
      if (t) diagnostics.push({
        severity: (config['type/missing-param-type'] as LintSeverity) ?? 'warning',
        code: 'type/missing-param-type',
        message: `Parameter "${param.name}" is missing a type annotation.`,
        line: t.line, column: t.column, endLine: t.line, endColumn: t.column + t.text.length, filePath,
      });
    }
  }
}

// ─── Trailing comma after return ────────────────────────────────────────────

/**
 * AST-based: detect trailing comma after return value (syntax error).
 */
export function checkTrailingCommaAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['syntax/trailing-comma'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  walk(parseResult.root, {
    visitReturnStatement(node) {
      const tokens = node.syntax.childTokens;
      const lastToken = tokens[tokens.length - 1];
      if (lastToken && lastToken.kind === TokenKind.Comma) {
        diagnostics.push({
          severity: (config['syntax/trailing-comma'] as LintSeverity) ?? 'error',
          code: 'syntax/trailing-comma',
          message: 'Trailing comma after return value is a syntax error — the code will not compile.',
          line: lastToken.line, column: lastToken.column,
          endLine: lastToken.line, endColumn: lastToken.column + 1,
          filePath,
        });
      }
    },
  });

  return diagnostics;
}

// ─── Shadows builtin ───────────────────────────────────────────────────────

/**
 * AST-based: detect variables/parameters that shadow built-in function names.
 * Uses buildScopes() to find all declarations, checks against builtinNames.
 */
export function checkShadowedBuiltinsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/shadows-builtin'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  function checkScope(s: Scope): void {
    for (const [, decl] of s.declarations) {
      if (decl.kind === 'function') continue; // function names don't shadow
      if (builtinNames.has(decl.nameLower)) {
        diagnostics.push({
          severity: (config['identifier/shadows-builtin'] as LintSeverity) ?? 'error',
          code: 'identifier/shadows-builtin',
          message: `'${decl.name}' shadows the built-in global function '${decl.name}'. Use a different name to avoid hiding the built-in.`,
          line: decl.line, column: decl.column,
          endLine: decl.line, endColumn: decl.column + decl.name.length,
          filePath,
        });
      }
    }
    for (const child of s.children) checkScope(child);
  }

  checkScope(scope);
  return diagnostics;
}

// ─── Shadows user-defined function ────────────────────────────────────────

/**
 * AST-based: detect variables/parameters that shadow a user-defined function.
 * Checks against functions declared in this file (from root scope) and
 * functions imported via @import (from lintContext.knownFuncNames).
 */
export function checkShadowedFunctionsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['identifier/shadows-function'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  // Map lowercase → original casing for local function declarations.
  const localFuncNames = new Map<string, string>();
  for (const [nameLower, decl] of scope.declarations) {
    if (decl.kind === 'function') localFuncNames.set(nameLower, decl.name);
  }

  // Combined: local functions + imported/sibling functions.
  const allFuncNames = new Set<string>([
    ...localFuncNames.keys(),
    ...lintContext.knownFuncNames,
  ]);

  function checkScope(s: Scope): void {
    for (const [, decl] of s.declarations) {
      if (decl.kind === 'function') continue;
      if (!allFuncNames.has(decl.nameLower)) continue;
      const funcName = localFuncNames.get(decl.nameLower) ?? decl.name;
      diagnostics.push({
        severity: (config['identifier/shadows-function'] as LintSeverity) ?? 'error',
        code: 'identifier/shadows-function',
        message: `'${decl.name}' shadows the user-defined function '${funcName}'. Use a different name to avoid hiding the function.`,
        line: decl.line, column: decl.column,
        endLine: decl.line, endColumn: decl.column + decl.name.length,
        filePath,
      });
    }
    for (const child of s.children) checkScope(child);
  }

  checkScope(scope);
  return diagnostics;
}

// ─── Unused parameters ─────────────────────────────────────────────────────

/**
 * AST-based: detect function parameters that are never referenced in the body.
 * Uses buildScopes() — checks parameter declarations vs references in scope.
 */
export function checkUnusedParametersAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/unused-parameter'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  function checkScope(s: Scope): void {
    // Collect all referenced names in this scope (including from nested scopes)
    const usedNames = collectUsedNames(s);

    for (const [, decl] of s.declarations) {
      if (decl.kind !== 'parameter') continue;
      if (decl.name.startsWith('_')) continue; // explicitly unused

      if (!usedNames.has(decl.nameLower)) {
        diagnostics.push({
          severity: (config['identifier/unused-parameter'] as LintSeverity) ?? 'hint',
          code: 'identifier/unused-parameter',
          message: `Parameter "${decl.name}" is never used. Prefix with \`_\` to indicate it is intentionally unused.`,
          line: decl.line, column: decl.column,
          endLine: decl.line, endColumn: decl.column + decl.name.length,
          filePath,
          fix: { type: 'insert' as const, line: decl.line, column: decl.column, text: '_' },
        });
      }
    }
    for (const child of s.children) checkScope(child);
  }

  checkScope(scope);
  return diagnostics;
}

/**
 * Collects all names referenced in a scope's body (references from this
 * scope and its nested child scopes that might read the variable).
 */
function collectUsedNames(scope: Scope): Set<string> {
  const used = new Set<string>();
  for (const ref of scope.references) used.add(ref.nameLower);
  // Nested functions can reference parent scope variables
  for (const child of scope.children) {
    for (const ref of child.references) used.add(ref.nameLower);
    // Go deeper — closures can be nested
    const nested = collectUsedNames(child);
    for (const n of nested) used.add(n);
  }
  return used;
}

/**
 * Checks if a variable declaration is actually read (used) in its scope.
 * A reference on the same line+column as the declaration is the assignment
 * target itself and doesn't count as a "use".
 */
function isVarUsedInScope(decl: Declaration, scope: Scope): boolean {
  // Check direct references in this scope
  for (const ref of scope.references) {
    if (ref.nameLower !== decl.nameLower) continue;
    // Skip the self-reference (assignment target)
    if (ref.line === decl.line && ref.column === decl.column) continue;
    return true;
  }
  // Check references in nested scopes (closures can read parent vars)
  for (const child of scope.children) {
    if (isVarReferencedInScope(decl.nameLower, child)) return true;
  }
  return false;
}

function isVarReferencedInScope(nameLower: string, scope: Scope): boolean {
  for (const ref of scope.references) {
    if (ref.nameLower === nameLower) return true;
  }
  for (const child of scope.children) {
    if (isVarReferencedInScope(nameLower, child)) return true;
  }
  return false;
}

// ─── Unused variables ──────────────────────────────────────────────────────

/**
 * AST-based: detect variables that are assigned but never read.
 * Uses buildScopes() — checks variable declarations vs references.
 */
export function checkUnusedVariablesAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/unused-variable'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  function checkScope(s: Scope): void {
    for (const [, decl] of s.declarations) {
      if (decl.kind !== 'variable' && decl.kind !== 'for-variable'
          && decl.kind !== 'dim-variable' && decl.kind !== 'catch-variable') continue;
      if (decl.name.startsWith('_')) continue;

      // A variable is "used" if it has references on a different line than its declaration,
      // or if it has more references than just the assignment target.
      const isUsed = isVarUsedInScope(decl, s);

      if (!isUsed) {
        diagnostics.push({
          severity: (config['identifier/unused-variable'] as LintSeverity) ?? 'warning',
          code: 'identifier/unused-variable',
          message: `Variable '${decl.name}' is defined but never used. Prefix with \`_\` to indicate it is intentionally unused.`,
          line: decl.line, column: decl.column,
          endLine: decl.line, endColumn: decl.column + decl.name.length,
          filePath,
        });
      }
    }
    for (const child of s.children) checkScope(child);
  }

  checkScope(scope);
  return diagnostics;
}

// ─── Wrong argument count ──────────────────────────────────────────────────

/**
 * AST-based: detect calls to built-in functions with wrong number of arguments.
 * Uses CallExpression.args.length instead of manual paren balancing.
 */
export function checkWrongArgCountAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/wrong-arg-count'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
      const callee = node.callee;
      if (!callee || !(callee instanceof IdentifierExpression)) continue;

      const nameLower = callee.name.toLowerCase();
      if (!builtinNames.has(nameLower)) continue;

      const arity = builtinArity.get(nameLower);
      if (!arity) continue;

      const argCount = node.args.length;
      if (argCount < arity.min || argCount > arity.max) {
        const expected = arity.min === arity.max
          ? `${arity.min} argument${arity.min !== 1 ? 's' : ''}`
          : `${arity.min}–${arity.max} arguments`;
        const got = `${argCount} ${argCount !== 1 ? 'were' : 'was'}`;
        const nameToken = callee.nameToken;
        if (nameToken) {
          diagnostics.push({
            severity: (config['identifier/wrong-arg-count'] as LintSeverity) ?? 'error',
            code: 'identifier/wrong-arg-count',
            message: `'${callee.name}' expects ${expected} but ${got} provided.`,
            line: nameToken.line, column: nameToken.column,
            endLine: nameToken.line, endColumn: nameToken.column + nameToken.text.length,
            filePath,
          });
        }
      }
  }

  return diagnostics;
}

// ─── Undefined function calls ──────────────────────────────────────────────

/**
 * AST-based: detect calls to undefined functions.
 * Uses CallExpression visitor + knownFuncNames from extension context.
 * No regex, no stripStringLiterals needed.
 */
// Roku entry-point function names — calls inside these are exempt from undefined-function checks
const ENTRY_POINT_NAMES = new Set(['main', 'runuserinterface', 'runscreensaver']);

/**
 * Check if a syntax node is inside a top-level entry-point function (Main, RunUserInterface, RunScreenSaver).
 * "Top-level" means the function is declared directly at file scope (not nested).
 */
function isInsideEntryPointFunction(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.kind === SyntaxKind.FunctionDeclaration || current.kind === SyntaxKind.FunctionExpression) {
      if (current.kind === SyntaxKind.FunctionDeclaration) {
        const nameToken = current.findToken(TokenKind.Identifier);
        if (nameToken && ENTRY_POINT_NAMES.has(nameToken.text.toLowerCase())) {
          if (current.parent && current.parent.kind === SyntaxKind.SourceFile) {
            return true;
          }
        }
      }
    }
    current = current.parent;
  }
  return false;
}

export function checkUndefinedCallsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['identifier/undefined-function'] === 'off') return [];
  if (!parseResult) return [];
  if (/[/\\]main\.brs$/i.test(filePath)) return [];
  // Files in /source/ directory have access to all functions (Roku flat scope)
  if (/[/\\]source[/\\]/i.test(filePath)) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);
  const knownFuncNames = lintContext.knownFuncNames;

  // Collect all locally declared names (functions + variables)
  const allLocalNames = new Set<string>();
  function gatherNames(s: Scope): void {
    for (const [name] of s.declarations) allLocalNames.add(name);
    for (const child of s.children) gatherNames(child);
  }
  gatherNames(scope);

  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
      const callee = node.callee;
      if (!callee || !(callee instanceof IdentifierExpression)) continue;

      const name = callee.name;
      const nameLower = name.toLowerCase();

      if (keywordNames.has(nameLower)) continue;
      if (builtinNames.has(nameLower)) continue;
      if (knownFuncNames.has(nameLower)) continue;
      if (allLocalNames.has(nameLower)) continue;

      // Entry-point exemption: calls inside Main/RunUserInterface/RunScreenSaver are exempt
      if (isInsideEntryPointFunction(node.syntax)) continue;

      const nameToken = callee.nameToken;
      if (nameToken) {
        diagnostics.push({
          severity: (config['identifier/undefined-function'] as LintSeverity) ?? 'error',
          code: 'identifier/undefined-function',
          message: `Unknown function '${name}'. It is not defined in this file or any reachable @import.`,
          line: nameToken.line, column: nameToken.column,
          endLine: nameToken.line, endColumn: nameToken.column + nameToken.text.length,
          filePath,
        });
      }
  }

  return diagnostics;
}

// ─── Undefined variables ───────────────────────────────────────────────────

/**
 * Resolve a variable name respecting BrightScript's no-closures semantics.
 * Anonymous functions (FunctionExpression) cannot see variables from enclosing function scopes.
 * Resolution walks up the scope chain but skips parent function scopes when crossing
 * a FunctionExpression boundary.
 */
function resolveNoClosures(name: string, scope: Scope): Declaration | undefined {
  const lower = name.toLowerCase();
  // Check current scope first
  const decl = scope.declarations.get(lower);
  if (decl) return decl;

  // Walk up, but skip intermediate function scopes if current scope is a function
  if (!scope.parent) return undefined;

  // If this scope's owner is a FunctionExpression (anonymous function),
  // skip all parent function scopes and go directly to file scope
  const ownerKind = scope.owner?.kind;
  if (ownerKind === SyntaxKind.FunctionExpression) {
    // Jump to file scope (root), skipping parent function scopes
    let fileScope = scope.parent;
    while (fileScope.parent) fileScope = fileScope.parent;
    return fileScope.declarations.get(lower);
  }

  // For named function scopes (FunctionDeclaration), check file scope
  if (ownerKind === SyntaxKind.FunctionDeclaration) {
    return scope.parent.declarations.get(lower);
  }

  // For other scopes (shouldn't happen with current parser), fall through
  return resolve(name, scope.parent);
}

/**
 * AST-based: detect usage of undefined variables.
 * Uses scope analysis — checks identifier references against declarations.
 * Respects BrightScript's no-closures semantics for anonymous functions.
 */
export function checkUndefinedVariablesAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['identifier/undefined-variable'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const rootScope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);
  const knownFuncNames = lintContext.knownFuncNames;
  const ALWAYS_VALID = new Set(['m', 'true', 'false', 'invalid', 'line_num']);

  // Collect all call target identifiers (line:col) to exclude from undefined-variable checks.
  // These are handled by checkUndefinedCallsAst instead.
  const callTargets = new Set<string>();
  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
    const callee = node.callee;
    if (callee && callee instanceof IdentifierExpression) {
      const t = callee.nameToken;
      if (t) callTargets.add(`${t.line}:${t.column}`);
    }
  }

  function checkScope(scope: Scope): void {
    for (const ref of scope.references) {
      if (ALWAYS_VALID.has(ref.nameLower)) continue;
      if (keywordNames.has(ref.nameLower)) continue;
      if (builtinNames.has(ref.nameLower)) continue;
      if (knownFuncNames.has(ref.nameLower)) continue;

      // Skip references that are call targets (handled by undefined-function rule)
      if (callTargets.has(`${ref.line}:${ref.column}`)) continue;

      // Resolve with no-closures semantics
      if (resolveNoClosures(ref.name, scope)) continue;

      diagnostics.push({
        severity: (config['identifier/undefined-variable'] as LintSeverity) ?? 'error',
        code: 'identifier/undefined-variable',
        message: `'${ref.name}' is used but never defined in this scope.`,
        line: ref.line, column: ref.column,
        endLine: ref.line, endColumn: ref.column + ref.name.length,
        filePath,
      });
    }
    for (const child of scope.children) checkScope(child);
  }

  checkScope(rootScope);
  return diagnostics;
}

// ─── Observer callback checks ──────────────────────────────────────────────

/**
 * AST-based: detect observeField/observeFieldScoped calls with undefined callbacks.
 * Uses CallExpression visitor to find the calls structurally.
 */
export function checkObserverCallbacksAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  const code = 'callback/undefined-observer-callback';
  if (config[code] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);
  const localFuncNames = new Set<string>();
  function gatherFuncNames(s: Scope): void {
    for (const [name, decl] of s.declarations) {
      if (decl.kind === 'function') localFuncNames.add(name);
    }
    for (const child of s.children) gatherFuncNames(child);
  }
  gatherFuncNames(scope);

  for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
      // Check if callee is .observeField or .observeFieldScoped
      const calleeSyntax = node.syntax.findChild(SyntaxKind.DotExpression);
      if (!calleeSyntax) continue;

      const memberToken = calleeSyntax.childTokens[calleeSyntax.childTokens.length - 1];
      if (!memberToken) continue;
      const methodName = memberToken.text.toLowerCase();
      if (methodName !== 'observefield' && methodName !== 'observefieldscoped') continue;

      // Second argument should be the callback name string
      const args = node.args;
      if (args.length < 2) continue;
      const secondArg = args[1];
      if (!secondArg || secondArg.syntax.kind !== SyntaxKind.LiteralExpression) continue;
      const strToken = secondArg.syntax.childTokens[0];
      if (!strToken || strToken.kind !== TokenKind.StringLiteral) continue;

      const callbackName = strToken.text.slice(1, -1);
      if (!callbackName) continue;

      const lower = callbackName.toLowerCase();
      if (lintContext.knownFuncNames.has(lower) || localFuncNames.has(lower)) continue;

      diagnostics.push({
        severity: (config[code] as LintSeverity) ?? 'error',
        code,
        message: `Callback function '${callbackName}' is not defined in this file or any reachable @import.`,
        line: strToken.line, column: strToken.column + 1,
        endLine: strToken.line, endColumn: strToken.column + 1 + callbackName.length,
        filePath,
      });
  }

  return diagnostics;
}

// ─── Test file structure ───────────────────────────────────────────────────

/**
 * AST-based: check test file structure (missing return ts, missing mock annotation).
 * Uses FunctionDeclaration visitor to find TestSuite functions.
 */
export function checkTestFileStructureAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext, imports } = ctx;
  if (!lintContext.isTestFile(filePath)) return [];
  if (config['test/missing-mock-annotation'] === 'off' && config['test/missing-return-ts'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  // Find TestSuite function and check for `return ts`
  if (config['test/missing-return-ts'] !== 'off') {
    for (const node of collectAst<FunctionDeclaration>(ctx, parseResult, 'functionDeclarations', 'visitFunctionDeclaration')) {
        if (!/^TestSuite__/i.test(node.name)) continue;

        // Check if body contains a `return ts` statement
        let hasReturnTs = false;
        walk(node.syntax, {
          visitReturnStatement(ret) {
            const val = ret.value;
            if (val && val instanceof IdentifierExpression && val.name.toLowerCase() === 'ts') {
              hasReturnTs = true;
            }
          },
        });

        if (!hasReturnTs) {
          const nameToken = node.nameToken;
          if (nameToken) {
            diagnostics.push({
              severity: (config['test/missing-return-ts'] as LintSeverity) ?? 'warning',
              code: 'test/missing-return-ts',
              message: 'Test suite function should end with `return ts` to return the suite object to the test runner.',
              line: nameToken.line, column: 0,
              endLine: nameToken.line, endColumn: Number.MAX_SAFE_INTEGER,
              filePath,
            });
          }
        }
    }
  }

  // Check mockFunction() calls reference mocked identifiers
  if (config['test/missing-mock-annotation'] !== 'off') {
    const mockedIdentifiers = new Set<string>();
    for (const imp of imports) {
      if (!imp.isMock) continue;
      const resolved = lintContext.resolveImportPath(imp.importPath, filePath, imp.fromModule);
      if (!resolved) continue;
      const text = lintContext.readFile(resolved);
      if (!text) continue;
      // Parse the mock file for function names
      
      const mockResult = parseBrs(text);
      walk(mockResult.root, {
        visitFunctionDeclaration(fn) { mockedIdentifiers.add(fn.name.toLowerCase()); },
      });
    }

    if (mockedIdentifiers.size > 0) {
      for (const node of collectAst<CallExpression>(ctx, parseResult, 'callExpressions', 'visitCallExpression')) {
          const callee = node.callee;
          if (!callee || !(callee instanceof IdentifierExpression)) continue;
          if (callee.name.toLowerCase() !== 'mockfunction') continue;

          const args = node.args;
          if (args.length === 0) continue;
          const firstArg = args[0];
          if (!firstArg || firstArg.syntax.kind !== SyntaxKind.LiteralExpression) continue;
          const strToken = firstArg.syntax.childTokens[0];
          if (!strToken || strToken.kind !== TokenKind.StringLiteral) continue;

          const mockTarget = strToken.text.slice(1, -1);
          const topLevel = mockTarget.includes('.') ? mockTarget.split('.')[0] : mockTarget;
          if (!mockedIdentifiers.has(topLevel.toLowerCase())) {
            diagnostics.push({
              severity: (config['test/missing-mock-annotation'] as LintSeverity) ?? 'warning',
              code: 'test/missing-mock-annotation',
              message: `"${topLevel}" is not defined in any \`@mock\`'ed file. Add a \`' @mock\` annotation for the file that defines "${topLevel}".`,
              line: strToken.line, column: strToken.column,
              endLine: strToken.line, endColumn: strToken.column + strToken.text.length,
              filePath,
            });
          }
      }
    }
  }

  return diagnostics;
}

// ─── Event callbacks (Kopytko events pattern) ──────────────────────────────

/**
 * AST-based: check event callback values in Kopytko `events: { key: "funcName" }` blocks.
 * Validates that the function names referenced as string values exist.
 */
export function checkEventCallbacksAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  const code = 'callback/undefined-event-callback';
  if (config[code] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const scope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);
  const localFuncNames = new Set<string>();
  function gatherFuncs(s: Scope): void {
    for (const [name, decl] of s.declarations) {
      if (decl.kind === 'function') localFuncNames.add(name);
    }
    for (const child of s.children) gatherFuncs(child);
  }
  gatherFuncs(scope);

  // Find AA fields named "events" with an AA value containing string callbacks
  for (const node of collectAst<import('kopytko-brightscript-parser').AAField>(ctx, parseResult, 'aaFields', 'visitAAField')) {
      const key = node.key.toLowerCase().replace(/"/g, '');
      if (key !== 'events') continue;

      // The value should be an AALiteral containing key: "callbackName" entries
      const value = node.value;
      if (!value || !(value instanceof AALiteral)) continue;

      for (const field of value.fields) {
        const fieldValue = field.value;
        if (!fieldValue || !(fieldValue instanceof LiteralExpression)) continue;
        const token = fieldValue.token;
        if (!token || token.kind !== TokenKind.StringLiteral) continue;

        const callbackName = token.text.slice(1, -1);
        if (!callbackName) continue;

        const lower = callbackName.toLowerCase();
        if (lintContext.knownFuncNames.has(lower) || localFuncNames.has(lower)) continue;

        diagnostics.push({
          severity: (config[code] as LintSeverity) ?? 'error',
          code,
          message: `Event callback function '${callbackName}' is not defined in this file or any reachable @import.`,
          line: token.line,
          column: token.column + 1,
          endLine: token.line,
          endColumn: token.column + 1 + callbackName.length,
          filePath,
        });
      }
  }

  return diagnostics;
}

// ─── Import checks (AST-based on trivia) ───────────────────────────────────

/**
 * Check if any function from an imported file is actually used in the current file
 * (or its sibling/test sibling files). Uses AST analysis to avoid false positives
 * from comments or string literals.
 */
function isFunctionFromImportUsed(
  importedFuncNames: string[],
  currentFilePath: string,
  currentContent: string,
  currentParseResult: ParseResult | undefined,
  lintContext: LintContext,
  currentFileScope?: Scope,
  currentIdentifiers?: IdentifierExpression[],
): boolean {
  const funcNamesLower = new Set(importedFuncNames.map(n => n.toLowerCase()));

  // Check usage in current file using the already-parsed result.
  // Pass the pre-built scope so buildScopes is not called again for each import.
  if (currentParseResult) {
    if (hasReferenceToAnyInTree(currentParseResult, funcNamesLower, currentFileScope, currentIdentifiers)) return true;
  } else if (currentContent) {
    if (hasReferenceToAny(currentContent, funcNamesLower)) return true;
  }

  const isTestFile = lintContext.isTestFile(currentFilePath);
  const isPromiseHelper = funcNamesLower.has('promiseresolve') || funcNamesLower.has('promisereject');

  // PromiseResolve/PromiseReject are used indirectly via .resolvedValue()/.rejectedValue()
  if (isPromiseHelper && isTestFile && contentUsesPromiseHelper(currentContent, funcNamesLower)) return true;

  // Check usage in sibling files
  const siblings = lintContext.getSiblingFiles(currentFilePath);
  for (const sib of siblings) {
    const content = lintContext.readFile(sib);
    if (!content) continue;
    if (hasReferenceToAny(content, funcNamesLower)) return true;
    if (isPromiseHelper && isTestFile && contentUsesPromiseHelper(content, funcNamesLower)) return true;
  }

  // Check usage in test sibling files
  const testSiblings = lintContext.getTestSiblings(currentFilePath);
  for (const sib of testSiblings) {
    const content = lintContext.readFile(sib);
    if (!content) continue;
    if (hasReferenceToAny(content, funcNamesLower)) return true;
    if (isPromiseHelper && isTestFile && contentUsesPromiseHelper(content, funcNamesLower)) return true;
  }

  return false;
}

/**
 * Check if any identifier in `funcNames` is referenced in an already-parsed tree —
 * either as a direct call (`asd()`) or as a value (`callback = asd`).
 *
 * Scope-aware: skips references where the name is locally declared (variable or
 * parameter), because those shadow the imported function and do not constitute usage.
 * `resolve()` walks the file's scope chain; imported functions are not in the tree,
 * so it returns `undefined` for them — only locally declared names resolve.
 */
/**
 * @param prebuiltScope — pre-built scope tree for `parseResult.root`. When the caller
 * already holds a scope (e.g., the current-file scope built once for the full import
 * loop), passing it avoids a redundant `buildScopes` call.
 */
function hasReferenceToAnyInTree(parseResult: ParseResult, funcNames: Set<string>, prebuiltScope?: Scope, identifiers?: IdentifierExpression[]): boolean {
  const rootScope = prebuiltScope ?? buildScopes(parseResult.root);
  const refs = identifiers ?? collectAst<IdentifierExpression>({} as RuleContext, parseResult, 'identifierExpressions', 'visitIdentifierExpression');
  for (const node of refs) {
    const nameLower = node.name.toLowerCase();
    if (!funcNames.has(nameLower)) continue;
    // If the name resolves to a local declaration, it shadows the import — skip.
    const token = node.nameToken;
    const line = token?.line ?? -1;
    const enclosingScope = findScopeAtLine(rootScope, line);
    if (resolve(nameLower, enclosingScope)) continue;
    return true;
  }
  return false;
}

/**
 * Parse text and check if any identifier in `funcNames` is referenced (called or used as value).
 * Uses the parser to avoid matching names in comments or string literals.
 */
function hasReferenceToAny(text: string, funcNames: Set<string>): boolean {
  const parseResult = parseBrs(text);
  if (!parseResult) return false;
  return hasReferenceToAnyInTree(parseResult, funcNames);
}

function contentUsesPromiseHelper(content: string, funcNames: Set<string>): boolean {
  if (funcNames.has('promiseresolve') && content.includes('.resolvedValue(')) return true;
  if (funcNames.has('promisereject') && content.includes('.rejectedValue(')) return true;
  return false;
}

/**
 * AST-based: check @import/@mock annotations in comment trivia.
 * Validates: duplicate, missing path, unresolved, unused.
 */
export function checkImportsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, imports, config, lintContext, parseResult, lines } = ctx;
  const currentContent = lines.join('\n');
  const diagnostics: LintDiagnostic[] = [];
  const seenImportKeys = new Set<string>();

  // Build the scope for the current file once so isFunctionFromImportUsed can pass it
  // to hasReferenceToAnyInTree without rebuilding it for every resolved @import.
  const currentFileScope = parseResult ? (ctx.analysis?.rootScope ?? buildScopes(parseResult.root)) : undefined;

  for (const imp of imports) {
    const lineIndex = imp.line - 1;
    const annotationType = imp.isMock ? '@mock' : '@import';

    // import/duplicate
    if (config['import/duplicate'] !== 'off') {
      const importKey = `${imp.importPath}|${imp.fromModule ?? ''}`;
      if (seenImportKeys.has(importKey)) {
        diagnostics.push({
          severity: (config['import/duplicate'] as LintSeverity) ?? 'warning',
          code: 'import/duplicate',
          message: `Kopytko ${annotationType}: duplicate import "${imp.importPath}"${imp.fromModule ? ` from "${imp.fromModule}"` : ''}.`,
          line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
          fix: { type: 'delete-line' as const, line: lineIndex, column: 0 },
        });
        continue;
      }
      seenImportKeys.add(importKey);
    }

    // import/missing-path
    if (config['import/missing-path'] !== 'off' && (!imp.importPath || imp.importPath.trim() === '')) {
      diagnostics.push({
        severity: (config['import/missing-path'] as LintSeverity) ?? 'error',
        code: 'import/missing-path',
        message: `Kopytko ${annotationType}: missing import path.`,
        line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
      });
      continue;
    }

    // import/path-not-absolute
    if (config['import/path-not-absolute'] !== 'off' && !imp.importPath.startsWith('/')) {
      diagnostics.push({
        severity: (config['import/path-not-absolute'] as LintSeverity) ?? 'warning',
        code: 'import/path-not-absolute',
        message: `Kopytko ${annotationType}: path "${imp.importPath}" should start with "/".`,
        line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
      });
    }

    // Resolve the import
    const resolved = lintContext.resolveImportPath(imp.importPath, filePath, imp.fromModule);
    if (resolved !== null) {
      // import/unused — check if any function from the resolved file is actually used
      if (config['import/unused'] !== 'off' && !imp.isMock) {
        const funcs = lintContext.parseFunctionsFromFile(resolved);
        if (funcs.length > 0) {
          // Check usage in current file + sibling files
          const isUsed = isFunctionFromImportUsed(funcs, filePath, currentContent, parseResult, lintContext, currentFileScope, ctx.analysis?.identifierExpressions);
          if (!isUsed) {
            diagnostics.push({
              severity: (config['import/unused'] as LintSeverity) ?? 'warning',
              code: 'import/unused',
              message: `Kopytko ${annotationType}: "${imp.importPath}" is imported but none of its functions are referenced.`,
              line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
              fix: { type: 'delete-line' as const, line: lineIndex, column: 0 },
            });
          }
        }
      }
      continue;
    }

    // Check if this is a build-generated file (matches generatedPaths/generatedModules)
    let matchedPattern: string | null = null;
    if (lintContext.generatedPaths && lintContext.generatedPaths.length > 0) {
      const pattern = lintContext.generatedPaths.find((p: string) => matchesGlob(imp.importPath, p));
      if (pattern) matchedPattern = pattern;
    }
    if (!matchedPattern && lintContext.generatedModules && lintContext.generatedModules.length > 0) {
      const gm = lintContext.generatedModules.find((gm: { path: string }) => matchesGlob(imp.importPath, gm.path));
      if (gm) matchedPattern = gm.path;
    }

    if (config['import/build-generated'] !== 'off' && matchedPattern) {
      diagnostics.push({
        severity: (config['import/build-generated'] as LintSeverity) ?? 'info',
        code: 'import/build-generated',
        message: `Kopytko ${annotationType}: "${imp.importPath}" matches generated pattern "${matchedPattern}" — file will be created at build time.`,
        line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
      });
      continue;
    }

    // import/unresolved
    if (config['import/unresolved'] !== 'off') {
      const label = imp.fromModule ? `"${imp.importPath}" from "${imp.fromModule}"` : `"${imp.importPath}"`;
      diagnostics.push({
        severity: (config['import/unresolved'] as LintSeverity) ?? 'warning',
        code: 'import/unresolved',
        message: imp.fromModule
          ? `Kopytko ${annotationType}: cannot resolve ${label}. Is "${imp.fromModule}" installed as an NPM dependency?`
          : `Kopytko ${annotationType}: cannot resolve ${label}. Check the file path and the sourceDir configuration.`,
        line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
      });
    }
  }

  // import/missing-promise-deps: warn when .resolvedValue()/.rejectedValue() used without the required import

  if (config['import/missing-promise-deps'] !== 'off' && lintContext.isTestFile(filePath)) {
    // Collect imports from current file and siblings (split suites share imports at runtime)
    const allImports = [...imports];
    for (const sib of [...lintContext.getSiblingFiles(filePath), ...lintContext.getTestSiblings(filePath)]) {
      const sibContent = lintContext.readFile(sib);
      if (sibContent) allImports.push(...lintContext.parseImports(sibContent));
    }

    const hasPromiseResolveImport = allImports.some(
      imp => !imp.isMock && imp.importPath.toLowerCase().endsWith('promiseresolve.brs'),
    );
    const hasPromiseRejectImport = allImports.some(
      imp => !imp.isMock && imp.importPath.toLowerCase().endsWith('promisereject.brs'),
    );

    if (!hasPromiseResolveImport && currentContent.includes('.resolvedValue(')) {
      const lineIndex = lines.findIndex(line => line.includes('.resolvedValue('));
      if (lineIndex >= 0) {
        diagnostics.push({
          severity: (config['import/missing-promise-deps'] as LintSeverity) ?? 'warning',
          code: 'import/missing-promise-deps',
          message: "`.resolvedValue()` requires `' @import /components/promise/PromiseResolve.brs from @dazn/kopytko-utils`.",
          line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
        });
      }
    }

    if (!hasPromiseRejectImport && currentContent.includes('.rejectedValue(')) {
      const lineIndex = lines.findIndex(line => line.includes('.rejectedValue('));
      if (lineIndex >= 0) {
        diagnostics.push({
          severity: (config['import/missing-promise-deps'] as LintSeverity) ?? 'warning',
          code: 'import/missing-promise-deps',
          message: "`.rejectedValue()` requires `' @import /components/promise/PromiseReject.brs from @dazn/kopytko-utils`.",
          line: lineIndex, column: 0, endLine: lineIndex, endColumn: Number.MAX_SAFE_INTEGER, filePath,
        });
      }
    }
  }

  return diagnostics;
}

// ─── Dead-code diagnostic ───────────────────────────────────────────────────

/**
 * AST-based: detect top-level functions never called anywhere in the workspace.
 * Requires `lintContext.calledWorkwideFuncNames` to be populated by the extension
 * (via WorkspaceCallIndex). Returns [] in CLI mode where it is absent.
 */
export function checkDeadFunctionsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['identifier/unused-function'] === 'off') return [];
  if (!parseResult) return [];
  if (!lintContext.calledWorkwideFuncNames) return [];
  if (filePath.replace(/\\/g, '/').includes('/source/')) return [];
  if (lintContext.isTestFile(filePath)) return [];

  const called = lintContext.calledWorkwideFuncNames;
  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<FunctionDeclaration>(ctx, parseResult, 'functionDeclarations', 'visitFunctionDeclaration')) {
      if (node.syntax.parent?.kind !== SyntaxKind.SourceFile) continue;

      const name = node.name;
      const nameLower = name.toLowerCase();
      if (nameLower === 'init') continue;
      if (nameLower === 'onkeyevent') continue;
      if (name.startsWith('_')) continue;
      if (called.has(nameLower)) continue;

      const nameToken = node.nameToken;
      if (!nameToken) continue;

      diagnostics.push({
        severity: (config['identifier/unused-function'] as LintSeverity) ?? 'hint',
        code: 'identifier/unused-function',
        message: `Function '${name}' is defined but never called anywhere in the workspace.`,
        line: nameToken.line,
        column: nameToken.column,
        endLine: nameToken.line,
        endColumn: nameToken.column + name.length,
        filePath,
      });
  }

  return diagnostics;
}

// ─── Shared token/line helpers ──────────────────────────────────────────────

function getFirstToken(node: SyntaxNode): import('kopytko-brightscript-parser').Token | undefined {
  for (const child of node.children) {
    if (isToken(child)) return child;
    if (isNode(child)) {
      const t = getFirstToken(child);
      if (t) return t;
    }
  }
  return undefined;
}

function getFirstTokenLine(node: SyntaxNode): number {
  const t = getFirstToken(node);
  return t ? t.line : -1;
}

function getLastTokenLine(node: SyntaxNode): number {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (isToken(child)) return child.line;
    if (isNode(child)) {
      const line = getLastTokenLine(child);
      if (line >= 0) return line;
    }
  }
  return -1;
}

// ─── Loop variable leak ─────────────────────────────────────────────────────

interface LoopRange { startLine: number; endLine: number; }

function collectLoopRanges(funcNode: SyntaxNode): LoopRange[] {
  const ranges: LoopRange[] = [];

  // Manual CST traversal — avoids using walk() so the "stop at nested functions"
  // boundary does not fire on the root FunctionDeclaration node itself.
  function traverseNode(node: SyntaxNode): void {
    for (const child of node.children) {
      if (!isNode(child)) continue;
      const kind = child.kind;
      if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.FunctionExpression) {
        continue; // Do not descend into nested function bodies
      }
      if (
        kind === SyntaxKind.ForStatement ||
        kind === SyntaxKind.ForEachStatement ||
        kind === SyntaxKind.WhileStatement
      ) {
        const start = getFirstTokenLine(child);
        const end = getLastTokenLine(child);
        if (start >= 0 && end >= 0) ranges.push({ startLine: start, endLine: end });
        traverseNode(child); // Recurse into the loop body for nested loops
      } else {
        traverseNode(child);
      }
    }
  }

  traverseNode(funcNode);
  return ranges;
}

/**
 * AST-based: detect variables first assigned inside a loop body that are referenced
 * after the loop ends. BrightScript is function-scoped so the variable is technically
 * accessible, but relying on it is fragile when the loop may not execute.
 *
 * Only checks FunctionDeclaration scopes. FunctionExpression scopes (anonymous functions)
 * cannot capture outer-function variables due to BrightScript's no-closures semantics.
 */
export function checkLoopVariableLeakAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/loop-variable-leak'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const rootScope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  function checkFunctionScope(funcScope: Scope): void {
    if (!funcScope.owner) return;
    if (funcScope.owner.kind !== SyntaxKind.FunctionDeclaration) return;

    const loopRanges = collectLoopRanges(funcScope.owner);
    if (loopRanges.length === 0) return;

    // Pre-build a map of write-reference lines per variable for condition B.
    const writeLinesByName = new Map<string, number[]>();
    for (const ref of funcScope.references) {
      if (!ref.isWrite) continue;
      if (!writeLinesByName.has(ref.nameLower)) writeLinesByName.set(ref.nameLower, []);
      writeLinesByName.get(ref.nameLower)!.push(ref.line);
    }

    for (const [, decl] of funcScope.declarations) {
      if (decl.kind !== 'variable' && decl.kind !== 'for-variable' && decl.kind !== 'dim-variable') continue;

      // Find the INNERMOST (smallest range) loop that contains the declaration line.
      // loopRanges is in outer-first order, so .find() would return the outer loop —
      // causing false negatives for variables used between an inner and outer loop's end.
      let containingLoop: LoopRange | undefined;
      for (const r of loopRanges) {
        if (decl.line >= r.startLine && decl.line <= r.endLine) {
          if (!containingLoop || (r.endLine - r.startLine) < (containingLoop.endLine - containingLoop.startLine)) {
            containingLoop = r;
          }
        }
      }
      if (!containingLoop) continue;

      for (const ref of funcScope.references) {
        if (ref.nameLower !== decl.nameLower) continue;
        if (ref.line === decl.line && ref.column === decl.column) continue;
        if (ref.line > containingLoop.endLine) {
          // Condition A: this reference is a plain `=` write — not a read of a
          // potentially-undefined value, so it is always safe.
          if (ref.isWrite) continue;
          // Condition B: a write to this variable exists between the containing loop's
          // end and this reference — the variable was reset before this point.
          const writeLines = writeLinesByName.get(decl.nameLower);
          if (writeLines?.some(wl => wl > containingLoop!.endLine && wl < ref.line)) continue;
          diagnostics.push({
            severity: (config['identifier/loop-variable-leak'] as LintSeverity) ?? 'warning',
            code: 'identifier/loop-variable-leak',
            message: `'${decl.name}' is first assigned inside a loop body and may be undefined if the loop never executes. Define it before the loop.`,
            line: ref.line, column: ref.column,
            endLine: ref.line, endColumn: ref.column + decl.name.length,
            filePath,
          });
        }
      }
    }
  }

  function walkScopes(scope: Scope): void {
    checkFunctionScope(scope);
    for (const child of scope.children) walkScopes(child);
  }

  walkScopes(rootScope);
  return diagnostics;
}

// ─── Duplicate function name ────────────────────────────────────────────────

/**
 * AST-based: detect function declarations whose name collides with a function
 * already visible in scope (from @import, sibling files, /source/) or declared
 * earlier in the same file. Ancestor-component overrides (from the `extends`
 * chain) are exempt when `lintContext.ancestorFuncNames` is populated.
 */
export function checkDuplicateFunctionsAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['identifier/duplicate-function'] === 'off') return [];
  if (!parseResult) return [];
  if (/[/\\]source[/\\]/i.test(filePath)) return [];

  const diagnostics: LintDiagnostic[] = [];
  // externalFuncNames, when provided by the extension, contains only functions from
  // imports/siblings/source — NOT from the current file. This avoids false positives
  // that arise because knownFuncNames always includes the file's own functions.
  // In tests and CLI mode (where externalFuncNames is absent), we fall back to
  // knownFuncNames which preserves the pre-existing behavior.
  const crossScopeNames = lintContext.externalFuncNames ?? lintContext.knownFuncNames;
  const ancestorFuncNames = lintContext.ancestorFuncNames;
  const seenInFile = new Map<string, string>(); // nameLower → original name

  for (const node of collectAst<FunctionDeclaration>(ctx, parseResult, 'functionDeclarations', 'visitFunctionDeclaration')) {
      if (node.syntax.parent?.kind !== SyntaxKind.SourceFile) continue;

      const nameToken = node.nameToken;
      if (!nameToken) continue;
      const nameLower = node.name.toLowerCase();

      // Same-file duplicate (second definition wins at runtime — flag it)
      if (seenInFile.has(nameLower)) {
        diagnostics.push({
          severity: (config['identifier/duplicate-function'] as LintSeverity) ?? 'error',
          code: 'identifier/duplicate-function',
          message: `Function '${node.name}' is already declared in this file (as '${seenInFile.get(nameLower)}'). The second definition silently overrides the first.`,
          line: nameToken.line, column: nameToken.column,
          endLine: nameToken.line, endColumn: nameToken.column + nameToken.text.length,
          filePath,
        });
        continue;
      }
      seenInFile.set(nameLower, node.name);

      // Cross-scope duplicate: name exists in external scope (imports, siblings, /source/).
      if (!crossScopeNames.has(nameLower)) continue;
      // Ancestor override is allowed
      if (ancestorFuncNames && ancestorFuncNames.has(nameLower)) continue;

      diagnostics.push({
        severity: (config['identifier/duplicate-function'] as LintSeverity) ?? 'error',
        code: 'identifier/duplicate-function',
        message: `Function '${node.name}' is already defined in a reachable scope (via @import or sibling file). This will silently override the existing function at runtime.`,
        line: nameToken.line, column: nameToken.column,
        endLine: nameToken.line, endColumn: nameToken.column + nameToken.text.length,
        filePath,
      });
  }

  return diagnostics;
}

// ─── m.top undefined field ──────────────────────────────────────────────────

/**
 * AST-based: detect `m.top.fieldName` accesses where `fieldName` is not declared
 * in the component's XML interface or any ancestor component / SG node.
 * Only runs when `lintContext.getMtopFields` is populated (extension mode).
 */
export function checkMtopFieldAccessAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult, lintContext } = ctx;
  if (config['mtop/undefined-field'] === 'off') return [];
  if (!parseResult) return [];
  if (!lintContext.getMtopFields) return [];

  const validFields = lintContext.getMtopFields(filePath);
  if (!validFields) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const node of collectAst<DotExpression>(ctx, parseResult, 'dotExpressions', 'visitDotExpression')) {
      // Match the pattern: m.top.<fieldName>
      const obj = node.object;
      if (!(obj instanceof DotExpression)) continue;

      const innerObj = obj.object;
      if (!(innerObj instanceof IdentifierExpression)) continue;
      if (innerObj.name.toLowerCase() !== 'm') continue;
      if (obj.member.toLowerCase() !== 'top') continue;

      // m.top.method() — built-in SG methods are not declared in <interface>, skip
      if (node.syntax.parent?.kind === SyntaxKind.CallExpression) continue;

      const fieldName = node.member.toLowerCase();
      if (validFields.has(fieldName)) continue;

      const memberToken = node.memberToken;
      if (!memberToken) continue;

      diagnostics.push({
        severity: (config['mtop/undefined-field'] as LintSeverity) ?? 'warning',
        code: 'mtop/undefined-field',
        message: `'${node.member}' is not declared in this component's XML interface or any ancestor component.`,
        line: memberToken.line, column: memberToken.column,
        endLine: memberToken.line, endColumn: memberToken.column + memberToken.text.length,
        filePath,
      });
  }

  return diagnostics;
}


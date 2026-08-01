import {
  SyntaxKind, SyntaxNode, TokenKind, CallExpression, IdentifierExpression, walk,
  buildScopes, builtinNames, keywordNames,
} from 'kopytko-brightscript-parser';
import type { ParseResult, Scope } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

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

/**
 * AST-based: detect calls to undefined functions.
 * Uses CallExpression visitor + knownFuncNames from extension context.
 * No regex, no stripStringLiterals needed.
 */
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

export const descriptor: RuleDefinition = {
  code: 'identifier/undefined-function',
  defaultSeverity: 'error',
  fn: checkUndefinedCallsAst,
};

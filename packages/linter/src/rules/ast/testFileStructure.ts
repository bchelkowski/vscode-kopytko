import {
  SyntaxKind, TokenKind, CallExpression, IdentifierExpression, FunctionDeclaration,
  walk, parse as parseBrs,
} from 'kopytko-brightscript-parser';
import type { ParseResult } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function collectAst<T>(ctx: RuleContext, parseResult: ParseResult, analysisKey: keyof NonNullable<RuleContext['analysis']>, visit: string): T[] {
  const fromAnalysis = ctx.analysis?.[analysisKey] as T[] | undefined;
  if (fromAnalysis) return fromAnalysis;
  const nodes: T[] = [];
  walk(parseResult.root, { [visit]: (node: T) => { nodes.push(node); } });
  return nodes;
}

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

export const descriptor: RuleDefinition = {
  code: 'test/*',
  defaultSeverity: 'warning',
  fn: checkTestFileStructureAst,
};

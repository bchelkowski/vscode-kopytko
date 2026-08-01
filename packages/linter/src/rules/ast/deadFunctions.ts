import { SyntaxKind, FunctionDeclaration, walk } from 'kopytko-brightscript-parser';
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

export const descriptor: RuleDefinition = {
  code: 'identifier/unused-function',
  defaultSeverity: 'hint',
  fn: checkDeadFunctionsAst,
};

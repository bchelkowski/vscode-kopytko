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

export const descriptor: RuleDefinition = {
  code: 'identifier/duplicate-function',
  defaultSeverity: 'error',
  fn: checkDuplicateFunctionsAst,
};

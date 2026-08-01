import { TokenKind, walk, firstToken } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

/**
 * AST-based: detect trailing comma after return value (syntax error).
 */
export function checkTrailingCommaAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['syntax/trailing-comma'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];

  const report = (line: number, column: number): void => {
    diagnostics.push({
      severity: (config['syntax/trailing-comma'] as LintSeverity) ?? 'error',
      code: 'syntax/trailing-comma',
      message: 'Trailing comma after return value is a syntax error — the code will not compile.',
      line, column,
      endLine: line, endColumn: column + 1,
      filePath,
    });
  };

  walk(parseResult.root, {
    visitReturnStatement(node) {
      const tokens = node.syntax.childTokens;
      const lastToken = tokens[tokens.length - 1];
      if (lastToken && lastToken.kind === TokenKind.Comma) {
        report(lastToken.line, lastToken.column);
        return;
      }

      // `return x,` is itself a parse error — the parser cannot attach an
      // unexpected trailing comma to the ReturnStatement, so it surfaces as
      // an ErrorNode in the *next* sibling slot instead (see
      // findings/lsp-architecture.md). Detect that shape too, so this rule
      // is a strict superset of the regex version it replaces rather than
      // silently losing the single most common case.
      const parent = node.syntax.parent;
      if (!parent) return;
      const siblings = parent.childNodes;
      const next = siblings[siblings.indexOf(node.syntax) + 1];
      if (!next) return;
      const nextFirst = firstToken(next);
      if (nextFirst?.kind === TokenKind.Comma && nextFirst.line === (lastToken?.line ?? node.syntax.line)) {
        report(nextFirst.line, nextFirst.column);
      }
    },
  });

  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'syntax/trailing-comma',
  defaultSeverity: 'error',
  fn: checkTrailingCommaAst,
};

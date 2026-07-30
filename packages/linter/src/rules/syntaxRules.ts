import type { LintDiagnostic, RuleContext, RuleDefinition } from '../types';

export function checkTrailingCommaSyntaxErrors(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;
  if (config['syntax/trailing-comma'] === 'off') return [];

  const diagnostics: LintDiagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    const returnCommaMatch = /^\s*return\b\s+.+,\s*$/.exec(raw);
    if (returnCommaMatch) {
      const commaPos = raw.lastIndexOf(',');
      diagnostics.push({
        severity: config['syntax/trailing-comma'] ?? 'error',
        code: 'syntax/trailing-comma',
        message: 'Trailing comma after return value is a syntax error — the code will not compile.',
        line: lineIdx,
        column: commaPos,
        endLine: lineIdx,
        endColumn: commaPos + 1,
        filePath,
      });
    }
  }

  return diagnostics;
}

export const trailingCommaSyntaxRule: RuleDefinition = {
  code: 'syntax/trailing-comma',
  defaultSeverity: 'error',
  fn: checkTrailingCommaSyntaxErrors,
};

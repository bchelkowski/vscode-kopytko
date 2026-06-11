import type { LintResult } from '../types';

export function formatJson(result: LintResult): string {
  return JSON.stringify({
    diagnostics: result.diagnostics.map(d => ({
      filePath: d.filePath,
      line: d.line + 1,
      column: d.column + 1,
      endLine: d.endLine !== undefined ? d.endLine + 1 : undefined,
      endColumn: d.endColumn !== undefined ? d.endColumn + 1 : undefined,
      severity: d.severity,
      code: d.code,
      message: d.message,
    })),
    summary: {
      fileCount: result.fileCount,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      infoCount: result.infoCount,
      hintCount: result.hintCount,
      totalIssues: result.diagnostics.length,
    },
  }, null, 2);
}

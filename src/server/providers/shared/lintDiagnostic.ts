import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import type { LintDiagnostic, LintSeverity } from 'kopytko-linter';

const SEVERITY_MAP: Record<LintSeverity, typeof DiagnosticSeverity[keyof typeof DiagnosticSeverity]> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

/**
 * Converts a linter diagnostic to its LSP form.
 *
 * Shared by the per-file diagnostics provider and the workspace-level component
 * checks, so everything the linter produces reaches the editor identically —
 * same severity mapping, same `source`, same `code`.
 */
export function toLspDiagnostic(d: LintDiagnostic): Diagnostic {
  return {
    severity: SEVERITY_MAP[d.severity] ?? DiagnosticSeverity.Warning,
    range: {
      start: { line: d.line, character: d.column },
      end: { line: d.endLine ?? d.line, character: d.endColumn ?? Number.MAX_SAFE_INTEGER },
    },
    message: d.message,
    source: 'kopytko',
    code: d.code,
  };
}

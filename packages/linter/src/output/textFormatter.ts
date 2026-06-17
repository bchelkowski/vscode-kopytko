import type { LintDiagnostic, LintResult } from '../types';

const SEVERITY_COLORS: Record<string, string> = {
  error: '\x1b[31m',   // red
  warning: '\x1b[33m', // yellow
  info: '\x1b[36m',    // cyan
  hint: '\x1b[90m',    // gray
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function groupByFile(diagnostics: LintDiagnostic[]): Map<string, LintDiagnostic[]> {
  const groups = new Map<string, LintDiagnostic[]>();
  for (const d of diagnostics) {
    const existing = groups.get(d.filePath) ?? [];
    existing.push(d);
    groups.set(d.filePath, existing);
  }
  return groups;
}

export function formatText(result: LintResult, useColors = true): string {
  const c = useColors ? SEVERITY_COLORS : { error: '', warning: '', info: '', hint: '' };
  const reset = useColors ? RESET : '';
  const bold = useColors ? BOLD : '';
  const dim = useColors ? DIM : '';

  const lines: string[] = [];
  const grouped = groupByFile(result.diagnostics);

  for (const [filePath, diagnostics] of grouped) {
    lines.push('');
    lines.push(`${bold}${filePath}${reset}`);

    const sorted = diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
    for (const d of sorted) {
      const sevColor = c[d.severity] ?? '';
      const loc = `${dim}${d.line + 1}:${d.column + 1}${reset}`;
      const sev = `${sevColor}${d.severity.padEnd(7)}${reset}`;
      const code = `${dim}${d.code}${reset}`;
      lines.push(`  ${loc}  ${sev}  ${d.message}  ${code}`);
    }
  }

  if (result.diagnostics.length > 0) {
    lines.push('');
    const parts: string[] = [];
    if (result.errorCount > 0) parts.push(`${c['error']}${result.errorCount} error${result.errorCount !== 1 ? 's' : ''}${reset}`);
    if (result.warningCount > 0) parts.push(`${c['warning']}${result.warningCount} warning${result.warningCount !== 1 ? 's' : ''}${reset}`);
    if (result.infoCount > 0) parts.push(`${c['info']}${result.infoCount} info${reset}`);
    if (result.hintCount > 0) parts.push(`${c['hint']}${result.hintCount} hint${result.hintCount !== 1 ? 's' : ''}${reset}`);
    lines.push(`✖ ${parts.join(', ')} in ${result.fileCount} file${result.fileCount !== 1 ? 's' : ''}`);
  } else {
    lines.push('');
    lines.push(`✓ No issues found in ${result.fileCount} file${result.fileCount !== 1 ? 's' : ''}`);
  }

  lines.push('');
  return lines.join('\n');
}

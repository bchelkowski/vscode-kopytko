import * as fs from 'fs';
import type { LintDiagnostic, LintFix } from './types';

/**
 * Applies auto-fixes to files based on lint diagnostics.
 * Returns the number of fixes applied.
 */
export function applyFixes(diagnostics: LintDiagnostic[]): number {
  const fixable = diagnostics.filter((d): d is LintDiagnostic & { fix: LintFix } => d.fix !== undefined);
  if (fixable.length === 0) return 0;

  const byFile = new Map<string, (LintDiagnostic & { fix: LintFix })[]>();
  for (const d of fixable) {
    const list = byFile.get(d.filePath) ?? [];
    list.push(d);
    byFile.set(d.filePath, list);
  }

  let totalFixed = 0;

  for (const [filePath, fileDiags] of byFile) {
    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';

    // Sort by line descending so fixes don't shift subsequent line numbers
    const sorted = [...fileDiags].sort((a, b) => {
      if (a.fix.line !== b.fix.line) return b.fix.line - a.fix.line;
      return b.fix.column - a.fix.column;
    });

    // Deduplicate by line+column to avoid double-fixing
    const seen = new Set<string>();
    const deduped = sorted.filter((d) => {
      const key = `${d.fix.type}:${d.fix.line}:${d.fix.column}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const d of deduped) {
      const { fix } = d;

      if (fix.type === 'delete-line' && fix.line >= 0 && fix.line < lines.length) {
        lines.splice(fix.line, 1);
        totalFixed++;
      } else if (fix.type === 'insert' && fix.text && fix.line >= 0 && fix.line < lines.length) {
        const line = lines[fix.line];
        const col = Math.min(fix.column, line.length);
        lines[fix.line] = line.slice(0, col) + fix.text + line.slice(col);
        totalFixed++;
      }
    }

    try {
      fs.writeFileSync(filePath, lines.join(lineEnding), 'utf-8');
    } catch {
      // Skip files we can't write to
    }
  }

  return totalFixed;
}

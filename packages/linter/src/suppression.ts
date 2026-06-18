import { matchesGlob } from './analysis/globMatcher';
import type { LintDiagnostic } from './types';

// Map from 0-based line number to suppressed rule code patterns.
// null means "suppress all rules"; Set<string> contains exact codes or glob patterns.
type SuppressionMap = Map<number, Set<string> | null>;

const DISABLE_NEXT_LINE_RE = /^\s*(?:'|rem\b)\s*kopytko-disable-next-line(?:\s+(.+))?$/i;
const DISABLE_LINE_RE = /(?:'|rem\b)\s*kopytko-disable-line(?:\s+(.+))?$/i;

function parseCodeList(raw: string | undefined): Set<string> | null {
  if (raw === undefined || raw.trim() === '') return null;
  return new Set(raw.split(',').map(s => s.trim()).filter(s => s.length > 0));
}

function mergeEntries(
  existing: Set<string> | null,
  incoming: Set<string> | null,
): Set<string> | null {
  if (existing === null || incoming === null) return null;
  for (const code of incoming) existing.add(code);
  return existing;
}

function addToMap(map: SuppressionMap, line: number, codes: Set<string> | null): void {
  const existing = map.get(line);
  if (existing === undefined) {
    map.set(line, codes);
  } else {
    map.set(line, mergeEntries(existing, codes));
  }
}

export function parseSuppressionMap(lines: string[]): SuppressionMap {
  const map: SuppressionMap = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const nextMatch = DISABLE_NEXT_LINE_RE.exec(line);
    if (nextMatch) {
      addToMap(map, i + 1, parseCodeList(nextMatch[1]));
    }

    const sameMatch = DISABLE_LINE_RE.exec(line);
    if (sameMatch) {
      addToMap(map, i, parseCodeList(sameMatch[1]));
    }
  }

  return map;
}

export function isSuppressed(map: SuppressionMap, diagnostic: LintDiagnostic): boolean {
  const entry = map.get(diagnostic.line);
  if (entry === undefined) return false;
  if (entry === null) return true;
  for (const pattern of entry) {
    if (matchesGlob(diagnostic.code, pattern)) return true;
  }
  return false;
}

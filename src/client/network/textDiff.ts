/**
 * A small line-level text diff used by the Network Inspector's "compare two
 * flows" view. Pure and dependency-free so it unit-tests directly and bundles
 * into the webview.
 */

export type DiffOp = 'equal' | 'add' | 'del';

export interface DiffRow {
  op: DiffOp;
  text: string;
}

/**
 * Unified line diff of `aText` (the "A"/before side) against `bText` (the
 * "B"/after side): `del` rows come only from A, `add` rows only from B,
 * `equal` rows are shared. Common prefix/suffix are trimmed cheaply first so
 * the O(n·m) LCS only runs over the changed middle; a pathological middle
 * falls back to "all deleted then all added" rather than hanging.
 */
export function diffLines(aText: string, bText: string): DiffRow[] {
  const a = aText.length ? aText.split('\n') : [];
  const b = bText.length ? bText.split('\n') : [];

  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ai = a.length;
  let bi = b.length;
  while (ai > lo && bi > lo && a[ai - 1] === b[bi - 1]) {
    ai--;
    bi--;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < lo; i++) rows.push({ op: 'equal', text: a[i] });
  rows.push(...lcsDiff(a.slice(lo, ai), b.slice(lo, bi)));
  for (let i = ai; i < a.length; i++) rows.push({ op: 'equal', text: a[i] });
  return rows;
}

function lcsDiff(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ op: 'add' as const, text }));
  if (m === 0) return a.map((text) => ({ op: 'del' as const, text }));
  // Guard: a huge changed middle isn't worth an O(n·m) table — show it as a
  // wholesale replacement instead of grinding.
  if (n * m > 4_000_000) {
    return [
      ...a.map((text) => ({ op: 'del' as const, text })),
      ...b.map((text) => ({ op: 'add' as const, text })),
    ];
  }

  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ op: 'equal', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ op: 'del', text: a[i] });
      i++;
    } else {
      rows.push({ op: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ op: 'del', text: a[i++] });
  while (j < m) rows.push({ op: 'add', text: b[j++] });
  return rows;
}

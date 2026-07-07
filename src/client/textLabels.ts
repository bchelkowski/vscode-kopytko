/**
 * Normalizes a raw list of user-typed labels: trims whitespace, drops empty
 * strings, and de-dupes case-insensitively (first-seen casing wins) so
 * "Bug"/"bug"/"BUG" collapse to one stored label while comparisons across
 * the app (filter, sort, autocomplete) stay case-insensitive.
 */
export function normalizeLabels(labels: string[] | undefined): string[] {
  if (!labels) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label === '') continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

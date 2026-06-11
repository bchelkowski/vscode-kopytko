import * as nodePath from 'path';
import fsWrapper from './fsWrapper';

/**
 * Matches a filename against a single-wildcard pattern (e.g. "*.component.brs").
 * Returns the string captured by the wildcard, or null if there is no match.
 */
export function matchWildcard(str: string, pattern: string): string | null {
  const starIdx = pattern.indexOf('*');
  if (starIdx < 0) return str === pattern ? '' : null;
  const prefix = pattern.slice(0, starIdx);
  const suffix = pattern.slice(starIdx + 1);
  if (str.startsWith(prefix) && str.endsWith(suffix) && str.length >= prefix.length + suffix.length) {
    const end = suffix.length > 0 ? str.length - suffix.length : str.length;
    return str.slice(prefix.length, end);
  }
  return null;
}

/** Replaces the single `*` in a pattern with the given wildcard value. */
export function applyWildcard(pattern: string, wildcard: string): string {
  return pattern.replace('*', wildcard);
}

/**
 * Given a document path and sibling pattern groups, returns the absolute paths
 * of any sibling files that exist alongside the current document.
 */
export function findSiblingFiles(documentPath: string, siblingPatterns: string[][]): string[] {
  if (siblingPatterns.length === 0) return [];
  const dir = nodePath.dirname(documentPath);
  const filename = nodePath.basename(documentPath);

  for (const group of siblingPatterns) {
    for (const pattern of group) {
      const wildcard = matchWildcard(filename, pattern);
      if (wildcard === null) continue;

      const siblings: string[] = [];
      for (const siblingPattern of group) {
        if (siblingPattern === pattern) continue;
        const siblingPath = nodePath.join(dir, applyWildcard(siblingPattern, wildcard));
        if (fsWrapper.existsSync(siblingPath)) siblings.push(siblingPath);
      }
      return siblings; // use first matching group only
    }
  }
  return [];
}

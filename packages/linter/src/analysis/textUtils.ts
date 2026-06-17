/** Escapes special regex characters in a string for use in `new RegExp(...)`. */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces string literal contents with spaces, preserving character offsets.
 * When `stripComments` is true, truncates at the first `'` comment marker
 * outside a string.
 */
export function stripStringLiterals(s: string, stripComments = false): string {
  let result = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += '"';
      } else if (s[i + 1] === '"') {
        result += '  '; // BrightScript escaped quote ""
        i++;
      } else {
        inString = false;
        result += '"';
      }
    } else if (inString) {
      result += ' ';
    } else if (stripComments && ch === "'") {
      break; // rest is a comment
    } else {
      result += ch;
    }
  }
  return result;
}

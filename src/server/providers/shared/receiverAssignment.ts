/**
 * Scans lines backward for a `receiverName = ConstructorName(...)` assignment
 * and returns `ConstructorName`, or null if none is found by line 0.
 *
 * `anchorToLineStart` requires the assignment to be the first thing on the
 * line (after optional whitespace); otherwise the receiver only needs to
 * appear at a word boundary anywhere on the line.
 */
export function findAssignedConstructor(
  lines: string[],
  fromLine: number,
  receiverName: string,
  opts: { anchorToLineStart?: boolean } = {},
): string | null {
  const escaped = receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = opts.anchorToLineStart
    ? `^\\s*${escaped}\\s*=\\s*(\\w+)\\s*\\(`
    : `\\b${escaped}\\s*=\\s*(\\w+)\\s*\\(`;
  const re = new RegExp(pattern, 'i');
  for (let i = fromLine; i >= 0; i--) {
    const match = re.exec(lines[i]);
    if (match) return match[1];
  }
  return null;
}

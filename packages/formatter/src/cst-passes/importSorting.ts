/* eslint-disable @typescript-eslint/no-unused-vars *//**
 * CST Pass: Import sorting.
 *
 * Sorts `' @import` and `' @mock` annotations at the top of the file.
 * Groups: module imports (with `from`) first, then local imports.
 * Within each group, sorts alphabetically.
 *
 * Unlike the regex version, this pass:
 * - Uses trivia classification to identify import comments precisely
 * - Works on the actual trivia text, not line-by-line matching
 * - Preserves all non-import content exactly as-is
 */

import { SyntaxNode, TriviaKind, isToken, isNode } from 'kopytko-brightscript-parser';
import type { Token, Trivia } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

interface ImportSortConfig {
  sortImports: boolean;
  emptyLineAfterImports: boolean;
}

const IMPORT_RE = /^\s*'\s*@import\s+/;
const MOCK_RE = /^\s*'\s*@mock\s+/;
const FROM_IMPORT_RE = /^\s*'\s*@import\s+(.*?)\s+from\s+(\S+)\s*(?:(?:'|rem\b).*)?$/;
const FROM_MOCK_RE = /^\s*'\s*@mock\s+(.*?)\s+from\s+(\S+)\s*(?:(?:'|rem\b).*)?$/;
const SUPPRESSION_RE = /^\s*(?:'|rem\b)\s*kopytko-disable-next-line\b/i;

/**
 * Creates an import sorting CST pass.
 * Operates on the leading trivia of the first token in the file.
 */
export function importSortingPass(config: ImportSortConfig): (root: SyntaxNode, source: string) => TextEdit[] {
  if (!config.sortImports && !config.emptyLineAfterImports) {
    return () => [];
  }

  return (root: SyntaxNode, source: string): TextEdit[] => {
    // Find all import/mock comment lines at the top of the file.
    // In our CST, these are trivia attached to the first token.
    const firstToken = findFirstToken(root);
    if (!firstToken) return [];

    // Collect consecutive import comments from leading trivia.
    // disable-next-line suppression comments are treated as transparent prefixes
    // that travel with the import that follows them during sorting.
    interface ImportEntry { prefixes: Trivia[]; trivia: Trivia }
    const importEntries: ImportEntry[] = [];
    let pendingPrefixes: Trivia[] = [];

    for (let i = 0; i < firstToken.leadingTrivia.length; i++) {
      const t = firstToken.leadingTrivia[i];
      if (t.kind === TriviaKind.Comment) {
        if (IMPORT_RE.test(t.text) || MOCK_RE.test(t.text)) {
          importEntries.push({ prefixes: pendingPrefixes, trivia: t });
          pendingPrefixes = [];
        } else if (SUPPRESSION_RE.test(t.text)) {
          pendingPrefixes.push(t);
        } else {
          // Non-import, non-suppression comment — stop
          break;
        }
      }
      // Skip whitespace and line breaks between imports
    }

    if (importEntries.length === 0) return [];
    if (!config.sortImports) return []; // Only sorting for now

    // Sort entries into groups, keeping each entry's prefixes with it
    const moduleImportEntries: ImportEntry[] = [];
    const localImportEntries: ImportEntry[] = [];
    const moduleMockEntries: ImportEntry[] = [];
    const localMockEntries: ImportEntry[] = [];

    for (const entry of importEntries) {
      if (MOCK_RE.test(entry.trivia.text)) {
        if (FROM_MOCK_RE.test(entry.trivia.text)) moduleMockEntries.push(entry);
        else localMockEntries.push(entry);
      } else {
        if (FROM_IMPORT_RE.test(entry.trivia.text)) moduleImportEntries.push(entry);
        else localImportEntries.push(entry);
      }
    }

    moduleImportEntries.sort((a, b) => {
      const am = FROM_IMPORT_RE.exec(a.trivia.text)!;
      const bm = FROM_IMPORT_RE.exec(b.trivia.text)!;
      const cmp = am[2].localeCompare(bm[2]);
      return cmp !== 0 ? cmp : am[1].localeCompare(bm[1]);
    });
    localImportEntries.sort((a, b) => a.trivia.text.localeCompare(b.trivia.text));
    moduleMockEntries.sort((a, b) => {
      const am = FROM_MOCK_RE.exec(a.trivia.text)!;
      const bm = FROM_MOCK_RE.exec(b.trivia.text)!;
      const cmp = am[2].localeCompare(bm[2]);
      return cmp !== 0 ? cmp : am[1].localeCompare(bm[1]);
    });
    localMockEntries.sort((a, b) => a.trivia.text.localeCompare(b.trivia.text));

    const sortedEntries = [
      ...moduleImportEntries, ...localImportEntries,
      ...moduleMockEntries, ...localMockEntries,
    ];

    // Check if already sorted (comparing flattened prefix+import texts)
    const originalTexts = importEntries.flatMap(e => [...e.prefixes.map(p => p.text), e.trivia.text]);
    const sortedTexts = sortedEntries.flatMap(e => [...e.prefixes.map(p => p.text), e.trivia.text]);
    if (arraysEqual(originalTexts, sortedTexts)) return [];

    // Build the replacement range: from the start of the first prefix (or first import)
    // to the end of the last import trivia.
    const firstEntry = importEntries[0];
    const lastEntry = importEntries[importEntries.length - 1];
    const rangeStart = firstEntry.prefixes.length > 0
      ? firstEntry.prefixes[0].pos
      : firstEntry.trivia.pos;
    const rangeEnd = lastEntry.trivia.end;

    const newText = sortedEntries
      .map(e => [...e.prefixes.map(p => p.text), e.trivia.text].join('\n'))
      .join('\n');
    return [{ pos: rangeStart, end: rangeEnd, newText }];
  };
}

function findFirstToken(node: SyntaxNode): Token | undefined {
  for (const child of node.children) {
    if (isToken(child)) return child;
    if (isNode(child)) {
      const found = findFirstToken(child);
      if (found) return found;
    }
  }
  return undefined;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

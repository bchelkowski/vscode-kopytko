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
const FROM_IMPORT_RE = /^\s*'\s*@import\s+(.*?)\s+from\s+(\S+)\s*$/;
const FROM_MOCK_RE = /^\s*'\s*@mock\s+(.*?)\s+from\s+(\S+)\s*$/;

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

    // Collect consecutive import comments from leading trivia
    const importTrivia: Trivia[] = [];
    let lastImportIdx = -1;

    for (let i = 0; i < firstToken.leadingTrivia.length; i++) {
      const t = firstToken.leadingTrivia[i];
      if (t.kind === TriviaKind.Comment) {
        if (IMPORT_RE.test(t.text) || MOCK_RE.test(t.text)) {
          importTrivia.push(t);
          lastImportIdx = i;
        } else {
          // Non-import comment encountered — stop
          break;
        }
      }
      // Skip whitespace and line breaks between imports
    }

    if (importTrivia.length === 0) return [];
    if (!config.sortImports) return []; // Only sorting for now

    // Sort imports
    const moduleImports: string[] = [];
    const localImports: string[] = [];
    const moduleMocks: string[] = [];
    const localMocks: string[] = [];

    for (const t of importTrivia) {
      if (MOCK_RE.test(t.text)) {
        if (FROM_MOCK_RE.test(t.text)) moduleMocks.push(t.text);
        else localMocks.push(t.text);
      } else {
        if (FROM_IMPORT_RE.test(t.text)) moduleImports.push(t.text);
        else localImports.push(t.text);
      }
    }

    // Sort each group
    moduleImports.sort((a, b) => {
      const am = FROM_IMPORT_RE.exec(a)!;
      const bm = FROM_IMPORT_RE.exec(b)!;
      const cmp = am[2].localeCompare(bm[2]);
      return cmp !== 0 ? cmp : am[1].localeCompare(bm[1]);
    });
    localImports.sort();
    moduleMocks.sort((a, b) => {
      const am = FROM_MOCK_RE.exec(a)!;
      const bm = FROM_MOCK_RE.exec(b)!;
      const cmp = am[2].localeCompare(bm[2]);
      return cmp !== 0 ? cmp : am[1].localeCompare(bm[1]);
    });
    localMocks.sort();

    const sorted = [...moduleImports, ...localImports, ...moduleMocks, ...localMocks];

    // Check if already sorted
    const original = importTrivia.map(t => t.text);
    if (arraysEqual(original, sorted)) return [];

    // Build the replacement: sorted imports joined by newlines
    const firstImport = importTrivia[0];
    const lastImport = importTrivia[importTrivia.length - 1];
    // Find the range covering all import trivia (from first import start to last import end)
    const rangeStart = firstImport.pos;
    const rangeEnd = lastImport.end;

    const newText = sorted.join('\n');
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

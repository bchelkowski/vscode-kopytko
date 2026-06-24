import { SelectionRange, Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  findNodeAtPosition,
  SyntaxNode,
  isToken,
  isNode,
} from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { getCachedParseResult } from '../utils/documentCache';

function firstToken(node: SyntaxNode): Token | undefined {
  for (const child of node.children) {
    if (isToken(child)) return child;
    const tok = firstToken(child);
    if (tok) return tok;
  }
  return undefined;
}

function lastToken(node: SyntaxNode): Token | undefined {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (isToken(child)) return child;
    const tok = lastToken(child);
    if (tok) return tok;
  }
  return undefined;
}

function nodeToRange(node: SyntaxNode): Range | null {
  const first = firstToken(node);
  const last = lastToken(node);
  if (!first || !last) return null;
  return Range.create(first.line, first.column, last.line, last.column + last.text.length);
}

function rangesEqual(a: Range, b: Range): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.character === b.start.character &&
    a.end.line === b.end.line &&
    a.end.character === b.end.character
  );
}

export class BrightScriptSelectionRangeProvider {
  provideSelectionRanges(document: TextDocument, positions: Position[]): SelectionRange[] {
    try {
      const parseResult = getCachedParseResult(document);
      const root = parseResult.root;

      return positions.map((position) => {
        const hit = findNodeAtPosition(root, position.line, position.character);
        if (!hit) return { range: Range.create(position.line, position.character, position.line, position.character) };

        const rawRanges: Range[] = [];
        for (const ancestor of hit.ancestors) {
          const r = nodeToRange(ancestor);
          if (r) rawRanges.push(r);
        }

        if (hit.token) {
          const tok = hit.token;
          const tokenRange = Range.create(tok.line, tok.column, tok.line, tok.column + tok.text.length);
          const last = rawRanges[rawRanges.length - 1];
          if (!last || !rangesEqual(last, tokenRange)) {
            rawRanges.push(tokenRange);
          }
        }

        const unique = rawRanges.filter((r, i) => i === 0 || !rangesEqual(r, rawRanges[i - 1]));

        let current: SelectionRange | undefined;
        for (const range of unique) {
          current = { range, parent: current };
        }

        return current ?? { range: Range.create(position.line, position.character, position.line, position.character) };
      });
    } catch {
      return positions.map((pos) => ({
        range: Range.create(pos.line, pos.character, pos.line, pos.character),
      }));
    }
  }
}

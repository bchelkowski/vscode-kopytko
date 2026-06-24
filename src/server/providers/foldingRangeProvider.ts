import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  walk,
  SyntaxNode,
  isToken,
} from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { getCachedParseResult, getCachedLines } from '../utils/documentCache';

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

function blockRange(node: SyntaxNode): FoldingRange | null {
  const first = firstToken(node);
  const last = lastToken(node);
  if (!first || !last || last.line <= first.line) return null;
  return { startLine: first.line, endLine: last.line };
}

const IMPORT_LINE_RE = /^\s*'\s*@(?:import|mock)\b/;

export class BrightScriptFoldingRangeProvider {
  provideFoldingRanges(document: TextDocument): FoldingRange[] {
    const ranges: FoldingRange[] = [];

    try {
      const parseResult = getCachedParseResult(document);

      walk(parseResult.root, {
        visitFunctionDeclaration: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitFunctionExpression: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitIfStatement: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitElseIfClause: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitElseClause: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitForStatement: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitForEachStatement: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitWhileStatement: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitTryStatement: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
        visitCatchClause: (node) => { const r = blockRange(node.syntax); if (r) ranges.push(r); },
      });
    } catch {
      // Never crash the LSP request
    }

    const lines = getCachedLines(document);
    let blockStart = -1;
    for (let i = 0; i < lines.length; i++) {
      const isImport = IMPORT_LINE_RE.test(lines[i]);
      if (isImport && blockStart === -1) {
        blockStart = i;
      } else if (!isImport && blockStart !== -1) {
        if (i - 1 > blockStart) {
          ranges.push({ startLine: blockStart, endLine: i - 1, kind: FoldingRangeKind.Imports });
        }
        blockStart = -1;
      }
    }
    if (blockStart !== -1 && lines.length - 1 > blockStart) {
      ranges.push({ startLine: blockStart, endLine: lines.length - 1, kind: FoldingRangeKind.Imports });
    }

    return ranges;
  }
}

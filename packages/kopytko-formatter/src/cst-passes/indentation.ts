/* eslint-disable @typescript-eslint/no-unused-vars *//**
 * CST Pass: Indentation.
 *
 * Applies consistent indentation based on nesting depth.
 * Walks the CST structure to determine indent level and sets
 * leading whitespace accordingly.
 */

import { SyntaxNode, SyntaxKind, TokenKind, isToken, isNode } from 'brightscript-parser';
import type { Token } from 'brightscript-parser';
import { TextEdit } from './infrastructure';

interface IndentConfig {
  indentSize: number;
  useTabs: boolean;
}

const INDENT_OPENERS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.IfStatement,
  SyntaxKind.ElseIfClause,
  SyntaxKind.ElseClause,
  SyntaxKind.ForStatement,
  SyntaxKind.ForEachStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.TryStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalCompilation,
]);

/**
 * Creates an indentation pass.
 * Calculates depth by counting ancestor INDENT_OPENERS and sets
 * leading whitespace for the first token of each line.
 */
export function indentationPass(config: IndentConfig): (root: SyntaxNode, source: string) => TextEdit[] {
  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    const indentChar = config.useTabs ? '\t' : ' '.repeat(config.indentSize);
    const lines = source.split(/\r?\n/);

    // Build a map: line number → expected indent depth
    const lineDepths = new Map<number, number>();
    computeDepths(root, 0, lineDepths);

    // For each line, check if the current indentation matches expected
    let offset = 0;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      const currentIndent = line.match(/^(\s*)/)?.[1] ?? '';
      const expectedDepth = lineDepths.get(lineNum);

      if (expectedDepth !== undefined && expectedDepth >= 0) {
        const expectedIndent = indentChar.repeat(expectedDepth);
        if (currentIndent !== expectedIndent && line.trim() !== '') {
          edits.push({
            pos: offset,
            end: offset + currentIndent.length,
            newText: expectedIndent,
          });
        }
      }

      offset += line.length + 1; // +1 for the newline character
    }

    return edits;
  };
}

function computeDepths(node: SyntaxNode, depth: number, lineDepths: Map<number, number>): void {
  for (const child of node.children) {
    if (isToken(child)) {
      // The first token of a line sets that line's depth
      if (!lineDepths.has(child.line)) {
        lineDepths.set(child.line, depth);
      }
    } else if (isNode(child)) {
      const childDepth = INDENT_OPENERS.has(child.kind) ? depth + 1 : depth;

      // For block openers, the first line (the keyword itself) stays at current depth
      if (INDENT_OPENERS.has(child.kind)) {
        // Opening keyword line stays at `depth`
        const firstToken = findFirstToken(child);
        if (firstToken) {
          lineDepths.set(firstToken.line, depth);
        }
        // Closing keyword also stays at `depth`
        const lastToken = findLastToken(child);
        if (lastToken) {
          lineDepths.set(lastToken.line, depth);
        }
        // Body is at depth + 1
        computeDepths(child, depth + 1, lineDepths);
      } else {
        computeDepths(child, depth, lineDepths);
      }
    }
  }
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

function findLastToken(node: SyntaxNode): Token | undefined {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (isToken(child)) return child;
    if (isNode(child)) {
      const found = findLastToken(child);
      if (found) return found;
    }
  }
  return undefined;
}

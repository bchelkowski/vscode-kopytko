/**
 * CST Pass: Associative array single-line length threshold.
 *
 * Expands a single-line AA literal (`{ a: 1, b: 2 }`) onto multiple lines —
 * one field per line — when its own raw text exceeds `threshold` characters.
 *
 * The old regex matched `\{[^{}]+\}` — a character class that explicitly
 * excludes brace characters — so it could never actually reach a *nested*
 * AA correctly: for `{ a: 1, b: { c: 2 } }` the outer `{` can't complete a
 * match without crossing the inner `{`, so the regex engine backs off to
 * matching the *inner* `{ c: 2 }` instead, leaving `{ a: 1, b: ` and ` }`
 * as untouched literal text wrapped around whatever the inner match
 * produced — a broken partial expansion. Walking real `AALiteral` nodes
 * has no such limitation.
 *
 * Fields are joined onto their own lines with no trailing comma (matching
 * the old pass) — BrightScript allows comma-omission on multi-line
 * AAs/arrays, and the `trailingCommas` pass, which always runs after this
 * one in `formatter.ts`, adds commas back per `arrayCommaStyle`/
 * `associativeArrayCommaStyle`/`trailingComma` if the user wants them.
 *
 * Nesting: once an AA is queued for expansion, its own children are not
 * visited further in *this* pass invocation — expanding both an outer and
 * an inner AA in the same call would produce overlapping edits (the outer
 * edit's replacement text is computed from original-source positions, so
 * it can't account for an inner edit changing the text inside its range).
 * An inner AA that still exceeds the threshold after the outer expands
 * stays single-line until the next format pass re-parses the now-expanded
 * source — the same "may need a second run to fully converge" trait as any
 * pass whose trigger condition depends on a sibling edit it can't see yet.
 */

import { SyntaxNode, SyntaxKind, isNode } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit, walkTokens, rawText } from './infrastructure';

export function aaThresholdPass(threshold: number, indentUnit: string): (root: SyntaxNode, source: string) => TextEdit[] {
  if (threshold <= 0) return () => [];

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];
    const eol = source.includes('\r\n') ? '\r\n' : '\n';

    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.AALiteral) {
        const expanded = tryExpand(node, threshold, indentUnit, eol, edits, source);
        if (expanded) return; // avoid overlapping edits with any nested AA
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }
    visit(root);

    return edits;
  };
}

function tryExpand(
  node: SyntaxNode,
  threshold: number,
  indentUnit: string,
  eol: string,
  edits: TextEdit[],
  source: string,
): boolean {
  const tokens: Token[] = [];
  walkTokens(node, (t) => { tokens.push(t); });
  if (tokens.length === 0) return false;

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (first.line !== last.line) return false; // already multi-line

  const rawLen = last.end - first.pos;
  if (rawLen <= threshold) return false;

  const fields = node.childNodes;
  if (fields.length === 0) return false;

  const lineStart = source.lastIndexOf('\n', first.pos - 1) + 1;
  const indentMatch = /^[ \t]*/.exec(source.slice(lineStart));
  const baseIndent = indentMatch ? indentMatch[0] : '';
  const childIndent = baseIndent + indentUnit;

  const fieldLines = fields.map(f => childIndent + rawText(f, source)).join(eol);
  const newText = `{${eol}${fieldLines}${eol}${baseIndent}}`;
  edits.push({ pos: first.pos, end: last.end, newText });
  return true;
}

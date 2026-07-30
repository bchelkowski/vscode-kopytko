/**
 * CST Pass: Trailing commas in multi-line array/AA literals.
 *
 * Only touches literals that are already written multi-line (the closing
 * `]`/`}` starts its own physical line) — a single-line `[1, 2, 3]` is left
 * completely alone, matching the old regex which only ever fired on a line
 * that began with the closer character.
 *
 * - `trailingComma` ('never' | 'always' | 'multiline') controls the LAST
 *   item. 'multiline' behaves exactly like 'always' here, since this pass
 *   never runs on a single-line literal in the first place.
 * - `arrayCommaStyle` / `associativeArrayCommaStyle` control every non-last
 *   item, per literal kind.
 *
 * A function/sub literal used as an array element or AA field value is
 * skipped entirely (comma untouched either way), matching the old regex's
 * explicit skip for `function`/`sub`/`end function`/`end sub` lines — those
 * keywords can only appear here as a function-expression value, never as a
 * real control-flow statement (array/AA elements are expressions), so this
 * is the direct structural equivalent of that skip.
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode, isToken } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit, walkTokens } from './infrastructure';

export interface TrailingCommaConfig {
  trailingComma: 'never' | 'always' | 'multiline';
  arrayCommaStyle: 'always' | 'never' | 'preserve';
  associativeArrayCommaStyle: 'always' | 'never' | 'preserve';
}

interface Item {
  /** The element expression (array item) or AAField node (AA item). */
  node: SyntaxNode;
  /** The value expression to check for a function/sub literal and to anchor the comma after. */
  value: SyntaxNode;
  comma: Token | undefined;
}

export function trailingCommasPass(config: TrailingCommaConfig): (root: SyntaxNode, source: string) => TextEdit[] {
  return (root: SyntaxNode): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.ArrayLiteral) {
        processCollection(node, 'array', config, edits);
      } else if (node.kind === SyntaxKind.AALiteral) {
        processCollection(node, 'aa', config, edits);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }
    visit(root);

    return edits;
  };
}

function processCollection(
  node: SyntaxNode,
  kind: 'array' | 'aa',
  config: TrailingCommaConfig,
  edits: TextEdit[],
): void {
  const children = node.children;
  const closer = children[children.length - 1];
  if (!closer || !isToken(closer)) return;
  if (closer.kind !== TokenKind.RightBracket && closer.kind !== TokenKind.RightBrace) return;

  const items: Item[] = [];
  for (let i = 1; i < children.length - 1; i++) {
    const child = children[i];
    if (!isNode(child)) continue; // stray token (shouldn't happen outside a Comma, handled below)
    let comma: Token | undefined;
    const next = children[i + 1];
    if (next && isToken(next) && next.kind === TokenKind.Comma) {
      comma = next;
      i++; // skip the comma on the next loop iteration
    }
    const value = kind === 'aa' ? aaFieldValue(child) : child;
    items.push({ node: child, value: value ?? child, comma });
  }

  if (items.length === 0) return;

  const last = items[items.length - 1];
  const lastToken = commaOrLastToken(last);
  if (lastToken.line === closer.line) return; // single-line literal — never touched

  const itemStyle = kind === 'array' ? config.arrayCommaStyle : config.associativeArrayCommaStyle;

  items.forEach((item, idx) => {
    if (item.value.kind === SyntaxKind.FunctionExpression) return; // function/sub value — leave as-is

    const isLast = idx === items.length - 1;
    const style: 'always' | 'never' | 'preserve' = isLast
      ? (config.trailingComma === 'never' ? 'never' : 'always')
      : itemStyle;
    if (style === 'preserve') return;

    if (style === 'always') {
      if (!item.comma) {
        const end = rawEnd(item.node);
        edits.push({ pos: end, end, newText: ',' });
      }
    } else {
      if (item.comma) {
        edits.push({ pos: item.comma.pos, end: item.comma.end, newText: '' });
      }
    }
  });
}

function commaOrLastToken(item: Item): Token {
  if (item.comma) return item.comma;
  let last: Token | undefined;
  walkTokens(item.node, (t) => { last = t; });
  return last!;
}

/** An AAField's value is its last child node (see ast.ts `AAField.value`). */
function aaFieldValue(field: SyntaxNode): SyntaxNode | undefined {
  const nodes = field.childNodes;
  return nodes.length > 0 ? nodes[nodes.length - 1] : undefined;
}

/** Raw end of a node's last direct-child token, ignoring trailing trivia. */
function rawEnd(node: SyntaxNode): number {
  let last: Token | undefined;
  walkTokens(node, (t) => { last = t; });
  return last ? last.end : node.end;
}

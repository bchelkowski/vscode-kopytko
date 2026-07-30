/**
 * CST Pass: Associative array key sorting + Kopytko template object structuring.
 *
 * Detection happens once per `AALiteral` and dictates exactly one of three behaviors — this is a
 * single coherent pass, not two competing ones:
 *
 * - `'template'` — the AA structurally matches a Kopytko UI component template (see
 *   `isKopytkoTemplateObject`): its top-level keys get forced into `kopytkoTemplateKeyOrder`,
 *   regardless of `associativeArrayKeySortOrder`.
 * - `'template-props-scope'` — a `props`/`dynamicProps`/`events` field's value *inside* a
 *   `'template'` node: always alphabetically sorted (with `kopytkoTemplatePropsSortPriorityKeys`),
 *   unconditionally, independent of `associativeArrayKeySortOrder`.
 * - `'plain'` — everything else: sorted alphabetically (with `associativeArraySortPriorityKeys`)
 *   only when `associativeArrayKeySortOrder === 'alphabetical'`; otherwise left untouched.
 *
 * A `children` field's value (an array of nested template objects) is walked element-by-element
 * with a fresh `'plain'` hint, so each element re-runs full template detection independently —
 * this gives "children recurses the same way" for free, at arbitrary depth, without a dedicated
 * children-specific code path.
 *
 * Trivia and member boundaries: a member's *start* uses `AAField.pos` (trivia-inclusive — the
 * `SyntaxNode.pos` getter, unlike the `rawStart`/`rawEnd`/`rawText` helpers elsewhere in this
 * directory, which deliberately exclude trivia), so a leading comment directly above a field is
 * captured as part of that field's own span and travels with it when reordered. A member's *end*
 * defaults to `rawEnd` (trivia-*exclusive*) rather than the field's own trivia-inclusive `.end` —
 * trailing trivia extends up to whatever token comes next, which for the *last* member in the
 * original AA is the closing `}` (so its trivia-inclusive `.end` would wrongly absorb the
 * whitespace between it and `}`) — **except** when a same-line trailing comment follows the field
 * (either directly, or after its comma): that comment is pulled into the member's own span too
 * (`getMembers`'s `trailingCommentEnd` check), because it describes *this* field, not whichever
 * field ends up adjacent to it after sorting. A comment on its own line above the *next* field is
 * already that field's own leading trivia (per `AAField.pos` above) and needs no special handling;
 * only the same-line case needs pulling forward, since otherwise it would sit in the "separator"
 * below and travel with whatever *new* neighbor a positional reuse gives it — the exact bug this
 * was written to fix (confirmed empirically: sorting `zeta: 1, ' note about zeta` above `alpha: 2`
 * moved "note about zeta" to trail `alpha` instead, since the old version left it in the reused
 * separator rather than folding it into `zeta`'s own span).
 *
 * A comma with no trailing comment is not a property of the member it happens to follow — it's a
 * *separator* between two members, indifferent to which members end up adjacent after sorting. So
 * instead of pairing every member with "its" comma, this pass captures the raw text *between* each
 * pair of consecutive original members (`source.slice(members[i].end, members[i+1].pos)` — comma
 * or bare newline, plus surrounding whitespace) as one of `members.length - 1` interchangeable
 * separators, and reuses that same ordered list between the *reordered* members. This is what keeps
 * single-line AAs syntactically valid after a reorder (the item that used to be last, with no
 * trailing comma, would otherwise end up comma-less in the middle of the list) — and because a
 * same-line trailing comment is now always absorbed into the member it follows (see above), a
 * separator itself never carries meaningful content, so reusing it positionally is safe.
 * `trailingCommasPass` (runs later in the pipeline) then normalizes comma presence/style on
 * whichever member ends up last, same as it would for hand-written code.
 *
 * Nested-edit safety: like `aaThreshold.ts`, this never emits two edits where one's range nests
 * inside another's in the same pass invocation — once an `AALiteral` fires a reorder edit, its
 * fields are not visited further this call. Resolving a multi-level template (top-level order +
 * nested props + nested children, all in one *Format Document* action) therefore needs more than
 * one pass invocation — `formatter.ts` wraps this pass in a small bounded convergence loop for
 * exactly that reason.
 */

import { SyntaxNode, SyntaxKind, TokenKind, TriviaKind, isNode, isToken } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit, rawEnd, walkTokens } from './infrastructure';

export interface AASortConfig {
  associativeArrayKeySortOrder: 'alphabetical' | 'preserve';
  /** Already resolved by the caller via `getEffectiveSortPriorityKeys`. */
  associativeArraySortPriorityKeys: string[];
  /** Empty = Kopytko template-object structuring is disabled entirely. */
  kopytkoTemplateKeyOrder: string[];
  /** Already resolved by the caller via `getEffectiveSortPriorityKeys`. */
  kopytkoTemplatePropsSortPriorityKeys: string[];
}

type Role = 'template' | 'template-props-scope' | 'plain';

interface Member {
  /** Normalized (quote-stripped, lowercased) key, for comparison only — never rewritten in output. */
  key: string;
  /** Trivia-inclusive start (includes any leading comment/blank lines). */
  pos: number;
  /** Trivia-*exclusive* end — see the file header comment for why this can't be the trivia-inclusive `.end`. */
  end: number;
  /** True when `end` was extended past the field's raw end to absorb a same-line trailing comment. */
  hasTrailingComment: boolean;
}

export function associativeArraySortPass(config: AASortConfig): (root: SyntaxNode, source: string) => TextEdit[] {
  const templateKeyOrderLower = config.kopytkoTemplateKeyOrder.map((k) => k.toLowerCase());
  const templateKeySet = new Set(templateKeyOrderLower);

  return (root: SyntaxNode, source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode, hint: Role): void {
      if (node.kind === SyntaxKind.AALiteral) {
        const role: Role = hint === 'template-props-scope'
          ? 'template-props-scope'
          : isKopytkoTemplateObject(node, templateKeySet)
            ? 'template'
            : 'plain';

        const fired = tryReorder(node, role, config, templateKeyOrderLower, edits, source);
        if (fired) return; // avoid overlapping edits with nested content this pass invocation

        for (const field of node.findAllChildren(SyntaxKind.AAField)) {
          const value = fieldValue(field);
          if (!value) continue;
          const key = normalizeKey(field);
          const childHint: Role = role === 'template' && (key === 'props' || key === 'dynamicprops' || key === 'events')
            ? 'template-props-scope'
            : 'plain';
          visitValue(value, childHint);
        }
        return;
      }

      for (const child of node.children) {
        if (isNode(child)) visit(child, hint);
      }
    }

    function visitValue(value: SyntaxNode, hint: Role): void {
      if (value.kind === SyntaxKind.ArrayLiteral) {
        for (const el of value.childNodes) visitValue(el, 'plain');
      } else {
        visit(value, hint);
      }
    }

    visit(root, 'plain');
    return edits;
  };
}

function tryReorder(
  node: SyntaxNode,
  role: Role,
  config: AASortConfig,
  templateKeyOrderLower: string[],
  edits: TextEdit[],
  source: string,
): boolean {
  const members = getMembers(node);
  if (members.length < 2) return false;

  let sorted: Member[];
  if (role === 'template') {
    sorted = [...members].sort((a, b) => compareTemplateOrder(a, b, templateKeyOrderLower));
  } else if (role === 'template-props-scope') {
    sorted = [...members].sort((a, b) => compareAlphabetical(a, b, config.kopytkoTemplatePropsSortPriorityKeys));
  } else {
    if (config.associativeArrayKeySortOrder !== 'alphabetical') return false;
    sorted = [...members].sort((a, b) => compareAlphabetical(a, b, config.associativeArraySortPriorityKeys));
  }

  if (sorted.every((m, i) => m === members[i])) return false; // already in desired order

  // Reuse the original positional separators (comma/newline between consecutive members) between
  // the *reordered* members — see the file header comment for why this is safe now that a
  // same-line trailing comment is always absorbed into the member it follows instead.
  const separators: string[] = [];
  for (let i = 0; i < members.length - 1; i++) {
    separators.push(source.slice(members[i].end, members[i + 1].pos));
  }

  const newText = sorted.map((m, i) => {
    const content = source.slice(m.pos, m.end);
    if (i === separators.length) return content; // new-last member — no trailing separator
    // A comma right after a same-line comment would be inert (swallowed by the comment) and
    // confusing to read — when this member's own span already ends in a trailing comment, drop
    // anything in the next separator up to (not including) its first line break.
    const sep = m.hasTrailingComment ? separators[i].slice(Math.max(separators[i].search(/\r?\n/), 0)) : separators[i];
    return content + sep;
  }).join('');
  edits.push({ pos: members[0].pos, end: members[members.length - 1].end, newText });
  return true;
}

function compareTemplateOrder(a: Member, b: Member, orderLower: string[]): number {
  const ia = orderLower.indexOf(a.key);
  const ib = orderLower.indexOf(b.key);
  const ra = ia === -1 ? orderLower.length : ia;
  const rb = ib === -1 ? orderLower.length : ib;
  return ra - rb;
}

function compareAlphabetical(a: Member, b: Member, priorityLower: string[]): number {
  const ia = priorityLower.indexOf(a.key);
  const ib = priorityLower.indexOf(b.key);
  if (ia !== -1 || ib !== -1) {
    const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
    const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
    if (ra !== rb) return ra - rb;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function getMembers(node: SyntaxNode): Member[] {
  const children = node.children;
  const members: Member[] = [];
  for (let i = 0; i < children.length; i++) {
    const field = children[i];
    if (!isNode(field) || field.kind !== SyntaxKind.AAField) continue;
    const next = children[i + 1];
    const comma = next && isToken(next) && next.kind === TokenKind.Comma ? next : undefined;
    const checkToken = comma ?? lastToken(field);
    const commentEnd = trailingCommentEnd(checkToken);
    members.push({
      key: normalizeKey(field),
      pos: field.pos,
      end: commentEnd ?? rawEnd(field),
      hasTrailingComment: commentEnd !== undefined,
    });
  }
  return members;
}

/** The last token in a node's subtree (depth-first), or undefined if it has none. */
function lastToken(node: SyntaxNode): Token | undefined {
  let last: Token | undefined;
  walkTokens(node, (t) => { last = t; });
  return last;
}

/** End offset of a same-line trailing comment attached to `token`, or undefined if there isn't one. */
function trailingCommentEnd(token: Token | undefined): number | undefined {
  if (!token) return undefined;
  const comment = token.trailingTrivia.find((t) => t.kind === TriviaKind.Comment || t.kind === TriviaKind.RemComment);
  return comment ? comment.pos + comment.text.length : undefined;
}

/** Strips surrounding quotes + unescapes `""`→`"` for a quoted key; lowercases for comparison. */
function normalizeKey(field: SyntaxNode): string {
  const keyToken = field.children.find((c): c is Token => isToken(c) && c.kind !== TokenKind.Colon);
  if (!keyToken) return '';
  if (keyToken.kind === TokenKind.StringLiteral) {
    return keyToken.text.slice(1, -1).replace(/""/g, '"').toLowerCase();
  }
  return keyToken.text.toLowerCase();
}

/** An AAField's value is its last child node (see ast.ts `AAField.value`). */
function fieldValue(field: SyntaxNode): SyntaxNode | undefined {
  const nodes = field.childNodes;
  return nodes.length > 0 ? nodes[nodes.length - 1] : undefined;
}

function hasTopLevelKey(aaNode: SyntaxNode, key: string): boolean {
  return aaNode.findAllChildren(SyntaxKind.AAField).some((f) => normalizeKey(f) === key);
}

/**
 * A Kopytko UI component template object: (a) every present key is a member of
 * `kopytkoTemplateKeyOrder` (a subset match — an unrecognized key disqualifies the whole AA);
 * (b) a `name` key is present; (c) an `id` key is present at the top level of the `props` and/or
 * `dynamicProps` field's own AA (not an arbitrary-depth search — these are flat config objects in
 * practice, and a deep search risks false-positiving on unrelated nested data).
 */
function isKopytkoTemplateObject(node: SyntaxNode, templateKeySet: Set<string>): boolean {
  if (templateKeySet.size === 0) return false;
  const fields = node.findAllChildren(SyntaxKind.AAField);
  if (fields.length === 0) return false;

  let hasName = false;
  let hasIdInProps = false;

  for (const field of fields) {
    const key = normalizeKey(field);
    if (!templateKeySet.has(key)) return false;
    if (key === 'name') hasName = true;
    if (key === 'props' || key === 'dynamicprops') {
      const value = fieldValue(field);
      if (value && value.kind === SyntaxKind.AALiteral && hasTopLevelKey(value, 'id')) {
        hasIdInProps = true;
      }
    }
  }

  return hasName && hasIdInProps;
}

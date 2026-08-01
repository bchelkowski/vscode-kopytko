/**
 * SceneGraph-specific queries over the XML CST.
 *
 * These are the typed replacements for the regex-based functions that used
 * to live in `../utils/xmlParsing.ts` (and were duplicated in
 * `src/server/brightscript/xmlScriptParser.ts` and
 * `packages/linter/src/analysis/xmlParser.ts`) — same exported names and
 * shapes so existing callers migrate without a rewrite, now backed by a real
 * parse instead of independent regexes. Fixes two known regex bugs for
 * free: a commented-out `<field .../>` is never seen as real (comments are
 * lexer trivia, not text the query layer scans), and single-quoted
 * `uri='...'` now matches (the old `parseXmlScriptUris` only matched double
 * quotes).
 */

import { XmlSyntaxKind } from './xmlSyntaxKind.js';
import { firstXmlToken, lastXmlToken } from './xmlSyntaxNode.js';
import { XmlTokenKind } from './xmlTokenKind.js';
import { XmlToken } from './xmlToken.js';
import { XmlTriviaKind } from './xmlTrivia.js';
import { parseXml, XmlParseResult } from './xmlParser.js';
import { XmlDocument, XmlElement } from './xmlAst.js';

/**
 * A token's own end plus any trailing Whitespace/Comment trivia, but
 * stopping before a trailing LineBreak (and anything after it). Used to
 * compute chunk boundaries that include a same-line trailing comment
 * (`<field .../> <!-- note -->`) without pulling in the newline that
 * follows it — that newline (and whatever comes after) belongs to
 * whatever's *next*, not to this element's own chunk.
 */
function endExcludingTrailingLineBreak(token: XmlToken): number {
  let end = token.end;
  for (const t of token.trailingTrivia) {
    if (t.kind === XmlTriviaKind.LineBreak) break;
    end = t.end;
  }
  return end;
}

function documentRoot(xmlText: string): { root: XmlElement | undefined; result: XmlParseResult } {
  const result = parseXml(xmlText);
  return { root: new XmlDocument(result.root).root, result };
}

function findComponentElement(root: XmlElement): XmlElement | undefined {
  return root.findAllDescendants(e => e.tagName.toLowerCase() === 'component')[0];
}

// ── Script URIs ──────────────────────────────────────────────────────────

/** Extracts all script URIs from `<script ... uri="...">` tags anywhere in the document. */
export function parseXmlScriptUris(xmlText: string): string[] {
  const { root } = documentRoot(xmlText);
  if (!root) return [];
  const uris: string[] = [];
  for (const el of root.findAllDescendants(e => e.tagName.toLowerCase() === 'script')) {
    const uri = el.getAttribute('uri');
    if (uri?.valueToken && !uri.valueToken.isMissing) uris.push(uri.value);
  }
  return uris;
}

// ── Interface ────────────────────────────────────────────────────────────

export interface XmlInterfaceField {
  name: string;
  type: string;
}

export interface XmlInterfaceFunction {
  name: string;
}

export interface ParsedXmlInterface {
  fields: XmlInterfaceField[];
  functions: XmlInterfaceFunction[];
}

/** Parses the first `<interface>` block's direct `<field>`/`<function>` children. */
export function parseXmlInterface(xmlText: string): ParsedXmlInterface {
  const fields: XmlInterfaceField[] = [];
  const functions: XmlInterfaceFunction[] = [];
  const { root } = documentRoot(xmlText);
  if (!root) return { fields, functions };

  const iface = root.findAllDescendants(e => e.tagName.toLowerCase() === 'interface')[0];
  if (!iface) return { fields, functions };

  for (const child of iface.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'field') {
      const id = child.getAttribute('id');
      if (id?.valueToken && !id.valueToken.isMissing) {
        fields.push({ name: id.value, type: child.getAttribute('type')?.value ?? 'dynamic' });
      }
    } else if (tag === 'function') {
      const name = child.getAttribute('name');
      if (name?.valueToken && !name.valueToken.isMissing) {
        functions.push({ name: name.value });
      }
    }
  }

  return { fields, functions };
}

// ── Component tag ────────────────────────────────────────────────────────

/** Returns the `extends` attribute of the first `<component>` element, or `null`. */
export function parseXmlExtends(xmlText: string): string | null {
  const { root } = documentRoot(xmlText);
  if (!root) return null;
  const comp = findComponentElement(root);
  const attr = comp?.getAttribute('extends');
  return attr?.valueToken && !attr.valueToken.isMissing ? attr.value : null;
}

/** Returns the `name` attribute of the first `<component>` element, or `null`. */
export function parseXmlComponentName(xmlText: string): string | null {
  const { root } = documentRoot(xmlText);
  if (!root) return null;
  const comp = findComponentElement(root);
  const attr = comp?.getAttribute('name');
  return attr?.valueToken && !attr.valueToken.isMissing ? attr.value : null;
}

/** A `<component>` tag's declared name and parent, with source positions. */
export interface ComponentTagInfo {
  name: string;
  /** 0-based line of the `<component` tag itself. */
  tagLine: number;
  /** 0-based position of the first character of the `name` attribute value. */
  nameLine: number;
  nameColumn: number;
  extendsName?: string;
  /** 0-based position of the first character of the `extends` attribute value. */
  extendsLine?: number;
  extendsColumn?: number;
}

/**
 * Parses the `<component>` tag, returning its `name`, its `extends` parent,
 * and the source position of each attribute *value* — what navigation
 * features need to place a cursor. `undefined` when the file declares no
 * named component.
 */
export function parseComponentTag(xmlText: string): ComponentTagInfo | undefined {
  const { root } = documentRoot(xmlText);
  if (!root) return undefined;
  const comp = findComponentElement(root);
  if (!comp) return undefined;

  const nameAttr = comp.getAttribute('name');
  if (!nameAttr?.valueToken || nameAttr.valueToken.isMissing) return undefined;

  // `comp.line` (the node getter) deliberately includes leading trivia — e.g.
  // a `<?xml ...?>` declaration or a comment right before `<component` would
  // shift it to an earlier line. `tagLine` means "the line the literal
  // `<component` text is on", so it needs the element's raw first token.
  const rawTagLine = firstXmlToken(comp.syntax)?.line ?? comp.line;

  const info: ComponentTagInfo = {
    name: nameAttr.value,
    tagLine: rawTagLine,
    nameLine: nameAttr.valueLine,
    nameColumn: nameAttr.valueColumn,
  };

  const extendsAttr = comp.getAttribute('extends');
  if (extendsAttr?.valueToken && !extendsAttr.valueToken.isMissing) {
    info.extendsName = extendsAttr.value;
    info.extendsLine = extendsAttr.valueLine;
    info.extendsColumn = extendsAttr.valueColumn;
  }

  return info;
}

// ── Interface element reordering (formatter support) ────────────────────

export interface XmlInterfaceElement {
  /** 'field' or 'function' — normalized to lowercase regardless of the source tag's casing. */
  kind: 'field' | 'function';
  /** The `id` attribute value (field) or `name` attribute value (function), verbatim. */
  key: string;
  /** This element's own tag text (self-closing or open+close pair), unmodified. */
  text: string;
}

export interface XmlInterfaceChunk {
  element: XmlInterfaceElement;
  /** The element's own text, prefixed with any comment/blank-lines immediately preceding it — the exact byte range that must move together when this element is reordered. */
  chunk: string;
}

export interface TokenizedXmlInterface {
  /** Byte offset in the original source just after the `<interface ...>` tag's `>`. */
  innerStart: number;
  /** Byte offset in the original source just before `</interface>`. */
  innerEnd: number;
  items: XmlInterfaceChunk[];
  /** Whitespace/comments after the last item, through innerEnd — never reordered. */
  trailingText: string;
}

/**
 * Tokenizes the first `<interface>...</interface>` block's `<field>`/`<function>`
 * children into reorderable chunks, each carrying whatever comment/blank-lines
 * describe it — see the file header for the general contract this preserves
 * from the old regex-based version, byte-for-byte, including its comment-
 * ownership rule (a same-line trailing comment moves with the element it
 * follows; an own-line comment moves with the element it precedes). Backed
 * by a real parse now instead of a hand-rolled tokenizer, so this also picks
 * up the parser's comment-vs-code distinction for free: no more accidental
 * matches inside a string-valued attribute, and a genuinely malformed
 * `<interface>` reliably returns `null` via the parser's own diagnostics
 * rather than a bespoke well-formedness regex.
 *
 * Returns `null` (the caller must leave the file untouched) when: there is
 * no `<interface>` block; the document has any parse diagnostic at all; or
 * anything other than a well-formed, attribute-complete `<field>`/`<function>`
 * element (self-closing, or an open/close pair with only whitespace between)
 * is found as a direct child of `<interface>`.
 */
export function tokenizeXmlInterfaceElements(xmlText: string): TokenizedXmlInterface | null {
  const { root, result } = documentRoot(xmlText);
  if (!root || result.diagnostics.length > 0) return null;

  const iface = root.findAllDescendants(e => e.tagName.toLowerCase() === 'interface')[0];
  if (!iface) return null;

  // `iface`'s direct children include two GreaterThan tokens (the opening
  // tag's `>` and the closing tag's `>`) — `findToken` returns the first
  // match in document order, which is the opening one.
  const openGreaterThan = iface.syntax.findToken(XmlTokenKind.GreaterThan);
  const closeLessSlash = iface.syntax.findToken(XmlTokenKind.LessSlash);
  if (!openGreaterThan || !closeLessSlash || openGreaterThan.isMissing || closeLessSlash.isMissing) return null;

  const innerStart = openGreaterThan.end;
  const innerEnd = closeLessSlash.pos;

  const items: XmlInterfaceChunk[] = [];
  let boundary = innerStart;

  for (const child of iface.syntax.childNodes) {
    if (child.kind !== XmlSyntaxKind.Element) return null; // stray Text/ErrorNode between elements
    const el = new XmlElement(child);
    const tag = el.tagName.toLowerCase();
    if (tag !== 'field' && tag !== 'function') return null;
    // Elements with anything other than pure whitespace between an open and
    // close tag (a nested element, or real text content) aren't the "always
    // empty" shape SceneGraph interface children are documented to have.
    // `childNodes` also includes this element's own `Attribute` children
    // (they're `XmlSyntaxNode`s too, just a different kind) — those are
    // structural, not "extra content", so they don't disqualify it.
    if (el.syntax.childNodes.some(n => n.kind !== XmlSyntaxKind.Attribute)) return null;

    const attrName = tag === 'field' ? 'id' : 'name';
    const keyAttr = el.getAttribute(attrName);
    if (!keyAttr?.valueToken || keyAttr.valueToken.isMissing) return null;

    // `text` is the tag's own markup only — first token's raw `.pos` to last
    // token's raw `.end` — not `el.getText()`, which would also include this
    // element's own leading trivia (indentation, a preceding comment).
    const firstToken = firstXmlToken(child)!;
    const rawLastToken = lastXmlToken(child)!;
    const tagText = xmlText.slice(firstToken.pos, rawLastToken.end);

    const elementEnd = endExcludingTrailingLineBreak(rawLastToken);
    items.push({
      element: { kind: tag, key: keyAttr.value, text: tagText },
      chunk: xmlText.slice(boundary, elementEnd),
    });
    boundary = elementEnd;
  }

  return { innerStart, innerEnd, items, trailingText: xmlText.slice(boundary, innerEnd) };
}

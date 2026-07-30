/**
 * SceneGraph XML parsing utilities (pure functions — no file system access).
 *
 * These extract structural information from SceneGraph XML text:
 * - Script URIs from <script> tags
 * - Interface fields and functions from <interface> blocks
 * - Component name and extends from <component> tags
 *
 * File-system-dependent operations (resolving URIs, finding files) stay
 * in the extension's xmlScriptParser.ts.
 */

/**
 * Extracts all script URIs from `<script type="text/brightscript" uri="...">` tags.
 */
export function parseXmlScriptUris(xmlText: string): string[] {
  const uris: string[] = [];
  const pattern = /<script\b[^>]*\buri\s*=\s*"([^"]+)"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xmlText)) !== null) {
    uris.push(match[1]);
  }
  return uris;
}

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

/**
 * Parses the `<interface>` section of a SceneGraph XML and returns
 * declared `<field>` and `<function>` entries.
 */
export function parseXmlInterface(xmlText: string): ParsedXmlInterface {
  const fields: XmlInterfaceField[] = [];
  const functions: XmlInterfaceFunction[] = [];

  const ifaceMatch = /<interface\b[^>]*>([\s\S]*?)<\/interface>/i.exec(xmlText);
  if (!ifaceMatch) return { fields, functions };
  const ifaceText = ifaceMatch[1];

  const fieldRe = /<field\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(ifaceText)) !== null) {
    const attrs = m[1];
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const typeMatch = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (idMatch) {
      fields.push({ name: idMatch[1], type: typeMatch ? typeMatch[1] : 'dynamic' });
    }
  }

  const funcRe = /<function\b([^>]*)>/gi;
  while ((m = funcRe.exec(ifaceText)) !== null) {
    const attrs = m[1];
    const nameMatch = /\bname\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (nameMatch) functions.push({ name: nameMatch[1] });
  }

  return { fields, functions };
}

export interface XmlInterfaceElement {
  /** 'field' or 'function' — normalized to lowercase regardless of the source tag's casing. */
  kind: 'field' | 'function';
  /** The `id` attribute value (field) or `name` attribute value (function), verbatim — quote/case normalization is the caller's job. */
  key: string;
  /** This element's own tag text (self-closing or open+close pair), unmodified. */
  text: string;
}

export interface XmlInterfaceChunk {
  element: XmlInterfaceElement;
  /** The element's own text, prefixed with any comment/blank-lines immediately preceding it —
   *  the exact byte range that must move together when this element is reordered. */
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
 * Tokenizes the first `<interface>...</interface>` block's `<field>`/`<function>` children into
 * reorderable chunks. Each chunk carries any comment/blank-lines that describe its element: a
 * comment on its own line above an element is that element's *leading* trivia (folded into the
 * next element's chunk); a comment on the *same* line as the previous element instead trails that
 * element and is folded backward into its chunk. Either way, the comment travels with the element
 * it was written to describe when chunks are later reordered by a caller — never with whichever
 * element a positional reorder happens to place next to it.
 *
 * Returns `null` (the caller must leave the file untouched) when anything other than whitespace,
 * an XML comment, or a well-formed `<field>`/`<function>` element (self-closing, or an open/close
 * pair with only whitespace between) is found between elements — including a missing `id`/`name`
 * attribute, an unterminated `<interface>` block, or no `<interface>` block at all. There is no
 * general XML parser backing this: SceneGraph interface children are always empty elements (no
 * nesting, no text content — see developer.roku.com/dev/docs/interface), so a purpose-built
 * tokenizer scoped to exactly that shape is sufficient and safer than a general-purpose one.
 */
export function tokenizeXmlInterfaceElements(xmlText: string): TokenizedXmlInterface | null {
  const openTagMatch = /<interface\b[^>]*>/i.exec(xmlText);
  if (!openTagMatch) return null;
  const innerStart = openTagMatch.index + openTagMatch[0].length;

  const closeMatch = /<\/interface\s*>/i.exec(xmlText.slice(innerStart));
  if (!closeMatch) return null;
  const innerEnd = innerStart + closeMatch.index;

  const inner = xmlText.slice(innerStart, innerEnd);

  const tokenRe = /<!--[\s\S]*?-->|<(field|function)\b[^>]*?(\/>|>\s*<\/\1\s*>)/gi;
  const items: XmlInterfaceChunk[] = [];
  let cursor = 0;
  let pendingTrivia = '';
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(inner)) !== null) {
    const between = inner.slice(cursor, match.index);
    if (!/^[ \t\r\n]*$/.test(between)) return null;

    if (match[0].startsWith('<!--')) {
      // A comment on the same line as the previous element (no line break in `between`, and no
      // "next element" trivia accumulated yet) trails that element and describes it — fold it
      // into that element's own chunk instead of treating it as the *next* element's leading
      // trivia, or a reorder would carry it over to whichever element ends up adjacent to it.
      if (items.length > 0 && pendingTrivia === '' && !/[\r\n]/.test(between)) {
        items[items.length - 1].chunk += between + match[0];
      } else {
        pendingTrivia += between + match[0];
      }
      cursor = tokenRe.lastIndex;
      continue;
    }

    pendingTrivia += between;
    cursor = tokenRe.lastIndex;

    const kind = match[1].toLowerCase() as 'field' | 'function';
    const attrName = kind === 'field' ? 'id' : 'name';
    const keyMatch = new RegExp(`\\b${attrName}\\b\\s*=\\s*["']([^"']*)["']`, 'i').exec(match[0]);
    if (!keyMatch) return null;

    items.push({
      element: { kind, key: keyMatch[1], text: match[0] },
      chunk: pendingTrivia + match[0],
    });
    pendingTrivia = '';
  }

  const tail = inner.slice(cursor);
  if (!/^[ \t\r\n]*$/.test(tail)) return null;

  return { innerStart, innerEnd, items, trailingText: pendingTrivia + tail };
}

/**
 * Returns the `extends` attribute value from a `<component>` tag, or null.
 */
export function parseXmlExtends(xmlText: string): string | null {
  const match = /<component\b[^>]*\bextends\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match ? match[1] : null;
}

/**
 * Returns the `name` attribute value from a `<component>` tag, or null.
 */
export function parseXmlComponentName(xmlText: string): string | null {
  const match = /<component\b[^>]*\bname\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match ? match[1] : null;
}

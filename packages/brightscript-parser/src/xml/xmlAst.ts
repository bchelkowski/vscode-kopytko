/**
 * Typed AST wrappers over the SceneGraph XML CST — mirrors `../ast.ts`'s
 * role for the BrightScript CST: a convenient, type-safe API over the raw
 * `XmlSyntaxNode` children array. `.syntax` always gives access to the raw
 * CST when the typed API isn't enough.
 */

import { XmlSyntaxKind } from './xmlSyntaxKind.js';
import { XmlSyntaxNode } from './xmlSyntaxNode.js';
import { XmlTokenKind } from './xmlTokenKind.js';
import { XmlToken } from './xmlToken.js';
import { parseXml } from './xmlParser.js';

export class XmlDocument {
  constructor(readonly syntax: XmlSyntaxNode) {}

  get root(): XmlElement | undefined {
    const el = this.syntax.findChild(XmlSyntaxKind.Element);
    return el ? new XmlElement(el) : undefined;
  }

  getText(): string { return this.syntax.getText(); }
}

/** Parses `xmlText` and returns its typed root element, or `undefined` if it has none. */
export function parseSceneGraphXml(xmlText: string): XmlElement | undefined {
  const result = parseXml(xmlText);
  return new XmlDocument(result.root).root;
}

export class XmlElement {
  constructor(readonly syntax: XmlSyntaxNode) {}

  get tagNameToken(): XmlToken | undefined {
    return this.syntax.findToken(XmlTokenKind.Name);
  }

  get tagName(): string {
    return this.tagNameToken?.text ?? '';
  }

  get selfClosing(): boolean {
    return this.syntax.findToken(XmlTokenKind.SlashGreaterThan) !== undefined;
  }

  get attributes(): XmlAttribute[] {
    return this.syntax.findAllChildren(XmlSyntaxKind.Attribute).map(n => new XmlAttribute(n));
  }

  /** Case-insensitive attribute lookup by name. */
  getAttribute(name: string): XmlAttribute | undefined {
    const lower = name.toLowerCase();
    return this.attributes.find(a => a.name.toLowerCase() === lower);
  }

  /** Direct child elements only (not text/comments, not deeper descendants). */
  get children(): XmlElement[] {
    return this.syntax.findAllChildren(XmlSyntaxKind.Element).map(n => new XmlElement(n));
  }

  /** The first direct child element with the given tag name (case-insensitive), if any. */
  findChildByTagName(tagName: string): XmlElement | undefined {
    const lower = tagName.toLowerCase();
    return this.children.find(c => c.tagName.toLowerCase() === lower);
  }

  /** All direct child elements with the given tag name (case-insensitive). */
  findAllChildrenByTagName(tagName: string): XmlElement[] {
    const lower = tagName.toLowerCase();
    return this.children.filter(c => c.tagName.toLowerCase() === lower);
  }

  /**
   * This element and every descendant (depth-first, self first), optionally
   * filtered by `predicate`. Self-inclusive to match the old regex-based
   * queries this replaces, which scanned the whole document text without
   * regard for how deep a `<script>`/`<component>` tag happened to be.
   */
  findAllDescendants(predicate?: (el: XmlElement) => boolean): XmlElement[] {
    const result: XmlElement[] = [];
    const visit = (el: XmlElement): void => {
      if (!predicate || predicate(el)) result.push(el);
      for (const child of el.children) visit(child);
    };
    visit(this);
    return result;
  }

  get pos(): number { return this.syntax.pos; }
  get end(): number { return this.syntax.end; }
  get line(): number { return this.syntax.line; }
  get column(): number { return this.syntax.column; }
  getText(): string { return this.syntax.getText(); }
}

export class XmlAttribute {
  constructor(readonly syntax: XmlSyntaxNode) {}

  get nameToken(): XmlToken | undefined {
    return this.syntax.findToken(XmlTokenKind.Name);
  }

  get name(): string {
    return this.nameToken?.text ?? '';
  }

  get valueToken(): XmlToken | undefined {
    return this.syntax.findToken(XmlTokenKind.StringLiteral);
  }

  /** The attribute's value with its surrounding quotes stripped. Raw text — XML entities are not decoded. */
  get value(): string {
    const t = this.valueToken;
    if (!t || t.isMissing || t.text.length < 2) return '';
    return t.text.slice(1, -1);
  }

  /** Byte offset of the value's first character, past the opening quote. */
  get valuePos(): number {
    const t = this.valueToken;
    return t && !t.isMissing ? t.pos + 1 : -1;
  }

  /** 0-based line of the value's first character. Values are always single-line in practice. */
  get valueLine(): number {
    return this.valueToken?.line ?? -1;
  }

  /** 0-based column of the value's first character, past the opening quote. */
  get valueColumn(): number {
    const t = this.valueToken;
    return t ? t.column + 1 : -1;
  }
}

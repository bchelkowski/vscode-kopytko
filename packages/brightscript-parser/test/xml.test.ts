import { expect } from 'chai';
import {
  xmlTokenize, xmlTokenFullText, xmlTokensToText, XmlTokenKind, XmlTriviaKind,
  parseXml, XmlSyntaxKind,
  XmlDocument, XmlElement, parseSceneGraphXml,
  parseXmlScriptUris, parseXmlInterface, parseXmlExtends, parseXmlComponentName,
  parseComponentTag, tokenizeXmlInterfaceElements,
} from '../src/index.js';

describe('XML lexer', () => {
  it('round-trips a self-closing tag', () => {
    const src = '<field id="title" type="string"/>';
    const tokens = xmlTokenize(src);
    expect(xmlTokensToText(tokens)).to.equal(src);
  });

  it('round-trips an open/close pair with text content', () => {
    const src = '<Label text="hi">some text</Label>';
    const tokens = xmlTokenize(src);
    expect(xmlTokensToText(tokens)).to.equal(src);
  });

  it('round-trips nested elements with indentation', () => {
    const src = '<component name="Foo">\n  <children>\n    <Rectangle color="0x000000FF" />\n  </children>\n</component>';
    const tokens = xmlTokenize(src);
    expect(xmlTokensToText(tokens)).to.equal(src);
  });

  it('round-trips comments and the XML declaration', () => {
    const src = '<?xml version="1.0" encoding="utf-8" ?>\n<!-- top comment -->\n<component name="Foo">\n  <!-- inner comment -->\n</component>\n<!-- trailing -->';
    const tokens = xmlTokenize(src);
    expect(xmlTokensToText(tokens)).to.equal(src);
  });

  it('round-trips single and double quoted attribute values', () => {
    const src = "<field id='title' type=\"string\"/>";
    const tokens = xmlTokenize(src);
    expect(xmlTokensToText(tokens)).to.equal(src);
  });

  it('round-trips CRLF line endings', () => {
    const src = '<component name="Foo">\r\n  <interface/>\r\n</component>';
    const tokens = xmlTokenize(src);
    expect(xmlTokensToText(tokens)).to.equal(src);
  });

  it('round-trips empty input', () => {
    const tokens = xmlTokenize('');
    expect(xmlTokensToText(tokens)).to.equal('');
    expect(tokens).to.have.length(1); // just EOF
    expect(tokens[0].kind).to.equal(XmlTokenKind.Eof);
  });

  it('round-trips malformed/incomplete input without crashing', () => {
    const sources = [
      '<component',
      '<component>',
      '<component><interface>',
      '<<<>>>',
      '<component name=>',
      '<component name="unterminated>',
    ];
    for (const src of sources) {
      const tokens = xmlTokenize(src);
      expect(xmlTokensToText(tokens), JSON.stringify(src)).to.equal(src);
    }
  });

  it('classifies a same-line comment after a self-closing tag as trailing trivia, not leading trivia of the next token', () => {
    const src = '<field id="a"/> <!-- note -->\n<field id="b"/>';
    const tokens = xmlTokenize(src);
    const slashGt = tokens.find(t => t.kind === XmlTokenKind.SlashGreaterThan)!;
    expect(slashGt.trailingTrivia.some(t => t.kind === XmlTriviaKind.Comment)).to.be.true;
    // The second field's opening `<` should NOT also see that comment as leading trivia.
    const secondLessThan = tokens.filter(t => t.kind === XmlTokenKind.LessThan)[1];
    expect(secondLessThan.leadingTrivia.some(t => t.kind === XmlTriviaKind.Comment)).to.be.false;
  });

  it('classifies an own-line comment as leading trivia of the following token', () => {
    const src = '<field id="a"/>\n<!-- note -->\n<field id="b"/>';
    const tokens = xmlTokenize(src);
    const secondLessThan = tokens.filter(t => t.kind === XmlTokenKind.LessThan)[1];
    expect(secondLessThan.leadingTrivia.some(t => t.kind === XmlTriviaKind.Comment)).to.be.true;
  });

  it('tokenFullText reconstructs a single token including its trivia', () => {
    const tokens = xmlTokenize('  <foo/>');
    const lt = tokens.find(t => t.kind === XmlTokenKind.LessThan)!;
    expect(xmlTokenFullText(lt)).to.equal('  <');
  });
});

describe('XML parser', () => {
  it('parses a minimal self-closing root element', () => {
    const r = parseXml('<component name="Foo"/>');
    expect(r.diagnostics).to.have.length(0);
    const root = r.root.findChild(XmlSyntaxKind.Element)!;
    expect(root.kind).to.equal(XmlSyntaxKind.Element);
  });

  it('parses nested elements and attributes cleanly', () => {
    const src = '<component name="Foo" extends="Group"><interface><field id="x" type="string"/></interface><children><Rectangle color="0xFF0000FF"/></children></component>';
    const r = parseXml(src);
    expect(r.diagnostics).to.have.length(0);
    expect(r.root.getText()).to.equal(src);
  });

  it('always produces a tree and round-trips even with a missing closing tag', () => {
    const src = '<component name="Foo">';
    const r = parseXml(src);
    expect(r.root).to.exist;
    expect(r.diagnostics.length).to.be.greaterThan(0);
    expect(r.root.getText()).to.equal(src);
  });

  it('flags a mismatched closing tag but still round-trips', () => {
    const src = '<component name="Foo"></wrongName>';
    const r = parseXml(src);
    expect(r.diagnostics.length).to.be.greaterThan(0);
    expect(r.root.getText()).to.equal(src);
  });

  it('does not duplicate a token when a required attribute value is missing (missing-token fix, mirrors the BrightScript parser)', () => {
    const src = '<component name=></component>';
    const r = parseXml(src);
    expect(r.diagnostics.length).to.be.greaterThan(0);
    expect(r.root.getText()).to.equal(src);
  });

  it('round-trips garbage input via ErrorNode recovery', () => {
    const src = '<<<>>>';
    const r = parseXml(src);
    expect(r.root.getText()).to.equal(src);
  });

  it('round-trips empty input with a diagnostic for the missing root element', () => {
    const r = parseXml('');
    expect(r.diagnostics.length).to.be.greaterThan(0);
    expect(r.root.getText()).to.equal('');
  });
});

describe('XML typed AST', () => {
  it('exposes tag name, self-closing, and attributes', () => {
    const el = parseSceneGraphXml('<field id="title" type="string"/>')!;
    expect(el.tagName).to.equal('field');
    expect(el.selfClosing).to.be.true;
    expect(el.attributes).to.have.length(2);
    expect(el.getAttribute('id')?.value).to.equal('title');
    expect(el.getAttribute('ID')?.value).to.equal('title'); // case-insensitive
    expect(el.getAttribute('missing')).to.be.undefined;
  });

  it('exposes direct children and findChildByTagName', () => {
    const el = parseSceneGraphXml('<component name="Foo"><interface/><children><Rectangle/></children></component>')!;
    expect(el.children).to.have.length(2);
    expect(el.findChildByTagName('interface')).to.exist;
    expect(el.findChildByTagName('INTERFACE')).to.exist; // case-insensitive
    expect(el.findChildByTagName('missing')).to.be.undefined;
  });

  it('findAllDescendants walks the whole subtree, self-inclusive', () => {
    const el = parseSceneGraphXml('<component><children><Group><Rectangle/><Rectangle/></Group></children></component>')!;
    const rects = el.findAllDescendants(e => e.tagName.toLowerCase() === 'rectangle');
    expect(rects).to.have.length(2);
    const all = el.findAllDescendants();
    expect(all[0].tagName).to.equal('component'); // self-inclusive
  });

  it('XmlDocument.root is undefined for input with no element at all', () => {
    const doc = new XmlDocument(parseXml('').root);
    expect(doc.root).to.be.undefined;
  });
});

describe('SceneGraph queries — bug fixes over the old regex version', () => {
  it('parseXmlScriptUris matches single-quoted uri (the old regex only matched double quotes)', () => {
    const xml = "<component><script type=\"text/brightscript\" uri='pkg:/components/Foo.brs'/></component>";
    expect(parseXmlScriptUris(xml)).to.deep.equal(['pkg:/components/Foo.brs']);
  });

  it('parseXmlInterface skips a commented-out field instead of reporting it as real', () => {
    const xml = '<component><interface><!-- <field id="ghost" type="string"/> --><field id="real" type="string"/></interface></component>';
    const iface = parseXmlInterface(xml);
    expect(iface.fields).to.have.length(1);
    expect(iface.fields[0].name).to.equal('real');
  });

  it('parseComponentTag returns the position of the name and extends attribute values', () => {
    const xml = '<component name="MyScreen" extends="Group">\n</component>';
    const info = parseComponentTag(xml)!;
    expect(info.name).to.equal('MyScreen');
    expect(info.extendsName).to.equal('Group');
    expect(info.tagLine).to.equal(0);
    // `name="MyScreen"` — value starts right after the opening quote.
    expect(xml.slice(0, 200)[info.nameColumn - 1]).to.equal('"');
  });

  it('parseComponentTag returns undefined when there is no named component', () => {
    expect(parseComponentTag('<component></component>')).to.be.undefined;
    expect(parseComponentTag('not xml at all')).to.be.undefined;
  });

  it('parseComponentTag reports tagLine as the literal <component> line, not shifted by a preceding <?xml?> declaration', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8" ?>',
      '<component',
      '    name="Card"',
      '    extends="Group">',
      '</component>',
    ].join('\n');
    const info = parseComponentTag(xml)!;
    expect(info.tagLine).to.equal(1);
    expect(info.nameLine).to.equal(2);
    expect(info.nameColumn).to.equal(10);
    expect(info.extendsLine).to.equal(3);
    expect(info.extendsColumn).to.equal(13);
  });

  it('tokenizeXmlInterfaceElements returns null on any parse diagnostic, not just its own well-formedness checks', () => {
    // Mismatched closing tag is a parse-level diagnostic, not something the
    // old regex tokenizer would have caught via its own well-formedness scan.
    const xml = '<component><interface><field id="a"/></wrongClose></component>';
    expect(tokenizeXmlInterfaceElements(xml)).to.be.null;
  });
});

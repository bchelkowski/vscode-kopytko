import { expect } from 'chai';
import { formatXml, checkXml } from '../src/xmlFormatter';
import { FormattingConfig, DEFAULT_FORMATTING_CONFIG } from '../src/config';

function xmlFormat(source: string, overrides: Partial<FormattingConfig> = {}): string {
  const config: FormattingConfig = { ...DEFAULT_FORMATTING_CONFIG, ...overrides };
  return formatXml(source, config);
}

describe('formatXml', () => {
  it('leaves the file unchanged when both settings are preserve (no-op fast path)', () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="z" type="string"/>\n    <field id="a" type="string"/>\n  </interface>\n</component>';
    expect(formatXml(source, DEFAULT_FORMATTING_CONFIG)).to.equal(source);
  });

  it("sorts fields alphabetically by id when xmlInterfaceSortOrder is 'alphabetical'", () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="z" type="string"/>\n    <field id="a" type="string"/>\n  </interface>\n</component>';
    const result = xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical' });
    expect(result.indexOf('id="a"')).to.be.lessThan(result.indexOf('id="z"'));
  });

  it('sorts functions alphabetically by name', () => {
    const source = '<component name="Foo">\n  <interface>\n    <function name="doWork"/>\n    <function name="cleanup"/>\n  </interface>\n</component>';
    const result = xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical' });
    expect(result.indexOf('name="cleanup"')).to.be.lessThan(result.indexOf('name="doWork"'));
  });

  it("groups fields before functions with 'fields-first'", () => {
    const source = '<component name="Foo">\n  <interface>\n    <function name="doWork"/>\n    <field id="a" type="string"/>\n  </interface>\n</component>';
    const result = xmlFormat(source, { xmlInterfaceGroupOrder: 'fields-first' });
    expect(result.indexOf('id="a"')).to.be.lessThan(result.indexOf('name="doWork"'));
  });

  it("groups functions before fields with 'functions-first'", () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="a" type="string"/>\n    <function name="doWork"/>\n  </interface>\n</component>';
    const result = xmlFormat(source, { xmlInterfaceGroupOrder: 'functions-first' });
    expect(result.indexOf('name="doWork"')).to.be.lessThan(result.indexOf('id="a"'));
  });

  it('applies xmlInterfaceSortPriorityKeys before falling back to alphabetical', () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="width" type="integer"/>\n    <field id="id" type="string"/>\n    <field id="height" type="integer"/>\n  </interface>\n</component>';
    const result = xmlFormat(source, {
      xmlInterfaceSortOrder: 'alphabetical',
      xmlInterfaceSortPriorityKeys: ['id', 'width', 'height'],
    });
    const idIdx = result.indexOf('id="id"');
    const widthIdx = result.indexOf('id="width"');
    const heightIdx = result.indexOf('id="height"');
    expect(idIdx).to.be.lessThan(widthIdx);
    expect(widthIdx).to.be.lessThan(heightIdx);
  });

  it('falls back to the global sortPriorityKeys when the xml-specific override is empty', () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="width" type="integer"/>\n    <field id="id" type="string"/>\n  </interface>\n</component>';
    const result = xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical', sortPriorityKeys: ['id', 'width'] });
    expect(result.indexOf('id="id"')).to.be.lessThan(result.indexOf('id="width"'));
  });

  it('moves a leading comment along with the field it precedes when reordering', () => {
    const source = [
      '<component name="Foo">',
      '  <interface>',
      '    <!-- the z field -->',
      '    <field id="z" type="string"/>',
      '    <field id="a" type="string"/>',
      '  </interface>',
      '</component>',
    ].join('\n');
    const result = xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical' });
    const aIdx = result.indexOf('id="a"');
    const commentIdx = result.indexOf('<!-- the z field -->');
    const zIdx = result.indexOf('id="z"');
    expect(aIdx).to.be.lessThan(commentIdx);
    expect(commentIdx).to.be.lessThan(zIdx);
  });

  it('moves a same-line trailing comment along with the field it describes, not whichever field ends up next to it', () => {
    const source = [
      '<component name="Foo">',
      '  <interface>',
      '    <field id="zeta" type="string" /> <!-- comment about zeta -->',
      '    <field id="alpha" type="string" />',
      '  </interface>',
      '</component>',
    ].join('\n');
    const result = xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical' });
    expect(result).to.not.match(/id="alpha"[^\n]*comment about zeta/);
    const zetaIdx = result.indexOf('id="zeta"');
    const commentIdx = result.indexOf('<!-- comment about zeta -->');
    expect(commentIdx).to.be.greaterThan(zetaIdx);
    expect(result.slice(zetaIdx, commentIdx)).to.not.include('\n');
  });

  it('returns the source unchanged when there is no <interface> block', () => {
    const source = '<component name="Foo"></component>';
    expect(xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical' })).to.equal(source);
  });

  it('returns the source unchanged when the interface block only has one element (nothing to reorder)', () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="a" type="string"/>\n  </interface>\n</component>';
    expect(xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical' })).to.equal(source);
  });

  it('returns the source unchanged when the interface block contains unexpected content', () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="a" type="string"/>\n    some text\n    <field id="b" type="string"/>\n  </interface>\n</component>';
    expect(xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical' })).to.equal(source);
  });

  it('is idempotent: formatting an already-sorted file produces no further changes', () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="a" type="string"/>\n    <field id="z" type="string"/>\n  </interface>\n</component>';
    const once = xmlFormat(source, { xmlInterfaceSortOrder: 'alphabetical' });
    const twice = xmlFormat(once, { xmlInterfaceSortOrder: 'alphabetical' });
    expect(twice).to.equal(once);
  });
});

describe('checkXml', () => {
  it('returns true when the file is already sorted', () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="a" type="string"/>\n    <field id="z" type="string"/>\n  </interface>\n</component>';
    expect(checkXml(source, { ...DEFAULT_FORMATTING_CONFIG, xmlInterfaceSortOrder: 'alphabetical' })).to.equal(true);
  });

  it('returns false when the file needs sorting', () => {
    const source = '<component name="Foo">\n  <interface>\n    <field id="z" type="string"/>\n    <field id="a" type="string"/>\n  </interface>\n</component>';
    expect(checkXml(source, { ...DEFAULT_FORMATTING_CONFIG, xmlInterfaceSortOrder: 'alphabetical' })).to.equal(false);
  });
});

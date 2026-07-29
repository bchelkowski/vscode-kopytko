import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import {
  findParentXmls,
  getXmlSiblingPaths,
  findComponentXml,
  clearComponentXmlCache,
  parseComponentTag,
} from '../../src/server/brightscript/xmlScriptParser';

describe('xmlScriptParser', () => {
  let existsStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let readdirStub: sinon.SinonStub;

  beforeEach(() => {
    existsStub = sinon.stub(fsWrapper, 'existsSync');
    readFileStub = sinon.stub(fsWrapper, 'readFileSync');
    readdirStub = sinon.stub(fsWrapper, 'readdirSync');
  });

  afterEach(() => { sinon.restore(); clearComponentXmlCache(); });

  // ── findComponentXml (cached) ─────────────────────────────────────────────

  describe('findComponentXml (cached)', () => {
    it('memoizes resolution and re-walks only after the cache is cleared', () => {
      const readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped');
      readdirTypedStub.withArgs('/project/app').returns([
        { name: 'Widget.xml', isDirectory: false },
      ]);

      expect(findComponentXml('Widget', ['/project/app'])).to.equal('/project/app/Widget.xml');
      expect(findComponentXml('Widget', ['/project/app'])).to.equal('/project/app/Widget.xml');
      // Second call served from cache → directory walked only once.
      expect(readdirTypedStub.callCount).to.equal(1);

      clearComponentXmlCache();
      findComponentXml('Widget', ['/project/app']);
      expect(readdirTypedStub.callCount).to.equal(2);
    });

    it('memoizes negative results (component not found)', () => {
      const readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
      expect(findComponentXml('Missing', ['/project/app'])).to.be.undefined;
      const afterFirst = readdirTypedStub.callCount;
      expect(findComponentXml('Missing', ['/project/app'])).to.be.undefined;
      // The negative result is cached → no further directory walks.
      expect(readdirTypedStub.callCount).to.equal(afterFirst);
    });
  });

  // ── findParentXmls ────────────────────────────────────────────────────────

  describe('findParentXmls', () => {
    it('finds XML files in same directory that reference the brs file', () => {
      readdirStub.returns(['App.view.xml', 'Other.xml', 'App.view.brs']);
      readFileStub.withArgs('/dir/App.view.xml', 'utf-8').returns(
        `<script uri="App.routing.brs" />`
      );
      readFileStub.withArgs('/dir/Other.xml', 'utf-8').returns('<component />');

      const result = findParentXmls('/dir/App.routing.brs');
      expect(result).to.deep.equal(['/dir/App.view.xml']);
    });

    it('returns empty array when no XML references the file', () => {
      readdirStub.returns(['Unrelated.xml']);
      readFileStub.returns('<component />');
      expect(findParentXmls('/dir/App.routing.brs')).to.deep.equal([]);
    });

    it('returns empty array when directory cannot be read', () => {
      readdirStub.throws(new Error('ENOENT'));
      expect(findParentXmls('/dir/file.brs')).to.deep.equal([]);
    });
  });

  // ── getXmlSiblingPaths ────────────────────────────────────────────────────

  describe('getXmlSiblingPaths', () => {
    it('returns sibling brs paths from shared XML, excluding self', () => {
      readdirStub.returns(['App.view.xml']);
      readFileStub.withArgs('/dir/App.view.xml', 'utf-8').returns(`
        <script type="text/brightscript" uri="App.routing.brs" />
        <script type="text/brightscript" uri="App.template.brs" />
        <script type="text/brightscript" uri="App.view.brs" />`);
      existsStub.callsFake((p: string) =>
        ['/dir/App.routing.brs', '/dir/App.template.brs', '/dir/App.view.brs'].includes(p)
      );

      const result = getXmlSiblingPaths('/dir/App.routing.brs', ['/project'], 'app');
      expect(result).to.include.members(['/dir/App.template.brs', '/dir/App.view.brs']);
      expect(result).not.to.include('/dir/App.routing.brs');
    });

    it('returns empty array when no parent XML found', () => {
      readdirStub.returns([]);
      expect(getXmlSiblingPaths('/dir/file.brs', ['/project'], 'app')).to.deep.equal([]);
    });
  });

  // ── parseComponentTag ─────────────────────────────────────────────────────

  describe('parseComponentTag', () => {
    it('returns the name and extends values with their positions', () => {
      const xml = '<component name="MyButton" extends="BaseButton">\n</component>';

      expect(parseComponentTag(xml)).to.deep.equal({
        name: 'MyButton',
        tagLine: 0,
        nameLine: 0,
        nameColumn: 17,
        extendsName: 'BaseButton',
        extendsLine: 0,
        extendsColumn: 36,
      });
    });

    it('reports positions relative to the line the attribute is on', () => {
      const xml = [
        '<?xml version="1.0" encoding="utf-8" ?>',
        '<component',
        '    name="Card"',
        '    extends="Group">',
        '</component>',
      ].join('\n');

      const tag = parseComponentTag(xml);

      expect(tag?.tagLine).to.equal(1);
      expect(tag?.nameLine).to.equal(2);
      expect(tag?.nameColumn).to.equal(10);
      expect(tag?.extendsLine).to.equal(3);
      expect(tag?.extendsColumn).to.equal(13);
    });

    it('handles single-quoted attribute values', () => {
      const tag = parseComponentTag("<component name='Card' extends='Group' />");

      expect(tag?.name).to.equal('Card');
      expect(tag?.extendsName).to.equal('Group');
      expect(tag?.extendsColumn).to.equal(32);
    });

    it('omits extends fields when the component has no parent', () => {
      const tag = parseComponentTag('<component name="Root" />');

      expect(tag?.name).to.equal('Root');
      expect(tag?.extendsName).to.be.undefined;
      expect(tag?.extendsLine).to.be.undefined;
    });

    it('returns undefined when there is no component tag', () => {
      expect(parseComponentTag('<settings><value>1</value></settings>')).to.be.undefined;
    });

    it('returns undefined when the component tag has no name', () => {
      expect(parseComponentTag('<component extends="Group" />')).to.be.undefined;
    });

    it('ignores name attributes outside the component tag', () => {
      const xml = [
        '<component name="Card" extends="Group">',
        '  <interface>',
        '    <function name="refresh" />',
        '  </interface>',
        '</component>',
      ].join('\n');

      const tag = parseComponentTag(xml);

      expect(tag?.name).to.equal('Card');
      expect(tag?.nameLine).to.equal(0);
    });
  });
});

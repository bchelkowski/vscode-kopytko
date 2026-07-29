import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import { SymbolKind, TypeHierarchyItem } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { BrightScriptTypeHierarchyProvider } from '../../src/server/providers/typeHierarchyProvider';
import { WorkspaceComponentIndex } from '../../src/server/utils/workspaceComponentIndex';
import { clearFileParseCache } from '../../src/server/utils/fileParseCache';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

const WORKSPACE = '/workspace';
const DIR = path.join(WORKSPACE, 'components');
const MY_BUTTON_XML = path.join(DIR, 'MyButton.xml');
const BASE_BUTTON_XML = path.join(DIR, 'BaseButton.xml');
const FANCY_BUTTON_XML = path.join(DIR, 'FancyButton.xml');
const MY_BUTTON_BRS = path.join(DIR, 'MyButton.brs');

const MY_BUTTON_XML_TEXT = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  '<component name="MyButton" extends="BaseButton">',
  '  <children>',
  '    <BaseButton id="inner" />',
  '  </children>',
  '  <script type="text/brightscript" uri="MyButton.brs" />',
  '</component>',
].join('\n');

// `<component name="BaseButton" extends="Group">` — name value at column 17,
// extends value at column 38.
const BASE_BUTTON_XML_TEXT = [
  '<component name="BaseButton" extends="Group">',
  '</component>',
].join('\n');

const FANCY_BUTTON_XML_TEXT = '<component name="FancyButton" extends="MyButton" />';

const MY_BUTTON_BRS_TEXT = [
  'sub init()',
  '  m.top.createChild("BaseButton")',
  '  m.poster = createObject("roSGNode", "Poster")',
  'end sub',
].join('\n');

function uriOf(filePath: string): string {
  return `file://${filePath}`;
}

function makeBrsDocument(content: string, filePath: string): TextDocument {
  return TextDocument.create(uriOf(filePath), 'brightscript', 1, content);
}

describe('BrightScriptTypeHierarchyProvider', () => {
  let readdirTypedStub: sinon.SinonStub;
  let readdirStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let index: WorkspaceComponentIndex;
  let provider: BrightScriptTypeHierarchyProvider;

  beforeEach(() => {
    readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
    readdirStub = sinon.stub(fsWrapper, 'readdirSync').returns([]);
    readFileStub = sinon.stub(fsWrapper, 'readFileSync').returns('');
    sinon.stub(fsWrapper, 'existsSync').returns(false);

    readdirTypedStub.withArgs(WORKSPACE).returns([{ name: 'components', isDirectory: true }]);
    readdirTypedStub.withArgs(DIR).returns([
      { name: 'MyButton.xml', isDirectory: false },
      { name: 'BaseButton.xml', isDirectory: false },
      { name: 'FancyButton.xml', isDirectory: false },
      { name: 'MyButton.brs', isDirectory: false },
    ]);
    readdirStub.withArgs(DIR).returns([
      'MyButton.xml', 'BaseButton.xml', 'FancyButton.xml', 'MyButton.brs',
    ]);
    readFileStub.withArgs(MY_BUTTON_XML, 'utf-8').returns(MY_BUTTON_XML_TEXT);
    readFileStub.withArgs(BASE_BUTTON_XML, 'utf-8').returns(BASE_BUTTON_XML_TEXT);
    readFileStub.withArgs(FANCY_BUTTON_XML, 'utf-8').returns(FANCY_BUTTON_XML_TEXT);

    index = new WorkspaceComponentIndex();
    index.build([WORKSPACE]);
    provider = new BrightScriptTypeHierarchyProvider(index);
  });

  afterEach(() => {
    sinon.restore();
    clearFileParseCache();
    invalidateAllCaches();
  });

  /** The item a hierarchy walk starts from, for the named component. */
  function itemFor(name: string, filePath: string, line: number, character: number): TypeHierarchyItem {
    const items = provider.prepare(uriOf(filePath), { line, character });
    expect(items, `prepare found no item for ${name}`).to.not.be.null;
    expect(items![0].name).to.equal(name);
    return items![0];
  }

  // ── prepare: XML ─────────────────────────────────────────────────────────

  describe('prepare (XML)', () => {
    it('resolves the parent from the extends attribute', () => {
      const items = provider.prepare(uriOf(MY_BUTTON_XML), { line: 1, character: 40 });

      expect(items).to.have.length(1);
      expect(items![0].name).to.equal('BaseButton');
      expect(items![0].kind).to.equal(SymbolKind.Class);
      expect(items![0].uri).to.equal(uriOf(BASE_BUTTON_XML));
      expect(items![0].detail).to.equal('extends Group');
    });

    it('resolves the component itself from the name attribute', () => {
      const items = provider.prepare(uriOf(MY_BUTTON_XML), { line: 1, character: 20 });

      expect(items).to.have.length(1);
      expect(items![0].name).to.equal('MyButton');
      expect(items![0].uri).to.equal(uriOf(MY_BUTTON_XML));
      expect(items![0].selectionRange).to.deep.equal({
        start: { line: 1, character: 17 },
        end: { line: 1, character: 25 },
      });
    });

    it('resolves a child element tag name', () => {
      const items = provider.prepare(uriOf(MY_BUTTON_XML), { line: 3, character: 8 });

      expect(items).to.have.length(1);
      expect(items![0].name).to.equal('BaseButton');
      expect(items![0].uri).to.equal(uriOf(BASE_BUTTON_XML));
    });

    it('falls back to the component the file declares', () => {
      const items = provider.prepare(uriOf(MY_BUTTON_XML), { line: 5, character: 4 });

      expect(items).to.have.length(1);
      expect(items![0].name).to.equal('MyButton');
    });

    it('returns a built-in item for an extends attribute naming a SceneGraph node', () => {
      const items = provider.prepare(uriOf(BASE_BUTTON_XML), { line: 0, character: 40 });

      expect(items).to.have.length(1);
      expect(items![0].name).to.equal('Group');
      expect(items![0].kind).to.equal(SymbolKind.Interface);
      expect(items![0].detail).to.equal('built-in SceneGraph node');
      // Anchored to the `extends="Group"` value that referenced it
      expect(items![0].uri).to.equal(uriOf(BASE_BUTTON_XML));
      expect(items![0].selectionRange).to.deep.equal({
        start: { line: 0, character: 38 },
        end: { line: 0, character: 43 },
      });
    });

    it('returns null for an XML that declares no component', () => {
      const manifest = path.join(DIR, 'settings.xml');
      readFileStub.withArgs(manifest, 'utf-8').returns('<settings><value>1</value></settings>');

      expect(provider.prepare(uriOf(manifest), { line: 0, character: 3 })).to.be.null;
    });

    it('returns null for an unreadable file', () => {
      expect(provider.prepare(uriOf(path.join(DIR, 'Gone.xml')), { line: 0, character: 0 })).to.be.null;
    });
  });

  // ── prepare: BrightScript ────────────────────────────────────────────────

  describe('prepare (.brs)', () => {
    it('resolves a component name under the cursor', () => {
      const doc = makeBrsDocument(MY_BUTTON_BRS_TEXT, MY_BUTTON_BRS);
      const items = provider.prepare(uriOf(MY_BUTTON_BRS), { line: 1, character: 24 }, doc);

      expect(items).to.have.length(1);
      expect(items![0].name).to.equal('BaseButton');
      expect(items![0].uri).to.equal(uriOf(BASE_BUTTON_XML));
    });

    it('resolves a built-in SceneGraph node name under the cursor', () => {
      const doc = makeBrsDocument(MY_BUTTON_BRS_TEXT, MY_BUTTON_BRS);
      const items = provider.prepare(uriOf(MY_BUTTON_BRS), { line: 2, character: 44 }, doc);

      expect(items).to.have.length(1);
      expect(items![0].name).to.equal('Poster');
      expect(items![0].kind).to.equal(SymbolKind.Interface);
      // Anchored to the word in the .brs file
      expect(items![0].uri).to.equal(uriOf(MY_BUTTON_BRS));
      expect(items![0].selectionRange.start).to.deep.equal({ line: 2, character: 39 });
    });

    it('falls back to the component that owns the file', () => {
      const doc = makeBrsDocument(MY_BUTTON_BRS_TEXT, MY_BUTTON_BRS);
      const items = provider.prepare(uriOf(MY_BUTTON_BRS), { line: 0, character: 5 }, doc);

      expect(items).to.have.length(1);
      expect(items![0].name).to.equal('MyButton');
      expect(items![0].uri).to.equal(uriOf(MY_BUTTON_XML));
    });

    it('returns one item per component sharing the file', () => {
      readFileStub.withArgs(BASE_BUTTON_XML, 'utf-8').returns(
        '<component name="BaseButton" extends="Group">\n  <script uri="MyButton.brs" />\n</component>'
      );
      clearFileParseCache();
      index.build([WORKSPACE]);
      provider = new BrightScriptTypeHierarchyProvider(index);

      const doc = makeBrsDocument(MY_BUTTON_BRS_TEXT, MY_BUTTON_BRS);
      const items = provider.prepare(uriOf(MY_BUTTON_BRS), { line: 0, character: 5 }, doc);

      expect(items!.map((i) => i.name).sort()).to.deep.equal(['BaseButton', 'MyButton']);
    });

    it('returns null when the file belongs to no component', () => {
      const orphan = path.join(WORKSPACE, 'source', 'Utils.brs');
      const doc = makeBrsDocument('sub helper()\nend sub', orphan);

      expect(provider.prepare(uriOf(orphan), { line: 0, character: 6 }, doc)).to.be.null;
    });
  });

  // ── supertypes ───────────────────────────────────────────────────────────

  describe('supertypes', () => {
    it('returns the workspace parent component', () => {
      const item = itemFor('MyButton', MY_BUTTON_XML, 1, 20);
      const parents = provider.supertypes(item);

      expect(parents).to.have.length(1);
      expect(parents[0].name).to.equal('BaseButton');
      expect(parents[0].kind).to.equal(SymbolKind.Class);
      expect(parents[0].uri).to.equal(uriOf(BASE_BUTTON_XML));
    });

    it('returns a built-in parent anchored to the child extends attribute', () => {
      const item = itemFor('BaseButton', BASE_BUTTON_XML, 0, 20);
      const parents = provider.supertypes(item);

      expect(parents).to.have.length(1);
      expect(parents[0].name).to.equal('Group');
      expect(parents[0].kind).to.equal(SymbolKind.Interface);
      expect(parents[0].detail).to.equal('built-in SceneGraph node');
      expect(parents[0].uri).to.equal(uriOf(BASE_BUTTON_XML));
      expect(parents[0].selectionRange.start).to.deep.equal({ line: 0, character: 38 });
    });

    it('continues up the built-in catalog', () => {
      const group = provider.supertypes(itemFor('BaseButton', BASE_BUTTON_XML, 0, 20))[0];
      const parents = provider.supertypes(group);

      expect(parents.map((p) => p.name)).to.deep.equal(['Node']);
      // The built-in chain keeps the anchor it was expanded from
      expect(parents[0].uri).to.equal(uriOf(BASE_BUTTON_XML));
    });

    it('stops at the root built-in node', () => {
      const group = provider.supertypes(itemFor('BaseButton', BASE_BUTTON_XML, 0, 20))[0];
      const node = provider.supertypes(group)[0];

      expect(provider.supertypes(node)).to.be.empty;
    });

    it('returns nothing for a component that extends itself', () => {
      const loopXml = path.join(DIR, 'Loop.xml');
      readdirTypedStub.withArgs(DIR).returns([{ name: 'Loop.xml', isDirectory: false }]);
      readFileStub.withArgs(loopXml, 'utf-8').returns('<component name="Loop" extends="Loop" />');
      clearFileParseCache();
      index.build([WORKSPACE]);
      provider = new BrightScriptTypeHierarchyProvider(index);

      expect(provider.supertypes(itemFor('Loop', loopXml, 0, 20))).to.be.empty;
    });

    it('returns nothing for a component with no extends attribute', () => {
      const plainXml = path.join(DIR, 'Plain.xml');
      readdirTypedStub.withArgs(DIR).returns([{ name: 'Plain.xml', isDirectory: false }]);
      readFileStub.withArgs(plainXml, 'utf-8').returns('<component name="Plain" />');
      clearFileParseCache();
      index.build([WORKSPACE]);
      provider = new BrightScriptTypeHierarchyProvider(index);

      const item = itemFor('Plain', plainXml, 0, 20);
      expect(item.detail).to.be.undefined;
      expect(provider.supertypes(item)).to.be.empty;
    });

    it('resolves a component that is not in the index by re-reading its XML', () => {
      const outsideXml = path.join('/elsewhere', 'Outside.xml');
      readFileStub.withArgs(outsideXml, 'utf-8')
        .returns('<component name="Outside" extends="BaseButton" />');

      const item = itemFor('Outside', outsideXml, 0, 20);
      const parents = provider.supertypes(item);

      expect(parents.map((p) => p.name)).to.deep.equal(['BaseButton']);
    });
  });

  // ── subtypes ─────────────────────────────────────────────────────────────

  describe('subtypes', () => {
    it('returns workspace components that extend the item', () => {
      const item = itemFor('MyButton', MY_BUTTON_XML, 1, 20);
      const children = provider.subtypes(item);

      expect(children.map((c) => c.name)).to.deep.equal(['FancyButton']);
      expect(children[0].uri).to.equal(uriOf(FANCY_BUTTON_XML));
    });

    it('returns an empty array for a leaf component', () => {
      const item = itemFor('FancyButton', FANCY_BUTTON_XML, 0, 20);

      expect(provider.subtypes(item)).to.be.empty;
    });

    it('lists workspace subtypes before built-in descendants', () => {
      const group = provider.supertypes(itemFor('BaseButton', BASE_BUTTON_XML, 0, 20))[0];
      const children = provider.subtypes(group);

      expect(children[0].name).to.equal('BaseButton');
      expect(children[0].kind).to.equal(SymbolKind.Class);

      const builtins = children.slice(1);
      expect(builtins.every((c) => c.kind === SymbolKind.Interface)).to.be.true;
      expect(builtins.map((c) => c.name)).to.include.members(['LayoutGroup', 'Poster', 'Rectangle']);
      // Built-in descendants keep the anchor of the item they were expanded from
      expect(builtins[0].uri).to.equal(group.uri);
    });
  });
});

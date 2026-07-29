import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { WorkspaceComponentIndex } from '../../src/server/utils/workspaceComponentIndex';
import { clearFileParseCache } from '../../src/server/utils/fileParseCache';

const WORKSPACE = '/workspace';
const COMPONENTS_DIR = path.join(WORKSPACE, 'app', 'components');
const BUTTON_XML = path.join(COMPONENTS_DIR, 'MyButton.xml');
const BASE_XML = path.join(COMPONENTS_DIR, 'BaseButton.xml');
const BUTTON_BRS = path.join(COMPONENTS_DIR, 'MyButton.brs');

const BUTTON_XML_TEXT = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  '<component name="MyButton" extends="BaseButton">',
  '  <script type="text/brightscript" uri="MyButton.brs" />',
  '</component>',
].join('\n');

const BASE_XML_TEXT = [
  '<component name="BaseButton" extends="Group">',
  '</component>',
].join('\n');

describe('WorkspaceComponentIndex', () => {
  let readdirTypedStub: sinon.SinonStub;
  let readdirStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let index: WorkspaceComponentIndex;

  beforeEach(() => {
    readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
    readdirStub = sinon.stub(fsWrapper, 'readdirSync').returns([]);
    readFileStub = sinon.stub(fsWrapper, 'readFileSync').returns('');
    index = new WorkspaceComponentIndex();
  });

  afterEach(() => {
    sinon.restore();
    clearFileParseCache();
  });

  /** Stubs a flat workspace containing MyButton.xml and BaseButton.xml. */
  function stubTwoComponents(): void {
    readdirTypedStub.withArgs(WORKSPACE).returns([{ name: 'app', isDirectory: true }]);
    readdirTypedStub.withArgs(path.join(WORKSPACE, 'app')).returns([
      { name: 'components', isDirectory: true },
    ]);
    readdirTypedStub.withArgs(COMPONENTS_DIR).returns([
      { name: 'MyButton.xml', isDirectory: false },
      { name: 'BaseButton.xml', isDirectory: false },
      { name: 'MyButton.brs', isDirectory: false },
    ]);
    readFileStub.withArgs(BUTTON_XML, 'utf-8').returns(BUTTON_XML_TEXT);
    readFileStub.withArgs(BASE_XML, 'utf-8').returns(BASE_XML_TEXT);
  }

  describe('build', () => {
    it('indexes a component with its name, parent, and attribute positions', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      const entry = index.getComponent('mybutton');
      expect(entry).to.not.be.undefined;
      expect(entry!.name).to.equal('MyButton');
      expect(entry!.extendsName).to.equal('BaseButton');
      expect(entry!.extendsLower).to.equal('basebutton');
      expect(entry!.filePath).to.equal(BUTTON_XML);
      // `<component name="MyButton" extends="BaseButton">` on the second line
      expect(entry!.nameLine).to.equal(1);
      expect(entry!.nameColumn).to.equal(17);
      expect(entry!.extendsLine).to.equal(1);
      expect(entry!.extendsColumn).to.equal(36);
    });

    it('walks nested directories', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      expect(index.getComponent('basebutton')).to.not.be.undefined;
      expect(index.getAll().map((e) => e.name)).to.deep.equal(['BaseButton', 'MyButton']);
    });

    it('skips node_modules and dot-directories', () => {
      readdirTypedStub.withArgs(WORKSPACE).returns([
        { name: 'node_modules', isDirectory: true },
        { name: '.git', isDirectory: true },
      ]);
      readdirTypedStub.withArgs(path.join(WORKSPACE, 'node_modules')).returns([
        { name: 'Hidden.xml', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(WORKSPACE, 'node_modules', 'Hidden.xml'), 'utf-8')
        .returns('<component name="Hidden" extends="Group" />');

      index.build([WORKSPACE]);

      expect(index.getComponent('hidden')).to.be.undefined;
    });

    it('indexes components under a root inside node_modules when given explicitly', () => {
      const pkgBase = path.join(WORKSPACE, 'node_modules', 'kopytko-ui', 'app');
      readdirTypedStub.withArgs(pkgBase).returns([{ name: 'Card.xml', isDirectory: false }]);
      readFileStub.withArgs(path.join(pkgBase, 'Card.xml'), 'utf-8')
        .returns('<component name="Card" extends="Group" />');

      index.build([pkgBase]);

      expect(index.getComponent('card')?.name).to.equal('Card');
    });

    it('ignores XML files that declare no component', () => {
      readdirTypedStub.withArgs(WORKSPACE).returns([{ name: 'manifest.xml', isDirectory: false }]);
      readFileStub.withArgs(path.join(WORKSPACE, 'manifest.xml'), 'utf-8')
        .returns('<settings><value>1</value></settings>');

      index.build([WORKSPACE]);

      expect(index.getAll()).to.be.empty;
    });

    it('ignores unreadable files', () => {
      readdirTypedStub.withArgs(WORKSPACE).returns([{ name: 'Broken.xml', isDirectory: false }]);
      readFileStub.withArgs(path.join(WORKSPACE, 'Broken.xml'), 'utf-8').throws(new Error('EACCES'));

      index.build([WORKSPACE]);

      expect(index.getAll()).to.be.empty;
    });
  });

  describe('root de-duplication', () => {
    it('walks a nested root only once', () => {
      stubTwoComponents();

      // buildSearchRoots() returns both `<ws>/<sourceDir>` and `<ws>`
      index.build([path.join(WORKSPACE, 'app'), WORKSPACE]);

      expect(readdirTypedStub.withArgs(COMPONENTS_DIR).callCount).to.equal(1);
      expect(index.getAll().map((e) => e.name)).to.deep.equal(['BaseButton', 'MyButton']);
    });

    it('keeps roots that only share a name prefix', () => {
      const appTwo = path.join(WORKSPACE, 'app-legacy');
      readdirTypedStub.withArgs(path.join(WORKSPACE, 'app')).returns([]);
      readdirTypedStub.withArgs(appTwo).returns([{ name: 'Old.xml', isDirectory: false }]);
      readFileStub.withArgs(path.join(appTwo, 'Old.xml'), 'utf-8')
        .returns('<component name="Old" extends="Group" />');

      index.build([path.join(WORKSPACE, 'app'), appTwo]);

      expect(index.getComponent('old')?.name).to.equal('Old');
    });

    it('ignores repeated and empty roots', () => {
      stubTwoComponents();

      index.build([WORKSPACE, WORKSPACE, '']);

      expect(readdirTypedStub.withArgs(COMPONENTS_DIR).callCount).to.equal(1);
    });

    it('keeps a package root under node_modules, which the outer walk cannot reach', () => {
      const pkgBase = path.join(WORKSPACE, 'node_modules', 'kopytko-ui', 'app');
      stubTwoComponents();
      readdirTypedStub.withArgs(pkgBase).returns([{ name: 'Card.xml', isDirectory: false }]);
      readFileStub.withArgs(path.join(pkgBase, 'Card.xml'), 'utf-8')
        .returns('<component name="Card" extends="Group" />');

      index.build([WORKSPACE, pkgBase]);

      expect(index.getComponent('card')?.name).to.equal('Card');
    });

    it('still collapses a plain sub-directory root', () => {
      stubTwoComponents();

      index.build([WORKSPACE, COMPONENTS_DIR]);

      expect(readdirTypedStub.withArgs(COMPONENTS_DIR).callCount).to.equal(1);
    });
  });

  describe('duplicate declarations', () => {
    /** Stubs the same component name declared in app/ and in a build output dir. */
    function stubDuplicate(): { source: string; copy: string } {
      const source = path.join(WORKSPACE, 'app', 'Card.xml');
      const copy = path.join(WORKSPACE, 'out', 'Card.xml');
      readdirTypedStub.withArgs(WORKSPACE).returns([
        { name: 'app', isDirectory: true },
        { name: 'out', isDirectory: true },
      ]);
      readdirTypedStub.withArgs(path.join(WORKSPACE, 'app')).returns([
        { name: 'Card.xml', isDirectory: false },
      ]);
      readdirTypedStub.withArgs(path.join(WORKSPACE, 'out')).returns([
        { name: 'Card.xml', isDirectory: false },
      ]);
      readFileStub.withArgs(source, 'utf-8').returns('<component name="Card" extends="Group" />');
      readFileStub.withArgs(copy, 'utf-8').returns('<component name="Card" extends="Group" />');
      return { source, copy };
    }

    it('keeps every declaration of a name, ordered by path', () => {
      const { source, copy } = stubDuplicate();
      index.build([WORKSPACE]);

      const cards = index.getAll().filter((e) => e.nameLower === 'card');

      expect(cards.map((e) => e.filePath)).to.deep.equal([source, copy]);
    });

    it('yields one entry per file when every name is unique', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      expect(index.getAll()).to.have.length(2);
    });

    it('does not double-count a file reached through two overlapping roots', () => {
      stubTwoComponents();
      index.build([WORKSPACE, path.join(WORKSPACE, 'app')]);

      expect(index.getAll()).to.have.length(2);
    });

    it('resolves lookups to the first declaration by path', () => {
      const { source } = stubDuplicate();
      index.build([WORKSPACE]);

      expect(index.getComponent('card')?.filePath).to.equal(source);
    });

    it('drops the extra declaration once the duplicate file is removed', () => {
      const { copy } = stubDuplicate();
      index.build([WORKSPACE]);

      index.removeFile(copy);

      expect(index.getAll().filter((e) => e.nameLower === 'card')).to.have.length(1);
    });

    it('lists both declarations as subtypes of their parent', () => {
      stubDuplicate();
      index.build([WORKSPACE]);

      expect(index.getChildren('group').map((e) => e.name)).to.deep.equal(['Card', 'Card']);
    });
  });

  describe('getChildren', () => {
    it('maps a parent name to its direct subtypes', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      expect(index.getChildren('basebutton').map((e) => e.name)).to.deep.equal(['MyButton']);
      expect(index.getChildren('group').map((e) => e.name)).to.deep.equal(['BaseButton']);
    });

    it('returns an empty array for a component nothing extends', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      expect(index.getChildren('mybutton')).to.be.empty;
    });

    it('sorts subtypes by name', () => {
      readdirTypedStub.withArgs(WORKSPACE).returns([
        { name: 'Zebra.xml', isDirectory: false },
        { name: 'Alpha.xml', isDirectory: false },
      ]);
      readFileStub.withArgs(path.join(WORKSPACE, 'Zebra.xml'), 'utf-8')
        .returns('<component name="Zebra" extends="Group" />');
      readFileStub.withArgs(path.join(WORKSPACE, 'Alpha.xml'), 'utf-8')
        .returns('<component name="Alpha" extends="Group" />');

      index.build([WORKSPACE]);

      expect(index.getChildren('group').map((e) => e.name)).to.deep.equal(['Alpha', 'Zebra']);
    });
  });

  describe('updateFile / removeFile', () => {
    it('picks up a newly added component', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      const newXml = path.join(COMPONENTS_DIR, 'FancyButton.xml');
      readFileStub.withArgs(newXml, 'utf-8')
        .returns('<component name="FancyButton" extends="BaseButton" />');
      index.updateFile(newXml);

      expect(index.getComponent('fancybutton')).to.not.be.undefined;
      expect(index.getChildren('basebutton').map((e) => e.name))
        .to.deep.equal(['FancyButton', 'MyButton']);
    });

    it('reflects a changed extends attribute', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      readFileStub.withArgs(BUTTON_XML, 'utf-8')
        .returns('<component name="MyButton" extends="Group" />');
      index.updateFile(BUTTON_XML);

      expect(index.getComponent('mybutton')?.extendsName).to.equal('Group');
      expect(index.getChildren('basebutton')).to.be.empty;
      expect(index.getChildren('group').map((e) => e.name)).to.deep.equal(['BaseButton', 'MyButton']);
    });

    it('drops a deleted component from both maps', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      index.removeFile(BUTTON_XML);

      expect(index.getComponent('mybutton')).to.be.undefined;
      expect(index.getChildren('basebutton')).to.be.empty;
    });

    it('ignores non-XML paths', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      index.removeFile(BUTTON_BRS);

      expect(index.getComponent('mybutton')).to.not.be.undefined;
    });

    it('ignores an XML the build would never have walked', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      // The client watches **/*.xml, so these do reach updateFile
      const vendored = path.join(WORKSPACE, 'node_modules', 'some-lib', 'Widget.xml');
      const hidden = path.join(WORKSPACE, '.cache', 'Widget.xml');
      readFileStub.withArgs(vendored, 'utf-8').returns('<component name="Vendored" />');
      readFileStub.withArgs(hidden, 'utf-8').returns('<component name="Hidden" />');

      index.updateFile(vendored);
      index.updateFile(hidden);

      expect(index.getComponent('vendored')).to.be.undefined;
      expect(index.getComponent('hidden')).to.be.undefined;
    });

    it('accepts an XML inside a package base dir that was given as a root', () => {
      const pkgBase = path.join(WORKSPACE, 'node_modules', 'kopytko-ui', 'app');
      stubTwoComponents();
      readdirTypedStub.withArgs(pkgBase).returns([]);
      index.build([WORKSPACE, pkgBase]);

      const pkgCard = path.join(pkgBase, 'Card.xml');
      readFileStub.withArgs(pkgCard, 'utf-8').returns('<component name="Card" extends="Group" />');
      index.updateFile(pkgCard);

      expect(index.getComponent('card')?.filePath).to.equal(pkgCard);
    });
  });

  describe('getComponentForBrsFile', () => {
    it('returns the component whose XML pulls in the .brs file', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);

      readdirStub.withArgs(COMPONENTS_DIR).returns(['MyButton.xml', 'BaseButton.xml', 'MyButton.brs']);

      const owners = index.getComponentForBrsFile(BUTTON_BRS);

      expect(owners.map((e) => e.name)).to.deep.equal(['MyButton']);
    });

    it('returns every component that shares the .brs file', () => {
      const sharedBrs = path.join(COMPONENTS_DIR, 'Shared.brs');
      readdirTypedStub.withArgs(COMPONENTS_DIR).returns([
        { name: 'MyButton.xml', isDirectory: false },
        { name: 'BaseButton.xml', isDirectory: false },
      ]);
      readFileStub.withArgs(BUTTON_XML, 'utf-8').returns(
        '<component name="MyButton" extends="Group">\n  <script uri="Shared.brs" />\n</component>'
      );
      readFileStub.withArgs(BASE_XML, 'utf-8').returns(
        '<component name="BaseButton" extends="Group">\n  <script uri="Shared.brs" />\n</component>'
      );
      readdirStub.withArgs(COMPONENTS_DIR).returns(['MyButton.xml', 'BaseButton.xml']);
      index.build([COMPONENTS_DIR]);

      const owners = index.getComponentForBrsFile(sharedBrs);

      expect(owners.map((e) => e.name).sort()).to.deep.equal(['BaseButton', 'MyButton']);
    });

    it('returns an empty array when no XML references the file', () => {
      stubTwoComponents();
      index.build([WORKSPACE]);
      readdirStub.withArgs(COMPONENTS_DIR).returns(['BaseButton.xml']);

      expect(index.getComponentForBrsFile(path.join(COMPONENTS_DIR, 'Orphan.brs'))).to.be.empty;
    });
  });
});

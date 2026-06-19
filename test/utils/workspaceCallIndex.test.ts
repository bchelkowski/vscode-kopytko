import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { WorkspaceCallIndex } from '../../src/server/utils/workspaceCallIndex';
import { clearFileParseCache } from '../../src/server/utils/fileParseCache';

const WORKSPACE = '/workspace';
const COMPONENT_FILE = path.join(WORKSPACE, 'app', 'components', 'Button.brs');
const XML_FILE = path.join(WORKSPACE, 'app', 'components', 'Button.xml');
const HELPER_FILE = path.join(WORKSPACE, 'app', 'components', 'Helper.brs');

const BRS_WITH_DIRECT_CALL = [
  'sub init()',
  '  helperFn()',
  'end sub',
].join('\n');

const BRS_WITH_OBSERVE_FIELD = [
  'sub init()',
  '  m.top.observeField("myField", "onMyFieldChange")',
  '  m.top.observeFieldScoped("otherField", "onOtherChange")',
  'end sub',
].join('\n');

const BRS_WITH_CALLFUNC = [
  'sub init()',
  '  m.childNode.callFunc("doSomething", {})',
  'end sub',
].join('\n');

const BRS_WITH_EVENTS = [
  'function createController() as Object',
  '  return {',
  '    events: {',
  '      click: "onClick",',
  '      hover: "onHover",',
  '    }',
  '  }',
  'end function',
].join('\n');

const BRS_WITH_METHOD_CALL = [
  'sub init()',
  '  m.helper.doSomething()',
  'end sub',
].join('\n');

const XML_WITH_INTERFACE = [
  '<component name="Button" extends="Group">',
  '  <interface>',
  '    <function name="myPublicMethod" />',
  '    <function name="anotherPublicMethod" />',
  '    <field id="title" type="string" />',
  '  </interface>',
  '  <script type="text/brightscript" uri="Button.brs" />',
  '</component>',
].join('\n');

const XML_WITHOUT_INTERFACE = [
  '<component name="SimpleButton" extends="Group">',
  '  <script type="text/brightscript" uri="Button.brs" />',
  '</component>',
].join('\n');

describe('WorkspaceCallIndex', () => {
  let readdirStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let index: WorkspaceCallIndex;

  beforeEach(() => {
    readdirStub = sinon.stub(fsWrapper, 'readdirTyped');
    readFileStub = sinon.stub(fsWrapper, 'readFileSync');
    readdirStub.returns([]);

    readdirStub.withArgs(WORKSPACE).returns([{ name: 'app', isDirectory: true }]);
    readdirStub.withArgs(path.join(WORKSPACE, 'app')).returns([
      { name: 'components', isDirectory: true },
    ]);
    readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
      { name: 'Button.brs', isDirectory: false },
    ]);
    readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(BRS_WITH_DIRECT_CALL);

    index = new WorkspaceCallIndex();
    index.build([WORKSPACE]);
  });

  afterEach(() => {
    sinon.restore();
    clearFileParseCache();
  });

  describe('build()', () => {
    it('populates getCalledNames() with direct function call names', () => {
      const called = index.getCalledNames();
      expect(called.has('helperfn')).to.be.true;
    });

    it('does not include method calls (m.foo())', () => {
      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(BRS_WITH_METHOD_CALL);
      clearFileParseCache();
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      expect(fresh.getCalledNames().has('dosomething')).to.be.false;
    });

    it('includes observeField string callbacks', () => {
      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(BRS_WITH_OBSERVE_FIELD);
      clearFileParseCache();
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      const called = fresh.getCalledNames();
      expect(called.has('onmyfieldchange')).to.be.true;
      expect(called.has('onotherchange')).to.be.true;
    });

    it('includes callFunc first-argument strings', () => {
      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(BRS_WITH_CALLFUNC);
      clearFileParseCache();
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      expect(fresh.getCalledNames().has('dosomething')).to.be.true;
    });

    it('includes Kopytko events: { prop: "fn" } string values', () => {
      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(BRS_WITH_EVENTS);
      clearFileParseCache();
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      const called = fresh.getCalledNames();
      expect(called.has('onclick')).to.be.true;
      expect(called.has('onhover')).to.be.true;
    });

    it('includes XML interface function names from .xml files', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
        { name: 'Button.brs', isDirectory: false },
        { name: 'Button.xml', isDirectory: false },
      ]);
      readFileStub.withArgs(XML_FILE, 'utf-8').returns(XML_WITH_INTERFACE);
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      const called = fresh.getCalledNames();
      expect(called.has('mypublicmethod')).to.be.true;
      expect(called.has('anotherpublicmethod')).to.be.true;
    });

    it('does not add names from xml files without <interface><function>', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
        { name: 'Button.brs', isDirectory: false },
        { name: 'Button.xml', isDirectory: false },
      ]);
      readFileStub.withArgs(XML_FILE, 'utf-8').returns(XML_WITHOUT_INTERFACE);
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      // Only the direct call from BRS_WITH_DIRECT_CALL
      expect(fresh.getCalledNames().has('helperfn')).to.be.true;
      expect(fresh.getCalledNames().size).to.equal(1);
    });
  });

  describe('getCalledNames()', () => {
    it('returns the same Set instance on repeated calls (lazy cache)', () => {
      const first = index.getCalledNames();
      const second = index.getCalledNames();
      expect(first).to.equal(second);
    });

    it('returns names from all files in the workspace', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
        { name: 'Button.brs', isDirectory: false },
        { name: 'Helper.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(BRS_WITH_DIRECT_CALL);
      readFileStub.withArgs(HELPER_FILE, 'utf-8').returns(BRS_WITH_OBSERVE_FIELD);
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      const called = fresh.getCalledNames();
      expect(called.has('helperfn')).to.be.true;
      expect(called.has('onmyfieldchange')).to.be.true;
    });
  });

  describe('updateFile()', () => {
    it('adds newly called names when a .brs file changes', () => {
      // Initially only helperFn is called
      expect(index.getCalledNames().has('helperfn')).to.be.true;
      expect(index.getCalledNames().has('onmyfieldchange')).to.be.false;

      // Update the file to also observe a field
      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(BRS_WITH_OBSERVE_FIELD);
      index.updateFile(COMPONENT_FILE);

      expect(index.getCalledNames().has('onmyfieldchange')).to.be.true;
    });

    it('removes names no longer called after a .brs file changes', () => {
      expect(index.getCalledNames().has('helperfn')).to.be.true;

      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns('sub init()\nend sub\n');
      index.updateFile(COMPONENT_FILE);

      expect(index.getCalledNames().has('helperfn')).to.be.false;
    });

    it('a name called in two files remains in the set after one file is updated to remove it', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
        { name: 'Button.brs', isDirectory: false },
        { name: 'Helper.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(HELPER_FILE, 'utf-8').returns(BRS_WITH_DIRECT_CALL);
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);

      // Both files call helperFn; remove it from Button.brs
      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns('sub init()\nend sub\n');
      fresh.updateFile(COMPONENT_FILE);

      // Still called from Helper.brs
      expect(fresh.getCalledNames().has('helperfn')).to.be.true;
    });

    it('updates XML interface names when a .xml file changes', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
        { name: 'Button.brs', isDirectory: false },
        { name: 'Button.xml', isDirectory: false },
      ]);
      readFileStub.withArgs(XML_FILE, 'utf-8').returns(XML_WITHOUT_INTERFACE);
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      expect(fresh.getCalledNames().has('mypublicmethod')).to.be.false;

      readFileStub.withArgs(XML_FILE, 'utf-8').returns(XML_WITH_INTERFACE);
      fresh.updateFile(XML_FILE);

      expect(fresh.getCalledNames().has('mypublicmethod')).to.be.true;
    });

    it('ignores non-.brs and non-.xml files', () => {
      const sizeBefore = index.getCalledNames().size;
      index.updateFile(path.join(WORKSPACE, 'package.json'));
      expect(index.getCalledNames().size).to.equal(sizeBefore);
    });

    it('invalidates the lazy union cache', () => {
      const before = index.getCalledNames();
      readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(BRS_WITH_OBSERVE_FIELD);
      index.updateFile(COMPONENT_FILE);
      const after = index.getCalledNames();
      expect(after).to.not.equal(before);
    });
  });

  describe('removeFile()', () => {
    it('removes contributions of a .brs file', () => {
      expect(index.getCalledNames().has('helperfn')).to.be.true;
      index.removeFile(COMPONENT_FILE);
      expect(index.getCalledNames().has('helperfn')).to.be.false;
    });

    it('a name called from another file remains after one file is removed', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
        { name: 'Button.brs', isDirectory: false },
        { name: 'Helper.brs', isDirectory: false },
      ]);
      readFileStub.withArgs(HELPER_FILE, 'utf-8').returns(BRS_WITH_DIRECT_CALL);
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);

      fresh.removeFile(COMPONENT_FILE);
      expect(fresh.getCalledNames().has('helperfn')).to.be.true;
    });

    it('removes XML interface names when a .xml file is removed', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
        { name: 'Button.brs', isDirectory: false },
        { name: 'Button.xml', isDirectory: false },
      ]);
      readFileStub.withArgs(XML_FILE, 'utf-8').returns(XML_WITH_INTERFACE);
      const fresh = new WorkspaceCallIndex();
      fresh.build([WORKSPACE]);
      expect(fresh.getCalledNames().has('mypublicmethod')).to.be.true;

      fresh.removeFile(XML_FILE);
      expect(fresh.getCalledNames().has('mypublicmethod')).to.be.false;
    });

    it('ignores non-.brs and non-.xml files', () => {
      const sizeBefore = index.getCalledNames().size;
      index.removeFile(path.join(WORKSPACE, 'package.json'));
      expect(index.getCalledNames().size).to.equal(sizeBefore);
    });
  });
});

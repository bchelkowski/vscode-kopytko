import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { WorkspaceFunctionIndex } from '../../src/server/utils/workspaceFunctionIndex';
import { clearFileParseCache } from '../../src/server/utils/fileParseCache';

const WORKSPACE = '/workspace';
const SOURCE_FILE = path.join(WORKSPACE, 'app', 'source', 'Helpers.brs');
const COMPONENT_FILE = path.join(WORKSPACE, 'app', 'components', 'Button.brs');

const SOURCE_CONTENT = [
  'function globalHelper(a as String) as String',
  '  return a',
  'end function',
  '',
  'sub globalSub()',
  'end sub',
].join('\n');

const COMPONENT_CONTENT = [
  'function buttonInit() as Void',
  'end function',
].join('\n');

describe('WorkspaceFunctionIndex — source/ directory caching', () => {
  let readdirStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let _existsStub: sinon.SinonStub;
  let index: WorkspaceFunctionIndex;

  beforeEach(() => {
    readdirStub = sinon.stub(fsWrapper, 'readdirTyped');
    readFileStub = sinon.stub(fsWrapper, 'readFileSync');
    _existsStub = sinon.stub(fsWrapper, 'existsSync').returns(false);
    readdirStub.returns([]);

    // Workspace structure: app/source/Helpers.brs + app/components/Button.brs
    readdirStub.withArgs(WORKSPACE).returns([{ name: 'app', isDirectory: true }]);
    readdirStub.withArgs(path.join(WORKSPACE, 'app')).returns([
      { name: 'source', isDirectory: true },
      { name: 'components', isDirectory: true },
    ]);
    readdirStub.withArgs(path.join(WORKSPACE, 'app', 'source')).returns([
      { name: 'Helpers.brs', isDirectory: false },
    ]);
    readdirStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
      { name: 'Button.brs', isDirectory: false },
    ]);
    readFileStub.withArgs(SOURCE_FILE, 'utf-8').returns(SOURCE_CONTENT);
    readFileStub.withArgs(COMPONENT_FILE, 'utf-8').returns(COMPONENT_CONTENT);

    index = new WorkspaceFunctionIndex();
    index.build([WORKSPACE]);
  });

  afterEach(() => {
    sinon.restore();
    clearFileParseCache();
  });

  describe('getSourceDirNames()', () => {
    it('returns function names only from source/ directory files', () => {
      const names = index.getSourceDirNames();
      expect(names.has('globalhelper')).to.be.true;
      expect(names.has('globalsub')).to.be.true;
    });

    it('does not include functions from non-source/ directories', () => {
      const names = index.getSourceDirNames();
      expect(names.has('buttoninit')).to.be.false;
    });

    it('returns an empty set when no source/ files exist', () => {
      readdirStub.withArgs(path.join(WORKSPACE, 'app', 'source')).returns([]);
      const freshIndex = new WorkspaceFunctionIndex();
      freshIndex.build([WORKSPACE]);
      expect(freshIndex.getSourceDirNames().size).to.equal(0);
    });

    it('returns the same Set instance on repeated calls (cache hit)', () => {
      const first = index.getSourceDirNames();
      const second = index.getSourceDirNames();
      expect(first).to.equal(second);
    });
  });

  describe('getSourceDirFunctions()', () => {
    it('returns FunctionDefinition objects from source/ files', () => {
      const fns = index.getSourceDirFunctions();
      const names = fns.map(f => f.nameLower);
      expect(names).to.include('globalhelper');
      expect(names).to.include('globalsub');
    });

    it('does not include functions from components/', () => {
      const fns = index.getSourceDirFunctions();
      const names = fns.map(f => f.nameLower);
      expect(names).to.not.include('buttoninit');
    });

    it('returns the same Array instance on repeated calls (cache hit)', () => {
      const first = index.getSourceDirFunctions();
      const second = index.getSourceDirFunctions();
      expect(first).to.equal(second);
    });
  });

  describe('findSourceDirFunction()', () => {
    it('finds a function by lowercase name', () => {
      const match = index.findSourceDirFunction('globalhelper');
      expect(match).to.not.be.undefined;
      expect(match!.name).to.equal('globalHelper');
    });

    it('does not find functions from non-source/ directories', () => {
      expect(index.findSourceDirFunction('buttoninit')).to.be.undefined;
    });

    it('returns undefined for an unknown name', () => {
      expect(index.findSourceDirFunction('doesnotexist')).to.be.undefined;
    });

    it('returns the same result on repeated calls (map cache)', () => {
      const first = index.findSourceDirFunction('globalhelper');
      const second = index.findSourceDirFunction('globalhelper');
      expect(first).to.equal(second);
    });
  });

  describe('cache invalidation', () => {
    it('clears source-dir cache when a source/ file is updated', () => {
      const before = index.getSourceDirNames();
      expect(before.has('globalhelper')).to.be.true;

      // Simulate an update: source file gains a new function
      const newContent = SOURCE_CONTENT + '\nfunction newSourceFn()\nend function\n';
      readFileStub.withArgs(SOURCE_FILE, 'utf-8').returns(newContent);
      index.updateFile(SOURCE_FILE);

      const after = index.getSourceDirNames();
      // After invalidation the cache is rebuilt, so we should get a NEW Set instance
      expect(after).to.not.equal(before);
    });

    it('does not rebuild source-dir cache when a non-source/ file is updated', () => {
      const before = index.getSourceDirNames();
      index.updateFile(COMPONENT_FILE);
      const after = index.getSourceDirNames();
      // Same object — cache was NOT invalidated
      expect(after).to.equal(before);
    });

    it('clears source-dir cache when a source/ file is removed', () => {
      const before = index.getSourceDirNames();
      index.removeFile(SOURCE_FILE);
      const after = index.getSourceDirNames();
      expect(after).to.not.equal(before);
      expect(after.has('globalhelper')).to.be.false;
    });

    it('does not rebuild source-dir cache when a non-source/ file is removed', () => {
      const before = index.getSourceDirNames();
      index.removeFile(COMPONENT_FILE);
      const after = index.getSourceDirNames();
      expect(after).to.equal(before);
    });

    it('clears all source-dir caches on build()', () => {
      const beforeNames = index.getSourceDirNames();
      const beforeFns = index.getSourceDirFunctions();

      index.build([WORKSPACE]);

      const afterNames = index.getSourceDirNames();
      const afterFns = index.getSourceDirFunctions();

      // After full rebuild, brand new cache objects are returned
      expect(afterNames).to.not.equal(beforeNames);
      expect(afterFns).to.not.equal(beforeFns);
    });
  });

  describe('build() — file filtering', () => {
    it('skips unreadable files without throwing', () => {
      readdirStub.withArgs('/other').returns([{ name: 'Bad.brs', isDirectory: false }]);
      readFileStub.withArgs('/other/Bad.brs', 'utf-8').throws(new Error('EACCES'));

      const other = new WorkspaceFunctionIndex();
      expect(() => other.build(['/other'])).not.to.throw();
      expect(other.getAllFunctions()).to.be.empty;
    });

    it('ignores non-.brs files', () => {
      readdirStub.withArgs('/other').returns([
        { name: 'script.js', isDirectory: false },
        { name: 'App.brs', isDirectory: false },
      ]);
      readFileStub.withArgs('/other/App.brs', 'utf-8').returns('function appFn()\nend function');

      const other = new WorkspaceFunctionIndex();
      other.build(['/other']);
      expect(other.getAllFunctions().map(f => f.nameLower)).to.deep.equal(['appfn']);
    });
  });
});

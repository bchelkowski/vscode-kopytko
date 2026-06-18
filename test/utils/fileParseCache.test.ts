import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import {
  readCachedFileText,
  readCachedDir,
  getCachedFunctionDefs,
  getCachedInnerMethodDefs,
  invalidateFileParseCache,
  clearFileParseCache,
  fileParseCacheSize,
} from '../../src/server/utils/fileParseCache';
import { invalidateAllCaches, invalidateDocumentCaches } from '../../src/server/utils/documentCache';

describe('fileParseCache', () => {
  let readFileStub: sinon.SinonStub;

  beforeEach(() => {
    readFileStub = sinon.stub(fsWrapper, 'readFileSync');
  });

  afterEach(() => {
    sinon.restore();
    clearFileParseCache();
  });

  describe('readCachedFileText', () => {
    it('reads a file once and serves subsequent reads from cache', () => {
      readFileStub.withArgs('/x.brs', 'utf-8').returns('foo');
      expect(readCachedFileText('/x.brs')).to.equal('foo');
      expect(readCachedFileText('/x.brs')).to.equal('foo');
      expect(readFileStub.calledOnce).to.be.true;
    });

    it('returns undefined and does not cache on read error', () => {
      readFileStub.withArgs('/missing.brs', 'utf-8').throws(new Error('ENOENT'));
      expect(readCachedFileText('/missing.brs')).to.be.undefined;
      expect(fileParseCacheSize()).to.equal(0);
      // Nothing was cached, so a second call retries the read.
      readCachedFileText('/missing.brs');
      expect(readFileStub.calledTwice).to.be.true;
    });

    it('keys on normalized path only, independent of the encoding string', () => {
      // Only a 'utf-8' stub is configured. A second access hitting the cache
      // (without a 'utf8' stub) proves the key is the path, not (path, encoding).
      readFileStub.withArgs('/y.brs', 'utf-8').returns('bar');
      expect(readCachedFileText('/y.brs')).to.equal('bar');
      expect(readCachedFileText('/y.brs')).to.equal('bar');
      expect(readFileStub.calledOnce).to.be.true;
    });

    it('applies the platform path-casing convention to the cache key', () => {
      readFileStub.returns('z');
      readCachedFileText('/A/B.brs');
      readCachedFileText('/a/b.brs');
      if (process.platform === 'linux') {
        // Case-sensitive FS → distinct keys → two reads.
        expect(readFileStub.calledTwice).to.be.true;
      } else {
        // Case-insensitive FS → one key → one read.
        expect(readFileStub.calledOnce).to.be.true;
      }
    });
  });

  describe('getCachedFunctionDefs', () => {
    it('parses once and memoizes the result array', () => {
      readFileStub.withArgs('/funcs.brs', 'utf-8').returns(
        'function foo()\nend function\nsub bar()\nend sub'
      );
      const first = getCachedFunctionDefs('/funcs.brs');
      const second = getCachedFunctionDefs('/funcs.brs');
      expect(first).to.not.be.undefined;
      expect(first!.map((d) => d.nameLower)).to.have.members(['foo', 'bar']);
      // Same reference → memoized, and only one disk read.
      expect(second).to.equal(first);
      expect(readFileStub.calledOnce).to.be.true;
    });

    it('returns undefined when the file cannot be read', () => {
      readFileStub.withArgs('/missing.brs', 'utf-8').throws(new Error('ENOENT'));
      expect(getCachedFunctionDefs('/missing.brs')).to.be.undefined;
    });

    it('shares a single read with readCachedFileText', () => {
      readFileStub.withArgs('/shared.brs', 'utf-8').returns('function foo()\nend function');
      readCachedFileText('/shared.brs');
      getCachedFunctionDefs('/shared.brs');
      expect(readFileStub.calledOnce).to.be.true;
    });
  });

  describe('getCachedInnerMethodDefs', () => {
    it('parses inner methods once and memoizes', () => {
      readFileStub.withArgs('/inner.brs', 'utf-8').returns(
        'function build()\n  m.doIt = function()\n  end function\nend function'
      );
      const first = getCachedInnerMethodDefs('/inner.brs');
      const second = getCachedInnerMethodDefs('/inner.brs');
      expect(first).to.not.be.undefined;
      expect(first!.some((d) => d.nameLower === 'doit')).to.be.true;
      expect(second).to.equal(first);
      expect(readFileStub.calledOnce).to.be.true;
    });
  });

  describe('readCachedDir', () => {
    let readdirTypedStub: sinon.SinonStub;

    beforeEach(() => {
      readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped');
    });

    it('lists a directory once and serves repeats from cache', () => {
      readdirTypedStub.withArgs('/some/dir').returns([{ name: 'A.brs', isDirectory: false }]);
      const first = readCachedDir('/some/dir');
      const second = readCachedDir('/some/dir');
      expect(first).to.deep.equal([{ name: 'A.brs', isDirectory: false }]);
      expect(second).to.equal(first);
      expect(readdirTypedStub.calledOnce).to.be.true;
    });

    it('returns undefined when the directory cannot be read', () => {
      readdirTypedStub.withArgs('/missing').throws(new Error('ENOENT'));
      expect(readCachedDir('/missing')).to.be.undefined;
    });

    it('re-lists after clearFileParseCache', () => {
      readdirTypedStub.withArgs('/some/dir').returns([{ name: 'A.brs', isDirectory: false }]);
      readCachedDir('/some/dir');
      clearFileParseCache();
      readCachedDir('/some/dir');
      expect(readdirTypedStub.calledTwice).to.be.true;
    });
  });

  describe('invalidation', () => {
    it('invalidateFileParseCache evicts a single entry', () => {
      readFileStub.withArgs('/a.brs', 'utf-8').returns('a');
      readCachedFileText('/a.brs');
      expect(fileParseCacheSize()).to.equal(1);
      invalidateFileParseCache('/a.brs');
      expect(fileParseCacheSize()).to.equal(0);
      // Next read re-reads from disk.
      readCachedFileText('/a.brs');
      expect(readFileStub.calledTwice).to.be.true;
    });

    it('clearFileParseCache empties the whole cache', () => {
      readFileStub.returns('content');
      readCachedFileText('/a.brs');
      readCachedFileText('/b.brs');
      expect(fileParseCacheSize()).to.equal(2);
      clearFileParseCache();
      expect(fileParseCacheSize()).to.equal(0);
    });
  });

  describe('document-cache invalidation interaction', () => {
    it('invalidateDocumentCaches keeps the file parse cache warm', () => {
      readFileStub.withArgs('/keep.brs', 'utf-8').returns('content');
      readCachedFileText('/keep.brs');
      expect(fileParseCacheSize()).to.equal(1);

      // A document-level invalidation must NOT drop unaffected files — that is
      // what lets the file cache survive a watched-file change to other files.
      invalidateDocumentCaches();
      expect(fileParseCacheSize()).to.equal(1);
      readCachedFileText('/keep.brs');
      expect(readFileStub.calledOnce).to.be.true;
    });

    it('invalidateAllCaches clears the file parse cache', () => {
      readFileStub.withArgs('/drop.brs', 'utf-8').returns('content');
      readCachedFileText('/drop.brs');
      expect(fileParseCacheSize()).to.equal(1);

      invalidateAllCaches();
      expect(fileParseCacheSize()).to.equal(0);
    });
  });
});

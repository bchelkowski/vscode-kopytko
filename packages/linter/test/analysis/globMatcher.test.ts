import { expect } from 'chai';
import { matchesGlob, findMatchingGlob } from '../../src/analysis/globMatcher';

describe('globMatcher', () => {
  describe('matchesGlob', () => {
    it('exact match (no wildcards)', () => {
      expect(matchesGlob('/components/Foo.brs', '/components/Foo.brs')).to.be.true;
      expect(matchesGlob('/components/Bar.brs', '/components/Foo.brs')).to.be.false;
    });

    it('* matches any characters except /', () => {
      expect(matchesGlob('/components/Foo.brs', '/components/*.brs')).to.be.true;
      expect(matchesGlob('/components/Bar.brs', '/components/*.brs')).to.be.true;
      expect(matchesGlob('/components/sub/Foo.brs', '/components/*.brs')).to.be.false;
    });

    it('** matches any characters including /', () => {
      expect(matchesGlob('/components/generated/Foo.brs', '/components/generated/**')).to.be.true;
      expect(matchesGlob('/components/generated/sub/Bar.brs', '/components/generated/**')).to.be.true;
      expect(matchesGlob('/other/Foo.brs', '/components/generated/**')).to.be.false;
    });

    it('** at the start matches any leading path', () => {
      expect(matchesGlob('/a/b/generated/Foo.brs', '**/generated/*.brs')).to.be.true;
      expect(matchesGlob('/generated/Foo.brs', '**/generated/*.brs')).to.be.true;
      expect(matchesGlob('/a/b/other/Foo.brs', '**/generated/*.brs')).to.be.false;
    });

    it('* does not match across directory separators', () => {
      expect(matchesGlob('/a/b/c.brs', '/a/*/c.brs')).to.be.true;
      expect(matchesGlob('/a/b/d/c.brs', '/a/*/c.brs')).to.be.false;
    });

    it('escapes regex special characters in the pattern', () => {
      expect(matchesGlob('/components/Foo.brs', '/components/Foo.brs')).to.be.true;
      expect(matchesGlob('/components/FooxBrs', '/components/Foo.brs')).to.be.false;
    });

    it('combined ** and * in one pattern', () => {
      expect(matchesGlob('/a/b/auto-gen/Foo.brs', '**/auto-gen/*.brs')).to.be.true;
      expect(matchesGlob('/a/b/auto-gen/sub/Foo.brs', '**/auto-gen/*.brs')).to.be.false;
    });
  });

  describe('findMatchingGlob', () => {
    it('returns the first matching pattern', () => {
      const patterns = ['/generated/**', '**/auto/*.brs'];
      expect(findMatchingGlob('/generated/Foo.brs', patterns)).to.equal('/generated/**');
    });

    it('returns undefined when no pattern matches', () => {
      expect(findMatchingGlob('/src/Foo.brs', ['/generated/**'])).to.be.undefined;
    });

    it('returns undefined for empty patterns array', () => {
      expect(findMatchingGlob('/any/path.brs', [])).to.be.undefined;
    });
  });
});

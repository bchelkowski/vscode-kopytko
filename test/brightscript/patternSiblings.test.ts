import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { matchWildcard, applyWildcard, findSiblingFiles } from '../../src/server/brightscript/patternSiblings';

describe('patternSiblings', () => {
  // ── matchWildcard ──────────────────────────────────────────────────────────

  describe('matchWildcard', () => {
    it('matches a filename against a pattern with * at the start', () => {
      expect(matchWildcard('Foo.component.brs', '*.component.brs')).to.equal('Foo');
    });

    it('matches a filename against a pattern with * in the middle', () => {
      expect(matchWildcard('prefix_Bar_suffix.brs', 'prefix_*_suffix.brs')).to.equal('Bar');
    });

    it('returns empty string for an exact match pattern without *', () => {
      expect(matchWildcard('exact.brs', 'exact.brs')).to.equal('');
    });

    it('returns null when the filename does not match the pattern', () => {
      expect(matchWildcard('Foo.view.brs', '*.component.brs')).to.be.null;
    });

    it('returns null when prefix does not match', () => {
      expect(matchWildcard('X_Foo.brs', 'Y_*.brs')).to.be.null;
    });

    it('returns null when suffix does not match', () => {
      expect(matchWildcard('Foo.abc', '*.xyz')).to.be.null;
    });

    it('handles zero-length wildcard value', () => {
      expect(matchWildcard('.component.brs', '*.component.brs')).to.equal('');
    });

    it('handles * at the end of the pattern', () => {
      expect(matchWildcard('prefix_something', 'prefix_*')).to.equal('something');
    });
  });

  // ── applyWildcard ──────────────────────────────────────────────────────────

  describe('applyWildcard', () => {
    it('replaces * with the wildcard value', () => {
      expect(applyWildcard('*.template.brs', 'Foo')).to.equal('Foo.template.brs');
    });

    it('replaces only the first * if multiple exist', () => {
      expect(applyWildcard('*_*', 'value')).to.equal('value_*');
    });

    it('handles pattern with no *', () => {
      expect(applyWildcard('exact.brs', 'anything')).to.equal('exact.brs');
    });
  });

  // ── findSiblingFiles ───────────────────────────────────────────────────────

  describe('findSiblingFiles', () => {
    let existsStub: sinon.SinonStub;

    beforeEach(() => {
      existsStub = sinon.stub(fsWrapper, 'existsSync');
      existsStub.returns(false);
    });

    afterEach(() => sinon.restore());

    it('returns empty array when siblingPatterns is empty', () => {
      expect(findSiblingFiles('/dir/Foo.component.brs', [])).to.deep.equal([]);
    });

    it('returns sibling path when pattern matches and sibling exists', () => {
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      const result = findSiblingFiles('/dir/Foo.component.brs', [['*.component.brs', '*.template.brs']]);
      expect(result).to.deep.equal(['/dir/Foo.template.brs']);
    });

    it('returns empty array when sibling file does not exist on disk', () => {
      const result = findSiblingFiles('/dir/Foo.component.brs', [['*.component.brs', '*.template.brs']]);
      expect(result).to.deep.equal([]);
    });

    it('returns empty array when filename does not match any group', () => {
      existsStub.returns(true);
      const result = findSiblingFiles('/dir/Foo.other.brs', [['*.component.brs', '*.template.brs']]);
      expect(result).to.deep.equal([]);
    });

    it('uses first matching group only', () => {
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      existsStub.withArgs('/dir/Foo.view.brs').returns(true);
      const patterns = [
        ['*.component.brs', '*.template.brs'],
        ['*.component.brs', '*.view.brs'],
      ];
      const result = findSiblingFiles('/dir/Foo.component.brs', patterns);
      expect(result).to.deep.equal(['/dir/Foo.template.brs']);
    });

    it('returns multiple siblings from same group', () => {
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      existsStub.withArgs('/dir/Foo.style.brs').returns(true);
      const patterns = [['*.component.brs', '*.template.brs', '*.style.brs']];
      const result = findSiblingFiles('/dir/Foo.component.brs', patterns);
      expect(result).to.deep.equal(['/dir/Foo.template.brs', '/dir/Foo.style.brs']);
    });

    it('works from the sibling side (template looking for component)', () => {
      existsStub.withArgs('/dir/Foo.component.brs').returns(true);
      const result = findSiblingFiles('/dir/Foo.template.brs', [['*.component.brs', '*.template.brs']]);
      expect(result).to.deep.equal(['/dir/Foo.component.brs']);
    });
  });
});

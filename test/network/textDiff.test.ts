import { expect } from 'chai';
import { diffLines } from '../../src/client/network/textDiff';

describe('network/textDiff', () => {
  it('marks equal lines when both sides are identical', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc');
    expect(rows.map((r) => r.op)).to.deep.equal(['equal', 'equal', 'equal']);
  });

  it('detects a single changed line in the middle', () => {
    const rows = diffLines('a\nb\nc', 'a\nB\nc');
    expect(rows).to.deep.equal([
      { op: 'equal', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'B' },
      { op: 'equal', text: 'c' },
    ]);
  });

  it('handles pure additions and deletions', () => {
    expect(diffLines('', 'x\ny').map((r) => r.op)).to.deep.equal(['add', 'add']);
    expect(diffLines('x\ny', '').map((r) => r.op)).to.deep.equal(['del', 'del']);
  });

  it('trims a common prefix and suffix around an inserted block', () => {
    const rows = diffLines('head\ntail', 'head\nnew1\nnew2\ntail');
    expect(rows).to.deep.equal([
      { op: 'equal', text: 'head' },
      { op: 'add', text: 'new1' },
      { op: 'add', text: 'new2' },
      { op: 'equal', text: 'tail' },
    ]);
  });

  it('keeps shared lines via the LCS when lines move', () => {
    const rows = diffLines('a\nb\nc\nd', 'a\nc\nd\ne');
    // 'b' deleted, 'e' added, a/c/d preserved as equal.
    const equal = rows.filter((r) => r.op === 'equal').map((r) => r.text);
    expect(equal).to.deep.equal(['a', 'c', 'd']);
    expect(rows.find((r) => r.op === 'del')?.text).to.equal('b');
    expect(rows.find((r) => r.op === 'add')?.text).to.equal('e');
  });
});

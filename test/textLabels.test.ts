import { expect } from 'chai';
import { normalizeLabels } from '../src/client/textLabels';

describe('normalizeLabels', () => {
  it('returns an empty array for undefined', () => {
    expect(normalizeLabels(undefined)).to.deep.equal([]);
  });

  it('trims whitespace around each label', () => {
    expect(normalizeLabels([' Bug ', '  Feature'])).to.deep.equal(['Bug', 'Feature']);
  });

  it('drops empty/whitespace-only entries', () => {
    expect(normalizeLabels(['Bug', '', '   '])).to.deep.equal(['Bug']);
  });

  it('de-dupes case-insensitively, keeping first-seen casing', () => {
    expect(normalizeLabels(['Bug', 'bug', 'BUG', 'Feature'])).to.deep.equal(['Bug', 'Feature']);
  });

  it('returns an empty array for an empty input array', () => {
    expect(normalizeLabels([])).to.deep.equal([]);
  });
});

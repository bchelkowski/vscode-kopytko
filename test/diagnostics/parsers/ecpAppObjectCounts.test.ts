import { expect } from 'chai';
import { parseEcpAppObjectCounts } from '../../../src/client/diagnostics/parsers/ecpAppObjectCounts';

// Trimmed from a real /query/app-object-counts/dev response (Roku Ultra, firmware 15.2.4).
const FIXTURE = `<app-object-counts>
<timestamp>1782995684112</timestamp>
<channel-id>dev</channel-id>
<channel-title>DAZN</channel-title>
<channel-version>3.30.5</channel-version>
<objects>
<objects-count>12589</objects-count>
<objects-num-bytes-physical>1498532</objects-num-bytes-physical>
<objects-num-bytes-logical>1413406</objects-num-bytes-logical>
<objects>
<object>
<type>roArray</type>
<count>1210</count>
<num-bytes-physical>118644</num-bytes-physical>
<num-bytes-logical>84208</num-bytes-logical>
</object>
<object>
<type>roString</type>
<count>6746</count>
<num-bytes-physical>409032</num-bytes-physical>
<num-bytes-logical>372970</num-bytes-logical>
</object>
<object>
<type>roSGNode</type>
<subtype>Font</subtype>
<count>157</count>
<num-bytes-physical>6940</num-bytes-physical>
<num-bytes-logical>6940</num-bytes-logical>
</object>
<object>
<type>roSGNode</type>
<subtype>Node</subtype>
<count>110</count>
<num-bytes-physical>4960</num-bytes-physical>
<num-bytes-logical>4960</num-bytes-logical>
</object>
</objects>
</objects>
<status>OK</status>
</app-object-counts>`;

describe('parseEcpAppObjectCounts', () => {
  it('reads the totals', () => {
    const s = parseEcpAppObjectCounts(FIXTURE);
    expect(s).to.not.be.null;
    expect(s!.totalCount).to.equal(12589);
    expect(s!.totalPhysicalBytes).to.equal(1498532);
    expect(s!.totalLogicalBytes).to.equal(1413406);
  });

  it('parses a plain-type entry without a subtype', () => {
    const s = parseEcpAppObjectCounts(FIXTURE);
    const arr = s!.types.find((t) => t.type === 'roArray');
    expect(arr).to.deep.equal({
      type: 'roArray', count: 1210, physicalBytes: 118644, logicalBytes: 84208,
    });
    expect(arr).to.not.have.property('subtype');
  });

  it('parses roSGNode entries with one row per subtype', () => {
    const s = parseEcpAppObjectCounts(FIXTURE);
    const sgNodes = s!.types.filter((t) => t.type === 'roSGNode');
    expect(sgNodes).to.have.length(2);
    expect(sgNodes[0]).to.deep.equal({
      type: 'roSGNode', subtype: 'Font', count: 157, physicalBytes: 6940, logicalBytes: 6940,
    });
    expect(sgNodes[1].subtype).to.equal('Node');
  });

  it('returns null when status is FAILED (e.g. channel backgrounded)', () => {
    const bad =
      '<app-object-counts><status>FAILED</status>' +
      '<error>Channel not running: active UI</error></app-object-counts>';
    expect(parseEcpAppObjectCounts(bad)).to.be.null;
  });

  it('returns null on malformed input', () => {
    expect(parseEcpAppObjectCounts('not xml at all')).to.be.null;
  });

  it('derives the total from entries when objects-count is missing', () => {
    const noTotal = FIXTURE.replace(/<objects-count>\d+<\/objects-count>/, '');
    const s = parseEcpAppObjectCounts(noTotal);
    expect(s!.totalCount).to.equal(1210 + 6746 + 157 + 110);
  });
});

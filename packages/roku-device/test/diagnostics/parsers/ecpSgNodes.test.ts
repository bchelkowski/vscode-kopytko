import { expect } from 'chai';
import { parseEcpSgNodes } from '../../../src/diagnostics/parsers/ecpSgNodes';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8" ?>
<sgnodes>
<timestamp>1782720357639</timestamp>
<channel-id>dev</channel-id>
<channel-title>DAZN</channel-title>
<All_Nodes node-count="5">
<MainScene children="1" extends="Scene" _sn="1">
<AppView children="2" extends="Group" name="app" _sn="2">
<Rectangle name="bg" _sn="3"/>
<Label name="title" _sn="4"/>
</AppView>
</MainScene>
<Default _sn="5"/>
</All_Nodes>
<status>OK</status>
</sgnodes>`;

describe('parseEcpSgNodes', () => {
  it('reads total count from node-count attribute', () => {
    const s = parseEcpSgNodes(FIXTURE);
    expect(s).to.not.be.null;
    expect(s!.totalCount).to.equal(5);
  });

  it('counts node types from element names', () => {
    const s = parseEcpSgNodes(FIXTURE);
    const types = Object.fromEntries(s!.types.map((t) => [t.type, t.count]));
    expect(types['MainScene']).to.equal(1);
    expect(types['AppView']).to.equal(1);
    expect(types['Rectangle']).to.equal(1);
    expect(types['Label']).to.equal(1);
    expect(types['Default']).to.equal(1);
  });

  it('returns null when status is not OK', () => {
    const bad = FIXTURE.replace('<status>OK</status>', '<status>ERROR</status>');
    expect(parseEcpSgNodes(bad)).to.be.null;
  });

  it('returns null when no node-count attribute', () => {
    const bad = FIXTURE.replace('node-count="5"', '');
    expect(parseEcpSgNodes(bad)).to.be.null;
  });

  it('staticBytes is always 0 (not available from ECP)', () => {
    const s = parseEcpSgNodes(FIXTURE);
    expect(s!.totalStaticBytes).to.equal(0);
    expect(s!.types.every((t) => t.staticBytes === 0)).to.be.true;
  });
});

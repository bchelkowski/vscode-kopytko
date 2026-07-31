import { expect } from 'chai';
import { parseEcpChanperf } from '../../../src/diagnostics/parsers/ecpChanperf';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8" ?>
<chanperf>
<timestamp>1782720282341</timestamp>
<plugin>
<cpu-percent>
<duration-seconds>1.000000</duration-seconds>
<user>1.5</user>
<sys>0.5</sys>
</cpu-percent>
<memory>
<used>42905600</used>
<res>42905600</res>
<anon>21086208</anon>
<swap>0</swap>
<file>21618688</file>
<shared>200704</shared>
<limit>859832320</limit>
</memory>
<id>dev</id>
</plugin>
<proc-stat>dev 1234 (channel) S 1 1234 1234 0 -1 4194560 5678 0 0 0 12 3 0 0 20 0 4 0 98765 123456789 4567 18446744073709551615</proc-stat>
<status>OK</status>
</chanperf>`;

describe('parseEcpChanperf', () => {
  it('parses memory converting bytes to KiB', () => {
    const s = parseEcpChanperf(FIXTURE);
    expect(s).to.not.be.null;
    expect(s!.memKiB).to.equal(Math.round(42905600 / 1024));   // 41900
    expect(s!.anonKiB).to.equal(Math.round(21086208 / 1024));  // 20592
    expect(s!.fileKiB).to.equal(Math.round(21618688 / 1024));  // 21112
    expect(s!.sharedKiB).to.equal(Math.round(200704 / 1024));  // 196
    expect(s!.swapKiB).to.equal(0);
    expect(s!.limitKiB).to.equal(Math.round(859832320 / 1024)); // 839680
  });

  it('leaves limitKiB undefined when the device omits <limit>', () => {
    const noLimit = FIXTURE.replace('<limit>859832320</limit>', '');
    const s = parseEcpChanperf(noLimit);
    expect(s!.limitKiB).to.be.undefined;
  });

  it('parses the Roku OS 15.2+ <proc-stat> field verbatim', () => {
    const s = parseEcpChanperf(FIXTURE);
    expect(s!.procStat).to.equal(
      'dev 1234 (channel) S 1 1234 1234 0 -1 4194560 5678 0 0 0 12 3 0 0 20 0 4 0 98765 123456789 4567 18446744073709551615',
    );
  });

  it('leaves procStat undefined on pre-15.2 firmware that omits <proc-stat>', () => {
    const noProcStat = FIXTURE.replace(/<proc-stat>.*<\/proc-stat>\n/, '');
    const s = parseEcpChanperf(noProcStat);
    expect(s!.procStat).to.be.undefined;
  });

  it('parses CPU float percentages', () => {
    const s = parseEcpChanperf(FIXTURE);
    expect(s!.cpuUser).to.equal(2);   // Math.round(1.5)
    expect(s!.cpuSys).to.equal(1);    // Math.round(0.5)
    expect(s!.cpuPct).to.equal(2);    // Math.round(1.5 + 0.5) = 2
  });

  it('returns null when status is not OK', () => {
    const bad = FIXTURE.replace('<status>OK</status>', '<status>ERROR</status>');
    expect(parseEcpChanperf(bad)).to.be.null;
  });

  it('returns null for empty/unrelated string', () => {
    expect(parseEcpChanperf('')).to.be.null;
    expect(parseEcpChanperf('<foo></foo>')).to.be.null;
  });
});

import { expect } from 'chai';
import { parseFwBeaconLine } from '../../../src/client/diagnostics/parsers/fwBeacon';

describe('parseFwBeaconLine', () => {
  it('parses an AppLaunchInitiate beacon line, deriving deviceWall from the log prefix', () => {
    const line = '06-26 07:24:26.305 app  [beacon.signal] |AppLaunchInitiate ---------> TimeBase(0 ms)';
    const now = new Date(2026, 5, 30).getTime(); // June 30 2026 — same year as the log line
    const beacon = parseFwBeaconLine(line, now);
    expect(beacon).to.not.be.null;
    expect(beacon!.name).to.equal('AppLaunchInitiate');
    expect(beacon!.timeBaseMs).to.equal(0);
    expect(beacon!.deviceWall).to.equal(new Date(2026, 5, 26, 7, 24, 26, 305).getTime());
  });

  it('parses an AppResumeComplete beacon line with a non-zero TimeBase', () => {
    const line = '06-26 07:24:27.118 sdkl [beacon.signal] |AppResumeComplete ---------> TimeBase(813 ms)';
    const now = new Date(2026, 5, 30).getTime();
    const beacon = parseFwBeaconLine(line, now);
    expect(beacon!.name).to.equal('AppResumeComplete');
    expect(beacon!.timeBaseMs).to.equal(813);
    expect(beacon!.deviceWall).to.equal(new Date(2026, 5, 26, 7, 24, 27, 118).getTime());
  });

  it('parses a "Complete" beacon reported as Duration(...) instead of TimeBase(...)', () => {
    // Captured live: *Initiate beacons report TimeBase(N ms), *Complete beacons
    // report Duration(N ms) — both are just a labeled ms count.
    const line = '07-01 11:27:13.476 sdkl [beacon.signal] |AppLaunchChainComplete ----> Duration(333 ms)';
    const now = new Date(2026, 6, 1).getTime();
    const beacon = parseFwBeaconLine(line, now);
    expect(beacon).to.not.be.null;
    expect(beacon!.name).to.equal('AppLaunchChainComplete');
    expect(beacon!.timeBaseMs).to.equal(333);
    expect(beacon!.deviceWall).to.equal(new Date(2026, 6, 1, 11, 27, 13, 476).getTime());
  });

  it('parses a VODStartInitiate/VODStartComplete pair (TimeBase then Duration)', () => {
    const initiate = '07-01 11:27:14.035 sdkl [beacon.signal] |VODStartInitiate ----------> TimeBase(376 ms)';
    const complete = '07-01 11:27:14.035 sdkl [beacon.signal] |VODStartComplete ----------> Duration(201 ms)';
    expect(parseFwBeaconLine(initiate)).to.include({ name: 'VODStartInitiate', timeBaseMs: 376 });
    expect(parseFwBeaconLine(complete)).to.include({ name: 'VODStartComplete', timeBaseMs: 201 });
  });

  it('derives the year from `now`, not from the current real clock', () => {
    const line = '01-15 12:00:00.000 app  [beacon.signal] |AppLaunchComplete ---------> TimeBase(500 ms)';
    const now = new Date(2030, 0, 20).getTime(); // Jan 20 2030
    const beacon = parseFwBeaconLine(line, now);
    expect(beacon!.deviceWall).to.equal(new Date(2030, 0, 15, 12, 0, 0, 0).getTime());
  });

  it('returns null for a line missing the leading device timestamp', () => {
    expect(parseFwBeaconLine('[beacon.signal] |AppLaunchInitiate ---------> TimeBase(0 ms)')).to.be.null;
  });

  it('returns null for ordinary print output', () => {
    expect(parseFwBeaconLine('[translate] Missing translation for \'railMenu_movies\' key')).to.be.null;
  });

  it('returns null for BRIGHTSCRIPT warning lines', () => {
    const line = 'BRIGHTSCRIPT: WARNING: roSGNode.signalBeacon: initiate before signaling AppResumeComplete: pkg:/components/Foo.brs(40)';
    expect(parseFwBeaconLine(line)).to.be.null;
  });

  it('returns null for an empty line', () => {
    expect(parseFwBeaconLine('')).to.be.null;
  });
});

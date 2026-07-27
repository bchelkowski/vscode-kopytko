import { expect } from 'chai';
import { classifyLine, type Severity } from '../../src/client/console/lineClassifier';

/** Reassemble the spans; they must always round-trip to the original line. */
function joined(line: string): string {
  return classifyLine(line).spans.map((s) => s.text).join('');
}

function kinds(line: string): string[] {
  return classifyLine(line).spans.map((s) => s.kind);
}

describe('lineClassifier', () => {
  describe('severity', () => {
    const cases: [string, Severity][] = [
      // Real lines captured from a device — see findings/roku-device-api.md.
      ['BRIGHTSCRIPT: ERROR: Type Mismatch: pkg:/components/Foo.brs(40)', 'error'],
      ['*** ERROR compiling /pkg:/source/main.brs', 'error'],
      ['Syntax Error. (compile error &h02) in pkg:/source/main.brs(12)', 'error'],
      ['Backtrace:', 'error'],
      ['BRIGHTSCRIPT: WARNING: roSGNode.signalBeacon: initiate before signaling AppResumeComplete: pkg:/components/Foo.brs(40)', 'warning'],
      ['06-26 07:24:26.305 app  [beacon.signal] |AppLaunchInitiate ---------> TimeBase(0 ms)', 'beacon'],
      ['06-26 07:24:26.429 sdkl [beacon.signal] |AppResumeInitiate ---------> TimeBase(0 ms)', 'beacon'],
      // Bracketed level tags, captured live from port 8085.
      ['  [Failed.NetworkRequestHandler] |OT Post API Failure = saveandlogconsent', 'error'],
      ['  [Warning.MultiProfile] |Multi Profile Consent is disabled.', 'warning'],
      ['  [Info.OneTrust] |OT config file is read', 'plain'],
      ['  [Success.NetworkRequestHandler] |banner Api Success', 'plain'],
      ['BrightScript Debugger> ', 'debugger'],
      ['Current Function:', 'debugger'],
      ['#0  Function foo() As Void', 'debugger'],
      ['<sg-nodes>', 'xml'],
      ['<?xml version="1.0" encoding="UTF-8" ?>', 'xml'],
      ['channel: mem=53920KiB{anon=31968,file=21756},%cpu=0{user=0,sys=0}', 'plain'],
      ['[translate] Missing translation for key', 'plain'],
      ['-------------------- Roku Analytics Thread Start --------------------', 'plain'],
      ['', 'plain'],
    ];

    for (const [line, severity] of cases) {
      it(`classifies ${JSON.stringify(line.slice(0, 48))} as ${severity}`, () => {
        expect(classifyLine(line).severity).to.equal(severity);
      });
    }

    it('prefers warning over beacon when a warning mentions a beacon name', () => {
      // This exact line is why error/warning are checked before beacons.
      const line = 'BRIGHTSCRIPT: WARNING: signalBeacon: initiate before AppResumeComplete';
      expect(classifyLine(line).severity).to.equal('warning');
    });

    it('does not treat a stray angle bracket in app output as XML', () => {
      expect(classifyLine('value is <unset> for now').severity).to.equal('plain');
    });

    it('has no rendezvous class — logrendezvous emits nothing on either port', () => {
      // Verified live (Roku Ultra, firmware 15.2.4.3442): `logrendezvous on`
      // produced no output on 8085 or 8080. Rendezvous arrives over ECP and
      // belongs to the Diagnostics panel.
      const severities = new Set(
        ['RENDEZVOUS[42] at pkg:/a.brs(1) 18ms', '[sg.rendezvous] foo']
          .map((line) => classifyLine(line).severity),
      );
      expect([...severities]).to.not.include('rendezvous');
    });
  });

  describe('spans', () => {
    it('round-trips every line back to the original text', () => {
      const lines = [
        '06-26 07:24:26.305 app  [beacon.signal] |AppLaunchInitiate ---> TimeBase(0 ms)',
        'BRIGHTSCRIPT: ERROR: Type Mismatch: pkg:/components/Foo.brs(40)',
        'channel: mem=53920KiB,%cpu=0',
        '<node><type>Font</type></node>',
        '> ',
        '',
        'plain text with no tokens at all',
      ];
      for (const line of lines) expect(joined(line), line).to.equal(line);
    });

    it('splits the device log prefix into timestamp and thread spans', () => {
      const spans = classifyLine('06-26 07:24:26.305 app  hello').spans;
      expect(spans[0]).to.deep.equal({ kind: 'timestamp', text: '06-26 07:24:26.305' });
      expect(spans[1]).to.deep.equal({ kind: 'text', text: ' ' });
      expect(spans[2]).to.deep.equal({ kind: 'thread', text: 'app' });
    });

    it('marks source references and metrics', () => {
      expect(kinds('at pkg:/components/Foo.brs(40)')).to.include('source');
      expect(kinds('mem=53920KiB and 12.5ms and 0%')).to.include('metric');
    });

    it('marks the device prompt', () => {
      expect(classifyLine('> ').spans[0].kind).to.equal('prompt');
      expect(classifyLine('BrightScript Debugger> bt').spans[0].kind).to.equal('prompt');
    });

    it('marks tags only on XML lines', () => {
      expect(kinds('<node><type>Font</type></node>')).to.include('tag');
      expect(kinds('a < b and c > d')).to.not.include('tag');
    });

    it('emits no spans for an empty line', () => {
      expect(classifyLine('').spans).to.be.empty;
    });

    it('never emits overlapping or out-of-order spans', () => {
      const line = '06-26 07:24:26.305 app  ERROR at pkg:/components/Foo.brs(40) took 18ms';
      const spans = classifyLine(line).spans;
      expect(spans.map((s) => s.text).join('')).to.equal(line);
      expect(spans.every((s) => s.text.length > 0)).to.be.true;
    });
  });

  describe('sourceRef', () => {
    it('extracts a pkg:/ reference with its line number', () => {
      expect(classifyLine('ERROR at pkg:/components/Foo.brs(40)').sourceRef)
        .to.deep.equal({ pkgPath: 'pkg:/components/Foo.brs', line: 40 });
    });

    it('extracts a bare filename reference', () => {
      expect(classifyLine('at Foo.brs(12)').sourceRef)
        .to.deep.equal({ pkgPath: 'Foo.brs', line: 12 });
    });

    it('handles .xml component references', () => {
      expect(classifyLine('pkg:/components/Foo.xml(7)').sourceRef?.pkgPath)
        .to.equal('pkg:/components/Foo.xml');
    });

    it('returns the first reference when a line has several', () => {
      const line = 'pkg:/a/One.brs(1) called from pkg:/b/Two.brs(2)';
      expect(classifyLine(line).sourceRef?.pkgPath).to.equal('pkg:/a/One.brs');
    });

    it('is undefined when there is no reference', () => {
      expect(classifyLine('channel: mem=53920KiB').sourceRef).to.be.undefined;
      // A parenthesised number that is not a file reference must not match.
      expect(classifyLine('TimeBase(0 ms)').sourceRef).to.be.undefined;
    });

    it('rejects a zero line number', () => {
      expect(classifyLine('pkg:/a/One.brs(0)').sourceRef).to.be.undefined;
    });
  });

  it('is stateless across calls despite module-level /g patterns', () => {
    const line = 'ERROR at pkg:/components/Foo.brs(40)';
    const first = classifyLine(line);
    const second = classifyLine(line);
    expect(second).to.deep.equal(first);
  });
});

import { expect } from 'chai';
import * as sinon from 'sinon';
import { ChanperfCollector } from '../../src/client/diagnostics/collectors/chanperfCollector';
import { NodeCountsCollector } from '../../src/client/diagnostics/collectors/nodeCountsCollector';
import { RendezvousCollector } from '../../src/client/diagnostics/collectors/rendezvousCollector';
import type { DiagnosticSample } from '../../src/client/diagnostics/session/eventModel';

const CHANPERF =
  'channel: mem=52492KiB{anon=31124,file=21172,shared=196,swap=0},%cpu=12{user=9,sys=3}';

const SGNODES =
  '<sg-nodes><nodes-count>3</nodes-count><nodes-num-bytes-static>840</nodes-num-bytes-static>' +
  '<nodes><node><type>EventTileModel</type><count>3</count><num-bytes-static>840</num-bytes-static></node></nodes></sg-nodes>';

describe('diagnostics collectors', () => {
  let clock: sinon.SinonFakeTimers;
  beforeEach(() => { clock = sinon.useFakeTimers(); });
  afterEach(() => { clock.restore(); sinon.restore(); });

  describe('ChanperfCollector', () => {
    it('emits a parsed mem-cpu sample with type and wall stamp', async () => {
      const console = { send: sinon.stub().resolves(CHANPERF) };
      const collector = new ChanperfCollector(console as any, 1000);
      const samples: DiagnosticSample[] = [];
      collector.on('sample', (s) => samples.push(s));

      collector.start();
      await clock.tickAsync(1);

      expect(samples).to.have.length(1);
      const s = samples[0] as any;
      expect(s.type).to.equal('mem-cpu');
      expect(s.memKiB).to.equal(52492);
      expect(s.cpuPct).to.equal(12);
      expect(s.wall).to.be.a('number');
      collector.stop();
    });

    it('polls again on the interval', async () => {
      const console = { send: sinon.stub().resolves(CHANPERF) };
      const collector = new ChanperfCollector(console as any, 1000);
      let count = 0;
      collector.on('sample', () => { count++; });

      collector.start();
      await clock.tickAsync(1);     // immediate
      await clock.tickAsync(1000);  // +1 interval
      expect(count).to.equal(2);
      collector.stop();
    });

    it('emits nothing and does not throw when the transport rejects', async () => {
      const console = { send: sinon.stub().rejects(new Error('not connected')) };
      const collector = new ChanperfCollector(console as any, 1000);
      let count = 0;
      collector.on('sample', () => { count++; });

      collector.start();
      await clock.tickAsync(1);
      expect(count).to.equal(0);
      collector.stop();
    });

    it('stops polling after stop()', async () => {
      const console = { send: sinon.stub().resolves(CHANPERF) };
      const collector = new ChanperfCollector(console as any, 1000);
      collector.start();
      await clock.tickAsync(1);
      collector.stop();
      const calls = console.send.callCount;
      await clock.tickAsync(5000);
      expect(console.send.callCount).to.equal(calls);
    });
  });

  describe('NodeCountsCollector', () => {
    it('emits a node-counts sample', async () => {
      const console = { send: sinon.stub().resolves(SGNODES) };
      const collector = new NodeCountsCollector(console as any, 2000);
      const samples: any[] = [];
      collector.on('sample', (s) => samples.push(s));

      collector.start();
      await clock.tickAsync(1);

      expect(samples).to.have.length(1);
      expect(samples[0].type).to.equal('node-counts');
      expect(samples[0].totalCount).to.equal(3);
      expect(samples[0].types[0]).to.deep.equal({
        type: 'EventTileModel', count: 3, staticBytes: 840,
      });
      collector.stop();
    });
  });

  describe('RendezvousCollector', () => {
    function makeEcp() {
      return {
        enableRendezvousTracking: sinon.stub().resolves(true),
        disableRendezvousTracking: sinon.stub().resolves(true),
        queryRendezvousEvents: sinon.stub().resolves({ events: [], dropCount: 0 }),
      };
    }

    it('enables tracking on start and emits rendezvous samples', async () => {
      const ecp = makeEcp();
      ecp.queryRendezvousEvents.resolves({
        events: [{ id: '7', startTimeMs: 100, endTimeMs: 118, line: 42, file: 'pkg:/Foo.brs' }],
        dropCount: 0,
      });
      const collector = new RendezvousCollector(ecp as any, { ip: '1.2.3.4', port: 8060 }, 1000);
      const samples: any[] = [];
      collector.on('sample', (s) => samples.push(s));

      collector.start();
      await clock.tickAsync(1000);

      expect(ecp.enableRendezvousTracking.calledWith('1.2.3.4', 8060)).to.be.true;
      expect(samples.length).to.be.greaterThan(0);
      expect(samples[0]).to.include({
        type: 'rendezvous', rid: '7', durationMs: 18, line: 42, file: 'pkg:/Foo.brs',
      });
      collector.stop();
    });

    it('disables tracking on stop', async () => {
      const ecp = makeEcp();
      const collector = new RendezvousCollector(ecp as any, { ip: '1.2.3.4', port: 8060 }, 1000);
      collector.start();
      await clock.tickAsync(1);
      collector.stop();
      expect(ecp.disableRendezvousTracking.calledWith('1.2.3.4', 8060)).to.be.true;
    });

    it('accumulates device drop counts', async () => {
      const ecp = makeEcp();
      ecp.queryRendezvousEvents.resolves({ events: [], dropCount: 5 });
      const collector = new RendezvousCollector(ecp as any, { ip: '1.2.3.4', port: 8060 }, 1000);
      collector.start();
      await clock.tickAsync(2000);
      expect(collector.totalDropCount).to.be.greaterThan(0);
      collector.stop();
    });
  });
});

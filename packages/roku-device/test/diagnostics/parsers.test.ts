import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
  stripConsoleResponse,
  isUsageResponse,
  parseChanperf,
  parseSgNodesCounts,
  parseFree,
  parseR2d2Bitmaps,
} from '../../src/diagnostics/parsers';

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf-8');

describe('diagnostics parsers', () => {
  // ── consoleResponse ──────────────────────────────────────────────────────────

  describe('stripConsoleResponse', () => {
    it('removes the banner, leading prompt and trailing prompt', () => {
      const raw = 'X02800C5FKLV (Roku Ultra - 15.2.4.3442)\r\n>channel: mem=1KiB\r\n>';
      expect(stripConsoleResponse(raw)).to.equal('channel: mem=1KiB');
    });

    it('keeps inner > characters from XML content', () => {
      const raw = '><sg-nodes>\n<nodes-count>3</nodes-count>\n</sg-nodes>\n>';
      expect(stripConsoleResponse(raw)).to.equal('<sg-nodes>\n<nodes-count>3</nodes-count>\n</sg-nodes>');
    });

    it('is a no-op for already-clean payloads', () => {
      expect(stripConsoleResponse('channel: mem=1KiB')).to.equal('channel: mem=1KiB');
    });

    it('detects Usage: hints', () => {
      expect(isUsageResponse('Usage: sgnodes all | roots | counts')).to.be.true;
      expect(isUsageResponse('<sg-nodes>')).to.be.false;
    });
  });

  // ── chanperf ─────────────────────────────────────────────────────────────────

  describe('parseChanperf', () => {
    it('parses the real device fixture', () => {
      const sample = parseChanperf(read('chanperf.raw.txt'));
      expect(sample).to.deep.equal({
        memKiB: 52492,
        anonKiB: 31124,
        fileKiB: 21172,
        sharedKiB: 196,
        swapKiB: 0,
        cpuPct: 0,
        cpuUser: 0,
        cpuSys: 0,
      });
    });

    it('parses a non-zero CPU line', () => {
      const sample = parseChanperf(
        'channel: mem=80000KiB{anon=50000,file=25000,shared=5000,swap=0},%cpu=37{user=30,sys=7}',
      );
      expect(sample?.cpuPct).to.equal(37);
      expect(sample?.cpuUser).to.equal(30);
      expect(sample?.cpuSys).to.equal(7);
      expect(sample?.memKiB).to.equal(80000);
    });

    it('returns null for unrelated output', () => {
      expect(parseChanperf('Usage: chanperf')).to.equal(null);
    });
  });

  // ── sgnodes counts ───────────────────────────────────────────────────────────

  describe('parseSgNodesCounts', () => {
    it('parses totals and per-type counts from the real fixture', () => {
      const result = parseSgNodesCounts(read('sgnodes-counts.raw.xml'));
      expect(result).to.not.equal(null);
      expect(result!.totalCount).to.equal(311);
      expect(result!.totalStaticBytes).to.equal(179272);
      expect(result!.types.length).to.equal(45);
    });

    it('surfaces custom project node types', () => {
      const result = parseSgNodesCounts(read('sgnodes-counts.raw.xml'))!;
      const byType = new Map(result.types.map((t) => [t.type, t]));

      expect(byType.get('BrowsePageNavigationModel')).to.deep.equal({
        type: 'BrowsePageNavigationModel',
        count: 35,
        staticBytes: 9800,
      });
      expect(byType.get('EventTileModel')!.count).to.equal(54);
      expect(byType.get('VodEventModel')!.count).to.equal(44);
    });

    it('returns null for a Usage hint', () => {
      expect(parseSgNodesCounts('Usage: sgnodes all | roots | counts | <node-id>')).to.equal(null);
    });
  });

  // ── free ─────────────────────────────────────────────────────────────────────

  describe('parseFree', () => {
    it('parses Mem and Swap rows from the real fixture', () => {
      const result = parseFree(read('free.raw.txt'));
      expect(result).to.deep.equal({
        total: 1504692,
        used: 424676,
        free: 689772,
        shared: 12216,
        buffCache: 390244,
        available: 1031464,
        swapTotal: 370028,
        swapUsed: 7424,
        swapFree: 362604,
      });
    });

    it('returns null when no Mem line is present', () => {
      expect(parseFree('nothing here')).to.equal(null);
    });
  });

  // ── r2d2_bitmaps ─────────────────────────────────────────────────────────────

  describe('parseR2d2Bitmaps', () => {
    it('parses bitmap rows and the GPU memory summary from the real fixture', () => {
      const result = parseR2d2Bitmaps(read('r2d2-bitmaps.raw.txt'));
      expect(result).to.not.equal(null);
      expect(result!.count).to.equal(17);
      expect(result!.usedBytes).to.equal(25874432);
      expect(result!.maxBytes).to.equal(240000000);
      expect(result!.availableBytes).to.equal(214125568);

      const factory = result!.bitmaps.find((b) => b.name.endsWith('Factory.webp'));
      expect(factory).to.exist;
      expect(factory!.sizeBytes).to.equal(3440640);
      expect(factory!.width).to.equal(948);
      expect(factory!.height).to.equal(879);
    });

    it('tolerates render-target rows without a name', () => {
      const result = parseR2d2Bitmaps('0x96fafb71  1920   1080   4  8294400  [123184]')!;
      expect(result.count).to.equal(1);
      expect(result.bitmaps[0].sizeBytes).to.equal(8294400);
      expect(result.bitmaps[0].name).to.equal('');
    });

    it('returns null for the "screen not displayed" hint', () => {
      expect(
        parseR2d2Bitmaps('loaded_textures only works when a Scene Graph screen is displayed'),
      ).to.equal(null);
    });
  });
});

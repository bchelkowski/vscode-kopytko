import { expect } from 'chai';
import { encodeRequest, FrameDecoder } from '../../src/rale/frame';

function responseFrame(uuid: string, payload: unknown): string {
  const json = JSON.stringify(payload);
  return `[start][uuid:${uuid.length}]${uuid}${json}[end]`;
}

describe('rale/frame', () => {
  describe('encodeRequest', () => {
    it('wraps the JSON body in [start]/[end] markers', () => {
      const frame = encodeRequest('abc-123', 'selectNode', { path: [{ child: 0 }] });
      expect(frame.startsWith('[start]')).to.be.true;
      expect(frame.endsWith('[end]')).to.be.true;
      const body = JSON.parse(frame.slice('[start]'.length, -'[end]'.length));
      expect(body).to.deep.equal({
        uuid: 'abc-123',
        command: 'selectNode',
        args: { path: [{ child: 0 }] },
      });
    });

    it('always includes args, even when omitted', () => {
      const frame = encodeRequest('u1', 'init');
      const body = JSON.parse(frame.slice('[start]'.length, -'[end]'.length));
      expect(body.args).to.deep.equal({});
    });
  });

  describe('FrameDecoder', () => {
    it('decodes a complete frame', () => {
      const decoder = new FrameDecoder();
      const frames = decoder.push(responseFrame('uuid-1', { raleVersion: '3.2.0' }));
      expect(frames).to.have.length(1);
      expect(frames[0].uuid).to.equal('uuid-1');
      expect(frames[0].payload).to.deep.equal({ raleVersion: '3.2.0' });
    });

    it('buffers a frame split across chunks (device sends ~3000-char pieces)', () => {
      const decoder = new FrameDecoder();
      const whole = responseFrame('uuid-2', { fieldlist: 'x'.repeat(9000) });
      let frames: ReturnType<FrameDecoder['push']> = [];
      for (let i = 0; i < whole.length; i += 3000) {
        frames = frames.concat(decoder.push(whole.slice(i, i + 3000)));
      }
      expect(frames).to.have.length(1);
      expect((frames[0].payload as { fieldlist: string }).fieldlist).to.have.length(9000);
    });

    it('handles markers split across chunk boundaries', () => {
      const decoder = new FrameDecoder();
      const whole = responseFrame('uuid-3', { ok: true });
      // Split inside "[start]" and inside "[end]".
      const cut1 = 3;                    // "[st" | "art]…"
      const cut2 = whole.length - 2;     // "…[en" | "d]"
      let frames = decoder.push(whole.slice(0, cut1));
      expect(frames).to.have.length(0);
      frames = decoder.push(whole.slice(cut1, cut2));
      expect(frames).to.have.length(0);
      frames = decoder.push(whole.slice(cut2));
      expect(frames).to.have.length(1);
      expect(frames[0].uuid).to.equal('uuid-3');
    });

    it('decodes multiple frames arriving in one chunk', () => {
      const decoder = new FrameDecoder();
      const frames = decoder.push(
        responseFrame('a', { n: 1 }) + responseFrame('b', { n: 2 }),
      );
      expect(frames.map(f => f.uuid)).to.deep.equal(['a', 'b']);
      expect(frames.map(f => (f.payload as { n: number }).n)).to.deep.equal([1, 2]);
    });

    it('discards noise before a frame start', () => {
      const decoder = new FrameDecoder();
      const frames = decoder.push('garbage-bytes' + responseFrame('c', { ok: 1 }));
      expect(frames).to.have.length(1);
      expect(frames[0].uuid).to.equal('c');
    });

    it('parses uuid header lengths correctly for full UUIDs', () => {
      const decoder = new FrameDecoder();
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'; // 36 chars
      const frames = decoder.push(responseFrame(uuid, { v: '{}' }));
      expect(frames[0].uuid).to.equal(uuid);
      expect(frames[0].payload).to.deep.equal({ v: '{}' });
    });

    it('yields payload null for a non-JSON body and keeps decoding', () => {
      const decoder = new FrameDecoder();
      const bad = '[start][uuid:2]xxnot-json[end]';
      const frames = decoder.push(bad + responseFrame('d', { ok: true }));
      expect(frames).to.have.length(2);
      expect(frames[0].uuid).to.equal('xx');
      expect(frames[0].payload).to.equal(null);
      expect(frames[1].uuid).to.equal('d');
    });

    it('reset() drops a partially buffered frame', () => {
      const decoder = new FrameDecoder();
      decoder.push('[start][uuid:3]abc{"unfinis');
      decoder.reset();
      const frames = decoder.push(responseFrame('e', { fresh: true }));
      expect(frames).to.have.length(1);
      expect(frames[0].uuid).to.equal('e');
    });
  });
});

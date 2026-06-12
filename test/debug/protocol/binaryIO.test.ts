import { expect } from 'chai';
import { BinaryWriter, BinaryReader } from '../../../src/client/debug/protocol/binaryIO';

describe('BinaryIO', () => {
  describe('BinaryWriter + BinaryReader round-trip', () => {
    it('reads back uint8 values', () => {
      const writer = new BinaryWriter();
      writer.writeUint8(0);
      writer.writeUint8(127);
      writer.writeUint8(255);

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readUint8()).to.equal(0);
      expect(reader.readUint8()).to.equal(127);
      expect(reader.readUint8()).to.equal(255);
      expect(reader.remaining).to.equal(0);
    });

    it('reads back int32 values (little-endian)', () => {
      const writer = new BinaryWriter();
      writer.writeInt32(0);
      writer.writeInt32(42);
      writer.writeInt32(-1);
      writer.writeInt32(2147483647); // max
      writer.writeInt32(-2147483648); // min

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readInt32()).to.equal(0);
      expect(reader.readInt32()).to.equal(42);
      expect(reader.readInt32()).to.equal(-1);
      expect(reader.readInt32()).to.equal(2147483647);
      expect(reader.readInt32()).to.equal(-2147483648);
    });

    it('reads back uint32 values (little-endian)', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(0);
      writer.writeUint32(1);
      writer.writeUint32(4294967295); // max uint32

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readUint32()).to.equal(0);
      expect(reader.readUint32()).to.equal(1);
      expect(reader.readUint32()).to.equal(4294967295);
    });

    it('reads back uint64 values (little-endian)', () => {
      const writer = new BinaryWriter();
      writer.writeUint64(0n);
      writer.writeUint64(0x0067756265647362n); // debugger magic
      writer.writeUint64(18446744073709551615n); // max uint64

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readUint64()).to.equal(0n);
      expect(reader.readUint64()).to.equal(0x0067756265647362n);
      expect(reader.readUint64()).to.equal(18446744073709551615n);
    });

    it('reads back float32 values', () => {
      const writer = new BinaryWriter();
      writer.writeFloat32(0.0);
      writer.writeFloat32(3.14);
      writer.writeFloat32(-1.5);

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readFloat32()).to.equal(0.0);
      expect(reader.readFloat32()).to.be.closeTo(3.14, 0.001);
      expect(reader.readFloat32()).to.equal(-1.5);
    });

    it('reads back float64 values', () => {
      const writer = new BinaryWriter();
      writer.writeFloat64(0.0);
      writer.writeFloat64(3.141592653589793);
      writer.writeFloat64(-1e-10);

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readFloat64()).to.equal(0.0);
      expect(reader.readFloat64()).to.equal(3.141592653589793);
      expect(reader.readFloat64()).to.equal(-1e-10);
    });

    it('reads back null-terminated strings', () => {
      const writer = new BinaryWriter();
      writer.writeStringNT('hello');
      writer.writeStringNT('');
      writer.writeStringNT('pkg:/source/main.brs');

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readStringNT()).to.equal('hello');
      expect(reader.readStringNT()).to.equal('');
      expect(reader.readStringNT()).to.equal('pkg:/source/main.brs');
      expect(reader.remaining).to.equal(0);
    });

    it('reads back boolean values', () => {
      const writer = new BinaryWriter();
      writer.writeBool(true);
      writer.writeBool(false);

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readBool()).to.equal(true);
      expect(reader.readBool()).to.equal(false);
    });

    it('reads back mixed types in sequence', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(42);
      writer.writeStringNT('test');
      writer.writeUint8(7);
      writer.writeUint64(100n);
      writer.writeBool(true);

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readUint32()).to.equal(42);
      expect(reader.readStringNT()).to.equal('test');
      expect(reader.readUint8()).to.equal(7);
      expect(reader.readUint64()).to.equal(100n);
      expect(reader.readBool()).to.equal(true);
      expect(reader.remaining).to.equal(0);
    });

    it('handles UTF-8 strings with multi-byte characters', () => {
      const writer = new BinaryWriter();
      writer.writeStringNT('héllo wörld');

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.readStringNT()).to.equal('héllo wörld');
    });
  });

  describe('BinaryWriter', () => {
    it('tracks length correctly', () => {
      const writer = new BinaryWriter();
      expect(writer.length).to.equal(0);

      writer.writeUint8(1);
      expect(writer.length).to.equal(1);

      writer.writeUint32(2);
      expect(writer.length).to.equal(5);

      writer.writeStringNT('hi');
      expect(writer.length).to.equal(8); // 5 + 'hi\0' = 3
    });

    it('writeBuffer appends raw bytes', () => {
      const writer = new BinaryWriter();
      writer.writeBuffer(Buffer.from([0x01, 0x02, 0x03]));

      const buf = writer.toBuffer();
      expect(buf.length).to.equal(3);
      expect(buf[0]).to.equal(1);
      expect(buf[1]).to.equal(2);
      expect(buf[2]).to.equal(3);
    });

    it('produces little-endian byte order for uint32', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(0x04030201);

      const buf = writer.toBuffer();
      expect(buf[0]).to.equal(0x01);
      expect(buf[1]).to.equal(0x02);
      expect(buf[2]).to.equal(0x03);
      expect(buf[3]).to.equal(0x04);
    });
  });

  describe('BinaryReader', () => {
    it('tracks position correctly', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(1);
      writer.writeUint8(2);

      const reader = new BinaryReader(writer.toBuffer());
      expect(reader.position).to.equal(0);
      expect(reader.remaining).to.equal(5);

      reader.readUint32();
      expect(reader.position).to.equal(4);
      expect(reader.remaining).to.equal(1);

      reader.readUint8();
      expect(reader.position).to.equal(5);
      expect(reader.remaining).to.equal(0);
    });

    it('skip advances the offset', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(1);
      writer.writeUint32(42);

      const reader = new BinaryReader(writer.toBuffer());
      reader.skip(4);
      expect(reader.readUint32()).to.equal(42);
    });

    it('readBuffer returns the correct slice', () => {
      const writer = new BinaryWriter();
      writer.writeUint8(0xAA);
      writer.writeUint8(0xBB);
      writer.writeUint8(0xCC);

      const reader = new BinaryReader(writer.toBuffer());
      reader.skip(1);
      const buf = reader.readBuffer(2);
      expect(buf.length).to.equal(2);
      expect(buf[0]).to.equal(0xBB);
      expect(buf[1]).to.equal(0xCC);
    });

    it('throws on read past end of buffer', () => {
      const reader = new BinaryReader(Buffer.alloc(2));
      expect(() => reader.readUint32()).to.throw(/read past end of buffer/);
    });

    it('throws on unterminated string', () => {
      const buf = Buffer.from('hello'); // no null terminator
      const reader = new BinaryReader(buf);
      expect(() => reader.readStringNT()).to.throw(/unterminated string/);
    });

    it('throws on skip past end', () => {
      const reader = new BinaryReader(Buffer.alloc(2));
      expect(() => reader.skip(3)).to.throw(/read past end of buffer/);
    });

    it('supports starting at a custom offset', () => {
      const buf = Buffer.alloc(8);
      buf.writeUInt32LE(42, 4);

      const reader = new BinaryReader(buf, 4);
      expect(reader.position).to.equal(4);
      expect(reader.readUint32()).to.equal(42);
    });
  });
});

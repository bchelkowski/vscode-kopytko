/**
 * Roku Socket-Based Debug Protocol — Binary IO Utilities
 *
 * Little-endian binary reader and writer for the protocol's wire format.
 * All multi-byte values are little-endian per the Roku spec.
 */

// ---------------------------------------------------------------------------
// BinaryWriter
// ---------------------------------------------------------------------------

export class BinaryWriter {
  private _chunks: Buffer[] = [];
  private _length = 0;

  get length(): number {
    return this._length;
  }

  writeUint8(value: number): void {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(value);
    this._push(buf);
  }

  writeInt32(value: number): void {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(value);
    this._push(buf);
  }

  writeUint32(value: number): void {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value);
    this._push(buf);
  }

  writeUint64(value: bigint): void {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value);
    this._push(buf);
  }

  writeFloat32(value: number): void {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(value);
    this._push(buf);
  }

  writeFloat64(value: number): void {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(value);
    this._push(buf);
  }

  /** Write a UTF-8 null-terminated string. */
  writeStringNT(str: string): void {
    const encoded = Buffer.from(str, 'utf-8');
    const buf = Buffer.alloc(encoded.length + 1); // +1 for null terminator
    encoded.copy(buf);
    buf[encoded.length] = 0;
    this._push(buf);
  }

  writeBool(value: boolean): void {
    this.writeUint8(value ? 1 : 0);
  }

  writeBuffer(buf: Buffer): void {
    this._push(buf);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this._chunks, this._length);
  }

  private _push(buf: Buffer): void {
    this._chunks.push(buf);
    this._length += buf.length;
  }
}

// ---------------------------------------------------------------------------
// BinaryReader
// ---------------------------------------------------------------------------

export class BinaryReader {
  private _buffer: Buffer;
  private _offset: number;

  constructor(buffer: Buffer, offset = 0) {
    this._buffer = buffer;
    this._offset = offset;
  }

  get position(): number {
    return this._offset;
  }

  get remaining(): number {
    return this._buffer.length - this._offset;
  }

  readUint8(): number {
    this._ensureAvailable(1);
    const value = this._buffer.readUInt8(this._offset);
    this._offset += 1;
    return value;
  }

  readInt32(): number {
    this._ensureAvailable(4);
    const value = this._buffer.readInt32LE(this._offset);
    this._offset += 4;
    return value;
  }

  readUint32(): number {
    this._ensureAvailable(4);
    const value = this._buffer.readUInt32LE(this._offset);
    this._offset += 4;
    return value;
  }

  readUint64(): bigint {
    this._ensureAvailable(8);
    const value = this._buffer.readBigUInt64LE(this._offset);
    this._offset += 8;
    return value;
  }

  readInt64(): bigint {
    this._ensureAvailable(8);
    const value = this._buffer.readBigInt64LE(this._offset);
    this._offset += 8;
    return value;
  }

  readFloat32(): number {
    this._ensureAvailable(4);
    const value = this._buffer.readFloatLE(this._offset);
    this._offset += 4;
    return value;
  }

  readFloat64(): number {
    this._ensureAvailable(8);
    const value = this._buffer.readDoubleLE(this._offset);
    this._offset += 8;
    return value;
  }

  readBool(): boolean {
    return this.readUint8() !== 0;
  }

  /** Read a null-terminated UTF-8 string. */
  readStringNT(): string {
    const start = this._offset;
    let end = start;
    while (end < this._buffer.length && this._buffer[end] !== 0) {
      end++;
    }
    if (end >= this._buffer.length) {
      throw new Error('BinaryReader: unterminated string — no null byte found');
    }
    const str = this._buffer.toString('utf-8', start, end);
    this._offset = end + 1; // skip past the null terminator
    return str;
  }

  skip(n: number): void {
    this._ensureAvailable(n);
    this._offset += n;
  }

  readBuffer(length: number): Buffer {
    this._ensureAvailable(length);
    const buf = this._buffer.subarray(this._offset, this._offset + length);
    this._offset += length;
    return buf;
  }

  private _ensureAvailable(n: number): void {
    if (this._offset + n > this._buffer.length) {
      throw new Error(
        `BinaryReader: read past end of buffer (offset=${this._offset}, need=${n}, length=${this._buffer.length})`,
      );
    }
  }
}

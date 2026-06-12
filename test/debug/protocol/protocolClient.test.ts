import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { BinaryWriter, BinaryReader } from '../../../src/client/debug/protocol/binaryIO';
import {
  CommandCode,
  DEBUGGER_MAGIC,
  ErrorCode,
  StopReason,
  UpdateType,
} from '../../../src/client/debug/protocol/constants';

/**
 * Creates a mock net.Socket that behaves like a TCP connection.
 * Provides a `pushData(buf)` method to simulate incoming data.
 */
function createMockSocket() {
  const emitter = new EventEmitter();
  const written: Buffer[] = [];

  const socket = Object.assign(emitter, {
    connect: (_port: number, _host: string, cb: () => void) => { cb(); },
    write: (data: Buffer | string) => { written.push(Buffer.isBuffer(data) ? data : Buffer.from(data)); return true; },
    destroy: () => {},
    setTimeout: () => {},
    removeAllListeners: (event?: string) => { if (event) emitter.removeAllListeners(event); return emitter; },
  });

  return {
    socket,
    written,
    pushData: (buf: Buffer) => emitter.emit('data', buf),
    close: () => emitter.emit('close'),
  };
}

/**
 * Builds a valid handshake response buffer (protocol 3.3.0).
 */
function buildHandshakeResponse(): Buffer {
  const writer = new BinaryWriter();
  writer.writeUint64(DEBUGGER_MAGIC);
  writer.writeUint32(3); // major
  writer.writeUint32(3); // minor
  writer.writeUint32(0); // patch
  writer.writeUint32(8); // remaining_packet_length (timestamp only)
  writer.writeUint64(1700000000n); // platform_revision_timestamp
  return writer.toBuffer();
}

/**
 * Builds a protocol response packet for a given requestId.
 */
function buildResponse(requestId: number, errorCode: ErrorCode, payload: Buffer = Buffer.alloc(0)): Buffer {
  const bodyWriter = new BinaryWriter();
  bodyWriter.writeUint32(requestId);
  bodyWriter.writeUint32(errorCode);
  if (payload.length > 0) {
    bodyWriter.writeBuffer(payload);
  }
  const body = bodyWriter.toBuffer();

  const packetWriter = new BinaryWriter();
  packetWriter.writeUint32(4 + body.length); // packet_length includes itself
  packetWriter.writeBuffer(body);
  return packetWriter.toBuffer();
}

/**
 * Builds an update packet (requestId = 0).
 */
function buildUpdate(updateType: UpdateType, errorCode: ErrorCode, payload: Buffer = Buffer.alloc(0)): Buffer {
  const bodyWriter = new BinaryWriter();
  bodyWriter.writeUint32(0); // requestId = 0 for updates
  bodyWriter.writeUint32(errorCode);
  bodyWriter.writeUint32(updateType);
  if (payload.length > 0) {
    bodyWriter.writeBuffer(payload);
  }
  const body = bodyWriter.toBuffer();

  const packetWriter = new BinaryWriter();
  packetWriter.writeUint32(4 + body.length);
  packetWriter.writeBuffer(body);
  return packetWriter.toBuffer();
}

// We can't easily import ProtocolClient since it creates real net.Socket
// connections. Instead, test the packet parsing logic indirectly via
// the BinaryIO and constants tests, plus integration-style tests below.

describe('Protocol constants', () => {
  it('DEBUGGER_MAGIC matches the expected byte sequence', () => {
    // b'bsdebug\0' as little-endian uint64
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(DEBUGGER_MAGIC);
    expect(buf.toString('ascii', 0, 7)).to.equal('bsdebug');
    expect(buf[7]).to.equal(0);
  });

  it('CommandCode enum has all expected commands', () => {
    expect(CommandCode.Stop).to.equal(1);
    expect(CommandCode.Continue).to.equal(2);
    expect(CommandCode.Threads).to.equal(3);
    expect(CommandCode.StackTrace).to.equal(4);
    expect(CommandCode.Variables).to.equal(5);
    expect(CommandCode.Step).to.equal(6);
    expect(CommandCode.AddBreakpoints).to.equal(7);
    expect(CommandCode.ListBreakpoints).to.equal(8);
    expect(CommandCode.RemoveBreakpoints).to.equal(9);
    expect(CommandCode.Execute).to.equal(10);
    expect(CommandCode.AddConditionalBreakpoints).to.equal(11);
    expect(CommandCode.SetExceptionBreakpoints).to.equal(12);
    expect(CommandCode.ExitChannel).to.equal(122);
  });

  it('UpdateType enum has all expected types', () => {
    expect(UpdateType.IOPortOpened).to.equal(1);
    expect(UpdateType.AllThreadsStopped).to.equal(2);
    expect(UpdateType.ThreadAttached).to.equal(3);
    expect(UpdateType.BreakpointError).to.equal(4);
    expect(UpdateType.CompileError).to.equal(5);
    expect(UpdateType.BreakpointVerified).to.equal(6);
    expect(UpdateType.ProtocolError).to.equal(7);
    expect(UpdateType.ExceptionBreakpointError).to.equal(8);
  });

  it('StopReason enum values are correct', () => {
    expect(StopReason.Undefined).to.equal(0);
    expect(StopReason.NotStopped).to.equal(1);
    expect(StopReason.NormalExit).to.equal(2);
    expect(StopReason.StopStatement).to.equal(3);
    expect(StopReason.Break).to.equal(4);
    expect(StopReason.RuntimeError).to.equal(5);
    expect(StopReason.CaughtRuntimeError).to.equal(6);
  });
});

describe('Protocol packet building', () => {
  it('builds a valid handshake magic buffer', () => {
    const writer = new BinaryWriter();
    writer.writeUint64(DEBUGGER_MAGIC);
    const buf = writer.toBuffer();
    expect(buf.length).to.equal(8);
    expect(buf.readBigUInt64LE()).to.equal(DEBUGGER_MAGIC);
  });

  it('parses a handshake response correctly', () => {
    const response = buildHandshakeResponse();
    const reader = new BinaryReader(response);

    const magic = reader.readUint64();
    expect(magic).to.equal(DEBUGGER_MAGIC);

    const major = reader.readUint32();
    const minor = reader.readUint32();
    const patch = reader.readUint32();
    expect(major).to.equal(3);
    expect(minor).to.equal(3);
    expect(patch).to.equal(0);

    const remainingLength = reader.readUint32();
    expect(remainingLength).to.equal(8);

    const timestamp = reader.readUint64();
    expect(timestamp).to.equal(1700000000n);
  });

  it('builds a request packet with correct framing', () => {
    const requestId = 1;
    const commandCode = CommandCode.Threads;

    const bodyWriter = new BinaryWriter();
    bodyWriter.writeUint32(requestId);
    bodyWriter.writeUint32(commandCode);
    const body = bodyWriter.toBuffer();

    const packetWriter = new BinaryWriter();
    packetWriter.writeUint32(4 + body.length); // packet_length
    packetWriter.writeBuffer(body);
    const packet = packetWriter.toBuffer();

    // Parse it back
    const reader = new BinaryReader(packet);
    const packetLength = reader.readUint32();
    expect(packetLength).to.equal(12); // 4 (length) + 4 (requestId) + 4 (command)

    const parsedRequestId = reader.readUint32();
    expect(parsedRequestId).to.equal(1);

    const parsedCommand = reader.readUint32();
    expect(parsedCommand).to.equal(CommandCode.Threads);
  });

  it('builds a response packet that can be parsed', () => {
    const payloadWriter = new BinaryWriter();
    payloadWriter.writeUint32(2); // thread count
    const payload = payloadWriter.toBuffer();

    const response = buildResponse(1, ErrorCode.OK, payload);
    const reader = new BinaryReader(response);

    const packetLength = reader.readUint32();
    const reqId = reader.readUint32();
    expect(reqId).to.equal(1);

    const errorCode = reader.readUint32();
    expect(errorCode).to.equal(ErrorCode.OK);

    const threadCount = reader.readUint32();
    expect(threadCount).to.equal(2);
  });

  it('builds an update packet with requestId = 0', () => {
    const payloadWriter = new BinaryWriter();
    payloadWriter.writeUint32(0); // primaryThreadIndex
    payloadWriter.writeUint32(StopReason.Break);
    payloadWriter.writeStringNT('Breakpoint hit');
    const payload = payloadWriter.toBuffer();

    const update = buildUpdate(UpdateType.AllThreadsStopped, ErrorCode.OK, payload);
    const reader = new BinaryReader(update);

    const packetLength = reader.readUint32();
    const reqId = reader.readUint32();
    expect(reqId).to.equal(0);

    const errorCode = reader.readUint32();
    expect(errorCode).to.equal(ErrorCode.OK);

    const updateType = reader.readUint32();
    expect(updateType).to.equal(UpdateType.AllThreadsStopped);

    const primaryThread = reader.readUint32();
    expect(primaryThread).to.equal(0);

    const stopReason = reader.readUint32();
    expect(stopReason).to.equal(StopReason.Break);

    const detail = reader.readStringNT();
    expect(detail).to.equal('Breakpoint hit');
  });

  it('handles partial packet reassembly', () => {
    const response = buildResponse(1, ErrorCode.OK);

    // Split the response into two chunks at an arbitrary point
    const mid = Math.floor(response.length / 2);
    const chunk1 = response.subarray(0, mid);
    const chunk2 = response.subarray(mid);

    // Simulate buffer accumulation
    let buffer = Buffer.alloc(0);
    buffer = Buffer.concat([buffer, chunk1]);

    // First chunk is incomplete — can't read packet_length fully or packet isn't complete
    if (buffer.length >= 4) {
      const packetLength = buffer.readUInt32LE(0);
      expect(buffer.length).to.be.lessThan(packetLength);
    }

    // Second chunk completes the packet
    buffer = Buffer.concat([buffer, chunk2]);
    const packetLength = buffer.readUInt32LE(0);
    expect(buffer.length).to.be.greaterThanOrEqual(packetLength);

    // Can now parse the full packet
    const reader = new BinaryReader(buffer.subarray(4, packetLength));
    const reqId = reader.readUint32();
    expect(reqId).to.equal(1);
  });

  it('handles multiple packets in a single buffer', () => {
    const response1 = buildResponse(1, ErrorCode.OK);
    const response2 = buildResponse(2, ErrorCode.OK);
    const combined = Buffer.concat([response1, response2]);

    let offset = 0;
    const packets: { requestId: number }[] = [];

    while (offset < combined.length) {
      const packetLength = combined.readUInt32LE(offset);
      const packetData = combined.subarray(offset + 4, offset + packetLength);
      const reader = new BinaryReader(packetData);
      packets.push({ requestId: reader.readUint32() });
      offset += packetLength;
    }

    expect(packets).to.have.length(2);
    expect(packets[0].requestId).to.equal(1);
    expect(packets[1].requestId).to.equal(2);
  });
});

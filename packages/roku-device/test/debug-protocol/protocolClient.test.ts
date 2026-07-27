import { expect } from 'chai';
import * as net from 'net';
import { BinaryWriter, BinaryReader } from '../../src/debug-protocol/binaryIO';
import { ProtocolClient, isRequestCancelled } from '../../src/debug-protocol/protocolClient';
import {
  CommandCode,
  DEBUGGER_MAGIC,
  ErrorCode,
  StopReason,
  UpdateType,
} from '../../src/debug-protocol/constants';

/**
 * ALL_THREADS_STOPPED / THREAD_ATTACHED payload as the device sends it:
 * int32 thread index, **uint8** stop reason, utf8z detail.
 */
function allThreadsStoppedPayload(threadIndex: number, stopReason: StopReason, detail = ''): Buffer {
  const writer = new BinaryWriter();
  writer.writeInt32(threadIndex);
  writer.writeUint8(stopReason);
  writer.writeStringNT(detail);
  return writer.toBuffer();
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

    const _packetLength = reader.readUint32();
    const reqId = reader.readUint32();
    expect(reqId).to.equal(1);

    const errorCode = reader.readUint32();
    expect(errorCode).to.equal(ErrorCode.OK);

    const threadCount = reader.readUint32();
    expect(threadCount).to.equal(2);
  });

  it('builds an update packet with requestId = 0', () => {
    const payload = allThreadsStoppedPayload(0, StopReason.Break, 'Breakpoint hit');

    const update = buildUpdate(UpdateType.AllThreadsStopped, ErrorCode.OK, payload);
    const reader = new BinaryReader(update);

    const _packetLength = reader.readUint32();
    const reqId = reader.readUint32();
    expect(reqId).to.equal(0);

    const errorCode = reader.readUint32();
    expect(errorCode).to.equal(ErrorCode.OK);

    const updateType = reader.readUint32();
    expect(updateType).to.equal(UpdateType.AllThreadsStopped);

    const primaryThread = reader.readInt32();
    expect(primaryThread).to.equal(0);

    // stop_reason is a single byte on the wire — ProtocolEventMapper reads uint8.
    const stopReason = reader.readUint8();
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

// ---------------------------------------------------------------------------
// ProtocolClient against a real TCP server
//
// These drive the actual framing, handshake and dispatch code rather than a
// reimplementation of it — the previous suite asserted against its own copy of
// the framing logic, so _processBuffer/_handlePacket/_performHandshake had no
// coverage at all.
// ---------------------------------------------------------------------------

/** A stand-in Roku debug daemon: answers the magic, then replays scripted bytes. */
class FakeDevice {
  readonly received: Buffer[] = [];
  private readonly _server: net.Server;
  private _socket: net.Socket | null = null;
  private _onMagic: (device: FakeDevice) => void = (d) => d.send(buildHandshakeResponse());

  private constructor(server: net.Server) {
    this._server = server;
  }

  static async start(): Promise<FakeDevice> {
    const server = net.createServer();
    const device = new FakeDevice(server);
    server.on('connection', (socket) => {
      device._socket = socket;
      socket.on('data', (chunk) => {
        device.received.push(chunk);
        // The client opens with the 8-byte magic; everything after is a command.
        if (device.received.length === 1) device._onMagic(device);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return device;
  }

  get port(): number {
    return (this._server.address() as net.AddressInfo).port;
  }

  /** Replace the default handshake reply (e.g. to glue an update onto it). */
  onMagic(handler: (device: FakeDevice) => void): void {
    this._onMagic = handler;
  }

  send(buf: Buffer): void {
    this._socket?.write(buf);
  }

  /** Abort the connection the way a Roku does — an RST, not a clean FIN. */
  reset(): void {
    this._socket?.resetAndDestroy();
  }

  async stop(): Promise<void> {
    this._socket?.destroy();
    await new Promise<void>((resolve) => this._server.close(() => resolve()));
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('ProtocolClient (real socket)', () => {
  let device: FakeDevice;
  let client: ProtocolClient;

  beforeEach(async () => {
    device = await FakeDevice.start();
    client = new ProtocolClient();
  });

  afterEach(async () => {
    client.close();
    await device.stop();
  });

  it('dispatches an update glued to the handshake before connect() resolves', async () => {
    const update = buildUpdate(
      UpdateType.AllThreadsStopped,
      ErrorCode.OK,
      allThreadsStoppedPayload(0, StopReason.Break),
    );
    // remotedebug_connect_early: the device is already stopped, so its initial
    // AllThreadsStopped rides along in the same TCP segment as the handshake.
    device.onMagic((d) => d.send(Buffer.concat([buildHandshakeResponse(), update])));

    const updates: number[] = [];
    client.on('update', (type) => updates.push(type));

    const handshake = await client.connect('127.0.0.1', device.port);

    expect(handshake.protocolVersion).to.deep.equal({ major: 3, minor: 3, patch: 0 });
    // Dispatched exactly once, and before connect() settled — this ordering is
    // what SessionController has to arm its suppression flag ahead of.
    expect(updates).to.deep.equal([UpdateType.AllThreadsStopped]);

    await tick();
    expect(updates).to.deep.equal([UpdateType.AllThreadsStopped]);
  });

  it('reassembles a packet split across chunks and drains several from one chunk', async () => {
    await client.connect('127.0.0.1', device.port);

    const pending = client.sendRequest(CommandCode.Threads);
    const response = buildResponse(1, ErrorCode.OK, Buffer.from([0, 0, 0, 0]));
    device.send(response.subarray(0, 5));
    await tick();
    device.send(response.subarray(5));

    expect((await pending).length).to.equal(4);

    const a = client.sendRequest(CommandCode.StackTrace);
    const b = client.sendRequest(CommandCode.Variables);
    device.send(Buffer.concat([
      buildResponse(2, ErrorCode.OK, Buffer.from([1])),
      buildResponse(3, ErrorCode.OK, Buffer.from([2, 2])),
    ]));

    expect((await a).length).to.equal(1);
    expect((await b).length).to.equal(2);
  });

  it('rejects with the command name and error code when the device refuses', async () => {
    await client.connect('127.0.0.1', device.port);

    const pending = client.sendRequest(CommandCode.Continue);
    device.send(buildResponse(1, ErrorCode.NotStopped));

    let message = '';
    await pending.catch((err: Error) => { message = err.message; });
    expect(message).to.contain('Continue');
    expect(message).to.contain('NotStopped');
  });

  it('keeps processing packets after an update listener throws', async () => {
    await client.connect('127.0.0.1', device.port);

    const errors: string[] = [];
    client.on('error', (err: Error) => errors.push(err.message));
    client.once('update', () => { throw new Error('listener exploded'); });

    const pending = client.sendRequest(CommandCode.Threads);
    // A throwing listener used to escape into the socket's 'data' emit and
    // abort the framing loop, stranding every packet queued behind it.
    device.send(Buffer.concat([
      buildUpdate(UpdateType.AllThreadsStopped, ErrorCode.OK, allThreadsStoppedPayload(0, StopReason.Break)),
      buildResponse(1, ErrorCode.OK, Buffer.from([7])),
    ]));

    expect((await pending).length).to.equal(1);
    expect(errors).to.deep.equal(['listener exploded']);
  });

  it('resyncs instead of disconnecting when the stream desynchronizes', async () => {
    await client.connect('127.0.0.1', device.port);

    let disconnected = false;
    client.on('disconnected', () => { disconnected = true; });
    const errors: string[] = [];
    client.on('error', (err: Error) => errors.push(err.message));

    const pending = client.sendRequest(CommandCode.Threads);
    // Four garbage bytes that decode as packet_length = 0. There is no sync
    // marker to scan for, so everything buffered is dropped…
    device.send(Buffer.from([0, 0, 0, 0]));
    await tick();
    // …and the next read realigns on a packet boundary.
    device.send(buildResponse(1, ErrorCode.OK, Buffer.from([9])));

    expect((await pending).length).to.equal(1);
    expect(errors).to.have.length(1);
    expect(errors[0]).to.contain('desynchronized');
    // Tearing the session down here would strand the channel stopped on device.
    expect(disconnected).to.equal(false);
  });

  it('drops a late response to an abandoned request without rejecting again', async () => {
    await client.connect('127.0.0.1', device.port);

    const abandoned = client.sendRequest(CommandCode.Variables);
    client.cancelPendingRequests();

    let cancelled = false;
    await abandoned.catch((err: unknown) => { cancelled = isRequestCancelled(err); });
    expect(cancelled).to.equal(true);
    expect(client.pendingRequestCount).to.equal(0);

    // The device still answers it — that must not disturb the next request.
    const next = client.sendRequest(CommandCode.Continue);
    device.send(Buffer.concat([
      buildResponse(1, ErrorCode.OK, Buffer.from([4, 4, 4, 4])),
      buildResponse(2, ErrorCode.OK),
    ]));

    expect((await next).length).to.equal(0);
  });

  it('emits disconnected once and rejects in-flight requests when the device resets', async () => {
    await client.connect('127.0.0.1', device.port);

    let disconnects = 0;
    client.on('disconnected', () => { disconnects++; });
    client.on('error', () => { /* ECONNRESET surfaces here */ });

    const pending = client.sendRequest(CommandCode.Continue);
    device.reset();

    let message = '';
    await pending.catch((err: Error) => { message = err.message; });
    await tick();

    expect(message).to.equal('Connection closed');
    expect(disconnects).to.equal(1);
    expect(client.isConnected).to.equal(false);
  });

  it('traces the command name and the in-flight set when the socket drops', async () => {
    const lines: string[] = [];
    client.setTracer((message) => lines.push(message));
    await client.connect('127.0.0.1', device.port);

    client.on('error', () => { /* ignore */ });
    const pending = client.sendRequest(CommandCode.Continue);
    device.reset();
    await pending.catch(() => { /* expected */ });
    await tick();

    expect(lines.some((l) => l.startsWith('handshake protocol 3.3.0'))).to.equal(true);
    expect(lines.some((l) => l.includes('send #1 Continue'))).to.equal(true);
    expect(lines.some((l) => l.includes('socket closed') && l.includes('#1 Continue'))).to.equal(true);
  });
});

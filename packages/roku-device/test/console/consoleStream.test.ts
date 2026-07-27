import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { ConsoleStream } from '../../src/console/consoleStream';
import type { ConsoleSocket } from '../../src/console/debugConsoleClient';

interface MockSocket extends ConsoleSocket {
  writes: string[];
  destroyed: boolean;
  fire(event: string, ...args: unknown[]): void;
}

function makeMockSocket(): MockSocket {
  const emitter = new EventEmitter();
  const sock = Object.assign(emitter, {
    writes: [] as string[],
    destroyed: false,
    write(data: string) { (sock.writes as string[]).push(data); },
    destroy() { sock.destroyed = true; },
    fire(event: string, ...args: unknown[]) { emitter.emit(event, ...args); },
  }) as unknown as MockSocket;
  return sock;
}

describe('ConsoleStream', () => {
  let clock: sinon.SinonFakeTimers;
  let sockets: MockSocket[];

  function makeStream(opts: Partial<{ autoReconnect: boolean; maxBackoffMs: number }> = {}) {
    sockets = [];
    return new ConsoleStream({
      host: '1.2.3.4',
      port: 8085,
      autoReconnect: opts.autoReconnect,
      maxBackoffMs: opts.maxBackoffMs,
      socketFactory: () => {
        const s = makeMockSocket();
        sockets.push(s);
        return s;
      },
    });
  }

  function bringUp(stream: ConsoleStream): MockSocket {
    stream.start();
    const sock = sockets[sockets.length - 1];
    sock.fire('connect');
    expect(stream.isConnected).to.be.true;
    return sock;
  }

  beforeEach(() => { clock = sinon.useFakeTimers(); });
  afterEach(() => { clock.restore(); sinon.restore(); });

  it('emits connect and reports isConnected', () => {
    const stream = makeStream();
    const onConnect = sinon.spy();
    stream.on('connect', onConnect);

    expect(stream.isConnected).to.be.false;
    bringUp(stream);
    expect(onConnect.calledOnce).to.be.true;
    stream.close();
  });

  it('forwards data chunks verbatim, including banners and prompts', () => {
    const stream = makeStream();
    const chunks: string[] = [];
    stream.on('data', (chunk: string) => chunks.push(chunk));
    const sock = bringUp(stream);

    sock.fire('data', 'X02800C5FKLV (Roku Ultra - 15.2.4.3442)\r\n>');
    sock.fire('data', 'channel: mem=52492KiB\n>');

    // Nothing is stripped — a terminal shows the prompt the device sent.
    expect(chunks).to.deep.equal([
      'X02800C5FKLV (Roku Ultra - 15.2.4.3442)\r\n>',
      'channel: mem=52492KiB\n>',
    ]);
    stream.close();
  });

  it('forwards a line split across two chunks as two chunks', () => {
    const stream = makeStream();
    const chunks: string[] = [];
    stream.on('data', (chunk: string) => chunks.push(chunk));
    const sock = bringUp(stream);

    sock.fire('data', 'BRIGHTSCRIPT: ERROR: Type Mis');
    sock.fire('data', 'match\r\n');

    // Re-assembly is the caller's job; the transport stays byte-faithful.
    expect(chunks.join('')).to.equal('BRIGHTSCRIPT: ERROR: Type Mismatch\r\n');
    stream.close();
  });

  it('converts Buffer chunks to strings', () => {
    const stream = makeStream();
    const chunks: string[] = [];
    stream.on('data', (chunk: string) => chunks.push(chunk));
    const sock = bringUp(stream);

    sock.fire('data', Buffer.from('free\r\n', 'utf8'));

    expect(chunks).to.deep.equal(['free\r\n']);
    stream.close();
  });

  it('writes exactly what it is given, with no terminator of its own', () => {
    const stream = makeStream();
    const sock = bringUp(stream);

    stream.write('chanperf\r\n');
    stream.write('\x03');

    expect(sock.writes).to.deep.equal(['chanperf\r\n', '\x03']);
    stream.close();
  });

  it('drops writes while disconnected instead of queueing them', () => {
    const stream = makeStream();
    stream.start();
    stream.write('chanperf\r\n');
    expect(sockets[0].writes).to.be.empty;

    sockets[0].fire('connect');
    stream.write('free\r\n');
    expect(sockets[0].writes).to.deep.equal(['free\r\n']);
    stream.close();
  });

  it('emits close and reconnects with doubling backoff after a drop', async () => {
    const stream = makeStream();
    const onClose = sinon.spy();
    stream.on('close', onClose);
    const sock = bringUp(stream);

    sock.fire('close');
    expect(onClose.calledOnce).to.be.true;
    expect(stream.isConnected).to.be.false;

    // First retry after 500ms.
    await clock.tickAsync(499);
    expect(sockets.length).to.equal(1);
    await clock.tickAsync(1);
    expect(sockets.length).to.equal(2);

    // That attempt fails to connect, so the next wait is 1000ms.
    sockets[1].fire('close');
    await clock.tickAsync(999);
    expect(sockets.length).to.equal(2);
    await clock.tickAsync(1);
    expect(sockets.length).to.equal(3);

    stream.close();
  });

  it('caps the backoff at maxBackoffMs', async () => {
    const stream = makeStream({ maxBackoffMs: 1000 });
    stream.start();

    for (let i = 0; i < 5; i += 1) {
      sockets[sockets.length - 1].fire('close');
      await clock.tickAsync(1000);
    }

    // 5 retries all landed within 1000ms each, so all 5 sockets were created.
    expect(sockets.length).to.equal(6);
    stream.close();
  });

  it('resets the backoff after a successful connect', async () => {
    const stream = makeStream();
    const sock = bringUp(stream);

    sock.fire('close');
    await clock.tickAsync(500);
    sockets[1].fire('connect');
    sockets[1].fire('close');

    // Backoff went back to 500ms rather than continuing to 1000ms.
    await clock.tickAsync(500);
    expect(sockets.length).to.equal(3);
    stream.close();
  });

  it('counts consecutive failures and resets them on connect', async () => {
    const stream = makeStream();
    stream.start();

    expect(stream.consecutiveFailures).to.equal(0);
    sockets[0].fire('close');
    expect(stream.consecutiveFailures).to.equal(1);

    await clock.tickAsync(500);
    sockets[1].fire('close');
    expect(stream.consecutiveFailures).to.equal(2);

    await clock.tickAsync(1000);
    sockets[2].fire('connect');
    expect(stream.consecutiveFailures).to.equal(0);
    stream.close();
  });

  it('does not throw when a socket errors with no error listener attached', async () => {
    const stream = makeStream();
    const sock = bringUp(stream);

    expect(() => sock.fire('error', new Error('ECONNRESET'))).to.not.throw();
    expect(stream.isConnected).to.be.false;
    stream.close();
  });

  it('emits error when a listener is attached', () => {
    const stream = makeStream();
    const onError = sinon.spy();
    stream.on('error', onError);
    const sock = bringUp(stream);

    sock.fire('error', new Error('ECONNREFUSED'));

    expect(onError.calledOnce).to.be.true;
    expect((onError.firstCall.args[0] as Error).message).to.equal('ECONNREFUSED');
    stream.close();
  });

  it('does not reconnect when autoReconnect is false', async () => {
    const stream = makeStream({ autoReconnect: false });
    const sock = bringUp(stream);

    sock.fire('close');
    await clock.tickAsync(10000);

    expect(sockets.length).to.equal(1);
    stream.close();
  });

  it('stops reconnecting after close()', async () => {
    const stream = makeStream();
    const sock = bringUp(stream);

    stream.close();
    sock.fire('close');
    await clock.tickAsync(10000);

    expect(sockets.length).to.equal(1);
    expect(sockets[0].destroyed).to.be.true;
  });

  it('emits close exactly once when close() follows a live connection', () => {
    const stream = makeStream();
    const onClose = sinon.spy();
    stream.on('close', onClose);
    bringUp(stream);

    stream.close();
    stream.close();

    expect(onClose.calledOnce).to.be.true;
  });
});

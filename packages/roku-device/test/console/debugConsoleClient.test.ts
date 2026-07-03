import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import {
  DebugConsoleClient,
  type ConsoleSocket,
} from '../../src/console/debugConsoleClient';

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

const IDLE = 250;

describe('DebugConsoleClient', () => {
  let clock: sinon.SinonFakeTimers;
  let sockets: MockSocket[];

  function makeClient(opts: Partial<{ commandTimeoutMs: number }> = {}) {
    sockets = [];
    const client = new DebugConsoleClient({
      host: '1.2.3.4',
      idleMs: IDLE,
      commandTimeoutMs: opts.commandTimeoutMs ?? 5000,
      socketFactory: () => {
        const s = makeMockSocket();
        sockets.push(s);
        return s;
      },
    });
    return client;
  }

  /** Connect + drain the banner so the client is ready. */
  async function bringUp(client: DebugConsoleClient): Promise<MockSocket> {
    client.start();
    const sock = sockets[sockets.length - 1];
    sock.fire('connect');
    sock.fire('data', 'X02800C5FKLV (Roku Ultra - 15.2.4.3442)\r\n>');
    await clock.tickAsync(IDLE);
    expect(client.isReady).to.be.true;
    return sock;
  }

  beforeEach(() => { clock = sinon.useFakeTimers(); });
  afterEach(() => { clock.restore(); sinon.restore(); });

  it('becomes ready after the connect banner drains', async () => {
    const client = makeClient();
    await bringUp(client);
    client.close();
  });

  it('rejects send() before the connection is ready', async () => {
    const client = makeClient();
    client.start();
    sockets[0].fire('connect');
    // not yet drained
    let err: Error | undefined;
    await client.send('chanperf').catch((e) => { err = e; });
    expect(err).to.be.instanceOf(Error);
    client.close();
  });

  it('sends a command and resolves with the cleaned payload', async () => {
    const client = makeClient();
    const sock = await bringUp(client);

    const p = client.send('chanperf');
    expect(sock.writes).to.include('chanperf\r\n');

    sock.fire('data', 'channel: mem=52492KiB{anon=1},%cpu=0{user=0,sys=0}\n>');
    await clock.tickAsync(IDLE);

    const payload = await p;
    expect(payload).to.equal('channel: mem=52492KiB{anon=1},%cpu=0{user=0,sys=0}');
    client.close();
  });

  it('serializes concurrent commands one at a time', async () => {
    const client = makeClient();
    const sock = await bringUp(client);

    const p1 = client.send('chanperf');
    const p2 = client.send('free');

    // Only the first command is written until it completes.
    expect(sock.writes.filter((w) => w === 'free\r\n')).to.have.length(0);

    sock.fire('data', 'first\n>');
    await clock.tickAsync(IDLE);
    expect(await p1).to.equal('first');

    expect(sock.writes).to.include('free\r\n');
    sock.fire('data', 'second\n>');
    await clock.tickAsync(IDLE);
    expect(await p2).to.equal('second');
    client.close();
  });

  it('times out a command that never responds', async () => {
    const client = makeClient({ commandTimeoutMs: 1000 });
    const sock = await bringUp(client);

    const p = client.send('chanperf');
    let err: Error | undefined;
    p.catch((e) => { err = e; });

    await clock.tickAsync(1000);
    await Promise.resolve();
    expect(err).to.be.instanceOf(Error);
    expect(err!.message).to.match(/timed out/);
    void sock;
    client.close();
  });

  it('rejects the in-flight command and reconnects on socket close', async () => {
    const client = makeClient();
    const sock = await bringUp(client);

    const p = client.send('chanperf');
    let err: Error | undefined;
    p.catch((e) => { err = e; });

    sock.fire('close');
    await Promise.resolve();
    expect(err).to.be.instanceOf(Error);
    expect(client.isReady).to.be.false;

    // Backoff reconnect creates a fresh socket.
    await clock.tickAsync(500);
    expect(sockets.length).to.equal(2);

    sockets[1].fire('connect');
    sockets[1].fire('data', 'banner\r\n>');
    await clock.tickAsync(IDLE);
    expect(client.isReady).to.be.true;
    client.close();
  });

  it('stops reconnecting after close()', async () => {
    const client = makeClient();
    const sock = await bringUp(client);
    client.close();
    sock.fire('close');
    await clock.tickAsync(5000);
    // No new socket created after close().
    expect(sockets.length).to.equal(1);
  });
});

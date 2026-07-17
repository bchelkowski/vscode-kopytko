import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import {
  RaleTrackerClient,
  type RaleSocket,
} from '../../src/rale/raleTrackerClient';

interface MockSocket extends RaleSocket {
  writes: string[];
  destroyed: boolean;
  resetCalled: boolean;
  port: number;
  fire(event: string, ...args: unknown[]): void;
  /** Reply to the most recent request with a framed payload. */
  reply(payload: unknown): void;
  lastRequest(): { uuid: string; command: string; args: Record<string, unknown> };
}

function makeMockSocket(port: number): MockSocket {
  const emitter = new EventEmitter();
  const sock = Object.assign(emitter, {
    writes: [] as string[],
    destroyed: false,
    resetCalled: false,
    port,
    write(data: string) { sock.writes.push(data); },
    destroy() { sock.destroyed = true; },
    resetAndDestroy() { sock.resetCalled = true; sock.destroyed = true; },
    fire(event: string, ...args: unknown[]) { emitter.emit(event, ...args); },
    lastRequest() {
      const raw = sock.writes[sock.writes.length - 1];
      return JSON.parse(raw.slice('[start]'.length, -'[end]'.length));
    },
    reply(payload: unknown) {
      const { uuid } = sock.lastRequest();
      const json = JSON.stringify(payload);
      sock.fire('data', `[start][uuid:${uuid.length}]${uuid}${json}[end]`);
    },
  }) as unknown as MockSocket;
  return sock;
}

describe('RaleTrackerClient', () => {
  let clock: sinon.SinonFakeTimers;
  let sockets: MockSocket[];
  let sendInput: sinon.SinonStub;

  function makeClient(opts: Partial<{
    failConnects: number;   // how many sockets never fire 'connect'
    maxAttempts: number;
    reusePort: number;
  }> = {}) {
    sockets = [];
    sendInput = sinon.stub().resolves();
    let created = 0;
    const client = new RaleTrackerClient({
      host: '1.2.3.4',
      ecp: { sendInput },
      maxAttempts: opts.maxAttempts ?? 3,
      reusePort: opts.reusePort,
      connectTimeoutMs: 1000,
      requestTimeoutMs: 5000,
      pickPort: () => 50000 + created,
      socketFactory: (_host, port) => {
        const s = makeMockSocket(port);
        sockets.push(s);
        const failing = created < (opts.failConnects ?? 0);
        created++;
        if (!failing) queueMicrotask(() => s.fire('connect'));
        return s;
      },
    });
    return client;
  }

  /** Run connect() to the point where init has been sent, then reply. */
  async function bringUp(client: RaleTrackerClient): Promise<MockSocket> {
    const promise = client.connect();
    promise.catch(() => { /* inspected via await below */ });
    await clock.tickAsync(0);
    const sock = sockets[sockets.length - 1];
    sock.reply({ raleVersion: '3.2.0', sessionid: 's-1' });
    await promise;
    return sock;
  }

  beforeEach(() => { clock = sinon.useFakeTimers(); });
  afterEach(() => { clock.restore(); sinon.restore(); });

  it('activates via ECP input, connects, and inits', async () => {
    const client = makeClient();
    const promise = client.connect();
    await clock.tickAsync(0);

    expect(sendInput.calledOnce).to.be.true;
    const [ip, params] = sendInput.firstCall.args;
    expect(ip).to.equal('1.2.3.4');
    expect(params.rale).to.equal('true');
    expect(params.port).to.equal('50000');
    expect(sockets[0].port).to.equal(50000);

    const init = sockets[0].lastRequest();
    expect(init.command).to.equal('init');
    expect(init.args).to.deep.equal({ logVerbosity: -1 });

    sockets[0].reply({ raleVersion: '3.2.0', sessionid: 's-1' });
    const info = await promise;
    expect(info.raleVersion).to.equal('3.2.0');
    expect(client.connected).to.be.true;
    client.close();
  });

  it('reconnects directly to reusePort without ECP activation', async () => {
    // Newer TrackerTasks (3.4.0) never leave their serve loop: the original
    // port keeps listening and re-activation is ignored, so a remembered
    // port must be tried first — with no sendInput.
    const client = makeClient({ reusePort: 51230 });
    const promise = client.connect();
    await clock.tickAsync(0);

    expect(sendInput.called).to.be.false;
    expect(sockets[0].port).to.equal(51230);
    sockets[0].reply({ raleVersion: '3.4.0', sessionid: 's-r' });
    const info = await promise;
    expect(info.raleVersion).to.equal('3.4.0');
    expect(client.port).to.equal(51230);
    client.close();
  });

  it('falls back to activation when the reused port refuses', async () => {
    // Older TrackerTasks (3.2.0) exit their serve loop on connection error,
    // so the stale port refuses and a fresh activation is needed.
    const client = makeClient({ reusePort: 51230, failConnects: 1 });
    const promise = client.connect();
    promise.catch(() => { /* handled below */ });
    await clock.tickAsync(1000);  // reuse connect times out
    await clock.tickAsync(0);     // activation attempt connects

    expect(sendInput.calledOnce).to.be.true;
    expect(sendInput.firstCall.args[1].port).to.equal('50001');
    sockets[1].reply({ raleVersion: '3.2.0', sessionid: 's-f' });
    const info = await promise;
    expect(info.sessionid).to.equal('s-f');
    expect(client.port).to.equal(50001);
    client.close();
  });

  it('retries on a new port when the TCP connect times out', async () => {
    const client = makeClient({ failConnects: 1 });
    const promise = client.connect();
    promise.catch(() => { /* handled below */ });
    await clock.tickAsync(1000);  // first connect times out
    await clock.tickAsync(0);     // second attempt connects

    expect(sendInput.callCount).to.equal(2);
    expect(sendInput.secondCall.args[1].port).to.equal('50001');
    expect(sockets[0].destroyed).to.be.true;

    sockets[1].reply({ raleVersion: '3.2.0', sessionid: 's-2' });
    const info = await promise;
    expect(info.sessionid).to.equal('s-2');
    client.close();
  });

  it('fails with a user-meaningful error after all attempts', async () => {
    const client = makeClient({ failConnects: 3, maxAttempts: 3 });
    const promise = client.connect();
    let err: Error | undefined;
    promise.catch((e) => { err = e; });
    await clock.tickAsync(4000);
    expect(err).to.be.instanceOf(Error);
    expect(err!.message).to.match(/TrackerTask not responding/);
    expect(sendInput.callCount).to.equal(3);
  });

  it('correlates concurrent requests by uuid', async () => {
    const client = makeClient();
    const sock = await bringUp(client);

    const p1 = client.request<{ n: number }>('getNodeData', { path: [{ child: 0 }] });
    const p2 = client.request<{ n: number }>('getNodeData', { path: [{ child: 1 }] });

    const req1 = JSON.parse(sock.writes[1].slice('[start]'.length, -'[end]'.length));
    const req2 = JSON.parse(sock.writes[2].slice('[start]'.length, -'[end]'.length));

    // Answer in reverse order — resolution must follow uuid, not send order.
    sock.fire('data', `[start][uuid:${req2.uuid.length}]${req2.uuid}{"n":2}[end]`);
    sock.fire('data', `[start][uuid:${req1.uuid.length}]${req1.uuid}{"n":1}[end]`);

    expect((await p1).n).to.equal(1);
    expect((await p2).n).to.equal(2);
    client.close();
  });

  it('rejects a request when the payload carries a TrackerTask error', async () => {
    const client = makeClient();
    const sock = await bringUp(client);

    const promise = client.selectNode([{ child: 99 }]);
    let err: Error | undefined;
    promise.catch((e) => { err = e; });
    sock.reply({ error: { message: 'Invalid Path' } });
    await clock.tickAsync(0);
    expect(err!.message).to.equal('TrackerTask: Invalid Path');
    client.close();
  });

  it('times out a request that never gets a response', async () => {
    const client = makeClient();
    await bringUp(client);

    const promise = client.request('getNodeTree', { path: [], maxLevel: 50 });
    let err: Error | undefined;
    promise.catch((e) => { err = e; });
    await clock.tickAsync(5000);
    expect(err!.message).to.match(/timed out/);
    client.close();
  });

  it('setField omits type unless given and sends JSON-native values', async () => {
    const client = makeClient();
    const sock = await bringUp(client);

    const promise = client.setField('visible', false);
    const req = sock.lastRequest();
    expect(req.command).to.equal('setField');
    expect(req.args).to.deep.equal({ field: 'visible', value: false });
    sock.reply([]);
    await promise;

    const promise2 = client.setField('translation', [0, 10], 'array');
    const req2 = sock.lastRequest();
    expect(req2.args).to.deep.equal({ field: 'translation', value: [0, 10], type: 'array' });
    sock.reply([]);
    await promise2;
    client.close();
  });

  it('emits close and rejects in-flight requests when the socket drops', async () => {
    const client = makeClient();
    const sock = await bringUp(client);

    const closed = sinon.spy();
    client.on('close', closed);

    const promise = client.request('updateNode');
    let err: Error | undefined;
    promise.catch((e) => { err = e; });

    sock.fire('close');
    await clock.tickAsync(0);

    expect(err!.message).to.match(/closed/);
    expect(client.connected).to.be.false;
    expect(closed.calledOnce).to.be.true;
  });

  it('close() tears down silently without emitting close', async () => {
    const client = makeClient();
    const sock = await bringUp(client);
    const closed = sinon.spy();
    client.on('close', closed);

    client.close();
    sock.fire('close');
    expect(sock.destroyed).to.be.true;
    expect(closed.called).to.be.false;
    let err: Error | undefined;
    await client.request('init').catch((e) => { err = e; });
    expect(err).to.be.instanceOf(Error);
  });

  it('closes with TCP RST so the TrackerTask exits its serve loop', async () => {
    // The task's while-loop only exits on a socket *error* (`closed` is never
    // set in v3.2.0) — a graceful FIN leaves it stuck and unable to accept a
    // new Edit session until the app restarts.
    const client = makeClient();
    const sock = await bringUp(client);
    client.close();
    expect(sock.resetCalled).to.be.true;
  });

  it('sends getItemList with the path arg', async () => {
    const client = makeClient();
    const sock = await bringUp(client);
    const promise = client.getItemList([{ child: 1 }]);
    const req = sock.lastRequest();
    expect(req.command).to.equal('getItemList');
    expect(req.args).to.deep.equal({ path: [{ child: 1 }] });
    sock.reply({ item: { subtype: 'Group', type: 'roSGNode' }, childList: [] });
    const result = await promise;
    expect(result.item.subtype).to.equal('Group');
    client.close();
  });

  it('normalizes the lowercase "childlist" key the device actually sends', async () => {
    // BrightScript dot-notation assignment lowercases AA keys, so the
    // TrackerTask's `item.childList = …` serializes as "childlist".
    const client = makeClient();
    const sock = await bringUp(client);
    const promise = client.getItemList([]);
    sock.reply({
      item: { subtype: 'MainScene', type: 'roSGNode' },
      childlist: [{ item: { subtype: 'AppView', id: 'app', index: 1, type: 'roSGNode' } }],
    });
    const result = await promise;
    expect(result.childList).to.have.length(1);
    expect(result.childList![0].item.subtype).to.equal('AppView');
    expect(result.childList![0].item.index).to.equal(1);
    client.close();
  });
});

import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { BeaconLogClient, type LogSocket } from '../../src/client/diagnostics/transport/beaconLogClient';

interface MockSocket extends LogSocket {
  destroyed: boolean;
  fire(event: string, ...args: unknown[]): void;
}

function makeMockSocket(): MockSocket {
  const emitter = new EventEmitter();
  const sock = Object.assign(emitter, {
    destroyed: false,
    destroy() { sock.destroyed = true; },
    fire(event: string, ...args: unknown[]) { emitter.emit(event, ...args); },
  }) as unknown as MockSocket;
  return sock;
}

describe('BeaconLogClient', () => {
  let clock: sinon.SinonFakeTimers;
  let sockets: MockSocket[];

  function makeClient() {
    sockets = [];
    return new BeaconLogClient({
      host: '1.2.3.4',
      socketFactory: () => {
        const s = makeMockSocket();
        sockets.push(s);
        return s;
      },
    });
  }

  beforeEach(() => { clock = sinon.useFakeTimers(); });
  afterEach(() => { clock.restore(); sinon.restore(); });

  it('emits a line for each complete newline-terminated chunk', () => {
    const client = makeClient();
    const lines: string[] = [];
    client.on('line', (l: string) => lines.push(l));

    client.start();
    sockets[0].fire('connect');
    sockets[0].fire('data', 'first line\r\nsecond line\r\n');

    expect(lines).to.deep.equal(['first line', 'second line']);
    client.close();
  });

  it('emits "rejected" and disconnects when the device refuses a second consumer', () => {
    const client = makeClient();
    const lines: string[] = [];
    const rejections: string[] = [];
    client.on('line', (l: string) => lines.push(l));
    client.on('rejected', (l: string) => rejections.push(l));

    client.start();
    const sock = sockets[0];
    sock.fire('connect');
    sock.fire('data', 'Console connection is already in use.\r\n');

    expect(rejections).to.deep.equal(['Console connection is already in use.']);
    expect(lines).to.have.length(0); // never treated as a real log line
    expect(sock.destroyed).to.be.true;
    client.close();
  });

  it('retries with backoff after a rejection, same as any other disconnect', async () => {
    const client = makeClient();
    client.start();
    sockets[0].fire('connect');
    sockets[0].fire('data', 'Console connection is already in use.\r\n');
    sockets[0].fire('close'); // real net.Socket emits close after destroy()

    await clock.tickAsync(500);
    expect(sockets.length).to.equal(2); // reconnect attempt scheduled and fired
    client.close();
  });

  it('close() stops further line/rejected events', () => {
    const client = makeClient();
    const lines: string[] = [];
    client.on('line', (l: string) => lines.push(l));

    client.start();
    const sock = sockets[0];
    sock.fire('connect');
    client.close();
    sock.fire('data', 'a line that arrives after close\r\n');

    expect(lines).to.have.length(0);
  });
});

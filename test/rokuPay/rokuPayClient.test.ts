import { expect } from 'chai';
import * as sinon from 'sinon';
import { RokuPayClient } from '../../src/client/rokuPay/rokuPayClient';

function fakeResponse(options: {
  status?: number;
  statusText?: string;
  body?: string;
  headers?: Record<string, string>;
} = {}): unknown {
  const headers = options.headers ?? { 'content-type': 'application/json' };
  return {
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    text: async () => options.body ?? '{}',
    headers: {
      forEach: (cb: (value: string, key: string) => void) => {
        for (const [key, value] of Object.entries(headers)) cb(value, key);
      },
    },
  };
}

describe('RokuPayClient', () => {
  it('passes method, url, headers, and body to fetch', async () => {
    const fetchFn = sinon.stub().resolves(fakeResponse());
    const client = new RokuPayClient(fetchFn as unknown as typeof fetch);

    await client.execute({
      method: 'POST',
      url: 'https://apipub.roku.com/listen/transaction-service.svc/cancel-subscription',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"transactionId":"tx-1"}',
    });

    const [url, init] = fetchFn.firstCall.args;
    expect(url).to.equal('https://apipub.roku.com/listen/transaction-service.svc/cancel-subscription');
    expect(init.method).to.equal('POST');
    expect(init.headers).to.deep.equal({ accept: 'application/json', 'content-type': 'application/json' });
    expect(init.body).to.equal('{"transactionId":"tx-1"}');
    expect(init.signal).to.be.instanceOf(AbortSignal);
  });

  it('sends no body for GET requests', async () => {
    const fetchFn = sinon.stub().resolves(fakeResponse());
    const client = new RokuPayClient(fetchFn as unknown as typeof fetch);

    await client.execute({ method: 'GET', url: 'https://example.com', headers: { accept: 'application/json' } });

    expect(fetchFn.firstCall.args[1].body).to.equal(undefined);
  });

  it('collects status, statusText, headers, body, and duration', async () => {
    const fetchFn = sinon.stub().resolves(fakeResponse({
      status: 404,
      statusText: 'Not Found',
      body: '{"error":"no such transaction"}',
      headers: { 'content-type': 'application/json', 'x-request-id': 'abc' },
    }));
    const client = new RokuPayClient(fetchFn as unknown as typeof fetch);

    const response = await client.execute({ method: 'GET', url: 'https://example.com', headers: {} });

    expect(response.status).to.equal(404);
    expect(response.statusText).to.equal('Not Found');
    expect(response.body).to.equal('{"error":"no such transaction"}');
    expect(response.headers).to.deep.equal({ 'content-type': 'application/json', 'x-request-id': 'abc' });
    expect(response.durationMs).to.be.a('number').and.at.least(0);
  });

  it('propagates network failures as rejections', async () => {
    const fetchFn = sinon.stub().rejects(new Error('getaddrinfo ENOTFOUND apipub.roku.com'));
    const client = new RokuPayClient(fetchFn as unknown as typeof fetch);

    try {
      await client.execute({ method: 'GET', url: 'https://apipub.roku.com/x', headers: {} });
      expect.fail('expected rejection');
    } catch (err) {
      expect((err as Error).message).to.include('ENOTFOUND');
    }
  });
});

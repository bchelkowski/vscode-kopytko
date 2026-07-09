import '../roku/vscode-mock';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import {
  MAX_BODY_LENGTH,
  MAX_LOG_ENTRIES,
  RokuPayLogStore,
} from '../../src/client/rokuPay/rokuPayLogStore';
import type { PayLogEntry } from '../../src/client/rokuPay/webview/protocol';
import { MockMemento } from '../deviceManager/memento-mock';

function entry(overrides: Partial<PayLogEntry> = {}): Omit<PayLogEntry, 'id'> {
  return {
    timestamp: Date.now(),
    endpointId: 'validate-transaction',
    endpointLabel: 'Validate Transaction',
    profileName: 'Prod',
    method: 'GET',
    url: 'https://apipub.roku.com/listen/transaction-service.svc/validate-transaction/****/tx-1',
    accept: 'json',
    status: 200,
    statusText: 'OK',
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"isEntitled":true}',
    durationMs: 120,
    ...overrides,
  };
}

describe('RokuPayLogStore', () => {
  let memento: MockMemento;
  let store: RokuPayLogStore;

  beforeEach(() => {
    memento = new MockMemento();
    store = new RokuPayLogStore(memento as unknown as vscode.Memento);
  });

  it('stores entries and returns them newest first', async () => {
    await store.add(entry({ timestamp: 1000, endpointId: 'old' }));
    await store.add(entry({ timestamp: 3000, endpointId: 'newest' }));
    await store.add(entry({ timestamp: 2000, endpointId: 'middle' }));

    expect(store.getAll().map((e) => e.endpointId)).to.deep.equal(['newest', 'middle', 'old']);
  });

  it('assigns a unique id per entry', async () => {
    const a = await store.add(entry());
    const b = await store.add(entry());
    expect(a.id).to.not.equal(b.id);
  });

  it('deletes a single entry', async () => {
    const a = await store.add(entry({ timestamp: 1 }));
    await store.add(entry({ timestamp: 2 }));

    await store.delete(a.id);

    expect(store.getAll()).to.have.length(1);
    expect(store.getAll()[0].id).to.not.equal(a.id);
  });

  it('clear removes everything', async () => {
    await store.add(entry());
    await store.add(entry());

    await store.clear();

    expect(store.getAll()).to.have.length(0);
  });

  it(`caps the log at ${MAX_LOG_ENTRIES} entries, trimming the oldest`, async () => {
    for (let i = 0; i < MAX_LOG_ENTRIES + 1; i++) {
      await store.add(entry({ timestamp: i, endpointId: `e-${i}` }));
    }

    const all = store.getAll();
    expect(all).to.have.length(MAX_LOG_ENTRIES);
    expect(all.some((e) => e.endpointId === 'e-0')).to.equal(false);
    expect(all[0].endpointId).to.equal(`e-${MAX_LOG_ENTRIES}`);
  });

  it('truncates oversized response bodies before persisting', async () => {
    const stored = await store.add(entry({ responseBody: 'x'.repeat(MAX_BODY_LENGTH + 100) }));

    expect(stored.responseBody).to.have.length.below(MAX_BODY_LENGTH + 50);
    expect(stored.responseBody!.endsWith('… [truncated]')).to.equal(true);
    const persisted = store.getAll()[0];
    expect(persisted.responseBody!.endsWith('… [truncated]')).to.equal(true);
  });

  it('fires onDidChange on add, delete, and clear', async () => {
    let fired = 0;
    store.onDidChange(() => { fired++; });

    const a = await store.add(entry());
    await store.delete(a.id);
    await store.clear();

    expect(fired).to.equal(3);
  });

  it('round-trips the ui state and defaults to an empty object', async () => {
    expect(store.getUiState()).to.deep.equal({});

    await store.setUiState({ lastTransactionId: 'tx-9', lastProfileId: 'p1', lastEndpointId: 'recover' });

    expect(store.getUiState()).to.deep.equal({
      lastTransactionId: 'tx-9', lastProfileId: 'p1', lastEndpointId: 'recover',
    });
  });
});

import '../roku/vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import type * as vscode from 'vscode';
import type { PayHttpResponse, RokuPayClient } from '../../src/client/rokuPay/rokuPayClient';
import { maskSecret, RokuPayController } from '../../src/client/rokuPay/rokuPayController';
import { RokuPayLogStore } from '../../src/client/rokuPay/rokuPayLogStore';
import { RokuPayProfileStore } from '../../src/client/rokuPay/rokuPayProfileStore';
import { MockMemento, MockSecretStorage } from '../deviceManager/memento-mock';

const API_KEY = 'AA11bb22-key/with+special';

function okResponse(overrides: Partial<PayHttpResponse> = {}): PayHttpResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"isEntitled":true}',
    durationMs: 42,
    ...overrides,
  };
}

describe('maskSecret', () => {
  it('masks raw and URL-encoded occurrences', () => {
    const url = `https://x/validate/${encodeURIComponent(API_KEY)}/tx-1?k=${API_KEY}`;
    const masked = maskSecret(url, API_KEY);
    expect(masked).to.not.include(API_KEY);
    expect(masked).to.not.include(encodeURIComponent(API_KEY));
    expect(masked).to.equal('https://x/validate/****/tx-1?k=****');
  });

  it('returns the text unchanged for an empty secret', () => {
    expect(maskSecret('abc', '')).to.equal('abc');
  });
});

describe('RokuPayController', () => {
  let memento: MockMemento;
  let secrets: MockSecretStorage;
  let profiles: RokuPayProfileStore;
  let log: RokuPayLogStore;
  let execute: sinon.SinonStub;
  let controller: RokuPayController;
  let profileId: string;

  beforeEach(async () => {
    memento = new MockMemento();
    secrets = new MockSecretStorage();
    profiles = new RokuPayProfileStore(
      memento as unknown as vscode.Memento,
      secrets as unknown as vscode.SecretStorage,
    );
    log = new RokuPayLogStore(memento as unknown as vscode.Memento);
    execute = sinon.stub().resolves(okResponse());
    controller = new RokuPayController({
      profiles,
      log,
      client: { execute } as unknown as RokuPayClient,
    });
    profileId = (await profiles.save({
      name: 'Prod', partnerReferenceId: 'ref-42', partnerAPIKey: API_KEY,
    })).id;
  });

  it('builds a GET URL from the template with encoded path values', async () => {
    await controller.send(profileId, 'validate-transaction', { transactionId: 'tx 1/x' }, 'json');

    const request = execute.firstCall.args[0];
    expect(request.method).to.equal('GET');
    expect(request.url).to.equal(
      `https://apipub.roku.com/listen/transaction-service.svc/validate-transaction/${encodeURIComponent(API_KEY)}/tx%201%2Fx`,
    );
    expect(request.body).to.equal(undefined);
    expect(request.headers).to.deep.equal({ accept: 'application/json' });
  });

  it('builds a JSON body for POST endpoints, injecting the key and omitting empty optionals', async () => {
    await controller.send(profileId, 'cancel-subscription', {
      transactionId: 'tx-1',
      cancellationDate: '',
      dontNotifyUser: false,
      partnerReferenceId: 'ref-42',
    }, 'json');

    const request = execute.firstCall.args[0];
    expect(request.headers['content-type']).to.equal('application/json');
    expect(JSON.parse(request.body)).to.deep.equal({
      partnerAPIKey: API_KEY,
      transactionId: 'tx-1',
      partnerReferenceId: 'ref-42',
    });
  });

  it('coerces number fields and includes checked booleans', async () => {
    await controller.send(profileId, 'refund-subscription', {
      transactionId: 'tx-1', amount: '9.99',
    }, 'json');
    expect(JSON.parse(execute.firstCall.args[0].body).amount).to.equal(9.99);

    await controller.send(profileId, 'cancel-subscription', {
      transactionId: 'tx-1', dontNotifyUser: true,
    }, 'json');
    expect(JSON.parse(execute.secondCall.args[0].body).dontNotifyUser).to.equal(true);
  });

  it('sends recovery-test requests as empty-body POSTs without content-type', async () => {
    await controller.send(profileId, 'grace-period-state', { transactionId: 'tx-1' }, 'json');

    const request = execute.firstCall.args[0];
    expect(request.method).to.equal('POST');
    expect(request.url).to.equal(
      `https://apipub.roku.com/test/subscription-recovery/grace-period-state/${encodeURIComponent(API_KEY)}/tx-1`,
    );
    expect(request.body).to.equal(undefined);
    expect(request.headers).to.deep.equal({ accept: 'application/json' });
  });

  it('requests XML when asked', async () => {
    await controller.send(profileId, 'validate-transaction', { transactionId: 'tx-1' }, 'xml');
    expect(execute.firstCall.args[0].headers.accept).to.equal('application/xml');
  });

  it('rejects when a required field is missing, without sending', async () => {
    try {
      await controller.send(profileId, 'refund-subscription', { transactionId: 'tx-1' }, 'json');
      expect.fail('expected rejection');
    } catch (err) {
      expect((err as Error).message).to.equal('Amount is required.');
    }
    expect(execute.called).to.equal(false);
    expect(log.getAll()).to.have.length(0);
  });

  it('rejects a non-numeric amount', async () => {
    try {
      await controller.send(profileId, 'refund-subscription', { transactionId: 'tx-1', amount: 'lots' }, 'json');
      expect.fail('expected rejection');
    } catch (err) {
      expect((err as Error).message).to.equal('Amount must be a number.');
    }
  });

  it('rejects when the profile has no API key', async () => {
    const keyless = await profiles.save({ name: 'Empty', partnerReferenceId: '' });
    try {
      await controller.send(keyless.id, 'validate-transaction', { transactionId: 'tx-1' }, 'json');
      expect.fail('expected rejection');
    } catch (err) {
      expect((err as Error).message).to.include('no Partner API Key');
    }
    expect(execute.called).to.equal(false);
  });

  it('rejects unknown endpoints and unknown profiles', async () => {
    try {
      await controller.send(profileId, 'nope', {}, 'json');
      expect.fail('expected rejection');
    } catch (err) {
      expect((err as Error).message).to.include('Unknown endpoint');
    }
    try {
      await controller.send('ghost', 'validate-transaction', { transactionId: 't' }, 'json');
      expect.fail('expected rejection');
    } catch (err) {
      expect((err as Error).message).to.include('profile');
    }
  });

  it('logs a masked entry — the key appears nowhere in the stored log', async () => {
    const entry = await controller.send(profileId, 'cancel-subscription', {
      transactionId: 'tx-1', partnerReferenceId: 'ref-42',
    }, 'json');

    const serialized = JSON.stringify(entry);
    expect(serialized).to.not.include(API_KEY);
    expect(serialized).to.not.include(encodeURIComponent(API_KEY));
    expect(entry.requestBody).to.include('"partnerAPIKey":"****"');
    expect(entry.status).to.equal(200);
    expect(entry.responseBody).to.equal('{"isEntitled":true}');
    expect(entry.profileName).to.equal('Prod');

    const persisted = JSON.stringify(memento.raw('kopytko.rokuPay.log'));
    expect(persisted).to.not.include(API_KEY);
    expect(persisted).to.not.include(encodeURIComponent(API_KEY));
  });

  it('masks the URL in GET log entries', async () => {
    const entry = await controller.send(profileId, 'validate-transaction', { transactionId: 'tx-1' }, 'json');
    expect(entry.url).to.equal(
      'https://apipub.roku.com/listen/transaction-service.svc/validate-transaction/****/tx-1',
    );
  });

  it('logs network failures as masked error entries', async () => {
    execute.rejects(new Error(`request to https://x/${encodeURIComponent(API_KEY)}/tx failed: timeout`));

    const entry = await controller.send(profileId, 'validate-transaction', { transactionId: 'tx' }, 'json');

    expect(entry.status).to.equal(undefined);
    expect(entry.error).to.include('timeout');
    expect(entry.error).to.not.include(encodeURIComponent(API_KEY));
    expect(log.getAll()).to.have.length(1);
  });

  it('remembers the last profile, endpoint, and transaction id', async () => {
    await controller.send(profileId, 'validate-transaction', { transactionId: 'tx-9' }, 'json');

    expect(controller.getUiState()).to.deep.equal({
      lastProfileId: profileId,
      lastEndpointId: 'validate-transaction',
      lastTransactionId: 'tx-9',
    });

    // A send without a transaction id keeps the remembered one.
    await controller.send(profileId, 'validate-refund', { refundId: 'rf-1' }, 'json');
    expect(controller.getUiState().lastTransactionId).to.equal('tx-9');
  });

  it('rejects saving a profile without a name', async () => {
    try {
      await controller.saveProfile({ name: '  ', partnerReferenceId: '' });
      expect.fail('expected rejection');
    } catch (err) {
      expect((err as Error).message).to.include('name');
    }
  });
});

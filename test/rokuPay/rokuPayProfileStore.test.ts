import '../roku/vscode-mock';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import { RokuPayProfileStore } from '../../src/client/rokuPay/rokuPayProfileStore';
import { MockMemento, MockSecretStorage } from '../deviceManager/memento-mock';

const STORE_KEY = 'kopytko.rokuPay.profiles';

describe('RokuPayProfileStore', () => {
  let memento: MockMemento;
  let secrets: MockSecretStorage;
  let store: RokuPayProfileStore;

  beforeEach(() => {
    memento = new MockMemento();
    secrets = new MockSecretStorage();
    store = new RokuPayProfileStore(
      memento as unknown as vscode.Memento,
      secrets as unknown as vscode.SecretStorage,
    );
  });

  it('creates a profile with the API key in SecretStorage, never in the Memento', async () => {
    const profile = await store.save({ name: 'Prod', partnerReferenceId: 'ref-1', partnerAPIKey: 'sk-secret-key' });

    const persisted = JSON.stringify(memento.raw(STORE_KEY));
    expect(persisted).to.not.include('sk-secret-key');
    expect(persisted).to.include('ref-1');
    expect(await store.getApiKey(profile.id)).to.equal('sk-secret-key');
    expect(secrets.secrets.get(`kopytko.rokuPay.apiKey.${profile.id}`)).to.equal('sk-secret-key');
    expect(profile.hasApiKey).to.equal(true);
  });

  it('reports hasApiKey=false when created without a key', async () => {
    const profile = await store.save({ name: 'Empty', partnerReferenceId: '' });

    expect(profile.hasApiKey).to.equal(false);
    expect(await store.getApiKey(profile.id)).to.equal(undefined);
  });

  it('keeps the existing key when editing with a blank key', async () => {
    const profile = await store.save({ name: 'Prod', partnerReferenceId: 'r', partnerAPIKey: 'original' });

    const updated = await store.save({ id: profile.id, name: 'Renamed', partnerReferenceId: 'r2', partnerAPIKey: '' });

    expect(await store.getApiKey(profile.id)).to.equal('original');
    expect(updated.hasApiKey).to.equal(true);
    expect(updated.name).to.equal('Renamed');
    expect(updated.partnerReferenceId).to.equal('r2');
  });

  it('replaces the key when editing with a new one', async () => {
    const profile = await store.save({ name: 'Prod', partnerReferenceId: 'r', partnerAPIKey: 'old' });

    await store.save({ id: profile.id, name: 'Prod', partnerReferenceId: 'r', partnerAPIKey: 'new' });

    expect(await store.getApiKey(profile.id)).to.equal('new');
  });

  it('preserves createdAt and bumps updatedAt on upsert', async () => {
    const profile = await store.save({ name: 'P', partnerReferenceId: '' });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await store.save({ id: profile.id, name: 'P', partnerReferenceId: '' });

    expect(updated.createdAt).to.equal(profile.createdAt);
    expect(updated.updatedAt).to.be.greaterThan(profile.createdAt);
  });

  it('deletes a profile along with its secret', async () => {
    const profile = await store.save({ name: 'P', partnerReferenceId: '', partnerAPIKey: 'k' });

    await store.delete(profile.id);

    expect(store.getAll()).to.have.length(0);
    expect(secrets.secrets.size).to.equal(0);
  });

  it('delete is a no-op for an unknown id', async () => {
    await store.save({ name: 'Keep', partnerReferenceId: '' });
    await store.delete('nope');
    expect(store.getAll()).to.have.length(1);
  });

  it('sorts profiles by name, case-insensitively', async () => {
    await store.save({ name: 'zeta', partnerReferenceId: '' });
    await store.save({ name: 'Alpha', partnerReferenceId: '' });
    await store.save({ name: 'beta', partnerReferenceId: '' });

    expect(store.getAll().map((p) => p.name)).to.deep.equal(['Alpha', 'beta', 'zeta']);
  });

  it('getViews exposes no secret material', async () => {
    await store.save({ name: 'P', partnerReferenceId: 'ref', partnerAPIKey: 'super-secret' });

    const views = store.getViews();
    expect(views).to.have.length(1);
    expect(JSON.stringify(views)).to.not.include('super-secret');
    expect(views[0]).to.include({ name: 'P', partnerReferenceId: 'ref', hasApiKey: true });
  });

  it('fires onDidChange on save and delete', async () => {
    let fired = 0;
    store.onDidChange(() => { fired++; });

    const profile = await store.save({ name: 'P', partnerReferenceId: '' });
    await store.delete(profile.id);

    expect(fired).to.equal(2);
  });
});

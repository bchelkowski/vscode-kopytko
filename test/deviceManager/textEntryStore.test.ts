import '../roku/vscode-mock';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import { TextEntryStore } from '../../src/client/deviceManager/textEntryStore';
import { MockMemento, MockSecretStorage } from './memento-mock';

const STORE_KEY = 'kopytko.deviceManager.textEntries';

describe('TextEntryStore', () => {
  let memento: MockMemento;
  let secrets: MockSecretStorage;
  let store: TextEntryStore;

  beforeEach(() => {
    memento = new MockMemento();
    secrets = new MockSecretStorage();
    store = new TextEntryStore(
      memento as unknown as vscode.Memento,
      secrets as unknown as vscode.SecretStorage,
    );
  });

  it('creates a text entry with a generated id and timestamps', async () => {
    const entry = await store.save({ type: 'text', title: 'Search', text: 'developer' });

    expect(entry.id).to.be.a('string').and.not.empty;
    expect(entry.createdAt).to.be.a('number');
    expect(entry.updatedAt).to.equal(entry.createdAt);
    expect(store.getAll()).to.have.length(1);
    expect(store.get(entry.id)).to.deep.include({ type: 'text', text: 'developer', title: 'Search' });
  });

  it('creates a credentials entry with the password in SecretStorage, never in the Memento', async () => {
    const entry = await store.save({ type: 'credentials', login: 'user@example.com', password: 'hunter2' });

    const persisted = JSON.stringify(memento.raw(STORE_KEY));
    expect(persisted).to.not.include('hunter2');
    expect(persisted).to.include('user@example.com');
    expect(await store.getPassword(entry.id)).to.equal('hunter2');
    expect(secrets.secrets.get(`kopytko.deviceManager.entry.${entry.id}`)).to.equal('hunter2');
  });

  it('keeps the existing password when editing with a blank password', async () => {
    const entry = await store.save({ type: 'credentials', login: 'a@b.c', password: 'original' });

    await store.save({ id: entry.id, type: 'credentials', login: 'renamed@b.c', password: '' });

    expect(await store.getPassword(entry.id)).to.equal('original');
    const updated = store.get(entry.id);
    expect(updated).to.deep.include({ type: 'credentials', login: 'renamed@b.c' });
  });

  it('replaces the password when editing with a new one', async () => {
    const entry = await store.save({ type: 'credentials', login: 'a@b.c', password: 'old' });

    await store.save({ id: entry.id, type: 'credentials', login: 'a@b.c', password: 'new' });

    expect(await store.getPassword(entry.id)).to.equal('new');
  });

  it('preserves createdAt and bumps updatedAt on upsert', async () => {
    const entry = await store.save({ type: 'text', text: 'one' });
    const created = entry.createdAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await store.save({ id: entry.id, type: 'text', text: 'two' });

    expect(updated.createdAt).to.equal(created);
    expect(updated.updatedAt).to.be.greaterThan(created);
  });

  it('deletes an entry along with its secret', async () => {
    const entry = await store.save({ type: 'credentials', login: 'a@b.c', password: 'p' });

    await store.delete(entry.id);

    expect(store.getAll()).to.have.length(0);
    expect(secrets.secrets.size).to.equal(0);
  });

  it('deletes the secret when an entry switches type from credentials to text', async () => {
    const entry = await store.save({ type: 'credentials', login: 'a@b.c', password: 'p' });

    await store.save({ id: entry.id, type: 'text', text: 'plain now' });

    expect(secrets.secrets.size).to.equal(0);
    expect(store.get(entry.id)).to.deep.include({ type: 'text', text: 'plain now' });
  });

  it('delete is a no-op for an unknown id', async () => {
    await store.save({ type: 'text', text: 'keep me' });
    await store.delete('nope');
    expect(store.getAll()).to.have.length(1);
  });

  it('sorts entries by title (falling back to value/login), case-insensitively', async () => {
    await store.save({ type: 'text', text: 'zebra' });
    await store.save({ type: 'credentials', title: 'Alpha', login: 'x@y.z' });
    await store.save({ type: 'text', title: 'beta', text: 'irrelevant' });

    expect(store.getAll().map((e) => e.title ?? (e.type === 'text' ? e.text : e.login)))
      .to.deep.equal(['Alpha', 'beta', 'zebra']);
  });
});

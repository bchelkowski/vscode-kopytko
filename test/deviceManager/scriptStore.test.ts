import '../roku/vscode-mock';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import { ScriptStore } from '../../src/client/deviceManager/scriptStore';
import { MockMemento } from './memento-mock';

describe('ScriptStore', () => {
  let memento: MockMemento;
  let store: ScriptStore;

  beforeEach(() => {
    memento = new MockMemento();
    store = new ScriptStore(memento as unknown as vscode.Memento);
  });

  it('creates a script with a generated id and preserves the raw source verbatim', async () => {
    const source = 'params:\n    rasp_version: 1\n# a comment\nsteps:\n    - step: &blk\n        - press: up\n    - *blk\n';
    const script = await store.save({ title: 'My script', format: 'rasp', source });

    expect(script.id).to.be.a('string').and.not.empty;
    expect(store.get(script.id)?.source).to.equal(source);
    expect(store.get(script.id)?.format).to.equal('rasp');
  });

  it('preserves createdAt and bumps updatedAt on upsert', async () => {
    const script = await store.save({ title: 'a', format: 'rasp', source: 'steps: []' });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await store.save({ id: script.id, title: 'a2', format: 'rasp', source: 'steps: []' });

    expect(updated.id).to.equal(script.id);
    expect(updated.createdAt).to.equal(script.createdAt);
    expect(updated.updatedAt).to.be.greaterThan(script.createdAt);
    expect(store.getAll()).to.have.length(1);
  });

  it('deletes by id and ignores unknown ids', async () => {
    const script = await store.save({ title: 'a', format: 'rasp', source: '' });
    await store.delete('unknown');
    expect(store.getAll()).to.have.length(1);
    await store.delete(script.id);
    expect(store.getAll()).to.have.length(0);
  });

  it('normalizes labels on save: trims, drops empty, dedupes case-insensitively', async () => {
    const script = await store.save({ title: 'a', format: 'rasp', source: '', labels: [' Bug ', 'bug', '', 'Feature'] });

    expect(script.labels).to.deep.equal(['Bug', 'Feature']);
  });

  it('defaults to an empty labels array when omitted', async () => {
    const script = await store.save({ title: 'a', format: 'rasp', source: '' });

    expect(script.labels).to.deep.equal([]);
  });

  it('preserves labels on edit when not resent, replaces when resent', async () => {
    const script = await store.save({ title: 'a', format: 'rasp', source: '', labels: ['Keep'] });

    const unchanged = await store.save({ id: script.id, title: 'a2', format: 'rasp', source: '' });
    expect(unchanged.labels).to.deep.equal(['Keep']);

    const replaced = await store.save({ id: script.id, title: 'a3', format: 'rasp', source: '', labels: ['New'] });
    expect(replaced.labels).to.deep.equal(['New']);
  });

  it('backfills labels to [] for scripts persisted before custom labels existed', async () => {
    await memento.update('kopytko.deviceManager.scripts', {
      legacy: { id: 'legacy', title: 'old script', format: 'rasp', source: '', createdAt: 1, updatedAt: 1 },
    });

    expect(store.getAll()[0].labels).to.deep.equal([]);
    expect(store.get('legacy')?.labels).to.deep.equal([]);
  });

  it('sorts scripts by title, case-insensitively', async () => {
    await store.save({ title: 'zeta', format: 'rasp', source: '' });
    await store.save({ title: 'Alpha', format: 'rasp', source: '' });
    await store.save({ title: 'beta', format: 'rasp', source: '' });

    expect(store.getAll().map((s) => s.title)).to.deep.equal(['Alpha', 'beta', 'zeta']);
  });

  it('fires onDidChange on save and delete', async () => {
    let fired = 0;
    store.onDidChange(() => { fired++; });

    const script = await store.save({ title: 'a', format: 'rasp', source: '' });
    await store.delete(script.id);

    expect(fired).to.equal(2);
  });
});

import '../roku/vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { ParameterSetStore } from '../../src/client/deepLinking/parameterSetStore';

interface MockMemento {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

function createMockMemento(): MockMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) as T : defaultValue) as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
    keys: () => [...store.keys()],
  };
}

const BASE_INPUT = {
  name: 'Movie preset',
  channelId: '12',
  channelName: 'Netflix',
  contentId: 'movie-123',
  params: [{ key: 'mediaType', value: 'movie' }],
};

describe('ParameterSetStore', () => {
  let memento: MockMemento;
  let store: ParameterSetStore;

  beforeEach(() => {
    memento = createMockMemento();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new ParameterSetStore(memento as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('returns an empty list when nothing is saved', () => {
    expect(store.getAll()).to.deep.equal([]);
  });

  it('creates a set with generated id and timestamps', async () => {
    const before = Date.now();
    const saved = await store.save({ ...BASE_INPUT });

    expect(saved.id).to.be.a('string').and.not.empty;
    expect(saved.createdAt).to.be.at.least(before);
    expect(saved.updatedAt).to.equal(saved.createdAt);
    expect(store.get(saved.id)).to.deep.equal(saved);
  });

  it('upserts an existing id, preserving createdAt and bumping updatedAt', async () => {
    const clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
    const created = await store.save({ ...BASE_INPUT });

    clock.tick(5_000);
    const updated = await store.save({ ...BASE_INPUT, id: created.id, name: 'Renamed' });

    expect(updated.id).to.equal(created.id);
    expect(updated.createdAt).to.equal(created.createdAt);
    expect(updated.updatedAt).to.equal(created.updatedAt + 5_000);
    expect(store.getAll()).to.have.length(1);
    expect(store.get(created.id)?.name).to.equal('Renamed');
  });

  it('normalizes labels on save: trims, drops empty, dedupes case-insensitively', async () => {
    const saved = await store.save({ ...BASE_INPUT, labels: [' Bug ', 'bug', '', 'Feature'] });

    expect(saved.labels).to.deep.equal(['Bug', 'Feature']);
  });

  it('defaults to an empty labels array when omitted', async () => {
    const saved = await store.save({ ...BASE_INPUT });

    expect(saved.labels).to.deep.equal([]);
  });

  it('preserves labels on edit when not resent, replaces when resent', async () => {
    const created = await store.save({ ...BASE_INPUT, labels: ['Keep'] });

    const unchanged = await store.save({ ...BASE_INPUT, id: created.id, name: 'renamed' });
    expect(unchanged.labels).to.deep.equal(['Keep']);

    const replaced = await store.save({ ...BASE_INPUT, id: created.id, labels: ['New'] });
    expect(replaced.labels).to.deep.equal(['New']);
  });

  it('backfills labels to [] for sets persisted before custom labels existed', async () => {
    await memento.update('kopytko.deepLinking.sets', {
      legacy: { id: 'legacy', ...BASE_INPUT, createdAt: 1, updatedAt: 1 },
    });

    expect(store.getAll()[0].labels).to.deep.equal([]);
    expect(store.get('legacy')?.labels).to.deep.equal([]);
  });

  it('sorts getAll by name case-insensitively', async () => {
    await store.save({ ...BASE_INPUT, name: 'zebra' });
    await store.save({ ...BASE_INPUT, name: 'Apple' });
    await store.save({ ...BASE_INPUT, name: 'mango' });

    expect(store.getAll().map((s) => s.name)).to.deep.equal(['Apple', 'mango', 'zebra']);
  });

  it('deletes a set by id', async () => {
    const saved = await store.save({ ...BASE_INPUT });
    await store.delete(saved.id);

    expect(store.get(saved.id)).to.be.undefined;
    expect(store.getAll()).to.deep.equal([]);
  });

  it('delete is a no-op for an unknown id', async () => {
    const saved = await store.save({ ...BASE_INPUT });
    await store.delete('does-not-exist');

    expect(store.getAll()).to.have.length(1);
    expect(store.get(saved.id)).to.exist;
  });

  it('returns undefined from get for an unknown id', () => {
    expect(store.get('nope')).to.be.undefined;
  });
});

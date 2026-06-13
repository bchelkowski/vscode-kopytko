import '../vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'events';
import { CredentialStore } from '../../../src/client/roku/persistence/credentialStore';

interface MockSecretStorage {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  onDidChange: (...args: unknown[]) => unknown;
}

function createMockSecretStorage(): MockSecretStorage {
  const store = new Map<string, string>();
  const emitter = new EventEmitter();
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    onDidChange: emitter.on.bind(emitter, 'change'),
  };
}

describe('CredentialStore', () => {
  let secrets: MockSecretStorage;
  let credStore: CredentialStore;

  beforeEach(() => {
    secrets = createMockSecretStorage();
    credStore = new CredentialStore(secrets as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  // ---------------------------------------------------------------------------
  // getPassword / setPassword
  // ---------------------------------------------------------------------------

  describe('getPassword / setPassword', () => {
    it('returns undefined for unknown device ID', async () => {
      const password = await credStore.getPassword('UNKNOWN');
      expect(password).to.be.undefined;
    });

    it('stores and retrieves a password', async () => {
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'secret123');

      const password = await credStore.getPassword('AA:BB:CC:DD:EE:01');
      expect(password).to.equal('secret123');
    });

    it('updates an existing password', async () => {
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'oldpass');
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'newpass');

      const password = await credStore.getPassword('AA:BB:CC:DD:EE:01');
      expect(password).to.equal('newpass');
    });
  });

  // ---------------------------------------------------------------------------
  // deletePassword
  // ---------------------------------------------------------------------------

  describe('deletePassword', () => {
    it('removes a stored password', async () => {
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'secret123');
      await credStore.deletePassword('AA:BB:CC:DD:EE:01');

      const password = await credStore.getPassword('AA:BB:CC:DD:EE:01');
      expect(password).to.be.undefined;
    });

    it('does not throw for non-existent device ID', async () => {
      await credStore.deletePassword('NONEXISTENT');
      // No error thrown
    });
  });

  // ---------------------------------------------------------------------------
  // hasPassword
  // ---------------------------------------------------------------------------

  describe('hasPassword', () => {
    it('returns false when no password stored', async () => {
      const has = await credStore.hasPassword('AA:BB:CC:DD:EE:01');
      expect(has).to.be.false;
    });

    it('returns true when password exists', async () => {
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'secret');

      const has = await credStore.hasPassword('AA:BB:CC:DD:EE:01');
      expect(has).to.be.true;
    });

    it('returns false after password is deleted', async () => {
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'secret');
      await credStore.deletePassword('AA:BB:CC:DD:EE:01');

      const has = await credStore.hasPassword('AA:BB:CC:DD:EE:01');
      expect(has).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // Namespacing by device ID
  // ---------------------------------------------------------------------------

  describe('namespacing', () => {
    it('isolates passwords by device ID', async () => {
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'pass-one');
      await credStore.setPassword('AA:BB:CC:DD:EE:02', 'pass-two');

      expect(await credStore.getPassword('AA:BB:CC:DD:EE:01')).to.equal('pass-one');
      expect(await credStore.getPassword('AA:BB:CC:DD:EE:02')).to.equal('pass-two');
    });

    it('deleting one device ID does not affect another', async () => {
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'pass-one');
      await credStore.setPassword('AA:BB:CC:DD:EE:02', 'pass-two');
      await credStore.deletePassword('AA:BB:CC:DD:EE:01');

      expect(await credStore.getPassword('AA:BB:CC:DD:EE:01')).to.be.undefined;
      expect(await credStore.getPassword('AA:BB:CC:DD:EE:02')).to.equal('pass-two');
    });

    it('keys are prefixed with namespace', async () => {
      await credStore.setPassword('AA:BB:CC:DD:EE:01', 'secret');

      // The key should be namespaced — verify via the raw SecretStorage
      const raw = await secrets.get('kopytko.device.password.AA:BB:CC:DD:EE:01');
      expect(raw).to.equal('secret');
    });
  });
});

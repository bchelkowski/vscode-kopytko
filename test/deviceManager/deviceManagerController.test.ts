import '../roku/vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import type * as vscode from 'vscode';
import type { DeviceManager, EcpClient } from 'kopytko-roku-device';
import { DeviceManagerController } from '../../src/client/deviceManager/deviceManagerController';
import { TextEntryStore } from '../../src/client/deviceManager/textEntryStore';
import { MockMemento, MockSecretStorage } from './memento-mock';

const DEVICE = { ip: '10.0.0.2', port: 8060, friendlyName: 'Living Room' };

interface EcpStub {
  keypress: sinon.SinonStub;
  keydown: sinon.SinonStub;
  keyup: sinon.SinonStub;
  sendText: sinon.SinonStub;
}

function makeController(activeDevice: unknown = DEVICE): { controller: DeviceManagerController; ecp: EcpStub; entries: TextEntryStore } {
  const ecp: EcpStub = {
    keypress: sinon.stub().resolves(),
    keydown: sinon.stub().resolves(),
    keyup: sinon.stub().resolves(),
    sendText: sinon.stub().resolves(),
  };
  const entries = new TextEntryStore(
    new MockMemento() as unknown as vscode.Memento,
    new MockSecretStorage() as unknown as vscode.SecretStorage,
  );
  const controller = new DeviceManagerController({
    deviceManager: { getActiveDevice: () => activeDevice, on: () => {}, off: () => {} } as unknown as DeviceManager,
    ecp: ecp as unknown as EcpClient,
    entries,
  });
  return { controller, ecp, entries };
}

describe('DeviceManagerController', () => {
  afterEach(() => sinon.restore());

  it('relays keypress/keydown/keyup to the active device', async () => {
    const { controller, ecp } = makeController();

    await controller.pressKey('Home');
    await controller.holdKey('Right');
    await controller.releaseKey('Right');

    expect(ecp.keypress.firstCall.args).to.deep.equal(['10.0.0.2', 'Home', 8060]);
    expect(ecp.keydown.firstCall.args).to.deep.equal(['10.0.0.2', 'Right', 8060]);
    expect(ecp.keyup.firstCall.args).to.deep.equal(['10.0.0.2', 'Right', 8060]);
  });

  it('throws a helpful error when there is no active device', async () => {
    const { controller } = makeController(null);

    try {
      await controller.pressKey('Home');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).to.include('No active Roku device');
    }
  });

  it('releaseAllHeldKeys sends keyup for every key still held and clears tracking', async () => {
    const { controller, ecp } = makeController();

    await controller.holdKey('Right');
    await controller.holdKey('Down');
    await controller.releaseKey('Down');
    ecp.keyup.resetHistory();

    await controller.releaseAllHeldKeys();
    expect(ecp.keyup.callCount).to.equal(1);
    expect(ecp.keyup.firstCall.args[1]).to.equal('Right');

    await controller.releaseAllHeldKeys();
    expect(ecp.keyup.callCount).to.equal(1);
  });

  it('releaseAllHeldKeys swallows errors (best-effort cleanup)', async () => {
    const { controller, ecp } = makeController();
    await controller.holdKey('Up');
    ecp.keyup.rejects(new Error('device gone'));

    await controller.releaseAllHeldKeys();
  });

  it('sendText delegates to the sequential EcpClient.sendText', async () => {
    const { controller, ecp } = makeController();

    await controller.sendText('zażółć');
    expect(ecp.sendText.firstCall.args).to.deep.equal(['10.0.0.2', 'zażółć', 8060]);
  });

  it('sendEntryField types the requested field of a saved entry', async () => {
    const { controller, ecp, entries } = makeController();
    const text = await entries.save({ type: 'text', text: 'search me' });
    const creds = await entries.save({ type: 'credentials', login: 'me@x.y', password: 's3cret' });

    await controller.sendEntryField(text.id, 'text');
    await controller.sendEntryField(creds.id, 'login');
    await controller.sendEntryField(creds.id, 'password');

    expect(ecp.sendText.getCall(0).args[1]).to.equal('search me');
    expect(ecp.sendText.getCall(1).args[1]).to.equal('me@x.y');
    expect(ecp.sendText.getCall(2).args[1]).to.equal('s3cret');
  });

  it('sendEntryField rejects for a missing entry, a mismatched field, and a missing password', async () => {
    const { controller, entries } = makeController();
    const text = await entries.save({ type: 'text', text: 'plain' });
    const creds = await entries.save({ type: 'credentials', login: 'me@x.y' }); // no password stored

    const expectError = async (promise: Promise<void>, includes: string): Promise<void> => {
      try {
        await promise;
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include(includes);
      }
    };

    await expectError(controller.sendEntryField('nope', 'text'), 'not found');
    await expectError(controller.sendEntryField(text.id, 'login'), 'no login field');
    await expectError(controller.sendEntryField(creds.id, 'password'), 'No password stored');
  });
});

import '../roku/vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import type { DeviceManager, EcpClient, InstallerClient } from 'kopytko-roku-device';
import type { CredentialStore } from '../../src/client/roku/persistence/credentialStore';
import { AbilitiesController, PasswordPromptCancelled } from '../../src/client/deviceManager/abilitiesController';

const DEVICE = { ip: '10.0.0.2', port: 8060, deviceId: 'AA:BB', serialNumber: 'X123', friendlyName: 'Ultra' };

interface Stubs {
  controller: AbilitiesController;
  ecp: { queryDeviceInfo: sinon.SinonStub; queryActiveApp: sinon.SinonStub };
  installer: Record<'takeScreenshot' | 'checkForUpdate' | 'reboot' | 'installChannel' | 'deleteChannel' | 'packageChannel' | 'rekey', sinon.SinonStub>;
  getPassword: sinon.SinonStub;
  promptPassword: sinon.SinonStub;
}

function makeController(activeDevice: unknown = DEVICE): Stubs {
  const ecp = {
    queryDeviceInfo: sinon.stub().resolves({ 'model-name': 'Roku Ultra' }),
    queryActiveApp: sinon.stub().resolves({ id: 'dev', name: 'Dev App' }),
  };
  const installer = {
    takeScreenshot: sinon.stub().resolves(),
    checkForUpdate: sinon.stub().resolves(),
    reboot: sinon.stub().resolves(),
    installChannel: sinon.stub().resolves(),
    deleteChannel: sinon.stub().resolves(),
    packageChannel: sinon.stub().resolves(),
    rekey: sinon.stub().resolves(),
  };
  const getPassword = sinon.stub().resolves('stored-pass');
  const promptPassword = sinon.stub().resolves('typed-pass');

  const controller = new AbilitiesController({
    deviceManager: { getActiveDevice: () => activeDevice } as unknown as DeviceManager,
    ecp: ecp as unknown as EcpClient,
    installer: installer as unknown as InstallerClient,
    credentials: { getPassword } as unknown as CredentialStore,
    promptPassword,
  });
  return { controller, ecp, installer, getPassword, promptPassword };
}

describe('AbilitiesController', () => {
  afterEach(() => sinon.restore());

  it('quick actions query the active device without a password', async () => {
    const { controller, ecp, getPassword } = makeController();

    const info = await controller.queryDeviceInfo();
    const app = await controller.queryActiveApp();

    expect(info['model-name']).to.equal('Roku Ultra');
    expect(app?.id).to.equal('dev');
    expect(ecp.queryDeviceInfo.firstCall.args).to.deep.equal(['10.0.0.2', 8060]);
    sinon.assert.notCalled(getPassword);
  });

  it('web-admin actions resolve the stored password by deviceId and plumb arguments through', async () => {
    const { controller, installer, getPassword, promptPassword } = makeController();

    await controller.takeScreenshot('C:/shots/s.jpg');
    await controller.installChannel('C:/app.zip');
    await controller.packageChannel('C:/app.zip', 'MyApp/1.0', 'sign-pw', 'C:/out.pkg');
    await controller.rekey('C:/key.pkg', 'sign-pw');
    await controller.deleteChannel();
    await controller.checkForUpdate();
    await controller.reboot();

    expect(getPassword.alwaysCalledWith('AA:BB')).to.equal(true);
    sinon.assert.notCalled(promptPassword);
    expect(installer.takeScreenshot.firstCall.args).to.deep.equal(['10.0.0.2', 'stored-pass', 'C:/shots/s.jpg']);
    expect(installer.installChannel.firstCall.args).to.deep.equal(['10.0.0.2', 'stored-pass', 'C:/app.zip']);
    expect(installer.packageChannel.firstCall.args).to.deep.equal(
      ['10.0.0.2', 'stored-pass', 'C:/app.zip', 'MyApp/1.0', 'sign-pw', 'C:/out.pkg'],
    );
    expect(installer.rekey.firstCall.args).to.deep.equal(['10.0.0.2', 'stored-pass', 'C:/key.pkg', 'sign-pw']);
    expect(installer.deleteChannel.firstCall.args).to.deep.equal(['10.0.0.2', 'stored-pass']);
    expect(installer.reboot.firstCall.args).to.deep.equal(['10.0.0.2', 'stored-pass']);
  });

  it('falls back to the serial number when the device has no deviceId', async () => {
    const { controller, getPassword } = makeController({ ...DEVICE, deviceId: '' });
    await controller.reboot();
    expect(getPassword.firstCall.args).to.deep.equal(['X123']);
  });

  it('prompts for the password when none is stored', async () => {
    const { controller, installer, getPassword, promptPassword } = makeController();
    getPassword.resolves(undefined);

    await controller.reboot();

    sinon.assert.calledOnce(promptPassword);
    expect(installer.reboot.firstCall.args).to.deep.equal(['10.0.0.2', 'typed-pass']);
  });

  it('throws PasswordPromptCancelled when the prompt is dismissed', async () => {
    const { controller, installer, getPassword, promptPassword } = makeController();
    getPassword.resolves(undefined);
    promptPassword.resolves(undefined);

    try {
      await controller.reboot();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(PasswordPromptCancelled);
    }
    sinon.assert.notCalled(installer.reboot);
  });

  it('propagates installer errors', async () => {
    const { controller, installer } = makeController();
    installer.installChannel.rejects(new Error('Install Failure: bad zip'));

    try {
      await controller.installChannel('C:/broken.zip');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).to.include('Install Failure');
    }
  });

  it('throws when there is no active device', async () => {
    const { controller } = makeController(null);

    try {
      await controller.queryDeviceInfo();
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).to.include('No active Roku device');
    }
  });
});

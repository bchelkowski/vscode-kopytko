import '../roku/vscode-mock';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { DeepLinkingController } from '../../src/client/deepLinking/deepLinkingController';
import type { DeepLinkingDeps } from '../../src/client/deepLinking/deepLinkingController';

const DEVICE = {
  ip: '192.168.1.20',
  port: 8060,
  friendlyName: 'Living Room Roku',
} as never;

interface Stubs {
  deps: DeepLinkingDeps;
  queryApps: sinon.SinonStub;
  queryAppIcon: sinon.SinonStub;
  launchApp: sinon.SinonStub;
  sendInput: sinon.SinonStub;
}

function createStubs(activeDevice: unknown = DEVICE): Stubs {
  // NOTE: pass `null` for "no device" — `undefined` would trigger the default.
  const queryApps = sinon.stub().resolves([]);
  const queryAppIcon = sinon.stub().rejects(new Error('no icon'));
  const launchApp = sinon.stub().resolves();
  const sendInput = sinon.stub().resolves();

  const deps = {
    deviceManager: { getActiveDevice: () => activeDevice } as never,
    ecp: { queryApps, queryAppIcon, launchApp, sendInput } as never,
    store: {} as never,
  } as DeepLinkingDeps;

  return { deps, queryApps, queryAppIcon, launchApp, sendInput };
}

describe('DeepLinkingController', () => {
  afterEach(() => {
    sinon.restore();
  });

  // ---------------------------------------------------------------------------
  // loadChannels
  // ---------------------------------------------------------------------------

  describe('loadChannels', () => {
    it('throws when there is no active device', async () => {
      const { deps } = createStubs(null);
      const controller = new DeepLinkingController(deps);

      try {
        await controller.loadChannels();
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('No active Roku device');
      }
    });

    it('maps apps to channels with base64 data-URI icons', async () => {
      const { deps, queryApps, queryAppIcon } = createStubs();
      queryApps.resolves([
        { id: '12', name: 'Netflix', version: '70.0' },
        { id: 'dev', name: 'My App', version: '1.0' },
      ]);
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      queryAppIcon.withArgs(DEVICE.ip, '12', DEVICE.port).resolves({ data: bytes, contentType: 'image/png' });
      queryAppIcon.withArgs(DEVICE.ip, 'dev', DEVICE.port).resolves({ data: bytes, contentType: 'image/jpeg' });

      const controller = new DeepLinkingController(deps);
      const channels = await controller.loadChannels();

      expect(channels).to.have.length(2);
      expect(channels[0]).to.deep.equal({
        id: '12',
        name: 'Netflix',
        version: '70.0',
        iconDataUri: `data:image/png;base64,${bytes.toString('base64')}`,
      });
      expect(channels[1].iconDataUri).to.equal(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    });

    it('degrades a failed icon fetch to an undefined iconDataUri without throwing', async () => {
      const { deps, queryApps, queryAppIcon } = createStubs();
      queryApps.resolves([
        { id: '12', name: 'Netflix' },
        { id: '404', name: 'Iconless' },
      ]);
      const bytes = Buffer.from([1, 2, 3]);
      queryAppIcon.withArgs(DEVICE.ip, '12', DEVICE.port).resolves({ data: bytes, contentType: 'image/png' });
      queryAppIcon.withArgs(DEVICE.ip, '404', DEVICE.port).rejects(new Error('Icon query failed: status 404'));

      const controller = new DeepLinkingController(deps);
      const channels = await controller.loadChannels();

      expect(channels[0].iconDataUri).to.be.a('string');
      expect(channels[1].iconDataUri).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // launch / input — parameter merging
  // ---------------------------------------------------------------------------

  describe('launch', () => {
    it('sends contentId first plus extra params to the device', async () => {
      const { deps, launchApp } = createStubs();
      const controller = new DeepLinkingController(deps);

      await controller.launch('12', 'movie-123', [{ key: 'mediaType', value: 'movie' }]);

      sinon.assert.calledOnceWithExactly(
        launchApp,
        DEVICE.ip,
        '12',
        { contentId: 'movie-123', mediaType: 'movie' },
        DEVICE.port,
      );
    });

    it('omits blank contentId and skips blank keys, trimming both', async () => {
      const { deps, launchApp } = createStubs();
      const controller = new DeepLinkingController(deps);

      await controller.launch('12', '   ', [
        { key: '  mediaType ', value: 'live' },
        { key: '   ', value: 'ignored' },
      ]);

      sinon.assert.calledOnceWithExactly(launchApp, DEVICE.ip, '12', { mediaType: 'live' }, DEVICE.port);
    });

    it('throws when there is no active device', async () => {
      const { deps } = createStubs(null);
      const controller = new DeepLinkingController(deps);

      try {
        await controller.launch('12', 'x', []);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('No active Roku device');
      }
    });

    it('propagates ECP failures', async () => {
      const { deps, launchApp } = createStubs();
      launchApp.rejects(new Error('Launch failed: status 403'));
      const controller = new DeepLinkingController(deps);

      try {
        await controller.launch('12', 'x', []);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('status 403');
      }
    });
  });

  describe('input', () => {
    it('sends merged params via sendInput (no channel id)', async () => {
      const { deps, sendInput } = createStubs();
      const controller = new DeepLinkingController(deps);

      await controller.input('ep-9', [{ key: 'mediaType', value: 'episode' }]);

      sinon.assert.calledOnceWithExactly(
        sendInput,
        DEVICE.ip,
        { contentId: 'ep-9', mediaType: 'episode' },
        DEVICE.port,
      );
    });
  });
});

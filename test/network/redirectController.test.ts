import { expect } from 'chai';
import {
  RedirectController,
  RedirectUnsupportedError,
  buildSetupCommands,
  buildTeardownCommands,
  type ElevatedRunner,
  type RedirectOptions,
  type SupervisedRedirectDriver,
  type WindowsRedirectDriver,
} from '../../src/client/network/redirect/redirectController';

const OPTS: RedirectOptions = { rokuIp: '192.168.137.42', proxyPort: 8888, ports: [80] };

function fakeRunner(): { runner: ElevatedRunner; calls: Array<{ label: string; commands: string[] }> } {
  const calls: Array<{ label: string; commands: string[] }> = [];
  const runner: ElevatedRunner = (label, commands) => {
    calls.push({ label, commands });
    return Promise.resolve();
  };
  return { runner, calls };
}

describe('network/RedirectController', () => {
  describe('command generation', () => {
    it('builds a scoped iptables chain on Linux and tears it down exactly', () => {
      const setup = buildSetupCommands('linux', OPTS).join('\n');
      expect(setup).to.contain('KOPYTKO_NET');
      expect(setup).to.contain('192.168.137.42');
      expect(setup).to.contain('--dport 80');
      expect(setup).to.contain('REDIRECT --to-ports 8888');
      expect(setup).to.contain('net.ipv4.ip_forward=1');

      const teardown = buildTeardownCommands('linux', OPTS).join('\n');
      expect(teardown).to.contain('-D PREROUTING');
      expect(teardown).to.contain('-F KOPYTKO_NET');
      expect(teardown).to.contain('-X KOPYTKO_NET');
    });

    it('builds a dedicated pf anchor on macOS and flushes only that anchor', () => {
      const setup = buildSetupCommands('darwin', OPTS).join('\n');
      expect(setup).to.contain('kopytko-net');
      expect(setup).to.contain('rdr pass');
      expect(setup).to.contain('127.0.0.1 port 8888');
      expect(setup).to.contain('pfctl -e');
      // Anchor is inserted among the rdr-anchors (ordering-safe), not appended.
      expect(setup).to.contain('/etc/pf.conf');
      expect(setup).to.contain('rdr-anchor');
      // No hardcoded Internet Sharing interface name.
      expect(setup).to.not.contain('bridge100');
      expect(setup).to.not.contain(' on ');

      const teardown = buildTeardownCommands('darwin', OPTS).join('\n');
      expect(teardown).to.contain('-a kopytko-net -F all');
    });

    it('produces no commands on unsupported platforms', () => {
      expect(buildSetupCommands('win32', OPTS)).to.deep.equal([]);
      expect(buildTeardownCommands('win32', OPTS)).to.deep.equal([]);
    });
  });

  describe('lifecycle', () => {
    it('applies then reverts with exactly-scoped commands', async () => {
      const { runner, calls } = fakeRunner();
      const ctrl = new RedirectController(runner, 'linux');

      await ctrl.enable(OPTS);
      expect(ctrl.isApplied).to.equal(true);
      expect(calls).to.have.length(1);
      expect(calls[0].commands.join('\n')).to.contain('REDIRECT --to-ports 8888');

      await ctrl.disable();
      expect(ctrl.isApplied).to.equal(false);
      expect(calls).to.have.length(2);
      expect(calls[1].commands.join('\n')).to.contain('-X KOPYTKO_NET');
    });

    it('is idempotent: a second disable does not re-run teardown', async () => {
      const { runner, calls } = fakeRunner();
      const ctrl = new RedirectController(runner, 'linux');
      await ctrl.enable(OPTS);
      await ctrl.disable();
      await ctrl.disable();
      expect(calls).to.have.length(2);
    });

    it('reverts a prior redirect before applying a new one', async () => {
      const { runner, calls } = fakeRunner();
      const ctrl = new RedirectController(runner, 'linux');
      await ctrl.enable(OPTS);
      await ctrl.enable({ ...OPTS, proxyPort: 9999 });
      // enable → (implicit disable of old) → new setup = 3 runner calls total.
      expect(calls).to.have.length(3);
      expect(calls[2].commands.join('\n')).to.contain('REDIRECT --to-ports 9999');
    });

    it('throws RedirectUnsupportedError on Windows without running anything, when no windowsDriver is injected', async () => {
      const { runner, calls } = fakeRunner();
      const ctrl = new RedirectController(runner, 'win32');
      let threw: unknown;
      try {
        await ctrl.enable(OPTS);
      } catch (err) {
        threw = err;
      }
      expect(threw).to.be.instanceOf(RedirectUnsupportedError);
      expect(ctrl.isApplied).to.equal(false);
      expect(calls).to.have.length(0);
    });
  });

  describe('windows driver (WinDivert)', () => {
    function fakeWindowsDriver(): { driver: WindowsRedirectDriver; calls: string[] } {
      const calls: string[] = [];
      const driver: WindowsRedirectDriver = {
        enable: (options) => {
          calls.push(`enable:${options.rokuIp}:${options.proxyPort}`);
          return Promise.resolve();
        },
        disable: () => {
          calls.push('disable');
          return Promise.resolve();
        },
      };
      return { driver, calls };
    }

    it('delegates to the injected windowsDriver instead of throwing, and never touches the shell-command runner', async () => {
      const { runner, calls: shellCalls } = fakeRunner();
      const { driver, calls } = fakeWindowsDriver();
      const ctrl = new RedirectController(runner, 'win32', driver);

      await ctrl.enable(OPTS);
      expect(ctrl.isApplied).to.equal(true);
      expect(calls).to.deep.equal(['enable:192.168.137.42:8888']);
      expect(shellCalls).to.have.length(0);

      await ctrl.disable();
      expect(ctrl.isApplied).to.equal(false);
      expect(calls).to.deep.equal(['enable:192.168.137.42:8888', 'disable']);
    });

    it('propagates the windowsDriver enable() failure and leaves nothing applied (e.g. RedirectUnsupportedError from an unconfigured WinDivert dir)', async () => {
      const { runner } = fakeRunner();
      const driver: WindowsRedirectDriver = {
        enable: () => Promise.reject(new RedirectUnsupportedError('WinDivert not configured')),
        disable: () => Promise.resolve(),
      };
      const ctrl = new RedirectController(runner, 'win32', driver);

      let threw: unknown;
      try {
        await ctrl.enable(OPTS);
      } catch (err) {
        threw = err;
      }
      expect(threw).to.be.instanceOf(RedirectUnsupportedError);
      expect(ctrl.isApplied).to.equal(false);
    });

    it('disable() without a prior enable() is a no-op and never calls the windows driver', async () => {
      const { runner } = fakeRunner();
      const { driver, calls } = fakeWindowsDriver();
      const ctrl = new RedirectController(runner, 'win32', driver);

      await ctrl.disable();
      expect(calls).to.deep.equal([]);
    });
  });

  describe('mac driver (persistent helper)', () => {
    function fakeMacDriver(): { driver: SupervisedRedirectDriver; calls: string[] } {
      const calls: string[] = [];
      const driver: SupervisedRedirectDriver = {
        enable: (options) => {
          calls.push(`enable:${options.rokuIp}:${options.proxyPort}`);
          return Promise.resolve();
        },
        disable: () => {
          calls.push('disable');
          return Promise.resolve();
        },
      };
      return { driver, calls };
    }

    it('delegates to the injected macDriver instead of the shell-command runner, on both enable and disable', async () => {
      const { runner, calls: shellCalls } = fakeRunner();
      const { driver, calls } = fakeMacDriver();
      const ctrl = new RedirectController(runner, 'darwin', undefined, driver);

      await ctrl.enable(OPTS);
      expect(ctrl.isApplied).to.equal(true);
      expect(calls).to.deep.equal(['enable:192.168.137.42:8888']);
      expect(shellCalls).to.have.length(0);

      await ctrl.disable();
      expect(ctrl.isApplied).to.equal(false);
      expect(calls).to.deep.equal(['enable:192.168.137.42:8888', 'disable']);
      expect(shellCalls).to.have.length(0);
    });

    it('propagates the macDriver enable() failure and leaves nothing applied', async () => {
      const { runner } = fakeRunner();
      const driver: SupervisedRedirectDriver = {
        enable: () => Promise.reject(new Error('helper failed to start')),
        disable: () => Promise.resolve(),
      };
      const ctrl = new RedirectController(runner, 'darwin', undefined, driver);

      let threw: unknown;
      try {
        await ctrl.enable(OPTS);
      } catch (err) {
        threw = err;
      }
      expect((threw as Error).message).to.equal('helper failed to start');
      expect(ctrl.isApplied).to.equal(false);
    });

    it('disable() without a prior enable() is a no-op and never calls the mac driver', async () => {
      const { runner } = fakeRunner();
      const { driver, calls } = fakeMacDriver();
      const ctrl = new RedirectController(runner, 'darwin', undefined, driver);

      await ctrl.disable();
      expect(calls).to.deep.equal([]);
    });

    it('falls back to the one-shot ElevatedRunner on darwin when no macDriver is injected', async () => {
      const { runner, calls } = fakeRunner();
      const ctrl = new RedirectController(runner, 'darwin');

      await ctrl.enable(OPTS);
      await ctrl.disable();
      expect(calls).to.have.length(2);
    });
  });
});

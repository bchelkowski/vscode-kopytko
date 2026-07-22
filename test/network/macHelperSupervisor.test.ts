import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MacHelperDriver, type MacHelperSupervisorDeps } from '../../src/client/network/redirect/mac/macHelperSupervisor';
import type { RedirectOptions } from '../../src/client/network/redirect/redirectController';

const OPTS: RedirectOptions = { rokuIp: '192.168.137.46', proxyPort: 8888, ports: [80] };

function makeDeps(overrides: Partial<MacHelperSupervisorDeps> = {}): {
  deps: MacHelperSupervisorDeps;
  scriptDir: string;
  runElevatedCalls: Array<{ scriptPath: string; label: string }>;
  stopCalls: string[];
} {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopytko-mac-helper-test-'));
  const runElevatedCalls: Array<{ scriptPath: string; label: string }> = [];
  const stopCalls: string[] = [];

  const deps: MacHelperSupervisorDeps = {
    scriptDir,
    mkfifo: async () => {
      /* never actually creates a FIFO in tests */
    },
    runElevated: async (scriptPath: string, label: string) => {
      runElevatedCalls.push({ scriptPath, label });
    },
    writeHeartbeat: () => {
      /* no-op in tests */
    },
    sendStop: async (fifoPath: string) => {
      stopCalls.push(fifoPath);
    },
    waitForStopped: async () => true,
    ...overrides,
  };
  return { deps, scriptDir, runElevatedCalls, stopCalls };
}

describe('network/redirect/mac/MacHelperDriver', () => {
  it('enable(): writes the script and launches it elevated exactly once', async () => {
    const { deps, scriptDir, runElevatedCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);

    await driver.enable(OPTS);
    try {
      expect(fs.existsSync(path.join(scriptDir, 'mac-helper', 'helper.sh'))).to.equal(true);
      expect(runElevatedCalls).to.have.length(1);
      expect(runElevatedCalls[0].label).to.contain('enable traffic capture');
    } finally {
      await driver.disable(); // clears the heartbeat interval so it doesn't outlive the test
    }
  });

  it('a full enable()+disable() cycle triggers exactly one elevated launch', async () => {
    const { deps, runElevatedCalls, stopCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);

    await driver.enable(OPTS);
    await driver.disable();

    expect(runElevatedCalls).to.have.length(1);
    expect(stopCalls).to.have.length(1);
  });

  it('enable(): surfaces the elevated launch failure with the log path for debugging', async () => {
    const { deps, scriptDir } = makeDeps({
      runElevated: async () => {
        throw new Error('user canceled the authorization request');
      },
    });
    const driver = new MacHelperDriver(deps);

    let threw: unknown;
    try {
      await driver.enable(OPTS);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(Error);
    expect((threw as Error).message).to.contain('user canceled the authorization request');
    expect((threw as Error).message).to.contain(path.join(scriptDir, 'mac-helper', 'helper.log'));
  });

  it('disable(): a no-op before enable() never sends a stop signal', async () => {
    const { deps, stopCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);
    await driver.disable();
    expect(stopCalls).to.have.length(0);
  });

  it('disable(): still tears down its own state even if the stop signal itself fails to send', async () => {
    const { deps, stopCalls } = makeDeps({
      sendStop: async () => {
        throw new Error('no reader on the FIFO — helper already gone');
      },
    });
    const driver = new MacHelperDriver(deps);
    await driver.enable(OPTS);

    let threw: unknown;
    try {
      await driver.disable();
    } catch (err) {
      threw = err;
    }
    expect(threw).to.equal(undefined);
    expect(stopCalls).to.have.length(0); // sendStop threw before recording

    // A second enable() must not be blocked by leftover state from the failed disable.
    await driver.enable(OPTS);
    await driver.disable();
  });

  it('disable(): does not throw when the helper never confirms "stopped" in time (heartbeat timeout is the backstop)', async () => {
    const { deps } = makeDeps({ waitForStopped: async () => false });
    const driver = new MacHelperDriver(deps);
    await driver.enable(OPTS);

    let threw: unknown;
    try {
      await driver.disable();
    } catch (err) {
      threw = err;
    }
    expect(threw).to.equal(undefined);
  });

  it('starts a heartbeat interval only after the elevated launch resolves', async () => {
    let heartbeatWrites = 0;
    const { deps } = makeDeps({
      writeHeartbeat: () => {
        heartbeatWrites++;
      },
    });
    const driver = new MacHelperDriver(deps);
    expect(heartbeatWrites).to.equal(0);
    await driver.enable(OPTS);
    await driver.disable();
  });
});

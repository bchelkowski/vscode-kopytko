import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MacHelperDriver, type MacHelperSupervisorDeps } from '../../src/client/network/redirect/mac/macHelperSupervisor';
import type { RedirectOptions } from '../../src/client/network/redirect/redirectController';

const OPTS: RedirectOptions = { rokuIp: '192.168.137.46', proxyPort: 8888, ports: [80] };
const OTHER_OPTS: RedirectOptions = { rokuIp: '192.168.137.99', proxyPort: 9999, ports: [80, 443] };

function makeDeps(overrides: Partial<MacHelperSupervisorDeps> = {}): {
  deps: MacHelperSupervisorDeps;
  scriptDir: string;
  runElevatedCalls: Array<{ scriptPath: string; label: string }>;
  commandCalls: Array<{ fifoPath: string; command: string; options?: RedirectOptions }>;
  /** Drives what waitForStatus resolves to next — defaults to echoing back the first `accept` value. */
  statusQueue: Array<string | null>;
} {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopytko-mac-helper-test-'));
  const runElevatedCalls: Array<{ scriptPath: string; label: string }> = [];
  const commandCalls: Array<{ fifoPath: string; command: string; options?: RedirectOptions }> = [];
  const statusQueue: Array<string | null> = [];

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
    sendCommand: async (fifoPath: string, command, options) => {
      commandCalls.push({ fifoPath, command, options });
    },
    waitForStatus: async (_statusPath: string, accept: string[]) => {
      if (statusQueue.length > 0) return statusQueue.shift()!;
      return accept[0]; // default: happy path, confirms whatever was expected
    },
    ...overrides,
  };
  return { deps, scriptDir, runElevatedCalls, commandCalls, statusQueue };
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
      await driver.teardown(); // clears the heartbeat interval so it doesn't outlive the test
    }
  });

  it('a full enable()+disable() cycle triggers exactly one elevated launch and sends "revert" (not "stop")', async () => {
    const { deps, runElevatedCalls, commandCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);

    await driver.enable(OPTS);
    await driver.disable();

    expect(runElevatedCalls).to.have.length(1);
    expect(commandCalls).to.deep.equal([{ fifoPath: commandCalls[0].fifoPath, command: 'revert', options: undefined }]);
    await driver.teardown();
  });

  it('re-enabling with the same options after a disable() reuses the helper via "apply" — no second elevated launch', async () => {
    const { deps, runElevatedCalls, commandCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);

    await driver.enable(OPTS);
    await driver.disable();
    await driver.enable(OPTS);
    await driver.disable();
    await driver.enable(OPTS);

    expect(runElevatedCalls).to.have.length(1); // only the very first enable() ever elevated
    expect(commandCalls.map((c) => c.command)).to.deep.equal(['revert', 'apply', 'revert', 'apply']);
    await driver.teardown();
  });

  it('switching to a different device/ports also reuses the helper via "apply" with the new options — no re-elevation', async () => {
    const { deps, runElevatedCalls, commandCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);

    await driver.enable(OPTS);
    await driver.enable(OTHER_OPTS); // switched active device mid-session, still "applied"

    expect(runElevatedCalls).to.have.length(1); // no second prompt for the device switch
    const applyCalls = commandCalls.filter((c) => c.command === 'apply');
    expect(applyCalls).to.have.length(1);
    expect(applyCalls[0].options).to.deep.equal(OTHER_OPTS);
    await driver.teardown();
  });

  it('disable() then enabling with different options still reuses via "apply", carrying the new options', async () => {
    const { deps, runElevatedCalls, commandCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);

    await driver.enable(OPTS);
    await driver.disable();
    await driver.enable(OTHER_OPTS);

    expect(runElevatedCalls).to.have.length(1);
    expect(commandCalls.map((c) => c.command)).to.deep.equal(['revert', 'apply']);
    expect(commandCalls[1].options).to.deep.equal(OTHER_OPTS);
    await driver.teardown();
  });

  it('falls back to a fresh elevated launch when the running helper does not confirm "apply" in time (e.g. it already self-terminated)', async () => {
    const { deps, runElevatedCalls, statusQueue } = makeDeps();
    const driver = new MacHelperDriver(deps);
    await driver.enable(OPTS);
    await driver.disable();

    statusQueue.push(null); // apply confirmation times out
    await driver.enable(OPTS);

    expect(runElevatedCalls).to.have.length(2);
    await driver.teardown();
  });

  it('falls back to a fresh elevated launch when the helper rejects the apply payload (status: failed)', async () => {
    const { deps, runElevatedCalls, statusQueue } = makeDeps();
    const driver = new MacHelperDriver(deps);
    await driver.enable(OPTS);

    statusQueue.push('failed'); // e.g. malformed options somehow reached validation
    await driver.enable(OTHER_OPTS);

    expect(runElevatedCalls).to.have.length(2);
    await driver.teardown();
  });

  it('falls back to a fresh elevated launch when sending "apply" itself fails (FIFO gone)', async () => {
    const { deps, runElevatedCalls } = makeDeps({
      sendCommand: async (_fifoPath, command) => {
        if (command === 'apply') throw new Error('ENOENT: no such file or directory');
      },
    });
    const driver = new MacHelperDriver(deps);
    await driver.enable(OPTS);
    await driver.disable();
    await driver.enable(OPTS);

    expect(runElevatedCalls).to.have.length(2);
    await driver.teardown();
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

  it('disable(): a no-op before enable() never sends a command', async () => {
    const { deps, commandCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);
    await driver.disable();
    expect(commandCalls).to.have.length(0);
  });

  it('disable(): is idempotent — a second disable() does not re-send "revert"', async () => {
    const { deps, commandCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);
    await driver.enable(OPTS);
    await driver.disable();
    await driver.disable();
    expect(commandCalls.filter((c) => c.command === 'revert')).to.have.length(1);
    await driver.teardown();
  });

  it('disable(): does not throw when the revert signal itself fails to send (heartbeat timeout is the backstop)', async () => {
    const { deps, commandCalls } = makeDeps({
      sendCommand: async () => {
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
    expect(commandCalls).to.have.length(0);
    // teardown() (not disable()) is the only thing that clears the heartbeat
    // interval by design — must still be reachable here, not orphaned by the
    // failed revert above.
    await driver.teardown();
  });

  it('teardown(): a no-op before enable() never sends a command', async () => {
    const { deps, commandCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);
    await driver.teardown();
    expect(commandCalls).to.have.length(0);
  });

  it('teardown(): sends "stop", clears the heartbeat, and a later enable() always elevates fresh (no reuse across a hard stop)', async () => {
    const { deps, runElevatedCalls, commandCalls } = makeDeps();
    const driver = new MacHelperDriver(deps);
    await driver.enable(OPTS);
    await driver.teardown();

    expect(commandCalls.map((c) => c.command)).to.deep.equal(['stop']);

    await driver.enable(OPTS);
    expect(runElevatedCalls).to.have.length(2);
    await driver.teardown();
  });

  it('teardown(): does not throw when the helper never confirms "stopped" in time', async () => {
    const { deps } = makeDeps({ waitForStatus: async () => null });
    const driver = new MacHelperDriver(deps);
    await driver.enable(OPTS);

    let threw: unknown;
    try {
      await driver.teardown();
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
    await driver.teardown();
  });
});

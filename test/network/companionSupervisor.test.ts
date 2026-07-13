import { expect } from 'chai';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as net from 'net';
import {
  WindowsCompanionDriver,
  type CompanionStatus,
  type CompanionSupervisorDeps,
} from '../../src/client/network/redirect/windows/companionSupervisor';
import { RedirectUnsupportedError, type RedirectOptions } from '../../src/client/network/redirect/redirectController';

/** Minimal net.Socket stand-in — never touches a real pipe. */
class FakePipe extends EventEmitter {
  destroyed = false;
  written: string[] = [];
  ended = false;

  write(data: string): boolean {
    this.written.push(data.trim());
    const reply = this.reply(data.trim());
    if (reply) setImmediate(() => this.emit('data', Buffer.from(reply + '\n')));
    return true;
  }
  end(): void {
    this.ended = true;
  }
  destroy(): void {
    this.destroyed = true;
  }

  constructor(private reply: (line: string) => string | null) {
    super();
  }
}

const OPTS: RedirectOptions = { rokuIp: '192.168.137.46', proxyPort: 8888, ports: [80] };

function makeDeps(overrides: Partial<CompanionSupervisorDeps> = {}): {
  deps: CompanionSupervisorDeps;
  pipes: FakePipe[];
  scriptDir: string;
} {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopytko-companion-test-'));
  const pipes: FakePipe[] = [];

  const deps: CompanionSupervisorDeps = {
    scriptDir,
    resolveWinDivertDir: () => 'C:\\WinDivert',
    resolveGatewayIp: () => '192.168.137.1',
    launchElevated: async () => {
      /* never actually elevates or spawns anything in tests */
    },
    waitForReady: async (): Promise<CompanionStatus> => ({ state: 'ready', detail: 'redirect active' }),
    connectPipe: (_name: string): net.Socket => {
      const pipe = new FakePipe(() => '{"ok":true}');
      pipes.push(pipe);
      setImmediate(() => pipe.emit('connect'));
      return pipe as unknown as net.Socket;
    },
    ...overrides,
  };
  return { deps, pipes, scriptDir };
}

describe('network/redirect/windows/WindowsCompanionDriver', () => {
  afterEach(function () {
    // best-effort cleanup of the per-test temp dir
  });

  it('enable(): writes the script, waits for readiness, authenticates over the pipe', async () => {
    const { deps, pipes, scriptDir } = makeDeps();
    const driver = new WindowsCompanionDriver(deps);

    await driver.enable(OPTS);
    try {
      expect(fs.existsSync(path.join(scriptDir, 'windivert', 'companion.ps1'))).to.equal(true);
      expect(pipes).to.have.length(1);
      expect(pipes[0].written[0]).to.match(/^[0-9a-f]{48}$/); // random hex token sent first, before any command
    } finally {
      await driver.disable(); // clears the heartbeat interval so it doesn't outlive the test
    }
  });

  it('enable(): throws RedirectUnsupportedError when winDivertDir is not configured (graceful degrade)', async () => {
    const { deps } = makeDeps({
      resolveWinDivertDir: () => {
        throw new RedirectUnsupportedError('not configured');
      },
    });
    const driver = new WindowsCompanionDriver(deps);

    let threw: unknown;
    try {
      await driver.enable(OPTS);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(RedirectUnsupportedError);
  });

  it('enable(): throws RedirectUnsupportedError when no gateway IP can be resolved', async () => {
    const { deps } = makeDeps({ resolveGatewayIp: () => undefined });
    const driver = new WindowsCompanionDriver(deps);

    let threw: unknown;
    try {
      await driver.enable(OPTS);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(RedirectUnsupportedError);
  });

  it('enable(): surfaces a clear timeout message when the companion never signals ready (e.g. AV quarantine)', async () => {
    const { deps } = makeDeps({
      waitForReady: async (): Promise<CompanionStatus> => ({ state: 'starting', detail: '' }),
    });
    const driver = new WindowsCompanionDriver(deps);

    let threw: unknown;
    try {
      await driver.enable(OPTS);
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(Error);
    expect((threw as Error).message).to.contain('never signaled ready');
  });

  it('enable(): surfaces the companion\'s own failure detail (e.g. driver load / HVCI block)', async () => {
    const { deps } = makeDeps({
      waitForReady: async (): Promise<CompanionStatus> => ({ state: 'failed', detail: 'WinDivertOpen failed - Win32 error 5' }),
    });
    const driver = new WindowsCompanionDriver(deps);

    let threw: unknown;
    try {
      await driver.enable(OPTS);
    } catch (err) {
      threw = err;
    }
    expect((threw as Error).message).to.contain('Win32 error 5');
  });

  it('disable(): a no-op before enable() never touches a pipe', async () => {
    const { deps, pipes } = makeDeps();
    const driver = new WindowsCompanionDriver(deps);
    await driver.disable();
    expect(pipes).to.have.length(0);
  });

  it('disable(): sends "stop" over the pipe and closes it', async () => {
    const { deps, pipes } = makeDeps();
    const driver = new WindowsCompanionDriver(deps);
    await driver.enable(OPTS);

    await driver.disable();

    expect(pipes[0].written).to.contain('stop');
    expect(pipes[0].destroyed).to.equal(true);
  });

  it('disable(): still cleans up even if the companion stops responding after connect', async function () {
    this.timeout(6000); // exercises the real (bounded) pipe-response timeout, not a fake clock
    const { deps, pipes } = makeDeps({
      connectPipe: (_name: string): net.Socket => {
        let calls = 0;
        // Authenticates fine (so enable() succeeds), then goes silent — the
        // subsequent "stop" in disable() must time out and clean up anyway,
        // never hang forever waiting for an ack that will never come.
        const pipe = new FakePipe(() => (++calls === 1 ? '{"ok":true}' : null));
        pipes.push(pipe);
        setImmediate(() => pipe.emit('connect'));
        return pipe as unknown as net.Socket;
      },
    });
    const driver = new WindowsCompanionDriver(deps);
    await driver.enable(OPTS);

    await driver.disable();
    expect(pipes[0].written).to.contain('stop');
    expect(pipes[0].destroyed).to.equal(true);
  });
});

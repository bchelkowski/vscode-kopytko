/**
 * Node-side counterpart to `macHelperScript.ts`: writes and launches the
 * helper elevated, then supervises it for the lifetime of a capture session —
 * a heartbeat file so the helper can detect and self-terminate if this
 * process (or all of VS Code) disappears without a clean `disable()`, and a
 * FIFO `stop` command for the ordinary teardown path.
 *
 * Unlike the Windows companion (`redirect/windows/companionSupervisor.ts`),
 * `enable()` needs no separate readiness poll: `osascript … with
 * administrator privileges` (`buildElevatedInvocation`, reused from
 * `elevate.ts`) already blocks until the script exits, and the script itself
 * only exits after setup succeeds and the watchdog is backgrounded — so a
 * resolved launch call already implies "ready".
 *
 * Implements `SupervisedRedirectDriver` so `RedirectController` can use it as
 * a drop-in for the darwin branch, exactly like the Windows driver.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { buildElevatedInvocation } from '../elevate';
import type { RedirectOptions, SupervisedRedirectDriver } from '../redirectController';
import { buildMacHelperScript, HEARTBEAT_TIMEOUT_SEC } from './macHelperScript';

export interface MacHelperSupervisorDeps {
  /** Directory the generated script/log/status/session files are written to (auditable, like `elevate.ts`). */
  scriptDir: string;
  log?: (msg: string) => void;
  /** Overridable for tests — real implementation shells out to `/usr/bin/mkfifo`. */
  mkfifo?: (fifoPath: string) => Promise<void>;
  /** Overridable for tests — real implementation runs the script via `osascript … with administrator privileges`. */
  runElevated?: (scriptPath: string, label: string) => Promise<void>;
  /** Overridable for tests — real implementation stamps the heartbeat file with the current epoch-seconds. */
  writeHeartbeat?: (heartbeatPath: string) => void;
  /** Overridable for tests — real implementation writes `stop\n` to the FIFO. */
  sendStop?: (fifoPath: string) => Promise<void>;
  /** Overridable for tests — real implementation is `fs.readFileSync` polling the status file. */
  waitForStopped?: (statusPath: string, timeoutMs: number) => Promise<boolean>;
}

interface Session {
  cmdFifoPath: string;
  statusPath: string;
}

const HEARTBEAT_INTERVAL_MS = Math.floor((HEARTBEAT_TIMEOUT_SEC * 1000) / 3);
const STOP_CONFIRM_TIMEOUT_MS = 5_000;

export class MacHelperDriver implements SupervisedRedirectDriver {
  private session: Session | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: MacHelperSupervisorDeps) {}

  private log(msg: string): void {
    this.deps.log?.(msg);
  }

  async enable(options: RedirectOptions): Promise<void> {
    await this.teardownSession();

    const sessionDir = path.join(this.deps.scriptDir, 'mac-helper');
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

    const scriptPath = path.join(sessionDir, 'helper.sh');
    const logPath = path.join(sessionDir, 'helper.log');
    const statusPath = path.join(sessionDir, 'helper-status.txt');
    const cmdFifoPath = path.join(sessionDir, 'helper.cmd');
    const heartbeatPath = path.join(sessionDir, 'helper.heartbeat');
    const pidPath = path.join(sessionDir, 'helper.pid');

    try {
      fs.unlinkSync(cmdFifoPath);
    } catch {
      /* fine — didn't exist */
    }
    const mkfifo = this.deps.mkfifo ?? defaultMkfifo;
    await mkfifo(cmdFifoPath);

    // Written before elevation so the watchdog has *a* file to read from the
    // instant it starts — it immediately overwrites this with its own fresh
    // timestamp (see macHelperScript.ts) rather than trusting how stale this
    // one already is by the time the admin-password dialog is dismissed.
    fs.writeFileSync(heartbeatPath, String(nowSeconds()), { mode: 0o600 });
    try {
      fs.unlinkSync(statusPath);
    } catch {
      /* fine — didn't exist */
    }

    const script = buildMacHelperScript({
      rokuIp: options.rokuIp,
      proxyPort: options.proxyPort,
      ports: options.ports,
      logPath,
      statusPath,
      cmdFifoPath,
      heartbeatPath,
      pidPath,
    });
    fs.writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o700 });
    this.log(`Mac helper script written to ${scriptPath} (log: ${logPath})`);

    const runElevated = this.deps.runElevated ?? defaultRunElevated;
    try {
      await runElevated(scriptPath, 'Kopytko Network Inspector — enable traffic capture');
    } catch (err) {
      const detail = (err as Error).message;
      this.log(`Mac helper failed to start: ${detail}`);
      throw new Error(`Traffic-capture helper failed to start: ${detail}. Check ${logPath}.`);
    }

    this.session = { cmdFifoPath, statusPath };
    const writeHeartbeat = this.deps.writeHeartbeat ?? defaultWriteHeartbeat;
    this.heartbeatTimer = setInterval(() => writeHeartbeat(heartbeatPath), HEARTBEAT_INTERVAL_MS);
    this.log('Mac helper ready. Heartbeat started.');
  }

  async disable(): Promise<void> {
    await this.teardownSession();
  }

  private async teardownSession(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const session = this.session;
    this.session = null;
    if (!session) return;

    const sendStop = this.deps.sendStop ?? defaultSendStop;
    try {
      await sendStop(session.cmdFifoPath);
    } catch (err) {
      // Not fatal: the watchdog's own heartbeat timeout (now that we've
      // stopped writing to it) is the backstop that guarantees the redirect
      // still comes down even if the stop signal itself couldn't be sent.
      this.log(`Mac helper stop signal failed (heartbeat timeout will still tear it down): ${(err as Error).message}`);
      return;
    }

    const waitForStopped = this.deps.waitForStopped ?? defaultWaitForStopped;
    const stopped = await waitForStopped(session.statusPath, STOP_CONFIRM_TIMEOUT_MS);
    if (!stopped) {
      this.log('Mac helper did not confirm teardown in time; relying on its own heartbeat-timeout self-termination.');
    }
  }
}

// ── process/status helpers (real implementations, injectable for tests) ───────

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function defaultWriteHeartbeat(heartbeatPath: string): void {
  try {
    fs.writeFileSync(heartbeatPath, String(nowSeconds()));
  } catch {
    /* best-effort heartbeat only */
  }
}

function defaultMkfifo(fifoPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/mkfifo', ['-m', '600', fifoPath], (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve();
    });
  });
}

function defaultRunElevated(scriptPath: string, label: string): Promise<void> {
  const invocation = buildElevatedInvocation('darwin', scriptPath, label);
  if (!invocation) {
    return Promise.reject(new Error('No elevation strategy for darwin'));
  }
  return new Promise((resolve, reject) => {
    execFile(invocation.cmd, invocation.args, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve();
    });
  });
}

function defaultSendStop(fifoPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.writeFile(fifoPath, 'stop\n', (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function defaultWaitForStopped(statusPath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.readFileSync(statusPath, 'utf8').trim() === 'stopped') return true;
    } catch {
      /* not written yet */
    }
    await sleep(150);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

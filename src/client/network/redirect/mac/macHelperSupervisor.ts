/**
 * Node-side counterpart to `macHelperScript.ts`: writes and launches the
 * helper elevated, then supervises it for the rest of the VS Code session —
 * a heartbeat file so the helper can detect and self-terminate if this
 * process (or all of VS Code) disappears without a clean `teardown()`, and a
 * FIFO `apply`/`revert`/`stop` control channel.
 *
 * Only the *first* `enable()` of the whole VS Code session needs a new
 * elevated launch. Once the helper is up, `disable()` sends `revert`
 * (flushes the pf anchor but leaves the watchdog running) and every later
 * `enable()` — even for a *different* device or ports — sends `apply
 * <rokuIp> <proxyPort> <ports>` over the FIFO instead of relaunching
 * elevated, since `do_apply` in `macHelperScript.ts` rebuilds the pf rules
 * from whatever values it's given at the time, not from what was baked into
 * the script at generation time. A prompt only reappears if the running
 * helper is actually gone (heartbeat lapsed, crash, or the reapply itself
 * fails/times out) — see `enable()` below. `teardown()` is a distinct hard
 * stop for when the extension actually shuts down, so the elevated helper
 * never outlives VS Code.
 *
 * Unlike the Windows companion (`redirect/windows/companionSupervisor.ts`),
 * the *initial* `enable()` needs no separate readiness poll: `osascript …
 * with administrator privileges` (`buildElevatedInvocation`, reused from
 * `elevate.ts`) already blocks until the script exits, and the script only
 * exits after the initial setup succeeds and the watchdog is backgrounded —
 * so a resolved launch call already implies "ready." Reusing an existing
 * session (`apply`/`revert`) does need a poll, since those are async FIFO
 * commands with no equivalent blocking call.
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
  /** Overridable for tests — real implementation writes `<command>\n` to the FIFO, or `apply <rokuIp> <proxyPort> <ports>\n` when options are given. */
  sendCommand?: (fifoPath: string, command: 'apply' | 'revert' | 'stop', options?: RedirectOptions) => Promise<void>;
  /** Overridable for tests — real implementation is `fs.readFileSync` polling the status file until it matches one of `accept`. */
  waitForStatus?: (statusPath: string, accept: string[], timeoutMs: number) => Promise<string | null>;
}

interface Session {
  cmdFifoPath: string;
  statusPath: string;
  heartbeatPath: string;
  options: RedirectOptions;
  applied: boolean;
}

const HEARTBEAT_INTERVAL_MS = Math.floor((HEARTBEAT_TIMEOUT_SEC * 1000) / 3);
/** Generous relative to the watchdog's 1s FIFO poll — apply/revert/stop are all near-instant `pfctl` calls. */
const CONFIRM_TIMEOUT_MS = 5_000;
/**
 * Opening a FIFO for writing blocks at the OS level until a reader is
 * present. The watchdog normally keeps one open for the whole session, but
 * if it died uncleanly (killed, crashed, reclaimed on sleep/wake) without
 * reaching `teardown_and_exit`'s `rm -f "$CMD_FIFO"`, the file lingers with
 * zero readers and a plain `fs.writeFile` would hang the caller's promise
 * forever — with no error, no state update, nothing. `enable()`/`disable()`
 * would then never resolve, which is worse than a normal failure: the UI's
 * toggle handler never gets a response to react to.
 */
const SEND_TIMEOUT_MS = 3_000;

export class MacHelperDriver implements SupervisedRedirectDriver {
  private session: Session | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * `enable`/`disable`/`teardown` all touch the same `session`/FIFO/
   * heartbeat state and none of it is safe under concurrent access (e.g. two
   * quick toggle clicks, or `RedirectController.enable()`'s own "revert
   * first if already applied" nested call overlapping a click that's still
   * in flight). Every public method runs through this queue so calls
   * execute one at a time, in call order, instead of racing.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: MacHelperSupervisorDeps) {}

  private log(msg: string): void {
    this.deps.log?.(msg);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Reuses the running helper (no new prompt) for any options, including a
   * different device/ports than last time — `apply` carries the new values
   * to the watchdog at runtime. Only falls back to a fresh elevated launch
   * (best-effort teardown of whatever's left first — the heartbeat timeout
   * is the backstop if that fails) when the running helper turns out to be
   * unreachable or doesn't confirm in time.
   */
  async enable(options: RedirectOptions): Promise<void> {
    return this.serialize(() => this.enableLocked(options));
  }

  /** Reverts the redirect but leaves the helper (and its heartbeat) running so a later enable() can reuse it. */
  async disable(): Promise<void> {
    return this.serialize(() => this.disableLocked());
  }

  /** Hard stop: reverts and exits the helper. Call once at extension deactivate/panel dispose — never on an ordinary toggle-off. */
  async teardown(): Promise<void> {
    return this.serialize(() => this.teardownLocked());
  }

  private async enableLocked(options: RedirectOptions): Promise<void> {
    if (this.session) {
      if (await this.tryReapply(options)) return;
      this.log('Mac helper reuse failed; relaunching with a new prompt.');
      await this.teardownLocked();
    }

    await this.launchFresh(options);
  }

  private async disableLocked(): Promise<void> {
    if (!this.session || !this.session.applied) return;

    const sendCommand = this.deps.sendCommand ?? defaultSendCommand;
    try {
      await sendCommand(this.session.cmdFifoPath, 'revert');
    } catch (err) {
      this.log(`Mac helper revert signal failed (heartbeat timeout will still tear it down if it's gone): ${(err as Error).message}`);
      return;
    }

    const waitForStatus = this.deps.waitForStatus ?? defaultWaitForStatus;
    const status = await waitForStatus(this.session.statusPath, ['reverted'], CONFIRM_TIMEOUT_MS);
    if (status !== 'reverted') {
      this.log(`Mac helper did not confirm revert in time (status: ${status ?? 'none'}).`);
    }
    this.session.applied = false;
  }

  private async teardownLocked(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const session = this.session;
    this.session = null;
    if (!session) return;

    const sendCommand = this.deps.sendCommand ?? defaultSendCommand;
    try {
      await sendCommand(session.cmdFifoPath, 'stop');
    } catch (err) {
      // Not fatal: with the heartbeat interval already cleared above, the
      // watchdog's own heartbeat timeout (if it's still alive at all) is the
      // backstop that guarantees it eventually tears itself down anyway.
      this.log(`Mac helper stop signal failed (heartbeat timeout will still tear it down): ${(err as Error).message}`);
      return;
    }

    const waitForStatus = this.deps.waitForStatus ?? defaultWaitForStatus;
    const status = await waitForStatus(session.statusPath, ['stopped'], CONFIRM_TIMEOUT_MS);
    if (status !== 'stopped') {
      this.log('Mac helper did not confirm full teardown in time; relying on its own heartbeat-timeout self-termination.');
    }
  }

  /** Sends `apply <options>` to the running helper and waits for it to confirm. Returns false if the helper is unreachable/stale. */
  private async tryReapply(options: RedirectOptions): Promise<boolean> {
    const session = this.session!;
    const sendCommand = this.deps.sendCommand ?? defaultSendCommand;
    try {
      await sendCommand(session.cmdFifoPath, 'apply', options);
    } catch (err) {
      this.log(`Mac helper is unreachable (${(err as Error).message}); it has likely already self-terminated.`);
      return false;
    }

    const waitForStatus = this.deps.waitForStatus ?? defaultWaitForStatus;
    const status = await waitForStatus(session.statusPath, ['ready', 'failed'], CONFIRM_TIMEOUT_MS);
    if (status !== 'ready') {
      this.log(`Mac helper did not confirm re-apply in time (status: ${status ?? 'none'}).`);
      return false;
    }
    session.options = options;
    session.applied = true;
    this.log('Mac helper redirect re-applied without a new prompt.');
    return true;
  }

  private async launchFresh(options: RedirectOptions): Promise<void> {
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

    this.session = { cmdFifoPath, statusPath, heartbeatPath, options, applied: true };
    const writeHeartbeat = this.deps.writeHeartbeat ?? defaultWriteHeartbeat;
    this.heartbeatTimer = setInterval(() => writeHeartbeat(heartbeatPath), HEARTBEAT_INTERVAL_MS);
    this.log('Mac helper ready. Heartbeat started.');
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

/** Exported for direct testing against a real FIFO — see `macHelperSupervisor.test.ts`. */
export function defaultSendCommand(fifoPath: string, command: 'apply' | 'revert' | 'stop', options?: RedirectOptions): Promise<void> {
  const line = command === 'apply' && options ? `apply ${options.rokuIp} ${options.proxyPort} ${options.ports.join(',')}\n` : `${command}\n`;
  const write = new Promise<void>((resolve, reject) => {
    fs.writeFile(fifoPath, line, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
  return withTimeout(write, SEND_TIMEOUT_MS, `writing '${command}' to the FIFO`);
}

/**
 * Races `promise` against a timer so a FIFO write with no reader (see
 * `SEND_TIMEOUT_MS`'s doc comment) rejects instead of hanging the caller
 * forever. The underlying `fs.writeFile` runs on libuv's threadpool, not the
 * main thread, so this timer still fires on schedule even while that write
 * is stuck — it just leaves the write itself to resolve (or never resolve)
 * in the background, which is harmless: nothing awaits it anymore.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out ${label} after ${timeoutMs}ms (no reader — the helper is likely dead)`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function defaultWaitForStatus(statusPath: string, accept: string[], timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = fs.readFileSync(statusPath, 'utf8').trim();
      if (accept.includes(status)) return status;
    } catch {
      /* not written yet */
    }
    await sleep(100);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

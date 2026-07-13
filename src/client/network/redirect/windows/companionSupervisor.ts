/**
 * Node-side counterpart to `companionScript.ts`: generates and launches the
 * elevated WinDivert companion, then supervises it for the lifetime of a
 * capture session — readiness handshake via a status file (the companion may
 * fail before it ever opens the named pipe, e.g. a blocked driver load), a
 * named-pipe control channel for stop/status, and a heartbeat so the
 * companion can detect and self-terminate if this process (or all of VS
 * Code) disappears without a clean `disable()`.
 *
 * Implements `WindowsRedirectDriver` so `RedirectController` can use it as a
 * drop-in for the win32 branch, exactly like the Linux/macOS `ElevatedRunner`
 * — but the underlying model is genuinely different (spawn + supervise + IPC,
 * not run-and-wait), which is why this isn't shoehorned into `elevate.ts`.
 */

import { randomBytes } from 'crypto';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { RedirectUnsupportedError, type RedirectOptions, type WindowsRedirectDriver } from '../redirectController';
import { buildWindowsCompanionScript, HEARTBEAT_TIMEOUT_SEC } from './companionScript';

export interface CompanionStatus {
  state: 'starting' | 'ready' | 'failed' | 'stopped';
  detail: string;
}

export interface CompanionPipeStatus {
  natEntries: number;
  packetsAtoB: number;
  packetsBtoA: number;
  uptimeSec: number;
}

export interface CompanionSupervisorDeps {
  /** Directory the generated script/log/status files are written to (auditable, like `elevate.ts`). */
  scriptDir: string;
  /** Resolves the folder containing WinDivert.dll/WinDivert64.sys. Throws when not configured. */
  resolveWinDivertDir: () => string;
  /** This machine's IP on the device's subnet. Undefined fails enable() with a clear message. */
  resolveGatewayIp: (rokuIp: string) => string | undefined;
  log?: (msg: string) => void;
  /** Overridable for tests — real implementation shells out via `Start-Process -Verb RunAs`. */
  launchElevated?: (scriptPath: string) => Promise<void>;
  /** Overridable for tests — real implementation is `fs.existsSync` polling. */
  waitForReady?: (statusPath: string, timeoutMs: number) => Promise<CompanionStatus>;
  /** Overridable for tests — real implementation is a Windows named-pipe `net.Socket`. */
  connectPipe?: (pipeName: string) => net.Socket;
}

const READY_TIMEOUT_MS = 15_000;
// Ping well inside the companion's HEARTBEAT_TIMEOUT_SEC so a single dropped
// write (GC pause, transient pipe hiccup) doesn't trip its self-termination.
const HEARTBEAT_INTERVAL_MS = Math.floor((HEARTBEAT_TIMEOUT_SEC * 1000) / 3);

export class WindowsCompanionDriver implements WindowsRedirectDriver {
  private pipe: net.Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: CompanionSupervisorDeps) {}

  private log(msg: string): void {
    this.deps.log?.(msg);
  }

  async enable(options: RedirectOptions): Promise<void> {
    await this.teardownPipe();

    const winDivertDir = this.deps.resolveWinDivertDir();
    const gatewayIp = this.deps.resolveGatewayIp(options.rokuIp);
    if (!gatewayIp) {
      // Environment issue, not a failed attempt — same "gracefully degrade to
      // the manual flow" treatment as an unconfigured winDivertDir below.
      throw new RedirectUnsupportedError(
        `Could not determine this machine's IP on ${options.rokuIp}'s subnet. Is the device connected via ICS?`,
      );
    }

    const sessionDir = path.join(this.deps.scriptDir, 'windivert');
    fs.mkdirSync(sessionDir, { recursive: true });

    const scriptPath = path.join(sessionDir, 'companion.ps1');
    const logPath = path.join(sessionDir, 'companion.log');
    const statusPath = path.join(sessionDir, 'companion-status.json');
    const pipeName = `kopytko-network-${randomBytes(6).toString('hex')}`;
    const token = randomBytes(24).toString('hex');

    try {
      fs.unlinkSync(statusPath);
    } catch {
      /* fine — didn't exist */
    }

    const script = buildWindowsCompanionScript({
      winDivertDllPath: path.join(winDivertDir, 'WinDivert.dll'),
      rokuIp: options.rokuIp,
      proxyPort: options.proxyPort,
      ports: options.ports,
      gatewayIp,
      pipeName,
      token,
      logPath,
      statusPath,
    });
    fs.writeFileSync(scriptPath, script, { encoding: 'utf8' });
    this.log(`Companion script written to ${scriptPath} (log: ${logPath})`);

    const launch = this.deps.launchElevated ?? launchElevatedCompanion;
    await launch(scriptPath);

    const waitForReady = this.deps.waitForReady ?? waitForStatusFile;
    const status = await waitForReady(statusPath, READY_TIMEOUT_MS);
    if (status.state !== 'ready') {
      const reason =
        status.state === 'starting'
          ? `companion never signaled ready within ${READY_TIMEOUT_MS / 1000}s — it may have been blocked or quarantined ` +
            `by antivirus/EDR software, or the UAC prompt was dismissed. Check ${logPath}.`
          : `${status.detail || 'unknown error'}. Check ${logPath}.`;
      throw new Error(`WinDivert companion failed to start: ${reason}`);
    }
    this.log('Companion signaled ready. Connecting control pipe.');

    const connect = this.deps.connectPipe ?? ((name: string) => net.connect({ path: `\\\\.\\pipe\\${name}` }));
    const pipe = await connectWithRetry(connect, pipeName, 5_000);
    await authenticate(pipe, token);
    this.pipe = pipe;

    this.heartbeatTimer = setInterval(() => {
      this.pipe?.write('ping\n');
    }, HEARTBEAT_INTERVAL_MS);

    pipe.on('close', () => {
      this.log('Companion pipe closed unexpectedly (companion process likely exited).');
      this.clearHeartbeat();
      this.pipe = null;
    });
    pipe.on('error', (err) => this.log(`Companion pipe error: ${err.message}`));
  }

  async disable(): Promise<void> {
    await this.teardownPipe();
  }

  /** Best-effort live status for the UI (nat entries / packet counts). Resolves `undefined` if not connected. */
  async status(): Promise<CompanionPipeStatus | undefined> {
    if (!this.pipe) return undefined;
    const reply = await sendCommand(this.pipe, 'status');
    return reply as unknown as CompanionPipeStatus;
  }

  private async teardownPipe(): Promise<void> {
    this.clearHeartbeat();
    const pipe = this.pipe;
    this.pipe = null;
    if (!pipe || pipe.destroyed) return;

    try {
      await sendCommand(pipe, 'stop');
    } catch (err) {
      this.log(`Companion stop command failed (continuing to close): ${(err as Error).message}`);
    } finally {
      pipe.end();
      pipe.destroy();
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// ── pipe helpers ──────────────────────────────────────────────────────────────

function connectWithRetry(connect: (name: string) => net.Socket, pipeName: string, timeoutMs: number): Promise<net.Socket> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect(pipeName);
      const onConnect = () => {
        socket.removeListener('error', onError);
        resolve(socket);
      };
      const onError = (err: Error) => {
        socket.removeListener('connect', onConnect);
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(err);
          return;
        }
        setTimeout(attempt, 200);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
    };
    attempt();
  });
}

const PIPE_RESPONSE_TIMEOUT_MS = 3_000;

function authenticate(pipe: net.Socket, token: string): Promise<void> {
  return readOneJsonLine(pipe, () => pipe.write(token + '\n'), 'auth').then((parsed) => {
    if (!parsed.ok) throw new Error((parsed.error as string | undefined) ?? 'authentication rejected');
  });
}

function sendCommand(pipe: net.Socket, command: string): Promise<Record<string, unknown> & { ok: boolean }> {
  return readOneJsonLine(pipe, () => pipe.write(command + '\n'), command).then((parsed) => {
    if (!parsed.ok) throw new Error((parsed.error as string | undefined) ?? `${command} failed`);
    return parsed as Record<string, unknown> & { ok: boolean };
  });
}

/**
 * Writes a command then waits for exactly one newline-delimited JSON reply.
 * Bounded by a timeout so a companion that stops responding (crashed
 * mid-command, pipe wedged) can never hang `disable()` forever — the
 * heartbeat watchdog on the companion side is the backstop that guarantees
 * the redirect itself still comes down even if this promise times out.
 */
function readOneJsonLine(pipe: net.Socket, send: () => void, context: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pipe.removeListener('data', onData);
      reject(new Error(`no response from companion for '${context}' within ${PIPE_RESPONSE_TIMEOUT_MS}ms`));
    }, PIPE_RESPONSE_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pipe.removeListener('data', onData);
      const line = buffer.slice(0, nl).trim();
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch {
        reject(new Error(`unexpected pipe response during ${context}: ${line}`));
      }
    };
    pipe.on('data', onData);
    send();
  });
}

// ── process/status helpers (real implementations, injectable for tests) ───────

/** Polls the companion's status file until it reports `ready`/`failed`, or times out (still `starting`). */
async function waitForStatusFile(statusPath: string, timeoutMs: number): Promise<CompanionStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: CompanionStatus = { state: 'starting', detail: '' };
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(statusPath, 'utf8');
      last = JSON.parse(raw) as CompanionStatus;
      if (last.state === 'ready' || last.state === 'failed') return last;
    } catch {
      /* file not written yet */
    }
    await sleep(250);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Launches the companion script elevated with its window hidden. This
 * process runs for the entire capture session, matching macOS/Linux's
 * toggle, where the redirect just runs invisibly after the one admin prompt
 * — a persistent visible console window for the whole session would be
 * unwanted chrome, not transparency: the UAC prompt itself is still the
 * real, unbypassed confirmation gate, and every action the companion takes
 * is still fully auditable via `companion.log`. Resolves once the
 * (non-elevated) launcher exits, which only confirms the UAC prompt was
 * accepted and the elevated process was started — actual readiness is
 * confirmed separately via the status file.
 */
function launchElevatedCompanion(scriptPath: string): Promise<void> {
  const inner =
    "Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden " +
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escapePs1(scriptPath)}')`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', inner], (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve();
    });
  });
}

function escapePs1(s: string): string {
  return s.replace(/'/g, "''");
}

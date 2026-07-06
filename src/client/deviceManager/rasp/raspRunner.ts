import type { EcpClient } from 'kopytko-roku-device';
import type { RaspScript, RaspStep, RaspStepEvent } from './raspTypes';

export interface RaspRunnerTarget {
  ip: string;
  port: number;
}

export interface RaspRunnerOptions {
  /** Cancels the run; the current await settles and the run throws AbortError. */
  signal: AbortSignal;
  /** Called for every executed step: once with `running`, then `ok`/`failed`. */
  onStep?: (event: RaspStepEvent) => void;
  /** Poll interval for wait_for_player_state / validate_streaming / launch. */
  pollIntervalMs?: number;
  /** Timeout for wait_for_player_state and validate_streaming polling. */
  waitTimeoutSec?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_WAIT_TIMEOUT_SEC = 30;
const DEFAULT_LAUNCH_TIMEOUT_SEC = 35;

/** Error thrown when a step fails; carries the step context for reporting. */
export class RaspStepError extends Error {
  constructor(message: string, readonly stepPath: string, readonly stepLabel: string) {
    super(message);
    this.name = 'RaspStepError';
  }
}

/**
 * Executes a parsed {@link RaspScript} against a device via ECP.
 *
 * Runs entirely in the extension host so a run survives the sidebar view
 * being collapsed/hidden (webview views don't retain context when hidden).
 * Every await races the abort signal; cancellation throws a DOMException
 * with name `AbortError` (matching `AbortSignal.throwIfAborted`).
 */
export class RaspRunner {
  constructor(private readonly ecp: EcpClient) {}

  async run(script: RaspScript, target: RaspRunnerTarget, options: RaspRunnerOptions): Promise<void> {
    const ctx: RunContext = {
      script,
      target,
      signal: options.signal,
      onStep: options.onStep ?? (() => {}),
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      waitTimeoutSec: options.waitTimeoutSec ?? DEFAULT_WAIT_TIMEOUT_SEC,
      total: countSteps(script.steps),
      index: 0,
    };

    await this.runSteps(script.steps, 'steps', ctx);
  }

  private async runSteps(steps: RaspStep[], path: string, ctx: RunContext): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      await this.runStep(steps[i], `${path}[${i}]`, ctx);
    }
  }

  private async runStep(step: RaspStep, path: string, ctx: RunContext): Promise<void> {
    ctx.signal.throwIfAborted();

    // Loops report their children, not themselves.
    if (step.kind === 'loop') {
      for (let iteration = 0; iteration < step.iterations; iteration++) {
        await this.runSteps(step.steps, `${path}.loop[${iteration}]`, ctx);
      }
      return;
    }

    const label = labelOf(step);
    const index = ctx.index++;
    const report = (status: 'running' | 'ok' | 'failed', message?: string): void =>
      ctx.onStep({ index, total: ctx.total, path, label, status, message });

    report('running');
    try {
      await this.execute(step, ctx);
      report('ok');
    } catch (err) {
      if (isAbortError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      report('failed', message);
      throw new RaspStepError(message, path, label);
    }
  }

  private async execute(step: Exclude<RaspStep, { kind: 'loop' }>, ctx: RunContext): Promise<void> {
    const { ip, port } = ctx.target;

    switch (step.kind) {
      case 'press':
        await this.ecp.keypress(ip, step.key, port);
        await sleep(ctx.script.defaultKeypressWaitSec * 1000, ctx.signal);
        return;

      case 'text':
        await this.ecp.sendText(ip, step.text, port);
        await sleep(ctx.script.defaultKeypressWaitSec * 1000, ctx.signal);
        return;

      case 'pause':
        await sleep(step.seconds * 1000, ctx.signal);
        return;

      case 'launch': {
        const params: Record<string, string> = {};
        if (step.contentId !== undefined) params['contentId'] = step.contentId;
        if (step.mediaType !== undefined) params['mediaType'] = step.mediaType;
        await this.ecp.launchApp(ip, step.channelId!, params, port);

        // Poll until the channel is the foreground app, up to the timeout.
        const timeoutMs = (step.timeoutSec ?? DEFAULT_LAUNCH_TIMEOUT_SEC) * 1000;
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const active = await this.tryQueryActiveApp(ip, port);
          if (active?.id === step.channelId) return;
          if (Date.now() >= deadline) {
            throw new Error(`Channel ${step.channelName ?? step.channelId} did not become active within ${timeoutMs / 1000}s (foreground: ${active?.name ?? 'unknown'}).`);
          }
          await sleep(ctx.pollIntervalMs, ctx.signal);
        }
      }

      case 'wait_for_player_state': {
        const deadline = Date.now() + ctx.waitTimeoutSec * 1000;
        for (;;) {
          const player = await this.tryQueryMediaPlayer(ip, port);
          const state = player?.state;
          if (state !== undefined && playerStateMatches(step.state, state)) return;
          if (Date.now() >= deadline) {
            throw new Error(`Player did not reach state "${step.state}" within ${ctx.waitTimeoutSec}s (last state: ${state ?? 'unreachable'}).`);
          }
          await sleep(ctx.pollIntervalMs, ctx.signal);
        }
      }

      case 'validate_streaming': {
        // Wait (bounded) for playback, then assert the reported stream format.
        const deadline = Date.now() + ctx.waitTimeoutSec * 1000;
        let player = await this.tryQueryMediaPlayer(ip, port);
        while (player?.state !== 'play') {
          if (Date.now() >= deadline) {
            throw new Error(`validate_streaming: player is not playing (state: ${player?.state ?? 'unreachable'}).`);
          }
          await sleep(ctx.pollIntervalMs, ctx.signal);
          player = await this.tryQueryMediaPlayer(ip, port);
        }

        const failures: string[] = [];
        const check = (name: string, expected: string | undefined, actual: string | undefined): void => {
          if (expected === undefined) return;
          if (actual === undefined || !actual.toLowerCase().includes(expected.toLowerCase())) {
            failures.push(`${name}: expected "${expected}", device reports "${actual ?? 'none'}"`);
          }
        };
        check('audio_codec', step.audioCodec, player.format?.audio);
        check('video_codec', step.videoCodec, player.format?.video);
        check('drm', step.drm, player.format?.drm);

        if (failures.length > 0) {
          throw new Error(`validate_streaming failed — ${failures.join('; ')}.`);
        }
        return;
      }
    }
  }

  private async tryQueryActiveApp(ip: string, port: number): Promise<{ id?: string; name: string } | undefined> {
    try {
      return await this.ecp.queryActiveApp(ip, port);
    } catch {
      return undefined;
    }
  }

  private async tryQueryMediaPlayer(ip: string, port: number): Promise<Awaited<ReturnType<EcpClient['queryMediaPlayer']>> | undefined> {
    try {
      return await this.ecp.queryMediaPlayer(ip, port);
    } catch {
      return undefined;
    }
  }
}

interface RunContext {
  script: RaspScript;
  target: RaspRunnerTarget;
  signal: AbortSignal;
  onStep: (event: RaspStepEvent) => void;
  pollIntervalMs: number;
  waitTimeoutSec: number;
  total: number;
  index: number;
}

/** Total executed-step count with loops expanded (loops themselves excluded). */
export function countSteps(steps: RaspStep[]): number {
  let count = 0;
  for (const step of steps) {
    count += step.kind === 'loop' ? step.iterations * countSteps(step.steps) : 1;
  }
  return count;
}

/** Human-readable label for progress reporting. */
export function labelOf(step: RaspStep): string {
  switch (step.kind) {
    case 'press': return `press ${step.key}`;
    case 'text': return `text "${step.text.length > 24 ? `${step.text.slice(0, 24)}…` : step.text}"`;
    case 'pause': return `pause ${step.seconds}s`;
    case 'wait_for_player_state': return `wait for player: ${step.state}`;
    case 'launch': return `launch ${step.channelName ?? step.channelId}`;
    case 'loop': return `loop ×${step.iterations}`;
    case 'validate_streaming': return 'validate streaming';
  }
}

/** `stop` matches every "not playing anything" state the device may report. */
function playerStateMatches(expected: 'play' | 'pause' | 'stop', actual: string): boolean {
  if (expected === 'stop') return actual === 'stop' || actual === 'none' || actual === 'close';
  return actual === expected;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Abortable sleep — resolves after `ms`, rejects with AbortError on cancel. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    signal.throwIfAborted();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

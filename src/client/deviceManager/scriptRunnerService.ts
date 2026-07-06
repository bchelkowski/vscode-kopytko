import * as vscode from 'vscode';
import type { DeviceManager, EcpClient } from 'kopytko-roku-device';
import { parseRasp } from './rasp/raspParser';
import { RaspRunner, RaspStepError } from './rasp/raspRunner';
import type { ScriptFormat } from './scriptStore';

export interface RunProgressEvent {
  /** Store id, or a synthetic `editor:` id for unsaved editor runs. */
  scriptId: string;
  index: number;
  total: number;
  label: string;
  status: 'running' | 'ok' | 'failed' | 'cancelled' | 'done';
  message?: string;
}

/**
 * Host-owned script execution service. Runs live here (not in a webview) so
 * they survive the sidebar views being collapsed — webview views don't retain
 * context when hidden. Progress fans out to every subscriber (sidebar view,
 * editor panels) and mirrors into a cancellable notification.
 *
 * One run at a time: scripts drive the device's single remote-control input,
 * so concurrent runs would interleave keypresses.
 */
export class ScriptRunnerService {
  private readonly progressEmitter = new vscode.EventEmitter<RunProgressEvent>();
  readonly onProgress = this.progressEmitter.event;

  private activeRun: { scriptId: string; abort: AbortController } | undefined;

  constructor(
    private readonly deviceManager: DeviceManager,
    private readonly ecp: EcpClient,
  ) {}

  get runningScriptId(): string | undefined {
    return this.activeRun?.scriptId;
  }

  /** Cancels the active run (no-op when nothing runs or the id differs). */
  cancel(scriptId?: string): void {
    if (!this.activeRun) return;
    if (scriptId !== undefined && this.activeRun.scriptId !== scriptId) return;
    this.activeRun.abort.abort();
  }

  /**
   * Parses and runs a script against the active device. Resolves when the run
   * finishes (success, failure, or cancel) — errors are reported through
   * progress events and toasts, not thrown, so callers just fire-and-forget.
   */
  async run(scriptId: string, title: string, format: ScriptFormat, source: string): Promise<void> {
    if (this.activeRun) {
      void vscode.window.showWarningMessage('A device script is already running — cancel it first.');
      return;
    }

    const device = this.deviceManager.getActiveDevice();
    if (!device) {
      void vscode.window.showErrorMessage('No active Roku device. Select a device in the Roku Devices view first.');
      return;
    }

    if (format !== 'rasp') {
      void vscode.window.showErrorMessage(`Script format "${format}" is not supported yet.`);
      return;
    }

    const { script, errors } = parseRasp(source);
    if (!script) {
      const first = errors[0];
      const where = first?.line !== undefined ? ` (line ${first.line})` : first?.path ? ` (${first.path})` : '';
      void vscode.window.showErrorMessage(`Script "${title}" has errors${where}: ${first?.message ?? 'unknown error'}`);
      return;
    }

    const config = vscode.workspace.getConfiguration('kopytko');
    const pollIntervalMs = config.get<number>('deviceManager.runner.pollIntervalMs', 500);
    const waitTimeoutSec = config.get<number>('deviceManager.runner.waitTimeoutSec', 30);

    const abort = new AbortController();
    this.activeRun = { scriptId, abort };

    const emit = (event: Omit<RunProgressEvent, 'scriptId'>): void =>
      this.progressEmitter.fire({ scriptId, ...event });

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running "${title}" on ${device.friendlyName || device.ip}`,
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => abort.abort());

          const runner = new RaspRunner(this.ecp);
          await runner.run(script, { ip: device.ip, port: device.port }, {
            signal: abort.signal,
            pollIntervalMs,
            waitTimeoutSec,
            onStep: (step) => {
              emit(step);
              if (step.status === 'running') {
                progress.report({
                  message: `${step.index + 1}/${step.total} — ${step.label}`,
                  increment: 100 / step.total,
                });
              }
            },
          });
        },
      );
      emit({ index: 0, total: 0, label: '', status: 'done' });
    } catch (err) {
      if (abort.signal.aborted) {
        emit({ index: 0, total: 0, label: '', status: 'cancelled' });
        void vscode.window.showInformationMessage(`Script "${title}" cancelled.`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        const label = err instanceof RaspStepError ? err.stepLabel : '';
        emit({ index: 0, total: 0, label, status: 'failed', message });
        void vscode.window.showErrorMessage(`Script "${title}" failed${label ? ` at "${label}"` : ''}: ${message}`);
      }
    } finally {
      this.activeRun = undefined;
    }
  }

  dispose(): void {
    this.activeRun?.abort.abort();
    this.progressEmitter.dispose();
  }
}

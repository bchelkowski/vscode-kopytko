import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as vscode from 'vscode';

const NORMAL_POLL_MS = 15_000;
const ALERT_POLL_MS = 1_000;
const ALERT_ITERATIONS = 30;
const SLEEP_CHECK_MS = 60_000;
const SLEEP_THRESHOLD_MS = 120_000;

interface NetworkMonitorEvents {
  'network-changed': [networkId: string];
  'wake': [];
}

/**
 * Monitors network interface changes and system sleep/wake events.
 *
 * Polls `os.networkInterfaces()` to detect IP changes and uses a timer-gap
 * heuristic to detect sleep/wake transitions. Pauses polling when the VS Code
 * window loses focus to reduce CPU usage.
 */
export class NetworkMonitor extends EventEmitter<NetworkMonitorEvents> {
  private pollTimer: NodeJS.Timeout | undefined;
  private sleepTimer: NodeJS.Timeout | undefined;
  private lastSleepCheck: number = 0;
  private lastNetworkId: string = '';
  private alertRemaining: number = 0;
  private focused: boolean = true;
  private focusDisposable: vscode.Disposable | undefined;

  // --- Public API ---

  /** Begin network polling and sleep/wake detection. */
  start(): void {
    this.lastNetworkId = this.computeNetworkId();
    this.lastSleepCheck = Date.now();
    this.focused = vscode.window.state.focused;

    this.focusDisposable = vscode.window.onDidChangeWindowState((state) => {
      this.focused = state.focused;
      if (state.focused) {
        this.resumePolling();
      } else {
        this.pausePolling();
      }
    });

    this.startPolling(NORMAL_POLL_MS);
    this.startSleepDetection();
  }

  /** Stop all timers and clean up listeners. */
  stop(): void {
    this.clearPolling();
    this.clearSleepDetection();
    this.focusDisposable?.dispose();
    this.focusDisposable = undefined;
    this.removeAllListeners();
  }

  /** Return the current network fingerprint hash. */
  getCurrentNetworkId(): string {
    return this.computeNetworkId();
  }

  // --- Network ID computation ---

  /**
   * Build an MD5 hash of all non-internal, non-link-local IPv4 interfaces.
   * Returns `'no-network'` when no qualifying interfaces exist.
   */
  private computeNetworkId(): string {
    const parts: string[] = [];

    for (const [, iface] of Object.entries(os.networkInterfaces())) {
      if (!iface) continue;
      for (const info of iface) {
        if (info.internal) continue;
        if (info.family === 'IPv4' && info.address.startsWith('169.254.')) continue;
        if (info.family === 'IPv6' && info.address.startsWith('fe80:')) continue;
        if (info.family === 'IPv4') {
          parts.push(`${info.address}:${info.netmask}`);
        }
      }
    }

    if (parts.length === 0) return 'no-network';
    parts.sort();
    return crypto.createHash('md5').update(parts.join('|')).digest('hex');
  }

  // --- Polling ---

  private startPolling(intervalMs: number): void {
    this.clearPolling();
    this.pollTimer = setInterval(() => this.checkNetwork(), intervalMs);
    this.pollTimer.unref?.();
  }

  private clearPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private checkNetwork(): void {
    const id = this.computeNetworkId();
    if (id !== this.lastNetworkId) {
      this.lastNetworkId = id;
      this.emit('network-changed', id);
    }

    if (this.alertRemaining > 0) {
      this.alertRemaining--;
      if (this.alertRemaining === 0) {
        this.startPolling(NORMAL_POLL_MS);
      }
    }
  }

  private pausePolling(): void {
    this.clearPolling();
  }

  private resumePolling(): void {
    const interval = this.alertRemaining > 0 ? ALERT_POLL_MS : NORMAL_POLL_MS;
    this.startPolling(interval);
    this.checkNetwork();
  }

  // --- Sleep / wake detection ---

  private startSleepDetection(): void {
    this.lastSleepCheck = Date.now();
    this.sleepTimer = setInterval(() => this.checkSleep(), SLEEP_CHECK_MS);
    this.sleepTimer.unref?.();
  }

  private clearSleepDetection(): void {
    if (this.sleepTimer !== undefined) {
      clearInterval(this.sleepTimer);
      this.sleepTimer = undefined;
    }
  }

  private checkSleep(): void {
    const now = Date.now();
    const elapsed = now - this.lastSleepCheck;
    this.lastSleepCheck = now;

    if (elapsed > SLEEP_CHECK_MS + SLEEP_THRESHOLD_MS) {
      this.onWake();
    }
  }

  /** Switch to alert-mode polling and notify listeners. */
  private onWake(): void {
    this.alertRemaining = ALERT_ITERATIONS;
    this.startPolling(ALERT_POLL_MS);
    this.emit('wake');
  }
}

export default NetworkMonitor;

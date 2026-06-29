import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { diagnosticsLock } from '../diagnostics/diagnosticsLock';
import { deployForPerfetto } from '../roku/rokuDeployer';
import { getAvailableEnvironments } from '../roku/kopytkorc';
import { enablePerfettoTracing, triggerHeapSnapshot } from './ecpTracing';
import { PerfettoWebSocketClient } from './transport/perfettoWebSocketClient';
import {
  buildPerfettoSessionId,
  writeManifest,
  listSessions,
  PERFETTO_TRACE_FILE,
  SCHEMA_VERSION,
  type PerfettoManifest,
  type PerfettoSessionInfo,
} from './session/perfettoSessionStore';
import type { CredentialStore } from '../roku/persistence/credentialStore';
import type { DeviceManager } from '../roku/discovery/deviceManager';
import type { EcpClient } from '../roku/discovery/ecpClient';
import type { RokuDevice } from '../roku/types';

export interface PerfettoControllerDeps {
  deviceManager: DeviceManager;
  ecp: EcpClient;
  credentials: CredentialStore;
  workspaceRoot: string;
}

export interface ActivePerfettoSession {
  id: string;
  dir: string;
  startedWall: number;
  app: { id?: string; title?: string; version?: string };
}

/**
 * Emits:
 * - `'data'`  (chunk: Buffer)  — raw binary Perfetto chunk, forwarded to webview
 * - `'stop'`                  — session ended
 * - `'error'` (err: Error)    — transport error
 */
export class PerfettoController extends EventEmitter {
  private ws: PerfettoWebSocketClient | null = null;
  private writeStream: fs.WriteStream | null = null;
  private _session: ActivePerfettoSession | null = null;
  private _manifest: PerfettoManifest | null = null;

  constructor(private readonly deps: PerfettoControllerDeps) {
    super();
  }

  get activeSession(): ActivePerfettoSession | null {
    return this._session;
  }

  get isRecording(): boolean {
    return this._session !== null;
  }

  getActiveDevice() {
    return this.deps.deviceManager.getActiveDevice();
  }

  async startSession(): Promise<ActivePerfettoSession | undefined> {
    if (this._session) return this._session;

    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      vscode.window.showWarningMessage(
        'Kopytko Perfetto: no active Roku device. Select a device first.',
      );
      return undefined;
    }

    if (!diagnosticsLock.acquire('perfetto')) {
      vscode.window.showWarningMessage(
        'Kopytko Perfetto: Diagnostics panel is currently running. Stop it first.',
      );
      return undefined;
    }

    try {
      return await this._start(device!);
    } catch (err) {
      diagnosticsLock.release('perfetto');
      throw err;
    }
  }

  private async _start(device: RokuDevice): Promise<ActivePerfettoSession | undefined> {
    const cfg = vscode.workspace.getConfiguration('kopytko');
    const outputDir = cfg.get<string>('diagnostics.outputDir', 'debug');
    const ecpPort = cfg.get<number>('perfetto.ecpPort', 8060);
    const startCommand = cfg.get<string>('perfetto.startCommand', '');
    const { workspaceRoot } = this.deps;

    const root = path.isAbsolute(outputDir)
      ? outputDir
      : path.join(workspaceRoot, outputDir);

    // Resolve password + environment using the same approach as the debug session.
    const password = (await this.deps.credentials.getPassword(device.deviceId || device.serialNumber)) ?? '';
    const env = this.deps.deviceManager.getEffectiveEnvironment(
      device.serialNumber,
      getAvailableEnvironments(workspaceRoot),
    ) ?? 'dev';

    // 1. Enable Perfetto on the device first so tracing is active the moment
    //    the channel starts after the deploy step.
    await enablePerfettoTracing(device.ip, 'dev', ecpPort);

    // 2. Open the WebSocket now — it stays open waiting for the channel to start.
    //    Any trace packets produced during channel boot are captured from the start.
    const earlyWs = new PerfettoWebSocketClient(device.ip, ecpPort);
    earlyWs.start();

    // 3. Deploy with run_as_process=1 (slow — build + upload + Roku installs channel).
    try {
      await deployForPerfetto({
        rootDir: workspaceRoot,
        host: device.ip,
        password,
        env,
        startCommand: startCommand || undefined,
        onOutput: (msg) => console.log('[perfetto deploy]', msg),
      });
    } catch (err) {
      earlyWs.dispose();
      throw err;
    }

    // 4. Resolve app metadata for session folder name.
    const app = await this._resolveApp(device.ip, device.port);
    const startedWall = Date.now();
    const id = buildPerfettoSessionId(startedWall, app.title ?? device.modelName);
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });

    const manifest: PerfettoManifest = {
      schemaVersion: SCHEMA_VERSION,
      id,
      startedWall,
      endedWall: null,
      device: {
        deviceId: device.deviceId,
        serialNumber: device.serialNumber,
        ip: device.ip,
        modelName: device.modelName,
        softwareVersion: device.softwareVersion,
      },
      app,
    };
    writeManifest(dir, manifest);
    this._manifest = manifest;

    // 5. Open write stream for binary trace file.
    this.writeStream = fs.createWriteStream(path.join(dir, PERFETTO_TRACE_FILE));

    // 6. Hand the early WS to the session — it's already connected and may have
    //    data buffered from channel startup.
    this.ws = earlyWs;

    earlyWs.on('data', (chunk: Buffer) => {
      this.writeStream?.write(chunk);
      this.emit('data', chunk);
    });

    earlyWs.on('error', (err: Error) => this.emit('error', err));

    earlyWs.on('close', () => {
      if (this._session) {
        void this.stopSession();
      }
    });

    this._session = { id, dir, startedWall, app };
    return this._session;
  }

  async stopSession(): Promise<void> {
    const session = this._session;
    if (!session) return;

    this._session = null;

    // Release immediately so the Diagnostics panel becomes available
    // without waiting for WS drain + file flush to complete.
    diagnosticsLock.release('perfetto');

    // Stop the WebSocket first (quiet-window drain).
    if (this.ws) {
      await this.ws.stop();
      this.ws.dispose();
      this.ws = null;
    }

    // Flush and close the write stream.
    await new Promise<void>((resolve) => {
      if (this.writeStream) {
        this.writeStream.end(resolve);
        this.writeStream = null;
      } else {
        resolve();
      }
    });

    // Finalize manifest.
    if (this._manifest) {
      this._manifest.endedWall = Date.now();
      writeManifest(session.dir, this._manifest);
      this._manifest = null;
    }

    this.emit('stop', session);
  }

  async captureHeapSnapshot(): Promise<void> {
    if (!this._session) {
      vscode.window.showWarningMessage('Kopytko Perfetto: no active session.');
      return;
    }
    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) return;

    const cfg = vscode.workspace.getConfiguration('kopytko');
    const ecpPort = cfg.get<number>('perfetto.ecpPort', 8060);
    await triggerHeapSnapshot(device.ip, 'dev', ecpPort);
  }

  /** Returns the complete binary trace for the active session (for webview replay). */
  getActiveBuffer(): Buffer | null {
    return this.ws?.getBuffer() ?? null;
  }

  /** Lists all saved Perfetto sessions under the configured output dir. */
  listSessions(): PerfettoSessionInfo[] {
    const cfg = vscode.workspace.getConfiguration('kopytko');
    const outputDir = cfg.get<string>('diagnostics.outputDir', 'debug');
    const { workspaceRoot } = this.deps;
    const root = path.isAbsolute(outputDir) ? outputDir : path.join(workspaceRoot, outputDir);
    return listSessions(root);
  }

  /** Reads the binary trace file for a past session. */
  readSessionTrace(dir: string): Buffer {
    const tracePath = path.join(dir, PERFETTO_TRACE_FILE);
    return fs.readFileSync(tracePath);
  }

  dispose(): void {
    void this.stopSession();
  }

  private async _resolveApp(
    ip: string,
    port: number,
  ): Promise<{ id?: string; title?: string; version?: string }> {
    try {
      const apps = await this.deps.ecp.queryApps(ip, port);
      const dev = apps.find((a) => a.id === 'dev');
      if (dev) return { id: dev.id, title: dev.name, version: dev.version };
    } catch {
      // Device offline or no dev channel — record without app meta.
    }
    return {};
  }
}

import * as path from 'path';
import * as vscode from 'vscode';
import type { DeviceManager } from '../roku/discovery/deviceManager';
import type { EcpClient } from '../roku/discovery/ecpClient';
import type { RendezvousManager } from '../roku/rendezvous/rendezvousManager';
import { DebugConsoleClient, type ConsoleSocketFactory } from './transport/debugConsoleClient';
import { diagnosticsLock } from './diagnosticsLock';
import {
  type Collector,
  SystemMemCollector,
  TextureCollector,
  RendezvousCollector,
} from './collectors';
import { EcpChanperfCollector } from './collectors/ecpChanperfCollector';
import { EcpNodeCountsCollector } from './collectors/ecpNodeCountsCollector';
import { DiagnosticsSession } from './session/diagnosticsSession';
import type { DiagnosticEventType } from './session/eventModel';
import { type DiagnosticsSink, nodeSink } from './storage/sink';
import {
  type SessionManifest,
  SCHEMA_VERSION,
  buildSessionId,
} from './storage/sessionStore';

export interface DiagnosticsControllerDeps {
  deviceManager: DeviceManager;
  ecp: EcpClient;
  rendezvousManager: RendezvousManager;
  workspaceRoot: string;
}

/**
 * Owns the lifecycle of a recording diagnostics session: reads configuration,
 * builds the transport + collectors for the active device, starts/stops the
 * session, and suspends the legacy Rendezvous Log poller while recording so the
 * two don't both drain the shared ECP event queue.
 */
export class DiagnosticsController {
  private session: DiagnosticsSession | undefined;
  private rendezvousSuspended = false;

  constructor(
    private readonly deps: DiagnosticsControllerDeps,
    private readonly sink: DiagnosticsSink = nodeSink,
    /** Injectable for tests so no real socket is opened. */
    private readonly socketFactory?: ConsoleSocketFactory,
    /** Optional output channel for connection diagnostics. */
    private readonly outputChannel?: vscode.OutputChannel,
  ) {}

  get activeSession(): DiagnosticsSession | undefined {
    return this.session;
  }

  get isRecording(): boolean {
    return this.session?.isRunning ?? false;
  }

  /** Returns the currently active Roku device, for display in the panel. */
  getActiveDevice() {
    return this.deps.deviceManager.getActiveDevice();
  }

  async startSession(): Promise<DiagnosticsSession | undefined> {
    if (this.session) return this.session;

    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      vscode.window.showWarningMessage(
        'Kopytko Diagnostics: no active Roku device. Select a device first.',
      );
      return undefined;
    }
    if (!this.deps.workspaceRoot) {
      vscode.window.showWarningMessage('Kopytko Diagnostics: open a workspace folder first.');
      return undefined;
    }

    if (!diagnosticsLock.acquire('diagnostics')) {
      vscode.window.showWarningMessage(
        'Kopytko Diagnostics: Kopytko Perfetto is currently recording. Stop it first.',
      );
      return undefined;
    }

    const cfg = vscode.workspace.getConfiguration('kopytko');
    const num = (key: string, def: number) => cfg.get<number>(key, def);
    const bool = (key: string, def: boolean) => cfg.get<boolean>(key, def);

    // mem-cpu and node-counts are fetched via ECP (HTTP port 8060) —
    // this is the same port as rendezvous and works without remotedebug=1.
    // The old raw-TCP debug console on port 8080 is kept only for the opt-in
    // systemMem and textures collectors which have no ECP equivalent yet.
    const ecpPort = device.port; // 8060 by default

    const consolePort = num('diagnostics.debugConsolePort', 8080);
    const needsConsole =
      bool('diagnostics.collectors.systemMem.enabled', false) ||
      bool('diagnostics.collectors.textures.enabled', false);

    const consoleClient = needsConsole
      ? new DebugConsoleClient({
          host: device.ip,
          port: consolePort,
          socketFactory: this.socketFactory,
        })
      : null;

    const log = (msg: string) =>
      this.outputChannel?.appendLine(`[${new Date().toISOString()}] ${msg}`);

    if (consoleClient) {
      consoleClient.on('ready', () =>
        log(`Debug console connected to ${device.ip}:${consolePort}`));
      consoleClient.on('disconnected', () =>
        log(`Debug console disconnected from ${device.ip}:${consolePort} — reconnecting...`));
    }

    const collectors: Collector[] = [];
    const collectorMeta: { type: DiagnosticEventType; intervalMs: number }[] = [];
    const add = (collector: Collector, intervalMs: number) => {
      collectors.push(collector);
      collectorMeta.push({ type: collector.type, intervalMs });
    };

    if (bool('diagnostics.collectors.memCpu.enabled', true)) {
      const i = num('diagnostics.collectors.memCpu.intervalMs', 1000);
      add(new EcpChanperfCollector(this.deps.ecp, device.ip, ecpPort, i), i);
    }
    if (bool('diagnostics.collectors.nodeCounts.enabled', true)) {
      const i = num('diagnostics.collectors.nodeCounts.intervalMs', 2000);
      add(new EcpNodeCountsCollector(this.deps.ecp, device.ip, ecpPort, i), i);
    }
    if (bool('diagnostics.collectors.systemMem.enabled', false) && consoleClient) {
      const i = num('diagnostics.collectors.systemMem.intervalMs', 5000);
      add(new SystemMemCollector(consoleClient, i), i);
    }
    if (bool('diagnostics.collectors.textures.enabled', false) && consoleClient) {
      const i = num('diagnostics.collectors.textures.intervalMs', 5000);
      add(new TextureCollector(consoleClient, i), i);
    }

    const collectRendezvous = bool('diagnostics.collectors.rendezvous.enabled', true);
    if (collectRendezvous) {
      const i = num('diagnostics.collectors.rendezvous.intervalMs', 1000);
      add(new RendezvousCollector(this.deps.ecp, { ip: device.ip, port: device.port }, i), i);
    }

    const app = await this.resolveApp(device.ip, device.port);

    const startedWall = Date.now();
    const id = buildSessionId(startedWall, app.title ?? device.modelName);
    const outputDir = cfg.get<string>('diagnostics.outputDir', 'debug');
    const root = path.isAbsolute(outputDir)
      ? outputDir
      : path.join(this.deps.workspaceRoot, outputDir);
    const dir = path.join(root, id);

    const manifest: SessionManifest = {
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
      collectors: collectorMeta,
      streams: {},
    };

    // Avoid the ECP rendezvous queue being drained by two pollers at once.
    if (collectRendezvous) {
      this.deps.rendezvousManager.suspend();
      this.rendezvousSuspended = true;
    }

    const session = new DiagnosticsSession({
      sink: this.sink,
      dir,
      manifest,
      collectors,
      transports: consoleClient ? [consoleClient] : [],
      ringSize: num('diagnostics.maxLivePoints', 3600),
    });
    this.session = session;

    try {
      await session.start();
    } catch (err) {
      this.session = undefined;
      if (this.rendezvousSuspended) {
        this.deps.rendezvousManager.resume();
        this.rendezvousSuspended = false;
      }
      consoleClient?.close();
      diagnosticsLock.release('diagnostics');
      throw err;
    }

    return session;
  }

  async stopSession(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = undefined;

    // Release the lock immediately so the Perfetto panel becomes available
    // as soon as the user clicks Stop, without waiting for the async cleanup.
    diagnosticsLock.release('diagnostics');

    await session.stop();

    if (this.rendezvousSuspended) {
      this.deps.rendezvousManager.resume();
      this.rendezvousSuspended = false;
    }
  }

  dispose(): void {
    void this.stopSession();
  }

  private async resolveApp(
    ip: string,
    port: number,
  ): Promise<{ id?: string; title?: string; version?: string }> {
    try {
      const apps = await this.deps.ecp.queryApps(ip, port);
      const dev = apps.find((a) => a.id === 'dev');
      if (dev) return { id: dev.id, title: dev.name, version: dev.version };
    } catch {
      // Device may be offline or no dev channel sideloaded — record without app meta.
    }
    return {};
  }
}

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
  AppStateCollector,
  FwBeaconCollector,
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
import { parseRegistryXml } from '../roku/views/registryProvider';

export interface RecordableApp {
  id: string;
  title: string;
  version?: string;
}

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
  /** App id to target for the *next* session. Always defaults to the sideloaded dev channel. */
  private selectedAppId = 'dev';

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

  get selectedApp(): string {
    return this.selectedAppId;
  }

  /** Returns the currently active Roku device, for display in the panel. */
  getActiveDevice() {
    return this.deps.deviceManager.getActiveDevice();
  }

  /**
   * Changes which app the *next* session targets. If a session is currently
   * recording and the selection actually changed, it's stopped immediately —
   * a running session always reflects the app it was started for, never a
   * silently-swapped target.
   */
  async setSelectedApp(appId: string): Promise<void> {
    const changed = appId !== this.selectedAppId;
    this.selectedAppId = appId;
    if (changed && this.isRecording) {
      await this.stopSession();
    }
  }

  /**
   * Lists apps sharing the same developer key as the sideloaded "dev" channel
   * (i.e. apps recordable via this panel), by cross-referencing ECP
   * `/query/registry/dev`'s `<plugins>` field (every channel id signed with
   * the same developer key — confirmed live: this list is identical no matter
   * which of those channel ids you query the registry for, and any other app
   * fails with "Specified dev ID does not match the device key") against
   * `/query/apps` for display names. Falls back to just the dev channel alone
   * if the registry lookup fails (e.g. no sideloaded channel present).
   */
  async listAvailableApps(): Promise<RecordableApp[]> {
    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) return [];

    let apps;
    try {
      apps = await this.deps.ecp.queryApps(device.ip, device.port);
    } catch {
      return [];
    }

    const devApp = apps.find((a) => a.id === 'dev');
    const toRecordable = (a: (typeof apps)[number]): RecordableApp => ({
      id: a.id,
      title: a.name,
      version: a.version,
    });

    try {
      const registryXml = await this.deps.ecp.queryRegistry(device.ip, 'dev', device.port);
      const registry = parseRegistryXml(registryXml);
      if (registry.status && registry.status !== 'OK') throw new Error(registry.error ?? 'registry query failed');

      const sharedIds = new Set(
        registry.plugins.split(',').map((s) => s.trim()).filter(Boolean),
      );
      sharedIds.add('dev');

      const result = apps.filter((a) => sharedIds.has(a.id)).map(toRecordable);
      result.sort((a, b) => (a.id === 'dev' ? -1 : b.id === 'dev' ? 1 : a.title.localeCompare(b.title)));
      return result;
    } catch {
      // No sideloaded channel, or registry access unavailable — dev-only, if present.
      return devApp ? [toRecordable(devApp)] : [];
    }
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
    // Always create the console client: textures collector (which uses port 8080) is
    // enabled by default now, and even when user turns it off in settings the client
    // is cheap (idle-framed, auto-reconnects, emits nothing when no commands queued).
    const consoleClient = new DebugConsoleClient({
      host: device.ip,
      port: consolePort,
      socketFactory: this.socketFactory,
    });

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
    if (bool('diagnostics.collectors.systemMem.enabled', false)) {
      const i = num('diagnostics.collectors.systemMem.intervalMs', 5000);
      add(new SystemMemCollector(consoleClient, i), i);
    }
    if (bool('diagnostics.collectors.textures.enabled', true)) {
      const i = num('diagnostics.collectors.textures.intervalMs', 5000);
      add(new TextureCollector(consoleClient, i), i);
    }

    const collectRendezvous = bool('diagnostics.collectors.rendezvous.enabled', true);
    if (collectRendezvous) {
      const i = num('diagnostics.collectors.rendezvous.intervalMs', 1000);
      const rendezvous = new RendezvousCollector(this.deps.ecp, { ip: device.ip, port: device.port }, i);
      rendezvous.on('enable-failed', () =>
        log(`Rendezvous tracking failed to enable on ${device.ip}:${device.port} — ` +
          'ensure "Control by mobile apps" is enabled on-device. Retrying every ' +
          `${i}ms.`));
      add(rendezvous, i);
    }

    const app = await this.resolveApp(device.ip, device.port);

    if (bool('diagnostics.collectors.appState.enabled', true)) {
      if (app.id) {
        const i = num('diagnostics.collectors.appState.intervalMs', 2000);
        add(new AppStateCollector(this.deps.ecp, device.ip, ecpPort, app.id, i), i);
        log(`App-state tracking armed for app id "${app.id}" (polling every ${i}ms). ` +
          'Requires "Control by mobile apps" enabled on-device or it will report "unknown" and no chart shading will appear.');
      } else {
        log(`App-state tracking skipped: could not resolve app id "${this.selectedAppId}" via ECP /query/apps.`);
      }
    }
    if (bool('diagnostics.collectors.fwBeacon.enabled', true)) {
      const beaconPort = num('diagnostics.beaconLogPort', 8085);
      // ConsoleSocket is a structural superset of LogSocket (adds `write`), so the
      // same test-injected socket factory can be reused for the beacon log client.
      const fwBeacon = new FwBeaconCollector(device.ip, beaconPort, this.socketFactory);
      fwBeacon.on('rejected', (line: string) =>
        log(`Framework beacon log (port ${beaconPort}) rejected the connection — ` +
          `this port only accepts one consumer at a time, so it's likely already ` +
          `held by an active debug session's IO channel or another tool. Beacons ` +
          `will keep retrying but won't appear until the port is free. Device said: "${line}"`));
      add(fwBeacon, 0);
    }

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
      transports: [consoleClient],
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
      consoleClient.close();
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

  /**
   * Starts or stops a single collector on the active session, driven by which
   * charts/tables the webview currently has visible. No-op when no session is
   * running or when settings never enabled this collector in the first place
   * (settings are a hard ceiling — this can only narrow, never widen, what's enabled).
   */
  setCollectorActive(type: DiagnosticEventType, active: boolean): void {
    this.session?.setCollectorActive(type, active);
  }

  hasCollector(type: DiagnosticEventType): boolean {
    return this.session?.hasCollector(type) ?? false;
  }

  private async resolveApp(
    ip: string,
    port: number,
  ): Promise<{ id?: string; title?: string; version?: string }> {
    try {
      const apps = await this.deps.ecp.queryApps(ip, port);
      const match = apps.find((a) => a.id === this.selectedAppId);
      if (match) return { id: match.id, title: match.name, version: match.version };
    } catch {
      // Device may be offline or the selected channel not installed — record without app meta.
    }
    return {};
  }
}

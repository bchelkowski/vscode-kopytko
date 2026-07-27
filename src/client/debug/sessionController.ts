import * as path from 'path';
import { deploy, type DeployOptions } from '../roku/rokuDeployer';
import { DebugCommands } from 'kopytko-roku-device';
import { ProtocolClient } from 'kopytko-roku-device';
import { IOClient } from 'kopytko-roku-device';
import { ErrorCode, isRequestCancelled } from 'kopytko-roku-device';
import { BreakpointService } from './services/breakpointService';
import { ProtocolEventMapper } from './protocolEventMapper';

/** Sink for wire-level debug-protocol tracing, or `null` when tracing is off. */
export interface TraceSink {
  write: (message: string) => void;
  /** Include a hex dump of every framed packet ("verbose"). */
  hex: boolean;
}

export interface SessionControllerCallbacks {
  sendOutput: (category: 'console' | 'stdout' | 'stderr', output: string) => void;
  sendEvent: (event: string, body?: Record<string, unknown>) => void;
  resetVariables: () => void;
  clearDiagnostics: () => void;
  addCompileDiagnostic: (localPath: string, message: string, lineNumber: number) => void;
  getWorkspaceRoot: () => string;
  /** Resolved when the session starts; `null` disables protocol tracing. */
  getTraceSink?: () => TraceSink | null;
}

export interface SessionControllerOptions {
  callbacks: SessionControllerCallbacks;
  breakpoints: BreakpointService;
  eventMapper?: ProtocolEventMapper;
  deployer?: (options: DeployOptions) => Promise<void>;
  protocolClientFactory?: () => ProtocolClient;
  commandsFactory?: (client: ProtocolClient) => DebugCommands;
  ioClientFactory?: () => IOClient;
}

export class SessionController {
  private readonly callbacks: SessionControllerCallbacks;
  private readonly breakpoints: BreakpointService;
  private readonly eventMapper: ProtocolEventMapper;
  private readonly deployer: (options: DeployOptions) => Promise<void>;
  private readonly protocolClientFactory: () => ProtocolClient;
  private readonly commandsFactory: (client: ProtocolClient) => DebugCommands;
  private readonly ioClientFactory: () => IOClient;

  private protocolClientInstance: ProtocolClient | null = null;
  private commandsInstance: DebugCommands | null = null;
  private ioClientInstance: IOClient | null = null;
  private launchConfig: Record<string, unknown> = {};
  private currentSourceRoot = '';
  private primaryThreadIndex = 0;
  private isStopped = false;
  private suppressInitialStop = false;
  /** Set when breakpoints changed while the target was running; flushed on the next stop. */
  private breakpointSyncDeferred = false;

  constructor(options: SessionControllerOptions) {
    this.callbacks = options.callbacks;
    this.breakpoints = options.breakpoints;
    this.eventMapper = options.eventMapper ?? new ProtocolEventMapper();
    this.deployer = options.deployer ?? deploy;
    this.protocolClientFactory = options.protocolClientFactory ?? (() => new ProtocolClient());
    this.commandsFactory = options.commandsFactory ?? ((client) => new DebugCommands(client));
    this.ioClientFactory = options.ioClientFactory ?? (() => new IOClient());
  }

  get protocolClient(): ProtocolClient | null {
    return this.protocolClientInstance;
  }

  get commands(): DebugCommands | null {
    return this.commandsInstance;
  }

  get sourceRoot(): string {
    return this.currentSourceRoot;
  }

  get stopped(): boolean {
    return this.isStopped;
  }

  setLaunchConfig(config: Record<string, unknown>): void {
    this.launchConfig = config;
  }

  async start(): Promise<void> {
    const host = this.launchConfig['host'] as string | undefined;
    const password = this.launchConfig['password'] as string | undefined;
    const env = this.launchConfig['env'] as string | undefined ?? 'dev';
    const rootDir = this.launchConfig['rootDir'] as string | undefined ?? this.callbacks.getWorkspaceRoot();
    const sourceDir = this.launchConfig['sourceDir'] as string | undefined ?? 'app';
    const startCommand = this.launchConfig['startCommand'] as string | undefined;

    this.currentSourceRoot = sourceDir ? path.join(rootDir, sourceDir) : rootDir;
    this.callbacks.sendOutput('console', `Source root: ${this.currentSourceRoot}\n`);

    if (!host || !password) {
      this.callbacks.sendOutput('stderr', 'Missing "host" or "password" in launch configuration.\n');
      this.callbacks.sendEvent('terminated');
      return;
    }

    // The device is launched with remotedebug_connect_early=1, so it is already
    // stopped when we connect and its initial AllThreadsStopped normally arrives
    // glued to the handshake bytes — which ProtocolClient dispatches
    // synchronously, *before* connect() resolves. Arming the suppression after
    // the await would therefore be too late, and the initial stop would surface
    // as a real DAP `stopped`: VS Code would start issuing threads/stackTrace/
    // variables while we are still sending breakpoints and the launch continue.
    this.suppressInitialStop = true;

    try {
      this.callbacks.clearDiagnostics();

      await this.deployer({
        rootDir,
        host,
        password,
        env,
        startCommand,
        onOutput: (msg) => this.callbacks.sendOutput('console', `${msg}\n`),
      });

      this.callbacks.sendOutput('console', 'Connecting debugger (port 8081)…\n');
      const client = this.protocolClientFactory();
      this.protocolClientInstance = client;
      this.commandsInstance = this.commandsFactory(client);
      this.attachTracer(client);
      this.attachProtocolListeners(client);

      const handshake = await client.connect(host);
      const ver = handshake.protocolVersion;
      this.callbacks.sendOutput('console',
        `Debugger connected (protocol ${ver.major}.${ver.minor}.${ver.patch}).\n`);

      await this.sendAllBreakpoints();
    } catch (err) {
      // Only genuine launch failures (deploy, connect, handshake, initial
      // breakpoints) terminate the session.
      this.suppressInitialStop = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.callbacks.sendOutput('stderr', `Launch failed: ${msg}\n`);
      this.callbacks.sendEvent('terminated');
      return;
    }

    if (this.launchConfig['stopOnEntry']) {
      this.isStopped = true;
      this.suppressInitialStop = false;
      this.callbacks.sendEvent('stopped', { reason: 'entry', threadId: 1, allThreadsStopped: true });
      return;
    }

    // Past this point the session is live. A failed resume is reported but must
    // not terminate it — otherwise a user pressing Continue while this request
    // is still outstanding (prepareResume rejects it) would kill the session.
    try {
      this.prepareResume();
      await this.commandsInstance?.continue();
      // Without this VS Code keeps showing "paused" over a running app: the
      // adapter emits `stopped` for the initial stop but never its counterpart.
      this.callbacks.sendEvent('continued', { threadId: 1, allThreadsContinued: true });
    } catch (err) {
      if (!isRequestCancelled(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        this.callbacks.sendOutput('stderr', `Failed to resume after launch: ${msg}\n`);
      }
    } finally {
      this.suppressInitialStop = false;
    }
  }

  prepareResume(): void {
    this.isStopped = false;
    this.protocolClientInstance?.cancelPendingRequests();
  }

  /**
   * Record that breakpoints changed while the target was running. The device
   * only accepts breakpoint edits while stopped, so the sync is replayed from
   * {@link handleUpdate} the next time it stops.
   */
  deferBreakpointSync(): void {
    this.breakpointSyncDeferred = true;
  }

  async disconnect(): Promise<void> {
    try {
      await this.commandsInstance?.exitChannel();
    } catch { /* ignore */ }
    this.cleanupClients();
  }

  dispose(): void {
    this.cleanupClients();
  }

  private attachTracer(client: ProtocolClient): void {
    const sink = this.callbacks.getTraceSink?.() ?? null;
    if (!sink) return;

    // Elapsed-time stamps, not wall clock: the question a trace has to answer is
    // whether the RST landed before or after the device acknowledged a command.
    const startedAt = Date.now();
    client.setTracer((message) => {
      const elapsed = String(Date.now() - startedAt).padStart(6, ' ');
      sink.write(`[${elapsed}ms] ${message}\n`);
    }, sink.hex);
  }

  private attachProtocolListeners(client: ProtocolClient): void {
    client.on('update', (updateType: number, _errorCode: number, payload: Buffer) => {
      this.handleUpdate(updateType, payload);
    });
    client.on('disconnected', () => {
      this.callbacks.sendOutput('console', 'Debugger disconnected.\n');
      this.callbacks.sendEvent('terminated');
    });
    client.on('error', (err: Error) => {
      this.callbacks.sendOutput('stderr', `Protocol error: ${err.message}\n`);
    });
  }

  private handleUpdate(updateType: number, payload: Buffer): void {
    const result = this.eventMapper.mapUpdate(updateType, payload, {
      suppressInitialStop: this.suppressInitialStop,
      sourceRoot: this.currentSourceRoot,
    });

    const wasStopped = this.isStopped;
    if (result.stopped !== undefined) {
      this.isStopped = result.stopped;
    }
    if (result.primaryThreadIndex !== undefined) {
      this.primaryThreadIndex = result.primaryThreadIndex;
    }
    if (result.resetVariables) {
      this.callbacks.resetVariables();
    }
    if (result.compileDiagnostic) {
      this.callbacks.addCompileDiagnostic(
        result.compileDiagnostic.localPath,
        result.compileDiagnostic.message,
        result.compileDiagnostic.lineNumber,
      );
    }
    for (const output of result.outputs) {
      this.callbacks.sendOutput(output.category, output.output);
    }
    for (const event of result.events) {
      this.callbacks.sendEvent(event.event, event.body);
    }
    if (result.ioPort !== undefined) {
      this.connectIOPort(result.ioPort);
    }
    if (!wasStopped && this.isStopped && this.breakpointSyncDeferred) {
      this.breakpointSyncDeferred = false;
      void this.sendAllBreakpoints();
    }
  }

  private connectIOPort(ioPort: number): void {
    const host = this.launchConfig['host'] as string;

    if (!host || this.ioClientInstance) return;

    const io = this.ioClientFactory();
    this.ioClientInstance = io;

    io.on('output', (text: string) => {
      this.callbacks.sendOutput('stdout', text);
    });
    io.on('error', (err: Error) => {
      this.callbacks.sendOutput('stderr', `IO channel error: ${err.message}\n`);
    });

    io.connect(host, ioPort).catch((err: Error) => {
      this.callbacks.sendOutput('stderr', `Failed to connect IO channel: ${err.message}\n`);
    });
  }

  private async sendAllBreakpoints(): Promise<void> {
    await this.breakpoints.sendAll(
      this.commandsInstance,
      this.currentSourceRoot,
      (id, line) => {
        this.callbacks.sendEvent('breakpoint', {
          reason: 'changed',
          breakpoint: { id, verified: true, line },
        });
      },
      (filePath, line, errorCode: ErrorCode) => {
        this.callbacks.sendOutput('stderr',
          `Breakpoint at ${filePath}:${line} rejected by device (error ${errorCode})\n`);
      },
      (filePath, err) => {
        this.callbacks.sendOutput('stderr', `Failed to set breakpoints in ${filePath}: ${err.message}\n`);
      },
    );
  }

  private cleanupClients(): void {
    if (this.ioClientInstance) {
      this.ioClientInstance.removeAllListeners();
      this.ioClientInstance.close();
      this.ioClientInstance = null;
    }
    if (this.protocolClientInstance) {
      this.protocolClientInstance.removeAllListeners();
      this.protocolClientInstance.close();
      this.protocolClientInstance = null;
    }
    this.commandsInstance = null;
  }
}

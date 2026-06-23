import * as path from 'path';
import { deploy, type DeployOptions } from '../roku/rokuDeployer';
import { DebugCommands } from './protocol/commands';
import { ProtocolClient } from './protocol/protocolClient';
import { IOClient } from './protocol/ioClient';
import { ErrorCode } from './protocol/constants';
import { BreakpointService } from './services/breakpointService';
import { ProtocolEventMapper } from './protocolEventMapper';

export interface SessionControllerCallbacks {
  sendOutput: (category: 'console' | 'stdout' | 'stderr', output: string) => void;
  sendEvent: (event: string, body?: Record<string, unknown>) => void;
  resetVariables: () => void;
  clearDiagnostics: () => void;
  addCompileDiagnostic: (localPath: string, message: string, lineNumber: number) => void;
  getWorkspaceRoot: () => string;
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
      this.attachProtocolListeners(client);

      const handshake = await client.connect(host);
      const ver = handshake.protocolVersion;
      this.callbacks.sendOutput('console',
        `Debugger connected (protocol ${ver.major}.${ver.minor}.${ver.patch}).\n`);

      this.suppressInitialStop = true;
      await this.sendAllBreakpoints();
      this.suppressInitialStop = false;

      if (this.launchConfig['stopOnEntry']) {
        this.isStopped = true;
        this.callbacks.sendEvent('stopped', { reason: 'entry', threadId: 1, allThreadsStopped: true });
      } else {
        await this.commandsInstance.continue();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.callbacks.sendOutput('stderr', `Launch failed: ${msg}\n`);
      this.callbacks.sendEvent('terminated');
    }
  }

  prepareResume(): void {
    this.isStopped = false;
    this.protocolClientInstance?.cancelPendingRequests();
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

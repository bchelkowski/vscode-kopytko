import { expect } from 'chai';
import { EventEmitter } from 'events';
import { SessionController, type SessionControllerCallbacks } from '../../src/client/debug/sessionController';
import { BreakpointService } from '../../src/client/debug/services/breakpointService';
import type { DeployOptions } from '../../src/client/roku/rokuDeployer';
import type { ProtocolClient } from 'kopytko-roku-device';
import type { DebugCommands } from 'kopytko-roku-device';
import { DEBUGGER_MAGIC, RequestCancelledError, StopReason, UpdateType } from 'kopytko-roku-device';

/** ALL_THREADS_STOPPED payload: int32 thread index, uint8 stop reason, utf8z detail. */
function allThreadsStoppedPayload(threadIndex = 0, stopReason = StopReason.Break): Buffer {
  const buf = Buffer.alloc(6);
  buf.writeInt32LE(threadIndex, 0);
  buf.writeUInt8(stopReason, 4);
  buf.writeUInt8(0, 5); // empty NUL-terminated detail
  return buf;
}

class FakeProtocolClient extends EventEmitter {
  isConnected = true;
  closed = false;
  pendingCancelled = false;
  tracerAttached = false;
  /** Update emitted synchronously from connect(), before the promise resolves. */
  emitOnConnect: (() => void) | undefined;

  constructor(private readonly calls: string[]) {
    super();
  }

  connect(host: string) {
    this.calls.push(`connect:${host}`);
    // Mirrors the real client: bytes glued to the handshake are dispatched
    // before connect() resolves.
    this.emitOnConnect?.();
    return Promise.resolve({
      magic: DEBUGGER_MAGIC,
      protocolVersion: { major: 3, minor: 3, patch: 0 },
      platformRevisionTimestamp: 0n,
    });
  }

  setTracer(): void {
    this.tracerAttached = true;
  }

  cancelPendingRequests(): void {
    this.pendingCancelled = true;
    this.calls.push('cancelPendingRequests');
  }

  close(): void {
    this.closed = true;
    this.calls.push('close');
  }
}

class FakeCommands {
  continueError: Error | undefined;

  constructor(private readonly calls: string[]) {}

  continue(): Promise<void> {
    this.calls.push('continue');
    return this.continueError ? Promise.reject(this.continueError) : Promise.resolve();
  }

  exitChannel(): Promise<void> {
    this.calls.push('exitChannel');
    return Promise.resolve();
  }
}

function createCallbacks(calls: string[]): SessionControllerCallbacks {
  return {
    sendOutput: (category, output) => calls.push(`output:${category}:${output}`),
    sendEvent: (event, body = {}) => calls.push(`event:${event}:${JSON.stringify(body)}`),
    resetVariables: () => calls.push('resetVariables'),
    clearDiagnostics: () => calls.push('clearDiagnostics'),
    addCompileDiagnostic: (localPath, message, lineNumber) => {
      calls.push(`diagnostic:${localPath}:${message}:${lineNumber}`);
    },
    getWorkspaceRoot: () => '/workspace',
  };
}

describe('SessionController', () => {
  it('reports missing launch credentials without deploying or connecting', async () => {
    const calls: string[] = [];
    const controller = new SessionController({
      breakpoints: new BreakpointService(),
      callbacks: createCallbacks(calls),
      deployer: () => {
        calls.push('deploy');
        return Promise.resolve();
      },
    });

    controller.setLaunchConfig({ rootDir: '/project', sourceDir: 'src' });
    await controller.start();

    expect(calls).to.deep.equal([
      'output:console:Source root: /project/src\n',
      'output:stderr:Missing "host" or "password" in launch configuration.\n',
      'event:terminated:{}',
    ]);
  });

  it('deploys, connects, sends breakpoints, and continues in launch order', async () => {
    const calls: string[] = [];
    const client = new FakeProtocolClient(calls);
    const commands = new FakeCommands(calls);
    const controller = new SessionController({
      breakpoints: new BreakpointService(),
      callbacks: createCallbacks(calls),
      deployer: (options: DeployOptions) => {
        calls.push(`deploy:${options.rootDir}:${options.host}:${options.password}:${options.env}:${options.startCommand}`);
        options.onOutput?.('deployed');
        return Promise.resolve();
      },
      protocolClientFactory: () => client as unknown as ProtocolClient,
      commandsFactory: () => commands as unknown as DebugCommands,
    });

    controller.setLaunchConfig({
      host: '192.168.0.10',
      password: 'secret',
      rootDir: '/project',
      sourceDir: 'app',
      env: 'qa',
      startCommand: 'npm run deploy',
    });
    await controller.start();

    expect(calls).to.deep.equal([
      'output:console:Source root: /project/app\n',
      'clearDiagnostics',
      'deploy:/project:192.168.0.10:secret:qa:npm run deploy',
      'output:console:deployed\n',
      'output:console:Connecting debugger (port 8081)…\n',
      'connect:192.168.0.10',
      'output:console:Debugger connected (protocol 3.3.0).\n',
      'cancelPendingRequests',
      'continue',
      'event:continued:{"threadId":1,"allThreadsContinued":true}',
    ]);
    expect(controller.stopped).to.equal(false);
  });

  it('stays stopped on entry when requested', async () => {
    const calls: string[] = [];
    const client = new FakeProtocolClient(calls);
    const commands = new FakeCommands(calls);
    const controller = new SessionController({
      breakpoints: new BreakpointService(),
      callbacks: createCallbacks(calls),
      deployer: () => Promise.resolve(),
      protocolClientFactory: () => client as unknown as ProtocolClient,
      commandsFactory: () => commands as unknown as DebugCommands,
    });

    controller.setLaunchConfig({ host: 'roku', password: 'pw', stopOnEntry: true });
    await controller.start();

    expect(controller.stopped).to.equal(true);
    expect(calls).to.include('event:stopped:{"reason":"entry","threadId":1,"allThreadsStopped":true}');
    expect(calls).not.to.include('continue');
  });

  it('suppresses the connect-early stop dispatched before connect() resolves', async () => {
    const calls: string[] = [];
    const client = new FakeProtocolClient(calls);
    const commands = new FakeCommands(calls);
    client.emitOnConnect = () => {
      client.emit('update', UpdateType.AllThreadsStopped, 0, allThreadsStoppedPayload());
    };
    const controller = new SessionController({
      breakpoints: new BreakpointService(),
      callbacks: createCallbacks(calls),
      deployer: () => Promise.resolve(),
      protocolClientFactory: () => client as unknown as ProtocolClient,
      commandsFactory: () => commands as unknown as DebugCommands,
    });

    controller.setLaunchConfig({ host: 'roku', password: 'pw' });
    await controller.start();

    // The initial stop must not reach VS Code — otherwise it starts issuing
    // threads/stackTrace/variables while we are still launching.
    expect(calls.filter((c) => c.startsWith('event:stopped'))).to.deep.equal([]);
    expect(calls).to.include('continue');
    // And the app is running afterwards, so state-based guards stay meaningful.
    expect(controller.stopped).to.equal(false);
  });

  it('reports a failed launch resume without terminating the session', async () => {
    const calls: string[] = [];
    const client = new FakeProtocolClient(calls);
    const commands = new FakeCommands(calls);
    commands.continueError = new Error('Continue rejected by device: NotStopped (4)');
    const controller = new SessionController({
      breakpoints: new BreakpointService(),
      callbacks: createCallbacks(calls),
      deployer: () => Promise.resolve(),
      protocolClientFactory: () => client as unknown as ProtocolClient,
      commandsFactory: () => commands as unknown as DebugCommands,
    });

    controller.setLaunchConfig({ host: 'roku', password: 'pw' });
    await controller.start();

    expect(calls).to.include(
      'output:stderr:Failed to resume after launch: Continue rejected by device: NotStopped (4)\n',
    );
    expect(calls.filter((c) => c.startsWith('event:terminated'))).to.deep.equal([]);
  });

  it('stays silent when the launch resume is cancelled by a user resume', async () => {
    const calls: string[] = [];
    const client = new FakeProtocolClient(calls);
    const commands = new FakeCommands(calls);
    commands.continueError = new RequestCancelledError();
    const controller = new SessionController({
      breakpoints: new BreakpointService(),
      callbacks: createCallbacks(calls),
      deployer: () => Promise.resolve(),
      protocolClientFactory: () => client as unknown as ProtocolClient,
      commandsFactory: () => commands as unknown as DebugCommands,
    });

    controller.setLaunchConfig({ host: 'roku', password: 'pw' });
    await controller.start();

    expect(calls.filter((c) => c.startsWith('output:stderr'))).to.deep.equal([]);
    expect(calls.filter((c) => c.startsWith('event:terminated'))).to.deep.equal([]);
  });

  it('replays breakpoints deferred while running on the next stop', async () => {
    const calls: string[] = [];
    const client = new FakeProtocolClient(calls);
    const commands = new FakeCommands(calls);
    const breakpoints = new BreakpointService();
    const synced: string[] = [];
    breakpoints.syncForFile = ((_c: unknown, filePath: string) => {
      synced.push(filePath);
      return Promise.resolve([]);
    }) as BreakpointService['syncForFile'];

    const controller = new SessionController({
      breakpoints,
      callbacks: createCallbacks(calls),
      deployer: () => Promise.resolve(),
      protocolClientFactory: () => client as unknown as ProtocolClient,
      commandsFactory: () => commands as unknown as DebugCommands,
    });

    controller.setLaunchConfig({ host: 'roku', password: 'pw' });
    await controller.start();
    synced.length = 0;

    // User toggles a breakpoint while the channel is running.
    breakpoints.setPending('/project/app/main.brs', [{ line: 12 }]);
    controller.deferBreakpointSync();
    expect(synced).to.deep.equal([]);

    // Next stop flushes it.
    client.emit('update', UpdateType.AllThreadsStopped, 0, allThreadsStoppedPayload());
    await new Promise((resolve) => setImmediate(resolve));

    expect(synced).to.deep.equal(['/project/app/main.brs']);
  });

  it('attaches a protocol tracer only when a trace sink is configured', async () => {
    const calls: string[] = [];
    const traced = new FakeProtocolClient(calls);
    const untraced = new FakeProtocolClient(calls);

    for (const [client, sink] of [
      [traced, { write: () => {}, hex: false }],
      [untraced, null],
    ] as const) {
      const controller = new SessionController({
        breakpoints: new BreakpointService(),
        callbacks: { ...createCallbacks(calls), getTraceSink: () => sink },
        deployer: () => Promise.resolve(),
        protocolClientFactory: () => client as unknown as ProtocolClient,
        commandsFactory: () => new FakeCommands(calls) as unknown as DebugCommands,
      });
      controller.setLaunchConfig({ host: 'roku', password: 'pw' });
      await controller.start();
    }

    expect(traced.tracerAttached).to.equal(true);
    expect(untraced.tracerAttached).to.equal(false);
  });

  it('disconnects by exiting the debug channel before closing clients', async () => {
    const calls: string[] = [];
    const client = new FakeProtocolClient(calls);
    const commands = new FakeCommands(calls);
    const controller = new SessionController({
      breakpoints: new BreakpointService(),
      callbacks: createCallbacks(calls),
      deployer: () => Promise.resolve(),
      protocolClientFactory: () => client as unknown as ProtocolClient,
      commandsFactory: () => commands as unknown as DebugCommands,
    });

    controller.setLaunchConfig({ host: 'roku', password: 'pw' });
    await controller.start();
    calls.length = 0;

    await controller.disconnect();

    expect(calls).to.deep.equal(['exitChannel', 'close']);
    expect(client.closed).to.equal(true);
  });
});

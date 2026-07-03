import { expect } from 'chai';
import { EventEmitter } from 'events';
import { SessionController, type SessionControllerCallbacks } from '../../src/client/debug/sessionController';
import { BreakpointService } from '../../src/client/debug/services/breakpointService';
import type { DeployOptions } from 'kopytko-roku-device';
import type { ProtocolClient } from 'kopytko-roku-device';
import type { DebugCommands } from 'kopytko-roku-device';
import { DEBUGGER_MAGIC } from 'kopytko-roku-device';

class FakeProtocolClient extends EventEmitter {
  isConnected = true;
  closed = false;
  pendingCancelled = false;

  constructor(private readonly calls: string[]) {
    super();
  }

  connect(host: string) {
    this.calls.push(`connect:${host}`);
    return Promise.resolve({
      magic: DEBUGGER_MAGIC,
      protocolVersion: { major: 3, minor: 3, patch: 0 },
      platformRevisionTimestamp: 0n,
    });
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
  constructor(private readonly calls: string[]) {}

  continue(): Promise<void> {
    this.calls.push('continue');
    return Promise.resolve();
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
      'continue',
    ]);
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

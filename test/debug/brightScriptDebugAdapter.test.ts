import { expect } from 'chai';
import '../roku/vscode-mock';
import { RequestCancelledError } from 'kopytko-roku-device';
import { BrightScriptDebugAdapter } from '../../src/client/debug/brightScriptDebugAdapter';

interface CapturedMessage {
  type: string;
  command?: string;
  event?: string;
  body?: Record<string, unknown>;
}

/**
 * Stand-in for SessionController. The adapter owns its controller, so the tests
 * swap it out after construction — what is under test here is the adapter's
 * protocol-state gating, not the controller.
 */
class FakeSession {
  stopped = false;
  connected = true;
  sourceRoot = '/project/app';
  calls: string[] = [];
  continueError: Error | undefined;

  commands = {
    getStackTrace: (threadIndex: number) => {
      this.calls.push(`getStackTrace:${threadIndex}`);
      return Promise.resolve([{ lineNumber: 10, functionName: 'main', filePath: 'pkg:/source/main.brs' }]);
    },
    continue: () => {
      this.calls.push('continue');
      return this.continueError ? Promise.reject(this.continueError) : Promise.resolve();
    },
  };

  get protocolClient() {
    return { isConnected: this.connected };
  }

  prepareResume(): void {
    this.calls.push('prepareResume');
  }

  deferBreakpointSync(): void {
    this.calls.push('deferBreakpointSync');
  }
}

function createAdapter() {
  const output: string[] = [];
  const channel = { append: (text: string) => output.push(text) };
  const adapter = new BrightScriptDebugAdapter(channel as never);
  const session = new FakeSession();
  (adapter as unknown as { _session: FakeSession })._session = session;

  const messages: CapturedMessage[] = [];
  adapter.onDidSendMessage((msg) => messages.push(msg as CapturedMessage));

  const syncedFiles: string[] = [];
  const breakpoints = (adapter as unknown as {
    _breakpoints: { syncForFile: (...args: unknown[]) => Promise<unknown[]> };
  })._breakpoints;
  breakpoints.syncForFile = (_c: unknown, filePath: unknown) => {
    syncedFiles.push(String(filePath));
    return Promise.resolve([]);
  };

  const send = (command: string, args: Record<string, unknown> = {}): void => {
    adapter.handleMessage({ seq: 1, type: 'request', command, arguments: args } as never);
  };

  return { adapter, session, messages, output, syncedFiles, send };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('BrightScriptDebugAdapter — protocol-state gating', () => {
  it('does not request a stack trace while the target is running', async () => {
    const { session, messages, send } = createAdapter();
    session.stopped = false;

    send('stackTrace', { threadId: 1 });
    await flush();

    // STACKTRACE while running is an out-of-state command; the device answers
    // by resetting the socket, which strands the channel frozen.
    expect(session.calls).to.deep.equal([]);
    const response = messages.find((m) => m.command === 'stackTrace');
    expect(response?.body).to.deep.equal({ stackFrames: [], totalFrames: 0 });
  });

  it('requests a stack trace while the target is stopped', async () => {
    const { session, messages, send } = createAdapter();
    session.stopped = true;

    send('stackTrace', { threadId: 1 });
    await flush();

    expect(session.calls).to.deep.equal(['getStackTrace:0']);
    const response = messages.find((m) => m.command === 'stackTrace');
    expect(response?.body?.['totalFrames']).to.equal(1);
  });

  it('defers breakpoint changes made while the target is running', async () => {
    const { session, messages, syncedFiles, send } = createAdapter();
    session.stopped = false;
    session.connected = true;

    send('setBreakpoints', { source: { path: '/project/app/main.brs' }, breakpoints: [{ line: 7 }] });
    await flush();

    expect(syncedFiles).to.deep.equal([]);
    expect(session.calls).to.deep.equal(['deferBreakpointSync']);
    const response = messages.find((m) => m.command === 'setBreakpoints');
    expect(response?.body).to.deep.equal({ breakpoints: [{ verified: false, line: 7 }] });
  });

  it('syncs breakpoints immediately while the target is stopped', async () => {
    const { session, syncedFiles, send } = createAdapter();
    session.stopped = true;
    session.connected = true;

    send('setBreakpoints', { source: { path: '/project/app/main.brs' }, breakpoints: [{ line: 7 }] });
    await flush();

    expect(syncedFiles).to.deep.equal(['/project/app/main.brs']);
    expect(session.calls).to.deep.equal([]);
  });

  it('reports a failed resume instead of swallowing it', async () => {
    const { session, output, send } = createAdapter();
    session.stopped = true;
    session.continueError = new Error('Continue rejected by device: NotStopped (4)');

    send('continue', { threadId: 1 });
    await flush();

    expect(output.join('')).to.equal('Continue failed: Continue rejected by device: NotStopped (4)\n');
  });

  it('stays quiet when a resume is cancelled by a newer resume', async () => {
    const { session, output, send } = createAdapter();
    session.stopped = true;
    session.continueError = new RequestCancelledError();

    send('continue', { threadId: 1 });
    await flush();

    expect(output).to.deep.equal([]);
  });
});

import * as path from 'path';
import * as vscode from 'vscode';
import { RokuConnection, DebugStop } from './rokuConnection';
import { deploy } from '../roku/rokuDeployer';
import type { BreakpointInjection } from '../roku/rokuDeployer';

// ---------------------------------------------------------------------------
// Minimal DAP type helpers (subset of the Debug Adapter Protocol)
// ---------------------------------------------------------------------------

interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  [key: string]: unknown;
}
interface DAPRequest extends DAPMessage { type: 'request'; command: string; arguments?: Record<string, unknown>; }

// Scope variable-reference IDs
const SCOPE_LOCALS = 1;
const SCOPE_GLOBALS = 2;

/**
 * Inline VS Code debug adapter for BrightScript.
 *
 * Workflow:
 *   1. `initialize`      → report capabilities, fire `initialized` event
 *   2. `setBreakpoints`  → record breakpoints per source file
 *   3. `launch`          → store launch config
 *   4. `configurationDone` → inject stops, deploy to Roku, connect debugger
 *   5. Running:          RokuConnection emits events → adapter sends DAP events
 */
export class BrightScriptDebugAdapter implements vscode.DebugAdapter {
  private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage = this._onDidSendMessage.event;

  private _seq = 1;
  private _connection: RokuConnection | null = null;
  private _launchConfig: Record<string, unknown> = {};
  private _breakpoints = new Map<string, number[]>(); // absPath → line numbers (1-based)
  private _outputChannel: vscode.OutputChannel;

  // Cached vars for the current stop (avoid double querying scopes+variables)
  private _cachedLocals: { name: string; type: string; value: string }[] = [];
  private _cachedGlobals: { name: string; type: string; value: string }[] = [];

  constructor(outputChannel: vscode.OutputChannel) {
    this._outputChannel = outputChannel;
  }

  // ---------------------------------------------------------------------------
  // vscode.DebugAdapter interface
  // ---------------------------------------------------------------------------

  handleMessage(message: vscode.DebugProtocolMessage): void {
    const msg = message as DAPMessage;
    if (msg.type === 'request') {
      this._handleRequest(msg as DAPRequest).catch((err: Error) => {
        this._sendOutput('stderr', `Debug adapter error: ${err.message}\n`);
      });
    }
  }

  dispose(): void {
    this._connection?.close();
    this._connection = null;
  }

  // ---------------------------------------------------------------------------
  // Request dispatcher
  // ---------------------------------------------------------------------------

  private async _handleRequest(req: DAPRequest): Promise<void> {
    switch (req.command) {
      case 'initialize':     return this._onInitialize(req);
      case 'launch':         return this._onLaunch(req);
      case 'setBreakpoints': return this._onSetBreakpoints(req);
      case 'configurationDone': return this._onConfigurationDone(req);
      case 'threads':        return this._onThreads(req);
      case 'stackTrace':     return this._onStackTrace(req);
      case 'scopes':         return this._onScopes(req);
      case 'variables':      return this._onVariables(req);
      case 'continue':       return this._onContinue(req);
      case 'next':           return this._onNext(req);
      case 'stepIn':         return this._onStepIn(req);
      case 'stepOut':        return this._onStepOut(req);
      case 'evaluate':       return this._onEvaluate(req);
      case 'disconnect':     return this._onDisconnect(req);
      default:
        this._sendResponse(req.seq, req.command, false, {}, 'Unsupported request');
    }
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  private _onInitialize(req: DAPRequest): void {
    this._sendResponse(req.seq, 'initialize', true, {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportTerminateDebuggee: true,
    });
    this._sendEvent('initialized');
  }

  private _onLaunch(req: DAPRequest): void {
    this._launchConfig = (req.arguments ?? {}) as Record<string, unknown>;
    this._sendResponse(req.seq, 'launch', true);
  }

  private _onSetBreakpoints(req: DAPRequest): void {
    const args = req.arguments ?? {};
    const source = (args['source'] as { path?: string } | undefined)?.path ?? '';
    const bpLines: number[] = ((args['breakpoints'] as Array<{ line: number }> | undefined) ?? [])
      .map((bp) => bp.line);

    this._breakpoints.set(source, bpLines);

    this._sendResponse(req.seq, 'setBreakpoints', true, {
      breakpoints: bpLines.map((line) => ({ verified: true, line })),
    });
  }

  private async _onConfigurationDone(req: DAPRequest): Promise<void> {
    this._sendResponse(req.seq, 'configurationDone', true);

    const host = this._launchConfig['host'] as string | undefined;
    const password = this._launchConfig['password'] as string | undefined;
    const env = this._launchConfig['env'] as string | undefined ?? 'dev';
    const rootDir = this._launchConfig['rootDir'] as string | undefined
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

    if (!host || !password) {
      this._sendOutput('stderr', 'Missing "host" or "password" in launch configuration.\n');
      this._sendEvent('terminated');
      return;
    }

    try {
      const breakpointInjections: BreakpointInjection[] = [];
      for (const [filePath, lines] of this._breakpoints) {
        if (lines.length > 0) {
          breakpointInjections.push({ filePath, lines });
        }
      }

      await deploy({
        rootDir,
        host,
        password,
        env,
        breakpoints: breakpointInjections,
        onOutput: (msg) => this._sendOutput('console', msg + '\n'),
      });

      const conn = new RokuConnection();
      this._connection = conn;

      conn.on('stopped', (stop: DebugStop) => this._onDebuggerStopped(stop));
      conn.on('output', (line: string) => this._sendOutput('stdout', line + '\n'));
      conn.on('compileError', (msg: string) => {
        this._sendOutput('stderr', `Compilation error: ${msg}\n`);
        this._sendEvent('terminated');
      });
      conn.on('terminated', () => {
        this._sendOutput('console', 'Program exited.\n');
        this._sendEvent('terminated');
      });
      conn.on('error', (err: Error) => {
        this._sendOutput('stderr', `Debugger error: ${err.message}\n`);
      });

      await conn.connect(host);
      this._sendOutput('console', 'Debugger connected.\n');

      if (this._launchConfig['stopOnEntry']) {
        this._sendEvent('stopped', { reason: 'entry', threadId: 1 });
      } else {
        conn.continue();
        this._sendEvent('continued', { threadId: 1 });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._sendOutput('stderr', `Launch failed: ${msg}\n`);
      this._sendEvent('terminated');
    }
  }

  private _onDebuggerStopped(stop: DebugStop): void {
    this._cachedLocals = [];
    this._cachedGlobals = [];
    const reason = stop.kind === 'breakpoint' ? 'breakpoint' : 'exception';
    this._sendEvent('stopped', {
      reason,
      threadId: 1,
      description: stop.message ?? (stop.kind === 'error' ? 'Runtime error' : 'Breakpoint hit'),
      allThreadsStopped: true,
    });
  }

  private _onThreads(req: DAPRequest): void {
    this._sendResponse(req.seq, 'threads', true, {
      threads: [{ id: 1, name: 'BrightScript' }],
    });
  }

  private async _onStackTrace(req: DAPRequest): Promise<void> {
    if (!this._connection) {
      this._sendResponse(req.seq, 'stackTrace', true, { stackFrames: [], totalFrames: 0 });
      return;
    }
    try {
      const frames = await this._connection.getStackFrames();
      const rootDir = (this._launchConfig['rootDir'] as string | undefined) ?? '';
      this._sendResponse(req.seq, 'stackTrace', true, {
        stackFrames: frames.map((f) => ({
          id: f.index,
          name: f.functionName,
          source: { path: rokuPathToLocal(f.file, rootDir) },
          line: f.line,
          column: 0,
        })),
        totalFrames: frames.length,
      });
    } catch {
      this._sendResponse(req.seq, 'stackTrace', true, { stackFrames: [], totalFrames: 0 });
    }
  }

  private _onScopes(req: DAPRequest): void {
    this._sendResponse(req.seq, 'scopes', true, {
      scopes: [
        { name: 'Local', variablesReference: SCOPE_LOCALS, expensive: false },
        { name: 'Global', variablesReference: SCOPE_GLOBALS, expensive: true },
      ],
    });
  }

  private async _onVariables(req: DAPRequest): Promise<void> {
    const ref = (req.arguments?.['variablesReference'] as number | undefined) ?? 0;

    if (!this._connection) {
      this._sendResponse(req.seq, 'variables', true, { variables: [] });
      return;
    }

    try {
      if (this._cachedLocals.length === 0 && this._cachedGlobals.length === 0) {
        const all = await this._connection.getVariables();
        this._cachedLocals = all.locals;
        this._cachedGlobals = all.globals;
      }

      const list = ref === SCOPE_LOCALS ? this._cachedLocals : this._cachedGlobals;
      this._sendResponse(req.seq, 'variables', true, {
        variables: list.map((v) => ({
          name: v.name,
          value: v.value,
          type: v.type,
          variablesReference: 0,
        })),
      });
    } catch {
      this._sendResponse(req.seq, 'variables', true, { variables: [] });
    }
  }

  private _onContinue(req: DAPRequest): void {
    this._connection?.continue();
    this._sendResponse(req.seq, 'continue', true, { allThreadsContinued: true });
  }

  private async _onNext(req: DAPRequest): Promise<void> {
    this._sendResponse(req.seq, 'next', true);
    try {
      await this._connection?.stepOver();
      this._sendEvent('stopped', { reason: 'step', threadId: 1, allThreadsStopped: true });
    } catch { /* connection may have closed */ }
  }

  private async _onStepIn(req: DAPRequest): Promise<void> {
    this._sendResponse(req.seq, 'stepIn', true);
    try {
      await this._connection?.stepIn();
      this._sendEvent('stopped', { reason: 'step', threadId: 1, allThreadsStopped: true });
    } catch { /* connection may have closed */ }
  }

  private async _onStepOut(req: DAPRequest): Promise<void> {
    this._sendResponse(req.seq, 'stepOut', true);
    try {
      await this._connection?.stepOut();
      this._sendEvent('stopped', { reason: 'step', threadId: 1, allThreadsStopped: true });
    } catch { /* connection may have closed */ }
  }

  private async _onEvaluate(req: DAPRequest): Promise<void> {
    const expr = (req.arguments?.['expression'] as string | undefined) ?? '';
    try {
      const result = await this._connection?.sendCommand(`print ${expr}`) ?? '';
      const value = result.replace(/BrightScript Debugger>.*$/s, '').trim();
      this._sendResponse(req.seq, 'evaluate', true, { result: value, variablesReference: 0 });
    } catch {
      this._sendResponse(req.seq, 'evaluate', false, {}, 'Evaluate failed');
    }
  }

  private _onDisconnect(req: DAPRequest): void {
    this._connection?.close();
    this._connection = null;
    this._sendResponse(req.seq, 'disconnect', true);
    this._sendEvent('terminated');
  }

  // ---------------------------------------------------------------------------
  // Protocol helpers
  // ---------------------------------------------------------------------------

  private _sendResponse(
    requestSeq: number,
    command: string,
    success: boolean,
    body: Record<string, unknown> = {},
    message?: string
  ): void {
    const msg: Record<string, unknown> = {
      seq: this._seq++,
      type: 'response',
      request_seq: requestSeq,
      success,
      command,
      body,
    };
    if (message) msg['message'] = message;
    this._onDidSendMessage.fire(msg as vscode.DebugProtocolMessage);
  }

  private _sendEvent(event: string, body: Record<string, unknown> = {}): void {
    this._onDidSendMessage.fire({
      seq: this._seq++,
      type: 'event',
      event,
      body,
    } as vscode.DebugProtocolMessage);
  }

  private _sendOutput(category: 'console' | 'stdout' | 'stderr', output: string): void {
    this._outputChannel.append(output);
    this._sendEvent('output', { category, output });
  }
}

// ---------------------------------------------------------------------------
// Path mapping
// ---------------------------------------------------------------------------

/**
 * Maps a Roku runtime path (/pkg:/components/Foo.brs) to a local absolute
 * path by stripping the pkg:/ prefix and joining with rootDir.
 */
function rokuPathToLocal(rokuPath: string, rootDir: string): string {
  const relative = rokuPath.replace(/^\/pkg:\//i, '').replace(/^pkg:\//i, '');
  return path.join(rootDir, relative);
}

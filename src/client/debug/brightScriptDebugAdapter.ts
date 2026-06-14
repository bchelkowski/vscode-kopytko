import * as path from 'path';
import * as vscode from 'vscode';
import { ProtocolClient } from './protocol/protocolClient';
import { DebugCommands } from './protocol/commands';
import { IOClient } from './protocol/ioClient';
import {
  StepType,
  UpdateType,
  StopReason,
  ErrorCode,
  VariableType,
  VariableFlags,
} from './protocol/constants';
import type {
  ThreadInfo,
  VariableInfo,
} from './protocol/types';
import { BinaryReader } from './protocol/binaryIO';
import { deploy } from '../roku/rokuDeployer';

// ---------------------------------------------------------------------------
// Minimal DAP type helpers (subset of the Debug Adapter Protocol)
// ---------------------------------------------------------------------------

interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  [key: string]: unknown;
}
interface DAPRequest extends DAPMessage { type: 'request'; command: string; arguments?: Record<string, unknown>; }

// Variable-reference base — expandable container references start here
const VAR_REF_BASE = 1000;

/**
 * Represents a variable reference that can be expanded in the Variables panel.
 * Maps a DAP variablesReference → a protocol path for getVariables().
 */
interface VarRefEntry {
  threadIndex: number;
  stackFrameIndex: number;
  path: string[];
  /** True when the path contains virtual key segments (e.g. SceneGraph node fields). */
  hasVirtualPath: boolean;
}

/**
 * Inline VS Code debug adapter for BrightScript using the Roku socket-based
 * debug protocol (port 8081).
 *
 * Workflow:
 *   1. `initialize`        → report capabilities, fire `initialized` event
 *   2. `setBreakpoints`    → store breakpoints (device not connected yet)
 *   3. `launch`            → store launch config
 *   4. `configurationDone` → deploy with remotedebug=1, connect protocol client,
 *                            send breakpoints, optionally continue
 *   5. Running:            ProtocolClient emits update events → DAP events
 */
export class BrightScriptDebugAdapter implements vscode.DebugAdapter {
  private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage = this._onDidSendMessage.event;

  private _seq = 1;
  private _protocolClient: ProtocolClient | null = null;
  private _commands: DebugCommands | null = null;
  private _ioClient: IOClient | null = null;
  private _launchConfig: Record<string, unknown> = {};
  private _outputChannel: vscode.OutputChannel;

  // Breakpoints stored before connection — absPath → DAP breakpoint specs
  private _pendingBreakpoints = new Map<string, Array<{ line: number; condition?: string; hitCondition?: string }>>();
  // Device breakpoint ID tracking — absPath → array of protocol breakpoint IDs
  private _deviceBreakpointIds = new Map<string, number[]>();

  // Variable reference management — reset on each stop event
  private _nextVarRef = VAR_REF_BASE;
  private _varRefs = new Map<number, VarRefEntry>();

  // Thread state from last stop
  private _threads: ThreadInfo[] = [];
  private _primaryThreadIndex = 0;
  private _stopped = false;

  // Diagnostics for compile errors
  private _diagnostics: vscode.DiagnosticCollection;

  /**
   * Effective source root used for path mapping between local paths and Roku
   * pkg:/ paths. Computed as `path.join(rootDir, sourceDir)` during launch so
   * that e.g. rootDir=/project + sourceDir=app gives /project/app, which maps
   * to pkg:/ on the device (the packager strips the sourceDir prefix).
   */
  private _sourceRoot = '';

  /**
   * While true, the first AllThreadsStopped update from the device is the
   * initial remotedebug_connect_early stop — we handle it in
   * _onConfigurationDone (send breakpoints + continue) and must not fire
   * a 'stopped' event to VS Code for it.
   */
  private _suppressInitialStop = false;

  constructor(outputChannel: vscode.OutputChannel) {
    this._outputChannel = outputChannel;
    this._diagnostics = vscode.languages.createDiagnosticCollection('brightscript-debug');
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
    this._ioClient?.close();
    this._ioClient = null;
    this._protocolClient?.close();
    this._protocolClient = null;
    this._diagnostics.dispose();
  }

  // ---------------------------------------------------------------------------
  // Request dispatcher
  // ---------------------------------------------------------------------------

  private async _handleRequest(req: DAPRequest): Promise<void> {
    switch (req.command) {
      case 'initialize':              return this._onInitialize(req);
      case 'launch':                  return this._onLaunch(req);
      case 'setBreakpoints':          return this._onSetBreakpoints(req);
      case 'setExceptionBreakpoints': return this._onSetExceptionBreakpoints(req);
      case 'configurationDone':       return this._onConfigurationDone(req);
      case 'threads':                 return this._onThreads(req);
      case 'stackTrace':              return this._onStackTrace(req);
      case 'scopes':                  return this._onScopes(req);
      case 'variables':               return this._onVariables(req);
      case 'continue':                return this._onContinue(req);
      case 'pause':                   return this._onPause(req);
      case 'next':                    return this._onNext(req);
      case 'stepIn':                  return this._onStepIn(req);
      case 'stepOut':                 return this._onStepOut(req);
      case 'evaluate':                return this._onEvaluate(req);
      case 'disconnect':              return this._onDisconnect(req);
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
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsPauseRequest: true,
      exceptionBreakpointFilters: [
        { filter: 'uncaught', label: 'Uncaught Exceptions', default: true },
        { filter: 'caught', label: 'Caught Exceptions', default: false },
      ],
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
    const bps = (args['breakpoints'] as Array<{ line: number; condition?: string; hitCondition?: string }> | undefined) ?? [];

    this._pendingBreakpoints.set(source, bps);

    if (this._protocolClient?.isConnected) {
      // Device is connected — send breakpoints immediately
      this._syncBreakpointsForFile(source, bps).then((results) => {
        this._sendResponse(req.seq, 'setBreakpoints', true, {
          breakpoints: results.map((r, i) => ({
            verified: r.errorCode === ErrorCode.OK,
            line: bps[i].line,
            id: r.id,
          })),
        });
      }).catch(() => {
        this._sendResponse(req.seq, 'setBreakpoints', true, {
          breakpoints: bps.map((bp) => ({ verified: false, line: bp.line })),
        });
      });
    } else {
      // Not connected yet — mark as unverified, will be sent after connect
      this._sendResponse(req.seq, 'setBreakpoints', true, {
        breakpoints: bps.map((bp) => ({ verified: false, line: bp.line })),
      });
    }
  }

  private async _onSetExceptionBreakpoints(req: DAPRequest): Promise<void> {
    const filters = (req.arguments?.['filters'] as string[] | undefined) ?? [];
    this._sendResponse(req.seq, 'setExceptionBreakpoints', true);

    if (this._commands && this._protocolClient?.isConnected) {
      try {
        await this._commands.setExceptionBreakpoints(filters);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._sendOutput('stderr', `Failed to set exception breakpoints: ${msg}\n`);
      }
    }
  }

  private async _onConfigurationDone(req: DAPRequest): Promise<void> {
    this._sendResponse(req.seq, 'configurationDone', true);

    const host = this._launchConfig['host'] as string | undefined;
    const password = this._launchConfig['password'] as string | undefined;
    const env = this._launchConfig['env'] as string | undefined ?? 'dev';
    const rootDir = this._launchConfig['rootDir'] as string | undefined
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const sourceDir = this._launchConfig['sourceDir'] as string | undefined ?? 'app';
    const startCommand = this._launchConfig['startCommand'] as string | undefined;

    // Build the effective source root: local files at <rootDir>/<sourceDir>
    // map to pkg:/ on the device (the packager strips sourceDir).
    this._sourceRoot = sourceDir ? path.join(rootDir, sourceDir) : rootDir;
    this._sendOutput('console', `Source root: ${this._sourceRoot}\n`);

    if (!host || !password) {
      this._sendOutput('stderr', 'Missing "host" or "password" in launch configuration.\n');
      this._sendEvent('terminated');
      return;
    }

    try {
      // Clear previous diagnostics
      this._diagnostics.clear();

      // Build and deploy with remotedebug enabled via manifest
      await deploy({
        rootDir,
        host,
        password,
        env,
        startCommand,
        onOutput: (msg) => this._sendOutput('console', msg + '\n'),
      });

      // Connect the socket-based debug protocol
      this._sendOutput('console', 'Connecting debugger (port 8081)…\n');
      const client = new ProtocolClient();
      this._protocolClient = client;
      this._commands = new DebugCommands(client);

      // Listen for update events
      client.on('update', (updateType: number, errorCode: number, payload: Buffer) => {
        this._handleUpdate(updateType, errorCode, payload);
      });
      client.on('disconnected', () => {
        this._sendOutput('console', 'Debugger disconnected.\n');
        this._sendEvent('terminated');
      });
      client.on('error', (err: Error) => {
        this._sendOutput('stderr', `Protocol error: ${err.message}\n`);
      });

      const handshake = await client.connect(host);
      const ver = handshake.protocolVersion;
      this._sendOutput('console',
        `Debugger connected (protocol ${ver.major}.${ver.minor}.${ver.patch}).\n`);

      // With remotedebug_connect_early=1 the device stops immediately on entry
      // and sends AllThreadsStopped. Suppress that event so VS Code doesn't show
      // a spurious "paused" state — we handle the initial stop ourselves here.
      this._suppressInitialStop = true;
      await this._sendAllBreakpoints();
      this._suppressInitialStop = false;

      if (this._launchConfig['stopOnEntry']) {
        // Stay paused at entry — report the stop to VS Code
        this._stopped = true;
        this._sendEvent('stopped', { reason: 'entry', threadId: 1, allThreadsStopped: true });
      } else {
        // Resume past the initial entry stop
        await this._commands.continue();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._sendOutput('stderr', `Launch failed: ${msg}\n`);
      this._sendEvent('terminated');
    }
  }

  private async _onThreads(req: DAPRequest): Promise<void> {
    if (!this._commands || !this._stopped) {
      this._sendResponse(req.seq, 'threads', true, {
        threads: [{ id: 1, name: 'Main' }],
      });
      return;
    }

    try {
      this._threads = await this._commands.getThreads();
      this._sendResponse(req.seq, 'threads', true, {
        threads: this._threads.map((t, i) => ({
          id: i + 1, // DAP thread IDs are 1-based
          name: t.functionName || `Thread ${i}`,
        })),
      });
    } catch {
      this._sendResponse(req.seq, 'threads', true, {
        threads: [{ id: 1, name: 'Main' }],
      });
    }
  }

  private async _onStackTrace(req: DAPRequest): Promise<void> {
    if (!this._commands) {
      this._sendResponse(req.seq, 'stackTrace', true, { stackFrames: [], totalFrames: 0 });
      return;
    }

    const threadId = (req.arguments?.['threadId'] as number | undefined) ?? 1;
    const threadIndex = threadId - 1;

    try {
      const frames = await this._commands.getStackTrace(threadIndex);
      this._sendResponse(req.seq, 'stackTrace', true, {
        // StackTrace returns frames most-recent-first (0 = current function),
        // but the Variables command uses inverted indexing where 0 = first called
        // and nframes-1 = most recent. Encode the protocol's frame index directly
        // so that scopes/variables requests use the correct index.
        stackFrames: frames.map((f, i) => ({
          id: this._encodeFrameId(threadIndex, frames.length - 1 - i),
          name: f.functionName,
          source: { path: rokuPathToLocal(f.filePath, this._sourceRoot) },
          line: f.lineNumber,
          column: 0,
        })),
        totalFrames: frames.length,
      });
    } catch {
      this._sendResponse(req.seq, 'stackTrace', true, { stackFrames: [], totalFrames: 0 });
    }
  }

  private _onScopes(req: DAPRequest): void {
    const frameId = (req.arguments?.['frameId'] as number | undefined) ?? 0;
    const { threadIndex, frameIndex } = this._decodeFrameId(frameId);

    // Register the local scope variable reference
    const localRef = this._allocateVarRef(threadIndex, frameIndex, []);

    this._sendResponse(req.seq, 'scopes', true, {
      scopes: [
        { name: 'Local', variablesReference: localRef, expensive: false },
      ],
    });
  }

  private async _onVariables(req: DAPRequest): Promise<void> {
    const ref = (req.arguments?.['variablesReference'] as number | undefined) ?? 0;

    if (!this._commands || !this._stopped) {
      this._sendResponse(req.seq, 'variables', true, { variables: [] });
      return;
    }

    const entry = this._varRefs.get(ref);
    if (!entry) {
      this._sendResponse(req.seq, 'variables', true, { variables: [] });
      return;
    }

    try {
      const isExpanding = entry.path.length > 0;
      const vars = await this._commands.getVariables(
        entry.threadIndex,
        entry.stackFrameIndex,
        entry.path,
        isExpanding, // getChildren=true when expanding a specific container
        isExpanding, // includeVirtualKeys — always request virtual keys when expanding
        entry.hasVirtualPath, // virtualPathIncluded — set when path contains virtual segments
      );

      // When expanding a container (getChildren=true with a path), the response
      // contains: [parent (isChildKey=false), child0, child1, ...].
      // Show only the child entries. For top-level locals (no path), all entries
      // are direct variables (isChildKey is irrelevant).
      const filtered = isExpanding
        ? vars.filter((v) => v.isChildKey)
        : vars;

      let arrayIndex = 0;
      const dapVars = filtered.map((v) => {
        const name = v.name || String(arrayIndex++);
        return this._variableInfoToDAP(v, name, entry.threadIndex, entry.stackFrameIndex, entry.path, isExpanding, entry.hasVirtualPath);
      });

      this._sendResponse(req.seq, 'variables', true, { variables: dapVars });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._sendOutput('stderr', `Variables error: ${msg}\n`);
      this._sendResponse(req.seq, 'variables', true, { variables: [] });
    }
  }

  private async _onContinue(req: DAPRequest): Promise<void> {
    this._stopped = false;
    this._protocolClient?.cancelPendingRequests();
    this._sendResponse(req.seq, 'continue', true, { allThreadsContinued: true });
    try {
      await this._commands?.continue();
    } catch { /* connection may have closed */ }
  }

  private async _onPause(req: DAPRequest): Promise<void> {
    this._sendResponse(req.seq, 'pause', true);
    try {
      await this._commands?.stop();
    } catch { /* connection may have closed */ }
  }

  private async _onNext(req: DAPRequest): Promise<void> {
    const threadId = (req.arguments?.['threadId'] as number | undefined) ?? 1;
    this._stopped = false;
    this._protocolClient?.cancelPendingRequests();
    this._sendResponse(req.seq, 'next', true);
    try {
      await this._commands?.step(threadId - 1, StepType.Over);
    } catch { /* connection may have closed */ }
  }

  private async _onStepIn(req: DAPRequest): Promise<void> {
    const threadId = (req.arguments?.['threadId'] as number | undefined) ?? 1;
    this._stopped = false;
    this._protocolClient?.cancelPendingRequests();
    this._sendResponse(req.seq, 'stepIn', true);
    try {
      await this._commands?.step(threadId - 1, StepType.Line);
    } catch { /* connection may have closed */ }
  }

  private async _onStepOut(req: DAPRequest): Promise<void> {
    const threadId = (req.arguments?.['threadId'] as number | undefined) ?? 1;
    this._stopped = false;
    this._protocolClient?.cancelPendingRequests();
    this._sendResponse(req.seq, 'stepOut', true);
    try {
      await this._commands?.step(threadId - 1, StepType.Out);
    } catch { /* connection may have closed */ }
  }

  private async _onEvaluate(req: DAPRequest): Promise<void> {
    const expr = (req.arguments?.['expression'] as string | undefined) ?? '';
    const context = (req.arguments?.['context'] as string | undefined) ?? 'hover';
    const frameId = (req.arguments?.['frameId'] as number | undefined) ?? 0;

    if (!this._commands || !this._stopped) {
      this._sendResponse(req.seq, 'evaluate', false, {}, 'Not stopped');
      return;
    }

    const { threadIndex, frameIndex } = this._decodeFrameId(frameId);

    try {
      if (context === 'repl') {
        // Execute arbitrary BrightScript in the debug console
        const result = await this._commands.execute(threadIndex, frameIndex, expr);
        const varRef = result.isContainer
          ? this._allocateVarRef(threadIndex, frameIndex, expr.split('.'))
          : 0;
        this._sendResponse(req.seq, 'evaluate', true, {
          result: result.resultValue || `<${result.resultType}>`,
          variablesReference: varRef,
        });
      } else {
        // Hover or watch — try to get the variable by path
        const pathSegments = expr.split('.');
        // Multi-segment paths may traverse virtual keys (e.g. node fields),
        // so set virtual flags to allow the device to resolve them.
        const hasVirtualSegments = pathSegments.length > 1;
        const vars = await this._commands.getVariables(
          threadIndex, frameIndex, pathSegments, false,
          hasVirtualSegments, hasVirtualSegments,
        );
        if (vars.length > 0) {
          const v = vars[0];
          const varRef = v.isContainer
            ? this._allocateVarRef(threadIndex, frameIndex, pathSegments, hasVirtualSegments)
            : 0;
          this._sendResponse(req.seq, 'evaluate', true, {
            result: v.value || `<${v.type}>`,
            type: variableTypeName(v.type),
            variablesReference: varRef,
          });
        } else {
          this._sendResponse(req.seq, 'evaluate', false, {}, 'Variable not found');
        }
      }
    } catch {
      this._sendResponse(req.seq, 'evaluate', false, {}, 'Evaluate failed');
    }
  }

  private async _onDisconnect(req: DAPRequest): Promise<void> {
    try {
      await this._commands?.exitChannel();
    } catch { /* ignore */ }
    this._ioClient?.close();
    this._ioClient = null;
    this._protocolClient?.close();
    this._protocolClient = null;
    this._commands = null;
    this._sendResponse(req.seq, 'disconnect', true);
    this._sendEvent('terminated');
  }

  // ---------------------------------------------------------------------------
  // Update event handling (from ProtocolClient)
  // ---------------------------------------------------------------------------

  private _handleUpdate(updateType: number, _errorCode: number, payload: Buffer): void {
    switch (updateType) {
      case UpdateType.AllThreadsStopped:
        this._onAllThreadsStopped(payload);
        break;
      case UpdateType.ThreadAttached:
        this._onThreadAttached(payload);
        break;
      case UpdateType.IOPortOpened:
        this._onIOPortOpened(payload);
        break;
      case UpdateType.CompileError:
        this._onCompileError(payload);
        break;
      case UpdateType.BreakpointVerified:
        this._onBreakpointVerified(payload);
        break;
      case UpdateType.BreakpointError:
        this._onBreakpointError(payload);
        break;
      case UpdateType.ProtocolError:
        this._sendOutput('stderr', 'Fatal protocol error — debug session terminated.\n');
        this._sendEvent('terminated');
        break;
      case UpdateType.ExceptionBreakpointError:
        this._onExceptionBreakpointError(payload);
        break;
    }
  }

  private _onAllThreadsStopped(payload: Buffer): void {
    const reader = new BinaryReader(payload);
    const primaryThreadIndex = reader.readInt32();
    const stopReason: StopReason = reader.readUint8(); // uint8 per spec
    const stopReasonDetail = reader.remaining > 0 ? reader.readStringNT() : '';

    // Suppress the initial remotedebug_connect_early stop — _onConfigurationDone
    // is already handling it (sending breakpoints + calling continue).
    if (this._suppressInitialStop) {
      this._stopped = true;
      this._primaryThreadIndex = primaryThreadIndex;
      return;
    }

    // App exited normally — end the debug session cleanly.
    if (stopReason === StopReason.NormalExit) {
      this._sendOutput('console', 'App exited normally.\n');
      this._sendEvent('terminated');
      return;
    }

    this._stopped = true;
    this._primaryThreadIndex = primaryThreadIndex;
    this._resetVarRefs();

    const reason = this._stopReasonToDAP(stopReason);

    if (stopReason === StopReason.RuntimeError || stopReason === StopReason.CaughtRuntimeError) {
      const detail = stopReasonDetail ? ` — ${stopReasonDetail}` : '';
      this._sendOutput('stderr', `Runtime error${detail}\n`);
    }

    this._sendEvent('stopped', {
      reason,
      threadId: primaryThreadIndex + 1,
      description: stopReasonDetail || reason,
      allThreadsStopped: true,
    });
  }

  private _onThreadAttached(payload: Buffer): void {
    const reader = new BinaryReader(payload);
    const threadIndex = reader.readInt32();
    const stopReason: StopReason = reader.readUint8(); // uint8 per spec
    const stopReasonDetail = reader.remaining > 0 ? reader.readStringNT() : '';

    this._stopped = true;
    this._resetVarRefs();

    this._sendEvent('stopped', {
      reason: this._stopReasonToDAP(stopReason),
      threadId: threadIndex + 1,
      description: stopReasonDetail || undefined,
      allThreadsStopped: true,
    });
  }

  private _onIOPortOpened(payload: Buffer): void {
    const reader = new BinaryReader(payload);
    const ioPort = reader.readUint32();
    const host = this._launchConfig['host'] as string;

    if (!host || this._ioClient) return;

    const io = new IOClient();
    this._ioClient = io;

    io.on('output', (text: string) => {
      this._sendOutput('stdout', text);
    });
    io.on('error', (err: Error) => {
      this._sendOutput('stderr', `IO channel error: ${err.message}\n`);
    });

    io.connect(host, ioPort).catch((err: Error) => {
      this._sendOutput('stderr', `Failed to connect IO channel: ${err.message}\n`);
    });
  }

  private _onCompileError(payload: Buffer): void {
    const reader = new BinaryReader(payload);
    reader.readUint32(); // flags — reserved, always 0
    const errorString = reader.readStringNT();
    const filePath = reader.readStringNT();
    const lineNumber = reader.readUint32();
    // library_name follows per spec but we don't need it

    this._sendOutput('stderr', `Compile error: ${errorString} (${filePath}:${lineNumber})\n`);

    // Show as VS Code diagnostic
    const localPath = rokuPathToLocal(filePath, this._sourceRoot);
    const uri = vscode.Uri.file(localPath);
    const range = new vscode.Range(
      Math.max(0, lineNumber - 1), 0,
      Math.max(0, lineNumber - 1), Number.MAX_SAFE_INTEGER,
    );
    const diag = new vscode.Diagnostic(range, errorString, vscode.DiagnosticSeverity.Error);
    diag.source = 'Roku';
    const existing = this._diagnostics.get(uri) ?? [];
    this._diagnostics.set(uri, [...existing, diag]);
  }

  private _onBreakpointVerified(payload: Buffer): void {
    const reader = new BinaryReader(payload);
    reader.readUint32(); // flags — reserved, always 0
    const count = reader.readUint32();
    for (let i = 0; i < count; i++) {
      const bpId = reader.readUint32();
      this._sendEvent('breakpoint', {
        reason: 'changed',
        breakpoint: { id: bpId, verified: true },
      });
    }
  }

  private _onBreakpointError(payload: Buffer): void {
    const reader = new BinaryReader(payload);
    reader.readUint32(); // flags — reserved, always 0
    const bpId = reader.readUint32();
    const compileErrorCount = reader.readUint32();
    for (let i = 0; i < compileErrorCount; i++) {
      const err = reader.readStringNT();
      this._sendOutput('stderr', `Breakpoint ${bpId} compile error: ${err}\n`);
    }
    const runtimeErrorCount = reader.readUint32();
    for (let i = 0; i < runtimeErrorCount; i++) {
      const err = reader.readStringNT();
      this._sendOutput('stderr', `Breakpoint ${bpId} runtime error: ${err}\n`);
    }
    const otherErrorCount = reader.readUint32();
    for (let i = 0; i < otherErrorCount; i++) {
      const err = reader.readStringNT();
      this._sendOutput('stderr', `Breakpoint ${bpId} error: ${err}\n`);
    }
  }

  private _onExceptionBreakpointError(payload: Buffer): void {
    const reader = new BinaryReader(payload);
    reader.readUint32(); // flags — reserved, always 0
    const filterId = reader.readUint32();
    const compileErrorCount = reader.readUint32();
    for (let i = 0; i < compileErrorCount; i++) {
      const err = reader.readStringNT();
      this._sendOutput('stderr', `Exception breakpoint ${filterId} compile error: ${err}\n`);
    }
    const runtimeErrorCount = reader.readUint32();
    for (let i = 0; i < runtimeErrorCount; i++) {
      const err = reader.readStringNT();
      this._sendOutput('stderr', `Exception breakpoint ${filterId} runtime error: ${err}\n`);
    }
    const otherErrorCount = reader.readUint32();
    for (let i = 0; i < otherErrorCount; i++) {
      const err = reader.readStringNT();
      this._sendOutput('stderr', `Exception breakpoint ${filterId} error: ${err}\n`);
    }
    // line_number and file_path follow per spec
    if (reader.remaining >= 4) {
      const lineNumber = reader.readUint32();
      const filePath = reader.remaining > 0 ? reader.readStringNT() : '';
      if (filePath) {
        this._sendOutput('stderr', `  at ${filePath}:${lineNumber}\n`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Breakpoint management
  // ---------------------------------------------------------------------------

  private async _sendAllBreakpoints(): Promise<void> {
    if (!this._commands) return;

    for (const [filePath, bps] of this._pendingBreakpoints) {
      if (bps.length === 0) continue;
      try {
        const results = await this._syncBreakpointsForFile(filePath, bps);
        // Send verification events to VS Code for breakpoints set before launch
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.errorCode === ErrorCode.OK) {
            this._sendEvent('breakpoint', {
              reason: 'changed',
              breakpoint: { id: r.id, verified: true, line: bps[i]?.line },
            });
          } else {
            this._sendOutput('stderr',
              `Breakpoint at ${filePath}:${bps[i]?.line} rejected by device (error ${r.errorCode})\n`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._sendOutput('stderr', `Failed to set breakpoints in ${filePath}: ${msg}\n`);
      }
    }
  }

  private async _syncBreakpointsForFile(
    filePath: string,
    bps: Array<{ line: number; condition?: string; hitCondition?: string }>,
  ): Promise<Array<{ id: number; errorCode: ErrorCode }>> {
    if (!this._commands) return bps.map(() => ({ id: 0, errorCode: ErrorCode.OtherError }));

    // Remove existing breakpoints for this file
    const existingIds = this._deviceBreakpointIds.get(filePath);
    if (existingIds && existingIds.length > 0) {
      try {
        await this._commands.removeBreakpoints(existingIds);
      } catch { /* ignore removal errors */ }
    }

    if (bps.length === 0) {
      this._deviceBreakpointIds.delete(filePath);
      return [];
    }

    const pkgPath = localPathToRoku(filePath, this._sourceRoot);

    // Split into conditional and simple breakpoints
    const conditionalBps = bps.filter(bp => bp.condition);
    const simpleBps = bps.filter(bp => !bp.condition);
    const results: Array<{ id: number; errorCode: ErrorCode }> = new Array(bps.length);
    const newIds: number[] = [];

    if (simpleBps.length > 0) {
      const simpleResults = await this._commands.addBreakpoints(
        simpleBps.map(bp => ({
          filePath: pkgPath,
          lineNumber: bp.line,
          ignoreCount: bp.hitCondition ? Math.max(0, parseInt(bp.hitCondition, 10) - 1) : 0,
        })),
      );
      let simpleIdx = 0;
      for (let i = 0; i < bps.length; i++) {
        if (!bps[i].condition) {
          results[i] = simpleResults[simpleIdx] ?? { id: 0, errorCode: ErrorCode.OtherError };
          newIds.push(results[i].id);
          simpleIdx++;
        }
      }
    }

    if (conditionalBps.length > 0) {
      const condResults = await this._commands.addConditionalBreakpoints(
        conditionalBps.map(bp => ({
          filePath: pkgPath,
          lineNumber: bp.line,
          condition: bp.condition!,
        })),
      );
      let condIdx = 0;
      for (let i = 0; i < bps.length; i++) {
        if (bps[i].condition) {
          results[i] = condResults[condIdx] ?? { id: 0, errorCode: ErrorCode.OtherError };
          newIds.push(results[i].id);
          condIdx++;
        }
      }
    }

    this._deviceBreakpointIds.set(filePath, newIds);
    return results;
  }

  // ---------------------------------------------------------------------------
  // Variable reference management
  // ---------------------------------------------------------------------------

  private _allocateVarRef(threadIndex: number, stackFrameIndex: number, path: string[], hasVirtualPath = false): number {
    const ref = this._nextVarRef++;
    this._varRefs.set(ref, { threadIndex, stackFrameIndex, path, hasVirtualPath });
    return ref;
  }

  private _resetVarRefs(): void {
    this._nextVarRef = VAR_REF_BASE;
    this._varRefs.clear();
  }

  private _variableInfoToDAP(
    v: VariableInfo,
    displayName: string,
    threadIndex: number,
    stackFrameIndex: number,
    parentPath: string[],
    isProperty: boolean,
    parentHasVirtualPath: boolean,
  ): { name: string; value: string; type: string; variablesReference: number; presentationHint?: { kind: string } } {
    const childPath = [...parentPath, displayName];
    // A child has virtual path segments if the parent already does, or if this
    // variable itself is a virtual key (e.g. a SceneGraph node field).
    const childHasVirtualPath = parentHasVirtualPath || v.isVirtual;
    const varRef = v.isContainer && v.childCount > 0
      ? this._allocateVarRef(threadIndex, stackFrameIndex, childPath, childHasVirtualPath)
      : 0;

    const typeName = variableTypeName(v.type);
    let displayValue: string;

    if (v.isContainer) {
      displayValue = v.value
        ? `${v.value} (${v.childCount} items)`
        : `${typeName} (${v.childCount} items)`;
    } else if (v.value) {
      displayValue = v.type === VariableType.String ? `"${v.value}"` : v.value;
    } else {
      displayValue = typeName;
    }

    return {
      name: displayName,
      value: displayValue,
      type: typeName,
      variablesReference: varRef,
      // Properties of containers use ":" separator, top-level locals use "="
      ...(isProperty ? { presentationHint: { kind: 'property' } } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Frame ID encoding (threadIndex + frameIndex packed into a single number)
  // ---------------------------------------------------------------------------

  private _encodeFrameId(threadIndex: number, frameIndex: number): number {
    return threadIndex * 10000 + frameIndex;
  }

  private _decodeFrameId(frameId: number): { threadIndex: number; frameIndex: number } {
    return {
      threadIndex: Math.floor(frameId / 10000),
      frameIndex: frameId % 10000,
    };
  }

  // ---------------------------------------------------------------------------
  // Stop reason mapping
  // ---------------------------------------------------------------------------

  private _stopReasonToDAP(reason: StopReason): string {
    switch (reason) {
      case StopReason.StopStatement: return 'breakpoint';
      case StopReason.Break: return 'breakpoint';
      case StopReason.RuntimeError: return 'exception';
      case StopReason.CaughtRuntimeError: return 'exception';
      default: return 'pause';
    }
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

/** Maps a Roku runtime path (pkg:/components/Foo.brs) to a local absolute path. */
function rokuPathToLocal(rokuPath: string, rootDir: string): string {
  const relative = rokuPath.replace(/^\/pkg:\//i, '').replace(/^pkg:\//i, '');
  return path.join(rootDir, relative);
}

/** Maps a local absolute path to a Roku pkg:/ path. */
function localPathToRoku(localPath: string, rootDir: string): string {
  const relative = path.relative(rootDir, localPath).replace(/\\/g, '/');
  return `pkg:/${relative}`;
}

/** Returns the canonical BrightScript type name for a VariableType enum. */
function variableTypeName(type: VariableType): string {
  switch (type) {
    case VariableType.AA: return 'roAssociativeArray';
    case VariableType.Array: return 'roArray';
    case VariableType.Boolean: return 'Boolean';
    case VariableType.Double: return 'Double';
    case VariableType.Float: return 'Float';
    case VariableType.Function: return 'Function';
    case VariableType.Integer: return 'Integer';
    case VariableType.Interface: return 'Interface';
    case VariableType.Invalid: return 'Invalid';
    case VariableType.List: return 'roList';
    case VariableType.LongInteger: return 'LongInteger';
    case VariableType.Object: return 'Object';
    case VariableType.String: return 'String';
    case VariableType.Subroutine: return 'Function';
    case VariableType.SubtypedObject: return 'Object';
    case VariableType.Uninitialized: return 'Uninitialized';
    case VariableType.Unknown: return 'Unknown';
    default: return 'Unknown';
  }
}

import * as vscode from 'vscode';
import {
  StepType,
  ErrorCode,
} from './protocol/constants';
import type { ThreadInfo } from './protocol/types';
import { BreakpointService, BreakpointSpec } from './services/breakpointService';
import { VariableService, variableTypeName } from './services/variableService';
import { rokuPathToLocal } from './services/pathMapping';
import { SessionController } from './sessionController';

// ---------------------------------------------------------------------------
// Minimal DAP type helpers (subset of the Debug Adapter Protocol)
// ---------------------------------------------------------------------------

interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  [key: string]: unknown;
}
interface DAPRequest extends DAPMessage { type: 'request'; command: string; arguments?: Record<string, unknown>; }

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
  private _outputChannel: vscode.OutputChannel;

  private _breakpoints = new BreakpointService();
  private _variables = new VariableService();
  private _session: SessionController;

  // Thread state from last stop
  private _threads: ThreadInfo[] = [];

  // Diagnostics for compile errors
  private _diagnostics: vscode.DiagnosticCollection;

  constructor(outputChannel: vscode.OutputChannel) {
    this._outputChannel = outputChannel;
    this._diagnostics = vscode.languages.createDiagnosticCollection('brightscript-debug');
    this._session = new SessionController({
      breakpoints: this._breakpoints,
      callbacks: {
        sendOutput: (category, output) => this._sendOutput(category, output),
        sendEvent: (event, body) => this._sendEvent(event, body),
        resetVariables: () => this._variables.reset(),
        clearDiagnostics: () => this._diagnostics.clear(),
        addCompileDiagnostic: (localPath, message, lineNumber) => {
          this._addCompileDiagnostic(localPath, message, lineNumber);
        },
        getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
      },
    });
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
    this._session.dispose();
    this._diagnostics.dispose();
    this._onDidSendMessage.dispose();
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
    this._session.setLaunchConfig((req.arguments ?? {}) as Record<string, unknown>);
    this._sendResponse(req.seq, 'launch', true);
  }

  private _onSetBreakpoints(req: DAPRequest): void {
    const args = req.arguments ?? {};
    const source = (args['source'] as { path?: string } | undefined)?.path ?? '';
    const bps = (args['breakpoints'] as BreakpointSpec[] | undefined) ?? [];

    this._breakpoints.setPending(source, bps);

    if (this._session.protocolClient?.isConnected) {
      // Device is connected — send breakpoints immediately
      this._breakpoints.syncForFile(this._session.commands, source, bps, this._session.sourceRoot).then((results) => {
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

    if (this._session.commands && this._session.protocolClient?.isConnected) {
      try {
        await this._session.commands.setExceptionBreakpoints(filters);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._sendOutput('stderr', `Failed to set exception breakpoints: ${msg}\n`);
      }
    }
  }

  private async _onConfigurationDone(req: DAPRequest): Promise<void> {
    this._sendResponse(req.seq, 'configurationDone', true);
    await this._session.start();
  }

  private async _onThreads(req: DAPRequest): Promise<void> {
    if (!this._session.commands || !this._session.stopped) {
      this._sendResponse(req.seq, 'threads', true, {
        threads: [{ id: 1, name: 'Main' }],
      });
      return;
    }

    try {
      this._threads = await this._session.commands.getThreads();
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
    if (!this._session.commands) {
      this._sendResponse(req.seq, 'stackTrace', true, { stackFrames: [], totalFrames: 0 });
      return;
    }

    const threadId = (req.arguments?.['threadId'] as number | undefined) ?? 1;
    const threadIndex = threadId - 1;

    try {
      const frames = await this._session.commands.getStackTrace(threadIndex);
      this._sendResponse(req.seq, 'stackTrace', true, {
        // StackTrace returns frames most-recent-first (0 = current function),
        // but the Variables command uses inverted indexing where 0 = first called
        // and nframes-1 = most recent. Encode the protocol's frame index directly
        // so that scopes/variables requests use the correct index.
        stackFrames: frames.map((f, i) => ({
          id: this._encodeFrameId(threadIndex, frames.length - 1 - i),
          name: f.functionName,
          source: { path: rokuPathToLocal(f.filePath, this._session.sourceRoot) },
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
    const localRef = this._variables.allocate(threadIndex, frameIndex, []);

    this._sendResponse(req.seq, 'scopes', true, {
      scopes: [
        { name: 'Local', variablesReference: localRef, expensive: false },
      ],
    });
  }

  private async _onVariables(req: DAPRequest): Promise<void> {
    const ref = (req.arguments?.['variablesReference'] as number | undefined) ?? 0;

    if (!this._session.commands || !this._session.stopped) {
      this._sendResponse(req.seq, 'variables', true, { variables: [] });
      return;
    }

    const entry = this._variables.get(ref);
    if (!entry) {
      this._sendResponse(req.seq, 'variables', true, { variables: [] });
      return;
    }

    try {
      const isExpanding = entry.path.length > 0;
      const vars = await this._session.commands.getVariables(
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
        return this._variables.toDAP(v, name, entry.threadIndex, entry.stackFrameIndex, entry.path, isExpanding, entry.hasVirtualPath);
      });

      this._sendResponse(req.seq, 'variables', true, { variables: dapVars });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._sendOutput('stderr', `Variables error: ${msg}\n`);
      this._sendResponse(req.seq, 'variables', true, { variables: [] });
    }
  }

  private async _onContinue(req: DAPRequest): Promise<void> {
    this._session.prepareResume();
    this._sendResponse(req.seq, 'continue', true, { allThreadsContinued: true });
    try {
      await this._session.commands?.continue();
    } catch { /* connection may have closed */ }
  }

  private async _onPause(req: DAPRequest): Promise<void> {
    this._sendResponse(req.seq, 'pause', true);
    try {
      await this._session.commands?.stop();
    } catch { /* connection may have closed */ }
  }

  private async _onNext(req: DAPRequest): Promise<void> {
    const threadId = (req.arguments?.['threadId'] as number | undefined) ?? 1;
    this._session.prepareResume();
    this._sendResponse(req.seq, 'next', true);
    try {
      await this._session.commands?.step(threadId - 1, StepType.Over);
    } catch { /* connection may have closed */ }
  }

  private async _onStepIn(req: DAPRequest): Promise<void> {
    const threadId = (req.arguments?.['threadId'] as number | undefined) ?? 1;
    this._session.prepareResume();
    this._sendResponse(req.seq, 'stepIn', true);
    try {
      await this._session.commands?.step(threadId - 1, StepType.Line);
    } catch { /* connection may have closed */ }
  }

  private async _onStepOut(req: DAPRequest): Promise<void> {
    const threadId = (req.arguments?.['threadId'] as number | undefined) ?? 1;
    this._session.prepareResume();
    this._sendResponse(req.seq, 'stepOut', true);
    try {
      await this._session.commands?.step(threadId - 1, StepType.Out);
    } catch { /* connection may have closed */ }
  }

  private async _onEvaluate(req: DAPRequest): Promise<void> {
    const expr = (req.arguments?.['expression'] as string | undefined) ?? '';
    const context = (req.arguments?.['context'] as string | undefined) ?? 'hover';
    const frameId = (req.arguments?.['frameId'] as number | undefined) ?? 0;

    if (!this._session.commands || !this._session.stopped) {
      this._sendResponse(req.seq, 'evaluate', false, {}, 'Not stopped');
      return;
    }

    const { threadIndex, frameIndex } = this._decodeFrameId(frameId);

    try {
      if (context === 'repl') {
        // Execute arbitrary BrightScript in the debug console
        const result = await this._session.commands.execute(threadIndex, frameIndex, expr);
        const varRef = result.isContainer
          ? this._variables.allocate(threadIndex, frameIndex, expr.split('.'))
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
        const vars = await this._session.commands.getVariables(
          threadIndex, frameIndex, pathSegments, false,
          hasVirtualSegments, hasVirtualSegments,
        );
        if (vars.length > 0) {
          const v = vars[0];
          const varRef = v.isContainer
            ? this._variables.allocate(threadIndex, frameIndex, pathSegments, hasVirtualSegments)
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
      await this._session.disconnect();
    } catch { /* ignore */ }
    this._sendResponse(req.seq, 'disconnect', true);
    this._sendEvent('terminated');
  }

  private _addCompileDiagnostic(localPath: string, errorString: string, lineNumber: number): void {
    // Show as VS Code diagnostic
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

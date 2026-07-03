import { BinaryReader } from 'kopytko-roku-device';
import { StopReason, UpdateType } from 'kopytko-roku-device';
import { rokuPathToLocal } from './services/pathMapping';

export interface DapEvent {
  event: string;
  body: Record<string, unknown>;
}

export interface DapOutput {
  category: 'console' | 'stdout' | 'stderr';
  output: string;
}

export interface CompileDiagnosticInfo {
  localPath: string;
  message: string;
  lineNumber: number;
}

export interface ProtocolUpdateMapping {
  events: DapEvent[];
  outputs: DapOutput[];
  stopped?: boolean;
  primaryThreadIndex?: number;
  resetVariables?: boolean;
  ioPort?: number;
  compileDiagnostic?: CompileDiagnosticInfo;
}

export interface ProtocolUpdateContext {
  suppressInitialStop: boolean;
  sourceRoot: string;
}

export class ProtocolEventMapper {
  mapUpdate(updateType: number, payload: Buffer, context: ProtocolUpdateContext): ProtocolUpdateMapping {
    switch (updateType) {
      case UpdateType.AllThreadsStopped:
        return this.mapAllThreadsStopped(payload, context.suppressInitialStop);
      case UpdateType.ThreadAttached:
        return this.mapThreadAttached(payload);
      case UpdateType.IOPortOpened:
        return this.mapIOPortOpened(payload);
      case UpdateType.CompileError:
        return this.mapCompileError(payload, context.sourceRoot);
      case UpdateType.BreakpointVerified:
        return this.mapBreakpointVerified(payload);
      case UpdateType.BreakpointError:
        return this.mapBreakpointError(payload);
      case UpdateType.ProtocolError:
        return {
          events: [{ event: 'terminated', body: {} }],
          outputs: [{ category: 'stderr', output: 'Fatal protocol error — debug session terminated.\n' }],
        };
      case UpdateType.ExceptionBreakpointError:
        return this.mapExceptionBreakpointError(payload);
      default:
        return { events: [], outputs: [] };
    }
  }

  mapAllThreadsStopped(payload: Buffer, suppressInitialStop: boolean): ProtocolUpdateMapping {
    const reader = new BinaryReader(payload);
    const primaryThreadIndex = reader.readInt32();
    const stopReason: StopReason = reader.readUint8();
    const stopReasonDetail = reader.remaining > 0 ? reader.readStringNT() : '';

    if (suppressInitialStop) {
      return { events: [], outputs: [], stopped: true, primaryThreadIndex };
    }

    if (stopReason === StopReason.NormalExit) {
      return {
        events: [{ event: 'terminated', body: {} }],
        outputs: [{ category: 'console', output: 'App exited normally.\n' }],
      };
    }

    const reason = stopReasonToDAP(stopReason);
    const outputs: DapOutput[] = [];
    if (stopReason === StopReason.RuntimeError || stopReason === StopReason.CaughtRuntimeError) {
      const detail = stopReasonDetail ? ` — ${stopReasonDetail}` : '';
      outputs.push({ category: 'stderr', output: `Runtime error${detail}\n` });
    }

    return {
      events: [{
        event: 'stopped',
        body: {
          reason,
          threadId: primaryThreadIndex + 1,
          description: stopReasonDetail || reason,
          allThreadsStopped: true,
        },
      }],
      outputs,
      stopped: true,
      primaryThreadIndex,
      resetVariables: true,
    };
  }

  mapThreadAttached(payload: Buffer): ProtocolUpdateMapping {
    const reader = new BinaryReader(payload);
    const threadIndex = reader.readInt32();
    const stopReason: StopReason = reader.readUint8();
    const stopReasonDetail = reader.remaining > 0 ? reader.readStringNT() : '';

    return {
      events: [{
        event: 'stopped',
        body: {
          reason: stopReasonToDAP(stopReason),
          threadId: threadIndex + 1,
          description: stopReasonDetail || undefined,
          allThreadsStopped: true,
        },
      }],
      outputs: [],
      stopped: true,
      resetVariables: true,
    };
  }

  mapIOPortOpened(payload: Buffer): ProtocolUpdateMapping {
    const reader = new BinaryReader(payload);
    return { events: [], outputs: [], ioPort: reader.readUint32() };
  }

  mapCompileError(payload: Buffer, sourceRoot: string): ProtocolUpdateMapping {
    const reader = new BinaryReader(payload);
    reader.readUint32();
    const errorString = reader.readStringNT();
    const filePath = reader.readStringNT();
    const lineNumber = reader.readUint32();

    return {
      events: [],
      outputs: [{ category: 'stderr', output: `Compile error: ${errorString} (${filePath}:${lineNumber})\n` }],
      compileDiagnostic: {
        localPath: rokuPathToLocal(filePath, sourceRoot),
        message: errorString,
        lineNumber,
      },
    };
  }

  mapBreakpointVerified(payload: Buffer): ProtocolUpdateMapping {
    const reader = new BinaryReader(payload);
    reader.readUint32();
    const count = reader.readUint32();
    const events: DapEvent[] = [];
    for (let i = 0; i < count; i++) {
      const bpId = reader.readUint32();
      events.push({
        event: 'breakpoint',
        body: { reason: 'changed', breakpoint: { id: bpId, verified: true } },
      });
    }
    return { events, outputs: [] };
  }

  mapBreakpointError(payload: Buffer): ProtocolUpdateMapping {
    const reader = new BinaryReader(payload);
    reader.readUint32();
    const bpId = reader.readUint32();
    const outputs: DapOutput[] = [];
    const compileErrorCount = reader.readUint32();
    for (let i = 0; i < compileErrorCount; i++) {
      outputs.push({ category: 'stderr', output: `Breakpoint ${bpId} compile error: ${reader.readStringNT()}\n` });
    }
    const runtimeErrorCount = reader.readUint32();
    for (let i = 0; i < runtimeErrorCount; i++) {
      outputs.push({ category: 'stderr', output: `Breakpoint ${bpId} runtime error: ${reader.readStringNT()}\n` });
    }
    const otherErrorCount = reader.readUint32();
    for (let i = 0; i < otherErrorCount; i++) {
      outputs.push({ category: 'stderr', output: `Breakpoint ${bpId} error: ${reader.readStringNT()}\n` });
    }
    return { events: [], outputs };
  }

  mapExceptionBreakpointError(payload: Buffer): ProtocolUpdateMapping {
    const reader = new BinaryReader(payload);
    reader.readUint32();
    const filterId = reader.readUint32();
    const outputs: DapOutput[] = [];
    const compileErrorCount = reader.readUint32();
    for (let i = 0; i < compileErrorCount; i++) {
      outputs.push({ category: 'stderr', output: `Exception breakpoint ${filterId} compile error: ${reader.readStringNT()}\n` });
    }
    const runtimeErrorCount = reader.readUint32();
    for (let i = 0; i < runtimeErrorCount; i++) {
      outputs.push({ category: 'stderr', output: `Exception breakpoint ${filterId} runtime error: ${reader.readStringNT()}\n` });
    }
    const otherErrorCount = reader.readUint32();
    for (let i = 0; i < otherErrorCount; i++) {
      outputs.push({ category: 'stderr', output: `Exception breakpoint ${filterId} error: ${reader.readStringNT()}\n` });
    }
    if (reader.remaining >= 4) {
      const lineNumber = reader.readUint32();
      const filePath = reader.remaining > 0 ? reader.readStringNT() : '';
      if (filePath) {
        outputs.push({ category: 'stderr', output: `  at ${filePath}:${lineNumber}\n` });
      }
    }
    return { events: [], outputs };
  }
}

export function stopReasonToDAP(reason: StopReason): string {
  switch (reason) {
    case StopReason.StopStatement: return 'breakpoint';
    case StopReason.Break: return 'breakpoint';
    case StopReason.RuntimeError: return 'exception';
    case StopReason.CaughtRuntimeError: return 'exception';
    default: return 'pause';
  }
}

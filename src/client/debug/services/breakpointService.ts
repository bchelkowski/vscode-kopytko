import { DebugCommands } from '../protocol/commands';
import { ErrorCode } from '../protocol/constants';
import { localPathToRoku } from './pathMapping';

export interface BreakpointSpec {
  line: number;
  condition?: string;
  hitCondition?: string;
}

export interface BreakpointResult {
  id: number;
  errorCode: ErrorCode;
}

export class BreakpointService {
  private pendingBreakpoints = new Map<string, BreakpointSpec[]>();
  private deviceBreakpointIds = new Map<string, number[]>();

  setPending(filePath: string, breakpoints: BreakpointSpec[]): void {
    this.pendingBreakpoints.set(filePath, breakpoints);
  }

  async sendAll(
    commands: DebugCommands | null,
    sourceRoot: string,
    onVerified: (id: number, line: number | undefined) => void,
    onRejected: (filePath: string, line: number | undefined, errorCode: ErrorCode) => void,
    onError: (filePath: string, error: Error) => void,
  ): Promise<void> {
    if (!commands) return;

    for (const [filePath, bps] of this.pendingBreakpoints) {
      if (bps.length === 0) continue;
      try {
        const results = await this.syncForFile(commands, filePath, bps, sourceRoot);
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.errorCode === ErrorCode.OK) {
            onVerified(r.id, bps[i]?.line);
          } else {
            onRejected(filePath, bps[i]?.line, r.errorCode);
          }
        }
      } catch (err) {
        onError(filePath, err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  async syncForFile(
    commands: DebugCommands | null,
    filePath: string,
    bps: BreakpointSpec[],
    sourceRoot: string,
  ): Promise<BreakpointResult[]> {
    if (!commands) return bps.map(() => ({ id: 0, errorCode: ErrorCode.OtherError }));

    const existingIds = this.deviceBreakpointIds.get(filePath);
    if (existingIds && existingIds.length > 0) {
      try {
        await commands.removeBreakpoints(existingIds);
      } catch { /* ignore removal errors */ }
    }

    if (bps.length === 0) {
      this.deviceBreakpointIds.delete(filePath);
      return [];
    }

    const pkgPath = localPathToRoku(filePath, sourceRoot);
    const conditionalBps = bps.filter(bp => bp.condition);
    const simpleBps = bps.filter(bp => !bp.condition);
    const results: BreakpointResult[] = new Array(bps.length);
    const newIds: number[] = [];

    if (simpleBps.length > 0) {
      const simpleResults = await commands.addBreakpoints(
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
      const condResults = await commands.addConditionalBreakpoints(
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

    this.deviceBreakpointIds.set(filePath, newIds);
    return results;
  }
}

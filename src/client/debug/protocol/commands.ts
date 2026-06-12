/**
 * Roku Socket-Based Debug Protocol — Command Builders & Response Parsers
 *
 * High-level methods that build binary request packets and parse structured
 * responses. Wraps the low-level ProtocolClient.
 */

import { BinaryReader, BinaryWriter } from './binaryIO';
import {
  CommandCode,
  StepType,
  VariableFlags,
  VariableRequestFlags,
} from './constants';
import type { ProtocolClient } from './protocolClient';
import type {
  ThreadInfo,
  StackEntry,
  VariableInfo,
  BreakpointSpec,
  ConditionalBreakpointSpec,
  BreakpointResult,
  ExecuteResult,
} from './types';
import { StopReason, VariableType, ErrorCode } from './constants';

export class DebugCommands {
  constructor(private readonly _client: ProtocolClient) {}

  async stop(): Promise<void> {
    await this._client.sendRequest(CommandCode.Stop);
  }

  async continue(): Promise<void> {
    await this._client.sendRequest(CommandCode.Continue);
  }

  async exitChannel(): Promise<void> {
    await this._client.sendRequest(CommandCode.ExitChannel);
  }

  // ---------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------

  async getThreads(): Promise<ThreadInfo[]> {
    const payload = await this._client.sendRequest(CommandCode.Threads);
    return DebugCommands._parseThreads(payload);
  }

  private static _parseThreads(payload: Buffer): ThreadInfo[] {
    const reader = new BinaryReader(payload);
    const threadCount = reader.readUint32();
    const threads: ThreadInfo[] = [];

    for (let i = 0; i < threadCount; i++) {
      const flags = reader.readUint8();
      const isPrimary = (flags & 0x01) !== 0;
      const stopReason: StopReason = reader.readUint8();
      const stopReasonDetail = reader.readStringNT();
      const lineNumber = reader.readUint32();
      const functionName = reader.readStringNT();
      const filePath = reader.readStringNT();
      const codeSnippet = reader.readStringNT();
      threads.push({ isPrimary, stopReason, stopReasonDetail, lineNumber, functionName, filePath, codeSnippet });
    }

    return threads;
  }

  // ---------------------------------------------------------------------------
  // Stack trace
  // ---------------------------------------------------------------------------

  async getStackTrace(threadIndex: number): Promise<StackEntry[]> {
    const writer = new BinaryWriter();
    writer.writeUint32(threadIndex);
    const payload = await this._client.sendRequest(CommandCode.StackTrace, writer.toBuffer());
    return DebugCommands._parseStackTrace(payload);
  }

  private static _parseStackTrace(payload: Buffer): StackEntry[] {
    const reader = new BinaryReader(payload);
    const entryCount = reader.readUint32();
    const entries: StackEntry[] = [];

    for (let i = 0; i < entryCount; i++) {
      const lineNumber = reader.readUint32();
      const functionName = reader.readStringNT();
      const filePath = reader.readStringNT();
      entries.push({ lineNumber, functionName, filePath });
    }

    return entries;
  }

  // ---------------------------------------------------------------------------
  // Variables
  // ---------------------------------------------------------------------------

  async getVariables(
    threadIndex: number,
    stackFrameIndex: number,
    path: string[] = [],
    getChildren = true,
    getVirtualKeys = false,
  ): Promise<VariableInfo[]> {
    const writer = new BinaryWriter();
    writer.writeUint32(threadIndex);
    writer.writeUint32(stackFrameIndex);

    // Variable path
    writer.writeUint32(path.length);
    for (const segment of path) {
      writer.writeStringNT(segment);
    }

    // Request flags
    let flags = 0;
    if (getChildren) flags |= VariableRequestFlags.GetChildKeys;
    if (getVirtualKeys) flags |= VariableRequestFlags.GetVirtualKeys;
    writer.writeUint8(flags);

    const payload = await this._client.sendRequest(CommandCode.Variables, writer.toBuffer());
    return DebugCommands._parseVariables(payload);
  }

  private static _parseVariables(payload: Buffer): VariableInfo[] {
    const reader = new BinaryReader(payload);
    const variableCount = reader.readUint32();
    const variables: VariableInfo[] = [];

    for (let i = 0; i < variableCount; i++) {
      variables.push(DebugCommands._parseOneVariable(reader));
    }

    return variables;
  }

  private static _parseOneVariable(reader: BinaryReader): VariableInfo {
    const flags = reader.readUint8();
    const variableType: VariableType = reader.readUint8();
    const isContainer = (flags & VariableFlags.IsContainer) !== 0;

    let name = '';
    if (flags & VariableFlags.IsNameHere) {
      name = reader.readStringNT();
    }

    let refCount: number | undefined;
    if (flags & VariableFlags.IsRefCounted) {
      refCount = reader.readUint32();
    }

    let value = '';
    if (flags & VariableFlags.IsValueHere) {
      value = reader.readStringNT();
    }

    let keyType = VariableType.String;
    let childCount = 0;
    if (isContainer) {
      keyType = reader.readUint8();
      childCount = reader.readUint32();
    }

    // If this variable has children inlined, parse them
    let children: VariableInfo[] | undefined;
    if ((flags & VariableFlags.IsChildKey) === 0 && isContainer && childCount > 0) {
      children = [];
      for (let c = 0; c < childCount; c++) {
        children.push(DebugCommands._parseOneVariable(reader));
      }
    }

    return {
      name,
      type: variableType,
      value,
      flags,
      childCount,
      keyType,
      refCount,
      children,
      isContainer,
    };
  }

  // ---------------------------------------------------------------------------
  // Stepping
  // ---------------------------------------------------------------------------

  async step(threadIndex: number, stepType: StepType): Promise<void> {
    const writer = new BinaryWriter();
    writer.writeUint32(threadIndex);
    writer.writeUint8(stepType);
    await this._client.sendRequest(CommandCode.Step, writer.toBuffer());
  }

  // ---------------------------------------------------------------------------
  // Breakpoints
  // ---------------------------------------------------------------------------

  async addBreakpoints(breakpoints: BreakpointSpec[]): Promise<BreakpointResult[]> {
    const writer = new BinaryWriter();
    writer.writeUint32(breakpoints.length);
    for (const bp of breakpoints) {
      writer.writeStringNT(bp.filePath);
      writer.writeUint32(bp.lineNumber);
      writer.writeUint32(bp.ignoreCount ?? 0);
    }
    const payload = await this._client.sendRequest(CommandCode.AddBreakpoints, writer.toBuffer());
    return DebugCommands._parseBreakpointResults(payload, breakpoints.length);
  }

  async addConditionalBreakpoints(breakpoints: ConditionalBreakpointSpec[]): Promise<BreakpointResult[]> {
    const writer = new BinaryWriter();
    writer.writeUint32(breakpoints.length);
    for (const bp of breakpoints) {
      writer.writeStringNT(bp.filePath);
      writer.writeUint32(bp.lineNumber);
      writer.writeUint32(0); // ignoreCount
      writer.writeStringNT(bp.condition);
    }
    const payload = await this._client.sendRequest(CommandCode.AddConditionalBreakpoints, writer.toBuffer());
    return DebugCommands._parseBreakpointResults(payload, breakpoints.length);
  }

  private static _parseBreakpointResults(payload: Buffer, _count: number): BreakpointResult[] {
    const reader = new BinaryReader(payload);
    const resultCount = reader.readUint32();
    const results: BreakpointResult[] = [];

    for (let i = 0; i < resultCount; i++) {
      const id = reader.readUint32();
      const errorCode: ErrorCode = reader.readUint32();
      results.push({ id, errorCode });
    }

    return results;
  }

  async removeBreakpoints(ids: number[]): Promise<void> {
    const writer = new BinaryWriter();
    writer.writeUint32(ids.length);
    for (const id of ids) {
      writer.writeUint32(id);
    }
    await this._client.sendRequest(CommandCode.RemoveBreakpoints, writer.toBuffer());
  }

  async listBreakpoints(): Promise<BreakpointResult[]> {
    const payload = await this._client.sendRequest(CommandCode.ListBreakpoints);
    const reader = new BinaryReader(payload);
    const count = reader.readUint32();
    const results: BreakpointResult[] = [];

    for (let i = 0; i < count; i++) {
      const id = reader.readUint32();
      const errorCode: ErrorCode = reader.readUint32();
      results.push({ id, errorCode });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Execute (REPL / hover / watch)
  // ---------------------------------------------------------------------------

  async execute(threadIndex: number, stackFrameIndex: number, code: string): Promise<ExecuteResult> {
    const writer = new BinaryWriter();
    writer.writeUint32(threadIndex);
    writer.writeUint32(stackFrameIndex);
    writer.writeStringNT(code);
    const payload = await this._client.sendRequest(CommandCode.Execute, writer.toBuffer());
    return DebugCommands._parseExecuteResult(payload);
  }

  private static _parseExecuteResult(payload: Buffer): ExecuteResult {
    const reader = new BinaryReader(payload);

    // The result is returned as a VariableInfo-like structure
    const flags = reader.readUint8();
    const resultType: VariableType = reader.readUint8();
    const isContainer = (flags & VariableFlags.IsContainer) !== 0;

    let resultValue = '';
    if (flags & VariableFlags.IsValueHere) {
      resultValue = reader.readStringNT();
    }

    let childCount = 0;
    if (isContainer) {
      reader.readUint8(); // keyType
      childCount = reader.readUint32();
    }

    return { resultType, resultValue, isContainer, childCount };
  }

  // ---------------------------------------------------------------------------
  // Exception breakpoints
  // ---------------------------------------------------------------------------

  async setExceptionBreakpoints(filters: string[]): Promise<void> {
    const writer = new BinaryWriter();
    writer.writeUint32(filters.length);
    for (const filter of filters) {
      writer.writeStringNT(filter);
    }
    await this._client.sendRequest(CommandCode.SetExceptionBreakpoints, writer.toBuffer());
  }
}

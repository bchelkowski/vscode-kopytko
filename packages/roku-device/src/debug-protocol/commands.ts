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

  /**
   * Commands the device accepts only while the debug target is stopped.
   * Sending any of these while the channel is running is a protocol-state
   * violation; some firmware answers `NOT_STOPPED`, some resets the socket.
   */
  static readonly STOPPED_ONLY_COMMANDS: ReadonlySet<CommandCode> = new Set([
    CommandCode.Continue,
    CommandCode.Threads,
    CommandCode.StackTrace,
    CommandCode.Variables,
    CommandCode.Step,
    CommandCode.Execute,
  ]);

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

  /**
   * Request variable information from the device.
   *
   * Wire format (per Roku reference implementation):
   *   uint8   flags           (GET_CHILD_KEYS=0x01)
   *   uint32  thread_index
   *   uint32  frame_index
   *   uint32  variable_path_len  (0 = all locals in frame)
   *   utf8z   path[]             (repeated path_len times)
   *
   * When `getChildren=false` (default): returns a flat list of variables
   * in the scope/path without child data — fast, suitable for initial display.
   *
   * When `getChildren=true`: the response contains the parent variable
   * (IS_CHILD_KEY=false) followed by its child keys (IS_CHILD_KEY=true).
   * Use this when expanding a container in the Variables panel.
  *
  * When `includeVirtualKeys=true`: also returns virtual keys (SceneGraph
  * node fields, `$children`, `$parent`, `$count`, etc.).
  *
  * When `virtualPathIncluded=true`: tells the device that the variable
  * path contains virtual key segments that must be resolved accordingly.
  */
  async getVariables(
   threadIndex: number,
   stackFrameIndex: number,
   path: string[] = [],
   getChildren = false,
   includeVirtualKeys = false,
   virtualPathIncluded = false,
  ): Promise<VariableInfo[]> {
   const writer = new BinaryWriter();

   // Flags byte comes FIRST per the Roku protocol spec
   let flags = 0;
   if (getChildren) flags |= VariableRequestFlags.GetChildKeys;
   if (includeVirtualKeys) flags |= VariableRequestFlags.GetVirtualKeys;
   if (virtualPathIncluded) flags |= VariableRequestFlags.VirtualPathIncluded;
   writer.writeUint8(flags);

    writer.writeUint32(threadIndex);
    writer.writeUint32(stackFrameIndex);

    // Variable path (empty = all locals in the frame)
    writer.writeUint32(path.length);
    for (const segment of path) {
      writer.writeStringNT(segment);
    }

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

  /**
   * Parse a single VariableInfo from the binary response.
   *
   * Field order per the Roku reference implementation:
   *   uint8   flags
   *   uint8   variable_type
   *   utf8z   name            (if IS_NAME_HERE)
   *   uint32  ref_count       (if IS_REF_COUNTED)
   *   uint8   key_type        (if IS_CONTAINER)   ← before value
   *   uint32  element_count   (if IS_CONTAINER)
   *   <value>                 (if IS_VALUE_HERE)   ← type-dependent
   */
  private static _parseOneVariable(reader: BinaryReader): VariableInfo {
    const flags = reader.readUint8();
    const variableType: VariableType = reader.readUint8();
    const isContainer = (flags & VariableFlags.IsContainer) !== 0;
    const isChildKey = (flags & VariableFlags.IsChildKey) !== 0;
    const isVirtual = (flags & VariableFlags.IsVirtual) !== 0;

    let name = '';
    if (flags & VariableFlags.IsNameHere) {
      name = reader.readStringNT();
    }

    let refCount: number | undefined;
    if (flags & VariableFlags.IsRefCounted) {
      refCount = reader.readUint32();
    }

    // Container metadata comes BEFORE value per the protocol spec
    let keyType = VariableType.String;
    let childCount = 0;
    if (isContainer) {
      keyType = reader.readUint8();
      childCount = reader.readUint32();
    }

    // Value — type-dependent binary encoding
    let value = '';
    if (flags & VariableFlags.IsValueHere) {
      value = DebugCommands._readTypedValue(reader, variableType);
    }

    return {
      name,
      type: variableType,
      value,
      flags,
      childCount,
      keyType,
      refCount,
      children: undefined,
      isContainer,
      isChildKey,
      isVirtual,
    };
  }

  /**
   * Read a value from the binary stream based on the variable type.
   * Container types (AA, Array, List) never have IS_VALUE_HERE set.
   */
  private static _readTypedValue(reader: BinaryReader, type: VariableType): string {
    switch (type) {
      case VariableType.Boolean:
        return reader.readUint8() !== 0 ? 'true' : 'false';
      case VariableType.Integer:
        return reader.readInt32().toString();
      case VariableType.Float:
        return reader.readFloat32().toString();
      case VariableType.Double:
        return reader.readFloat64().toString();
      case VariableType.LongInteger:
        return reader.readInt64().toString();
      case VariableType.String:
        return reader.readStringNT();
      case VariableType.Function:
      case VariableType.Subroutine:
        return reader.readStringNT();
      case VariableType.Object:
      case VariableType.Interface:
        return reader.readStringNT();
      case VariableType.SubtypedObject: {
        // Two strings: type name + subtype name
        const typeName = reader.readStringNT();
        const subtypeName = reader.readStringNT();
        return subtypeName ? `${typeName}:${subtypeName}` : typeName;
      }
      case VariableType.Invalid:
      case VariableType.Uninitialized:
      case VariableType.Unknown:
        return '';
      default:
        // AA, Array, List — should never have IS_VALUE_HERE
        return '';
    }
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
    return DebugCommands._parseBreakpointResults(payload);
  }

  async addConditionalBreakpoints(breakpoints: ConditionalBreakpointSpec[]): Promise<BreakpointResult[]> {
    const writer = new BinaryWriter();
    writer.writeUint32(0); // flags — reserved, always 0
    writer.writeUint32(breakpoints.length);
    for (const bp of breakpoints) {
      writer.writeStringNT(bp.filePath);
      writer.writeUint32(bp.lineNumber);
      writer.writeUint32(0); // ignoreCount
      writer.writeStringNT(bp.condition);
    }
    const payload = await this._client.sendRequest(CommandCode.AddConditionalBreakpoints, writer.toBuffer());
    return DebugCommands._parseBreakpointResults(payload);
  }

  /**
   * Parse breakpoint results. Each BreakpointInfo per the spec:
   *   uint32 breakpoint_id
   *   uint32 error_code
   *   uint32 ignore_count
   */
  private static _parseBreakpointResults(payload: Buffer): BreakpointResult[] {
    const reader = new BinaryReader(payload);
    const resultCount = reader.readUint32();
    const results: BreakpointResult[] = [];

    for (let i = 0; i < resultCount; i++) {
      const id = reader.readUint32();
      const errorCode: ErrorCode = reader.readUint32();
      reader.readUint32(); // ignore_count — not used by the adapter
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
    return DebugCommands._parseBreakpointResults(payload);
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

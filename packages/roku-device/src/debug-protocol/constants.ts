/**
 * Roku Socket-Based Debug Protocol — Constants
 *
 * Binary protocol on TCP port 8081. All values are little-endian.
 * Reference: https://developer.roku.com/dev/docs/socket-based-debugger
 * Target: Protocol 3.3.0 / Roku OS 14.1+
 */

export const DEBUGGER_PORT = 8081;
export const DEBUGGER_MAGIC = 0x0067756265647362n; // b'bsdebug\0' as uint64 LE

export enum CommandCode {
  Stop = 1,
  Continue = 2,
  Threads = 3,
  StackTrace = 4,
  Variables = 5,
  Step = 6,
  AddBreakpoints = 7,
  ListBreakpoints = 8,
  RemoveBreakpoints = 9,
  Execute = 10,
  AddConditionalBreakpoints = 11,
  SetExceptionBreakpoints = 12,
  ExitChannel = 122,
}

export enum StepType {
  Line = 1,
  Out = 2,
  Over = 3,
}

export enum UpdateType {
  IOPortOpened = 1,
  AllThreadsStopped = 2,
  ThreadAttached = 3,
  BreakpointError = 4,
  CompileError = 5,
  BreakpointVerified = 6,
  ProtocolError = 7,
  ExceptionBreakpointError = 8,
}

export enum StopReason {
  Undefined = 0,
  NotStopped = 1,
  NormalExit = 2,
  StopStatement = 3,
  Break = 4,
  RuntimeError = 5,
  CaughtRuntimeError = 6,
}

export enum VariableType {
  AA = 1,
  Array = 2,
  Boolean = 3,
  Double = 4,
  Float = 5,
  Function = 6,
  Integer = 7,
  Interface = 8,
  Invalid = 9,
  List = 10,
  LongInteger = 11,
  Object = 12,
  String = 13,
  Subroutine = 14,
  SubtypedObject = 15,
  Uninitialized = 16,
  Unknown = 17,
}

export enum VariableFlags {
  IsChildKey = 0x01,
  IsConst = 0x02,
  IsContainer = 0x04,
  IsNameHere = 0x08,
  IsRefCounted = 0x10,
  IsValueHere = 0x20,
  IsKeysCaseSensitive = 0x40,
  IsVirtual = 0x80,
}

export enum VariableRequestFlags {
  GetChildKeys = 0x01,
  CaseSensitivityOptions = 0x02,
  GetVirtualKeys = 0x04,
  VirtualPathIncluded = 0x08,
}

export enum ErrorCode {
  OK = 0,
  OtherError = 1,
  UndefinedCommand = 2,
  CantContinue = 3,
  NotStopped = 4,
  InvalidArgs = 5,
}

export const CONNECTION_TIMEOUT_MS = 60_000;
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Container variable types that can be expanded in the Variables panel. */
export const CONTAINER_TYPES = new Set([
  VariableType.AA,
  VariableType.Array,
  VariableType.List,
  VariableType.Object,
  VariableType.SubtypedObject,
]);

/**
 * Roku Socket-Based Debug Protocol — Type Definitions
 *
 * TypeScript interfaces for the binary protocol data structures.
 */

import type { StopReason, VariableType, UpdateType, ErrorCode } from './constants';

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

export interface ProtocolVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface HandshakeResponse {
  magic: bigint;
  protocolVersion: ProtocolVersion;
  platformRevisionTimestamp: bigint;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export interface ThreadInfo {
  isPrimary: boolean;
  stopReason: StopReason;
  stopReasonDetail: string;
  lineNumber: number;
  functionName: string;
  filePath: string;
  codeSnippet: string;
}

// ---------------------------------------------------------------------------
// Stack trace
// ---------------------------------------------------------------------------

export interface StackEntry {
  lineNumber: number;
  functionName: string;
  filePath: string;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export interface VariableInfo {
  name: string;
  type: VariableType;
  value: string;
  flags: number;
  childCount: number;
  keyType: VariableType;
  refCount?: number;
  children?: VariableInfo[];
  isContainer: boolean;
  /** True when this entry is a child key of a parent container. */
  isChildKey: boolean;
  /** True when this entry is a virtual key (e.g. SceneGraph node field). */
  isVirtual: boolean;
}

// ---------------------------------------------------------------------------
// Breakpoints
// ---------------------------------------------------------------------------

export interface BreakpointSpec {
  filePath: string;
  lineNumber: number;
  ignoreCount?: number;
}

export interface ConditionalBreakpointSpec {
  filePath: string;
  lineNumber: number;
  condition: string;
}

export interface BreakpointResult {
  id: number;
  errorCode: ErrorCode;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ExecuteResult {
  resultType: VariableType;
  resultValue: string;
  isContainer: boolean;
  childCount: number;
}

// ---------------------------------------------------------------------------
// Update messages (device → client, requestId === 0)
// ---------------------------------------------------------------------------

export interface StopInfo {
  primaryThreadIndex: number;
  stopReason: StopReason;
  stopReasonDetail: string;
}

export interface CompileErrorInfo {
  errorString: string;
  filePath: string;
  lineNumber: number;
  libraryName: string;
}

export interface BreakpointErrorInfo {
  breakpointId: number;
  compileErrors: string[];
  runtimeErrors: string[];
  otherErrors: string[];
}

export interface DebuggerUpdate {
  updateType: UpdateType;
  errorCode: ErrorCode;
  data: StopInfo | CompileErrorInfo | CompileErrorInfo[] | BreakpointErrorInfo[] | number[] | number | null;
}

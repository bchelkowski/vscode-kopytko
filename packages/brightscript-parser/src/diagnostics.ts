/**
 * Parse diagnostics — errors and warnings produced by the parser.
 */

export interface ParseDiagnostic {
  /** Human-readable error message. */
  readonly message: string;
  /** Byte offset where the problem starts. */
  readonly pos: number;
  /** Byte offset just past the end of the problem. */
  readonly end: number;
  /** 0-based line number. */
  readonly line: number;
  /** 0-based column. */
  readonly column: number;
}

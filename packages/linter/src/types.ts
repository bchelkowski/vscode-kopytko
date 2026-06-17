import type { LintContext } from './context';
import type { ParseResult } from 'kopytko-brightscript-parser';

export type LintSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface LintFix {
  /** Type of fix to apply. */
  type: 'delete-line' | 'insert';
  /** 0-based line number. */
  line: number;
  /** 0-based column (for 'insert'). */
  column: number;
  /** Text to insert (for 'insert'). */
  text?: string;
}

export interface LintDiagnostic {
  code: string;
  message: string;
  severity: LintSeverity;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  filePath: string;
  /** Optional auto-fix for this diagnostic. */
  fix?: LintFix;
}

export interface LintResult {
  diagnostics: LintDiagnostic[];
  fileCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  hintCount: number;
}

export interface GeneratedModuleConfig {
  path: string;
  functions: string[];
}

export interface KopytkoImport {
  raw: string;
  importPath: string;
  fromModule?: string;
  line: number;
  isMock?: boolean;
}

export interface FunctionDefinition {
  name: string;
  nameLower: string;
  line: number;
  column: number;
  filePath: string;
  signature: string;
}

export interface RuleContext {
  filePath: string;
  lines: string[];
  imports: KopytkoImport[];
  config: RuleConfig;
  lintContext: LintContext;
  /** Parsed CST — available for rules that use AST-based analysis. */
  parseResult?: ParseResult;
}

export type RuleConfig = Record<string, LintSeverity | 'off'>;

export type RuleFn = (ctx: RuleContext) => LintDiagnostic[];

export interface RuleDefinition {
  code: string;
  defaultSeverity: LintSeverity;
  fn: RuleFn;
}

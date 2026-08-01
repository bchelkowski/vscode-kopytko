import { parse, analyzeContext } from 'kopytko-brightscript-parser';
import type { FunctionDefinition } from '../types';

const FUNC_PREFIX_RE = /^\s*(?:function|sub)\s+/i;
const FUNC_FULL_RE = /^\s*(?:function|sub)\s+(\w+)\s*\(/i;

export interface InnerMethodDefinition {
  name: string;
  nameLower: string;
  line: number;
  column: number;
  filePath: string;
  ownerFunction?: string;
}

/**
 * Parses all top-level function/sub definitions from a BrightScript text.
 *
 * Deliberately kept as a line-scan rather than a CST walk: this is called from
 * `projectIndexer.ts` once per project *and package* file, before anything
 * needing that file has otherwise been parsed — a full parse here is a real,
 * unconditional cost across the whole dependency graph. It was audited against
 * the CST-based version for the "a commented-out function still gets indexed"
 * failure mode reported elsewhere; that does not reproduce here (`^\s*` cannot
 * skip over a leading `'`), so there is no correctness case to justify the
 * cost. See `findings/lsp-architecture.md`.
 */
export function parseFunctionDefs(text: string, filePath: string, preLines?: string[]): FunctionDefinition[] {
  const lines = preLines ?? text.split(/\r?\n/);
  const defs: FunctionDefinition[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = FUNC_FULL_RE.exec(lines[i]);
    if (!match) continue;
    const prefixMatch = FUNC_PREFIX_RE.exec(lines[i]);
    const column = prefixMatch ? prefixMatch[0].length : 0;
    defs.push({
      name: match[1],
      nameLower: match[1].toLowerCase(),
      line: i,
      column,
      filePath,
      signature: lines[i].trim(),
    });
  }
  return defs;
}

/**
 * Parses all associative-array method assignments — both `<obj>.<name> =
 * function|sub(...)` and AA-literal `<name>: function|sub(...)` — from a
 * BrightScript text.
 *
 * CST-based (via `analyzeContext()`), unlike its `parseFunctionDefs` sibling
 * above: this function has no hot-path caller in this package (nothing here
 * calls it — it exists purely as public API), so a full parse costs nothing
 * extra. This removes an independently-maintained duplicate of logic the
 * parser already owns as the single source of truth (`analyzeContext()` is
 * also what the extension's own inner-method detection runs on). Note this
 * carries over one limitation from the regex it replaces rather than fixing
 * it: `analyzeContext()`'s `dotAssignedFunctions` also requires the
 * assignment's receiver to be a single identifier (`obj instanceof
 * IdentifierExpression` in `contextAnalysis.ts`), so a nested receiver like
 * `m.handlers.onClick = function()` still goes undetected — same as before.
 */
export function parseInnerMethodDefs(text: string, filePath: string): InnerMethodDefinition[] {
  const result = parse(text);
  const ctx = analyzeContext(result.root);
  const defs: InnerMethodDefinition[] = [];

  for (const f of ctx.dotAssignedFunctions) {
    defs.push({
      name: f.fieldName,
      nameLower: f.fieldName.toLowerCase(),
      line: f.line,
      column: f.column,
      filePath,
      ownerFunction: f.enclosingFunction || undefined,
    });
  }
  for (const f of ctx.inlineAAFunctions) {
    defs.push({
      name: f.aaFieldNameOriginal,
      nameLower: f.aaFieldName,
      line: f.line,
      column: f.column,
      filePath,
      ownerFunction: f.enclosingFunction || undefined,
    });
  }

  // Document order, matching the old line-scan's output order.
  defs.sort((a, b) => a.line - b.line || a.column - b.column);
  return defs;
}

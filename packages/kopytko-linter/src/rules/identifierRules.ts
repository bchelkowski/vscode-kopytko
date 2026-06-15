import type { LintDiagnostic, RuleContext } from '../types';
import { builtinNames, keywordNames, builtinArity } from '../catalog/builtins';
import { stripStringLiterals } from '../analysis/textUtils';
import { escapeRegex } from '../analysis/textUtils';
import { stripNumericLiterals } from '../analysis/numericLiterals';
import {
  buildFunctionScopes,
  findScopeAtLine,
  findParentScopeAtLine,
  computeMainBodyLines,
  countCallArgs,
  extractParamList,
} from '../analysis/scopeAnalysis';
import type { FunctionScope } from '../analysis/scopeAnalysis';

const CALL_RE = /(?<![.\w@])([a-zA-Z_]\w*)\s*\(/g;
const DECL_RE = /^\s*(?:function|sub)\s+\w+\s*\(/i;
const EXPR_IDENT_RE = /(?<![.\w@])([a-zA-Z_]\w*)/g;
const _alwaysValidVarIdents = new Set(['m']);

function collectLocalNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  const ASSIGN_RE = /^\s*(?:m\.)?([a-zA-Z_]\w*)[&%!#$]?(?:\s*\[[^\]]*\])?\s*(?:\+|-|\*|\/|\\|<<|>>)?=/;
  const FOR_RE = /^\s*for\s+(?:each\s+)?([a-zA-Z_]\w*)\b/i;
  const CATCH_VAR_RE = /^\s*catch\s+\(?([a-zA-Z_]\w*)\)?/i;

  for (const line of lines) {
    const assignMatch = ASSIGN_RE.exec(line);
    if (assignMatch) {
      const n = assignMatch[1].toLowerCase();
      if (!keywordNames.has(n)) names.add(n);
    }

    const forMatch = FOR_RE.exec(line);
    if (forMatch) names.add(forMatch[1].toLowerCase());

    const strippedForParams = stripStringLiterals(line, true);
    const paramStr = extractParamList(strippedForParams);
    if (paramStr && paramStr.trim()) {
      for (const part of paramStr.split(',')) {
        const nm = /^\s*([a-zA-Z_]\w*)/.exec(part.trim());
        if (nm) {
          const p = nm[1].toLowerCase();
          if (!keywordNames.has(p)) names.add(p);
        }
      }
    }

    const catchMatch = CATCH_VAR_RE.exec(line);
    if (catchMatch) names.add(catchMatch[1].toLowerCase());
  }

  return names;
}

export function checkUndefinedCalls(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config, lintContext } = ctx;
  if (config['identifier/undefined-function'] === 'off' && config['identifier/wrong-arg-count'] === 'off') return [];

  const isMainFile = /[/\\]main\.brs$/i.test(filePath);
  if (isMainFile) return [];

  const localNames = collectLocalNames(lines);
  const inMainBody = computeMainBodyLines(lines);
  const knownFuncNames = lintContext.knownFuncNames;
  const diagnostics: LintDiagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;
    if (/^\s*#/i.test(raw)) continue;
    if (DECL_RE.test(raw)) continue;
    if (/^\s*dim\b/i.test(raw)) continue;
    if (/^\s*throw\b/i.test(raw)) continue;
    if (inMainBody[lineIdx]) continue;

    const stripped = stripNumericLiterals(stripStringLiterals(raw, true));

    CALL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CALL_RE.exec(stripped)) !== null) {
      const name = match[1];
      const nameLower = name.toLowerCase();

      if (keywordNames.has(nameLower)) continue;

      if (builtinNames.has(nameLower)) {
        if (config['identifier/wrong-arg-count'] !== 'off') {
          const arity = builtinArity.get(nameLower);
          if (arity) {
            const openParenPos = match.index + match[0].length - 1;
            const argCount = countCallArgs(stripped, openParenPos);
            if (argCount !== null && (argCount < arity.min || argCount > arity.max)) {
              const expected = arity.min === arity.max
                ? `${arity.min} argument${arity.min !== 1 ? 's' : ''}`
                : `${arity.min}–${arity.max} arguments`;
              const got = `${argCount} ${argCount !== 1 ? 'were' : 'was'}`;
              diagnostics.push({
                severity: config['identifier/wrong-arg-count'] ?? 'error',
                code: 'identifier/wrong-arg-count',
                message: `'${name}' expects ${expected} but ${got} provided.`,
                line: lineIdx,
                column: match.index,
                endLine: lineIdx,
                endColumn: match.index + name.length,
                filePath,
              });
            }
          }
        }
        continue;
      }

      if (knownFuncNames.has(nameLower)) continue;
      if (localNames.has(nameLower)) continue;

      if (config['identifier/undefined-function'] !== 'off') {
        diagnostics.push({
          severity: config['identifier/undefined-function'] ?? 'error',
          code: 'identifier/undefined-function',
          message: `Unknown function '${name}'. It is not defined in this file or any reachable @import.`,
          line: lineIdx,
          column: match.index,
          endLine: lineIdx,
          endColumn: match.index + name.length,
          filePath,
        });
      }
    }
  }

  return diagnostics;
}

export function checkUndefinedVariables(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config, lintContext } = ctx;
  if (config['identifier/undefined-variable'] === 'off') return [];

  const scopes = buildFunctionScopes(lines);
  const knownFuncNames = lintContext.knownFuncNames;
  const diagnostics: LintDiagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (!raw) continue;
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;
    if (/^\s*#/i.test(raw)) continue;
    if (DECL_RE.test(raw)) continue;
    if (/^\s*dim\b/i.test(raw)) continue;

    const scope = findScopeAtLine(scopes, lineIdx);
    if (!scope) continue;

    const scopeVars = new Set([...scope.params, ...scope.vars]);
    const stripped = stripNumericLiterals(stripStringLiterals(raw, true));

    const LVALUE_RE = /^\s*(?:m\.)?([a-zA-Z_]\w*)[&%!#$]?(?:\s*\[[^\]]*\])?\s*(?:\+|-|\*|\/|\\|<<|>>)?=/;
    const lvalueMatch = LVALUE_RE.exec(stripped);
    const lvalue = lvalueMatch ? lvalueMatch[1].toLowerCase() : null;

    EXPR_IDENT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EXPR_IDENT_RE.exec(stripped)) !== null) {
      const name = match[1];
      const nameLower = name.toLowerCase();

      const after = stripped.slice(match.index + name.length).trimStart();
      if (after.startsWith('(') || after.startsWith(':') || after.startsWith('.')) continue;

      if (keywordNames.has(nameLower)) continue;
      if (builtinNames.has(nameLower)) continue;
      if (_alwaysValidVarIdents.has(nameLower)) continue;
      if (knownFuncNames.has(nameLower)) continue;
      if (lvalue !== null && nameLower === lvalue) continue;
      if (scopeVars.has(nameLower)) continue;

      if (lineIdx === scope.startLine && scope.name === '' && match.index < scope.startColumn) {
        const parentScope = findParentScopeAtLine(scopes, lineIdx, scope);
        if (parentScope) {
          const parentVars = new Set([...parentScope.params, ...parentScope.vars]);
          if (parentVars.has(nameLower)) continue;
        }
      }
      if (lineIdx === scope.endLine) {
        const endKw = /\b(?:end\s*(?:function|sub)|endfunction|endsub)\b/i.exec(stripped);
        if (endKw && match.index >= endKw.index + endKw[0].length) {
          const parentScope = findParentScopeAtLine(scopes, lineIdx, scope);
          if (parentScope) {
            const parentVars = new Set([...parentScope.params, ...parentScope.vars]);
            if (parentVars.has(nameLower)) continue;
          }
        }
      }

      diagnostics.push({
        severity: config['identifier/undefined-variable'] ?? 'error',
        code: 'identifier/undefined-variable',
        message: `'${name}' is used but never defined in this scope.`,
        line: lineIdx,
        column: match.index,
        endLine: lineIdx,
        endColumn: match.index + name.length,
        filePath,
      });
    }
  }

  return diagnostics;
}

export function checkShadowedBuiltins(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;
  if (config['identifier/shadows-builtin'] === 'off') return [];

  const diagnostics: LintDiagnostic[] = [];
  const severity = config['identifier/shadows-builtin'] ?? 'error';

  const ASSIGN_RE = /^\s*(?:m\.)?([a-zA-Z_]\w*)[&%!#$]?(?:\s*\[[^\]]*\])?\s*(?:\+|-|\*|\/|\\|<<|>>)?=/;
  const FOR_RE = /^\s*for\s+(?:each\s+)?([a-zA-Z_]\w*)\b/i;
  const DIM_RE = /^\s*dim\s+([a-zA-Z_]\w*)\s*\(/i;
  const CATCH_RE = /^\s*catch\s+\(?([a-zA-Z_]\w*)\)?/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) continue;

    const stripped = stripStringLiterals(line, true);

    // Check function/sub parameters
    const funcMatch = /\b(?:function|sub)\b\s*(?:[a-zA-Z_]\w*\s*)?\(([^)]*)\)/i.exec(stripped);
    if (funcMatch && funcMatch[1].trim()) {
      const paramsStr = funcMatch[1];
      const paramsStart = stripped.indexOf(paramsStr, funcMatch.index);
      for (const part of paramsStr.split(',')) {
        const nm = /^\s*([a-zA-Z_]\w*)/.exec(part.trim());
        if (nm) {
          const paramName = nm[1];
          if (builtinNames.has(paramName.toLowerCase())) {
            const col = stripped.indexOf(paramName, paramsStart);
            diagnostics.push({
              severity,
              code: 'identifier/shadows-builtin',
              message: `'${paramName}' shadows the built-in global function '${paramName}'. Use a different name to avoid hiding the built-in.`,
              line: i, column: col >= 0 ? col : 0, endLine: i, endColumn: (col >= 0 ? col : 0) + paramName.length, filePath,
            });
          }
        }
      }
    }

    const checks: { re: RegExp; match: RegExpExecArray | null }[] = [
      { re: ASSIGN_RE, match: ASSIGN_RE.exec(stripped) },
      { re: FOR_RE, match: FOR_RE.exec(stripped) },
      { re: DIM_RE, match: DIM_RE.exec(stripped) },
      { re: CATCH_RE, match: CATCH_RE.exec(stripped) },
    ];

    for (const { match: m } of checks) {
      if (!m) continue;
      const varName = m[1];
      if (builtinNames.has(varName.toLowerCase())) {
        const col = stripped.indexOf(varName, m.index);
        diagnostics.push({
          severity,
          code: 'identifier/shadows-builtin',
          message: `'${varName}' shadows the built-in global function '${varName}'. Use a different name to avoid hiding the built-in.`,
          line: i, column: col >= 0 ? col : 0, endLine: i, endColumn: (col >= 0 ? col : 0) + varName.length, filePath,
        });
      }
    }
  }

  return diagnostics;
}

export function checkUnusedParameters(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;
  if (config['identifier/unused-parameter'] === 'off') return [];

  const FUNC_DECL_RE = /^\s*(?:function|sub)\s+\w+\s*\(([^)]*)\)/i;
  const ANON_FUNC_RE = /(?:function|sub)\s*\(([^)]*)\)/i;
  const diagnostics: LintDiagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) continue;

    const funcMatch = FUNC_DECL_RE.exec(line) || ANON_FUNC_RE.exec(line);
    if (!funcMatch || !funcMatch[1].trim()) continue;

    const paramsStr = funcMatch[1];
    const paramsStart = line.indexOf('(', funcMatch.index) + 1;
    const params: { name: string; col: number }[] = [];
    let offset = 0;
    for (const rawParam of paramsStr.split(',')) {
      const nameMatch = /^\s*(\w+)/.exec(rawParam);
      if (nameMatch) {
        const name = nameMatch[1];
        if (!name.startsWith('_')) {
          const col = paramsStart + offset + rawParam.length - rawParam.trimStart().length;
          params.push({ name, col });
        }
      }
      offset += rawParam.length + 1;
    }

    if (params.length === 0) continue;

    const bodyLines: string[] = [];
    let depth = 1;
    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      const bLine = lines[j];
      if (/^\s*'/.test(bLine) || /^\s*rem\b/i.test(bLine)) continue;
      const stripped = bLine.replace(/'.*$/, '');
      if (/\b(?:function|sub)\s*\(/i.test(stripped)) depth++;
      if (/^\s*end\s*(?:function|sub)\b/i.test(stripped)) depth--;
      if (depth > 0) bodyLines.push(stripStringLiterals(stripped, true));
    }

    const bodyText = bodyLines.join('\n');

    for (const param of params) {
      const used = new RegExp(`\\b${escapeRegex(param.name)}\\b`, 'i').test(bodyText);
      if (!used) {
        diagnostics.push({
          severity: config['identifier/unused-parameter'] ?? 'warning',
          code: 'identifier/unused-parameter',
          message: `Parameter "${param.name}" is never used. Prefix with \`_\` to indicate it is intentionally unused.`,
          line: i, column: param.col, endLine: i, endColumn: param.col + param.name.length, filePath,
          fix: { type: 'insert', line: i, column: param.col, text: '_' },
        });
      }
    }
  }

  return diagnostics;
}

// --- Unused variable detection ---

interface UnusedVarDef {
  name: string;
  nameLower: string;
  line: number;
  column: number;
}

function buildNestedRanges(scopes: FunctionScope[], currentScope: FunctionScope): [number, number][] {
  const ranges: [number, number][] = [];
  for (const s of scopes) {
    if (s === currentScope) continue;
    if (s.startLine > currentScope.startLine && s.endLine <= currentScope.endLine) {
      ranges.push([s.startLine, s.endLine]);
    }
  }
  return ranges;
}

function isInNestedRange(line: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => line > start && line <= end);
}

/**
 * Splits a stripped line on `:` statement separators, respecting braces,
 * parentheses, and brackets (so `{ key: value }` is not split).
 * Returns each sub-statement with its column offset in the original line.
 */
function splitStatements(stripped: string): { text: string; offset: number }[] {
  const statements: { text: string; offset: number }[] = [];
  let start = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === ':' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      const segment = stripped.slice(start, i);
      if (segment.trim()) statements.push({ text: segment, offset: start });
      start = i + 1;
    }
  }
  const last = stripped.slice(start);
  if (last.trim()) statements.push({ text: last, offset: start });

  return statements;
}

function collectScopeVarDefs(
  lines: string[],
  scope: FunctionScope,
  nestedRanges: [number, number][],
): UnusedVarDef[] {
  const defs: UnusedVarDef[] = [];
  const seen = new Set<string>();

  const ASSIGN_RE = /^\s*([a-zA-Z_]\w*)[&%!#$]?\s*(?:\+|-|\*|\/|\\|<<|>>)?=/;
  const FOR_RE = /^\s*for\s+(?:each\s+)?([a-zA-Z_]\w*)\b/i;
  const DIM_RE = /^\s*dim\s+([a-zA-Z_]\w*)\s*\(/i;
  const CATCH_RE = /^\s*catch\s+([a-zA-Z_]\w*)/i;

  for (let i = scope.startLine + 1; i < scope.endLine; i++) {
    if (isInNestedRange(i, nestedRanges)) continue;

    const raw = lines[i];
    if (!raw) continue;
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    const stripped = stripStringLiterals(raw, true);
    const stmts = splitStatements(stripped);
    let inlineDepth = 0;

    for (const { text: stmt, offset } of stmts) {
      // Skip statements inside inline nested function/sub bodies
      if (inlineDepth > 0) {
        if (/^\s*(?:end\s*(?:function|sub)|endfunction|endsub)\b/i.test(stmt)) inlineDepth--;
        continue;
      }

      // Local variable assignment (skip m.field assignments)
      if (!/^\s*m\./i.test(stmt)) {
        const assignMatch = ASSIGN_RE.exec(stmt);
        if (assignMatch) {
          const name = assignMatch[1];
          const nameLower = name.toLowerCase();
          if (!keywordNames.has(nameLower) && !scope.params.has(nameLower)
              && !_alwaysValidVarIdents.has(nameLower) && !seen.has(nameLower)) {
            seen.add(nameLower);
            const col = offset + assignMatch.index + assignMatch[0].lastIndexOf(name);
            defs.push({ name, nameLower, line: i, column: col });
          }
        }
      }

      const forMatch = FOR_RE.exec(stmt);
      if (forMatch) {
        const name = forMatch[1];
        const nameLower = name.toLowerCase();
        if (!scope.params.has(nameLower) && !_alwaysValidVarIdents.has(nameLower) && !seen.has(nameLower)) {
          seen.add(nameLower);
          const col = offset + forMatch.index + forMatch[0].lastIndexOf(name);
          defs.push({ name, nameLower, line: i, column: col });
        }
      }

      const dimMatch = DIM_RE.exec(stmt);
      if (dimMatch) {
        const name = dimMatch[1];
        const nameLower = name.toLowerCase();
        if (!scope.params.has(nameLower) && !_alwaysValidVarIdents.has(nameLower) && !seen.has(nameLower)) {
          seen.add(nameLower);
          const col = offset + dimMatch.index + dimMatch[0].lastIndexOf(name);
          defs.push({ name, nameLower, line: i, column: col });
        }
      }

      const catchMatch = CATCH_RE.exec(stmt);
      if (catchMatch) {
        const name = catchMatch[1];
        const nameLower = name.toLowerCase();
        if (!scope.params.has(nameLower) && !_alwaysValidVarIdents.has(nameLower) && !seen.has(nameLower)) {
          seen.add(nameLower);
          const col = offset + catchMatch.index + catchMatch[0].lastIndexOf(name);
          defs.push({ name, nameLower, line: i, column: col });
        }
      }

      // After processing, check if this statement opens an inline nested scope
      if (/\b(?:function|sub)\s*\(/i.test(stmt)) inlineDepth++;
    }
  }

  return defs;
}

function isVarUsedInScope(
  varNameLower: string,
  lines: string[],
  scope: FunctionScope,
  nestedRanges: [number, number][],
): boolean {
  const escaped = escapeRegex(varNameLower);
  const varRe = new RegExp(`(?<![.\\w@])${escaped}\\b`, 'i');
  const compoundAssignRe = new RegExp(`^\\s*${escaped}[&%!#$]?\\s*(?:\\+|-|\\*|\\/|\\\\|<<|>>)=`, 'i');
  const arrayAccessRe = new RegExp(`^\\s*${escaped}[&%!#$]?\\s*\\[`, 'i');
  const simpleAssignRe = new RegExp(`^\\s*${escaped}[&%!#$]?\\s*=`, 'i');
  const assignCaptureRe = new RegExp(`^\\s*${escaped}[&%!#$]?\\s*=(.*)`, 'is');
  const forDefRe = new RegExp(`^\\s*for\\s+${escaped}\\s*=`, 'i');
  const forEachDefRe = new RegExp(`^\\s*for\\s+each\\s+${escaped}\\s+in\\b`, 'i');
  const dimDefRe = new RegExp(`^\\s*dim\\s+${escaped}\\s*\\(`, 'i');
  const catchDefRe = new RegExp(`^\\s*catch\\s+${escaped}\\b`, 'i');

  for (let i = scope.startLine + 1; i < scope.endLine; i++) {
    if (isInNestedRange(i, nestedRanges)) continue;

    const raw = lines[i];
    if (!raw) continue;
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    const stripped = stripStringLiterals(raw, true);
    if (!varRe.test(stripped)) continue;

    const stmts = splitStatements(stripped);
    let inlineDepth = 0;

    for (const { text: stmt } of stmts) {
      // Skip statements inside inline nested function/sub bodies
      if (inlineDepth > 0) {
        if (/^\s*(?:end\s*(?:function|sub)|endfunction|endsub)\b/i.test(stmt)) inlineDepth--;
        continue;
      }

      if (!varRe.test(stmt)) {
        // Even if var not here, check for inline scope start
        if (/\b(?:function|sub)\s*\(/i.test(stmt)) inlineDepth++;
        continue;
      }

      // Compound assignment (x += ...) — variable is implicitly read
      if (compoundAssignRe.test(stmt)) return true;

      // Array-indexed access (x[i] = ... or x[i]) — variable is accessed
      if (arrayAccessRe.test(stmt)) return true;

      // Simple assignment (x = ...) — only a use if the variable also appears in the RHS
      if (simpleAssignRe.test(stmt)) {
        const fullMatch = assignCaptureRe.exec(stmt);
        if (fullMatch) {
          const rhs = fullMatch[1];
          if (varRe.test(rhs)) return true;
        }
        // After processing, check if RHS opens an inline nested scope
        if (/\b(?:function|sub)\s*\(/i.test(stmt)) inlineDepth++;
        continue;
      }

      // For / for each / dim / catch definitions — not a use
      if (forDefRe.test(stmt)) continue;
      if (forEachDefRe.test(stmt)) continue;
      if (dimDefRe.test(stmt)) continue;
      if (catchDefRe.test(stmt)) continue;

      // Variable appears in any other context (if condition, return, print,
      // passed as argument in a call, etc.) — used
      return true;
    }
  }

  return false;
}

export function checkUnusedVariables(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;
  if (config['identifier/unused-variable'] === 'off') return [];

  const scopes = buildFunctionScopes(lines);
  if (scopes.length === 0) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (const scope of scopes) {
    const nestedRanges = buildNestedRanges(scopes, scope);
    const varDefs = collectScopeVarDefs(lines, scope, nestedRanges);

    for (const vd of varDefs) {
      if (vd.name.startsWith('_')) continue;

      if (!isVarUsedInScope(vd.nameLower, lines, scope, nestedRanges)) {
        diagnostics.push({
          severity: config['identifier/unused-variable'] ?? 'warning',
          code: 'identifier/unused-variable',
          message: `Variable '${vd.name}' is defined but never used. Prefix with \`_\` to indicate it is intentionally unused.`,
          line: vd.line,
          column: vd.column,
          endLine: vd.line,
          endColumn: vd.column + vd.name.length,
          filePath,
        });
      }
    }
  }

  return diagnostics;
}
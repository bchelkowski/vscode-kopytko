import type { LintDiagnostic, RuleContext } from '../types';
import { extractParamList } from '../analysis/scopeAnalysis';
import { stripStringLiterals } from '../analysis/textUtils';

const FUNC_DECL_RE = /^\s*(function|sub)\s+(\w+)\s*\(/i;
const ANON_FUNC_RE = /\b(function|sub)\s*\(/i;
const RETURN_TYPE_RE = /\)\s+as\s+\w+/i;

export function checkMissingTypeAnnotations(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;

  const returnTypeOff = config['type/missing-return-type'] === 'off';
  const paramTypeOff = config['type/missing-param-type'] === 'off';
  if (returnTypeOff && paramTypeOff) return [];

  const diagnostics: LintDiagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    const stripped = stripStringLiterals(raw, true);
    const namedMatch = FUNC_DECL_RE.exec(stripped);
    if (!namedMatch) continue;

    const keyword = namedMatch[1].toLowerCase();
    const funcName = namedMatch[2];
    const keywordStart = stripped.search(/\b(?:function|sub)\b/i);

    // Check return type (only for `function`, not `sub`)
    if (!returnTypeOff && keyword === 'function') {
      // Find the closing paren for the param list, then check for `as Type` after it
      const afterDecl = getAfterParamList(stripped, i, lines);
      if (afterDecl !== null && !RETURN_TYPE_RE.test(')' + afterDecl)) {
        diagnostics.push({
          severity: config['type/missing-return-type'] ?? 'warning',
          code: 'type/missing-return-type',
          message: `Function "${funcName}" is missing a return type annotation.`,
          line: i,
          column: keywordStart,
          endLine: i,
          endColumn: keywordStart + keyword.length,
          filePath,
        });
      }
    }

    // Check param types
    if (!paramTypeOff) {
      const paramStr = extractParamList(stripped);
      if (paramStr && paramStr.trim()) {
        const params = paramStr.split(',');
        let paramOffset = stripped.indexOf('(', namedMatch.index) + 1;

        for (const param of params) {
          const trimmed = param.trim();
          if (trimmed === '') {
            paramOffset += param.length + 1;
            continue;
          }

          const nameMatch = /^([a-zA-Z_]\w*)/.exec(trimmed);
          if (!nameMatch) {
            paramOffset += param.length + 1;
            continue;
          }

          const paramName = nameMatch[1];

          if (!paramHasType(trimmed)) {
            const paramNameStart = stripped.indexOf(trimmed, paramOffset);
            const col = paramNameStart >= 0 ? paramNameStart : paramOffset;

            diagnostics.push({
              severity: config['type/missing-param-type'] ?? 'warning',
              code: 'type/missing-param-type',
              message: `Parameter "${paramName}" is missing a type annotation.`,
              line: i,
              column: col,
              endLine: i,
              endColumn: col + paramName.length,
              filePath,
            });
          }

          paramOffset += param.length + 1;
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Checks whether a parameter token has an `as Type` annotation.
 *
 * BrightScript parameter format: `name [= defaultValue] [as Type]`
 * The default value comes before the type, e.g.:
 *   `id = "" as String`  → has type
 *   `id`                 → no type
 *   `id = ""`            → no type
 *   `id as String`       → has type
 */
function paramHasType(param: string): boolean {
  return /\bas\s+\w+/i.test(param);
}

/**
 * Gets the text after the closing `)` of the parameter list on a declaration line.
 * Returns null if the param list spans multiple lines (in which case we skip return-type check).
 */
function getAfterParamList(line: string, _lineIdx: number, _lines: string[]): string | null {
  const funcMatch = /\b(?:function|sub)\b\s*(?:\w+\s*)?\(/i.exec(line);
  if (!funcMatch) return null;

  const openIdx = line.indexOf('(', funcMatch.index + funcMatch[0].length - 1);
  if (openIdx < 0) return null;

  let depth = 0;
  for (let i = openIdx; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')') {
      depth--;
      if (depth === 0) return line.slice(i);
    }
  }

  // Multi-line params — skip return type check for simplicity
  return null;
}

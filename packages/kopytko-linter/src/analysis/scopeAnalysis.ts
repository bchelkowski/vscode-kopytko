import { stripStringLiterals } from './textUtils';
import { keywordNames } from '../catalog/builtins';

export interface FunctionScope {
  startLine: number;
  endLine: number;
  startColumn: number;
  name: string;
  params: Set<string>;
  vars: Set<string>;
}

const ANON_FUNC_SCOPE_RE = /\b(?:function|sub)\s*\(/i;
const FUNC_END_SCOPE_RE = /^\s*(?:end\s*(?:function|sub)|endfunction|endsub)\b/i;
const PARAM_LIST_RE = /\b(?:function|sub)\b\s*(?:[a-zA-Z_]\w*\s*)?\(([^)]*)\)/i;
const ENTRY_POINT_NAMES = new Set(['main', 'runuserinterface', 'runscreensaver']);

export { PARAM_LIST_RE, ENTRY_POINT_NAMES };

export function buildFunctionScopes(lines: string[]): FunctionScope[] {
  const allScopes: FunctionScope[] = [];
  const stack: FunctionScope[] = [];

  const ASSIGN_RE_SCOPE = /^\s*(?:m\.)?([a-zA-Z_]\w*)[&%!#$]?(?:\s*\[[^\]]*\])?\s*(?:\+|-|\*|\/|\\|<<|>>)?=/;
  const FOR_RE_SCOPE = /^\s*for\s+(?:each\s+)?([a-zA-Z_]\w*)\b/i;
  const DIM_RE_SCOPE = /^\s*dim\s+([a-zA-Z_]\w*)\s*\(/i;
  const CATCH_RE_SCOPE = /^\s*catch\s+\(?([a-zA-Z_]\w*)\)?/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) continue;

    if (FUNC_END_SCOPE_RE.test(line)) {
      if (stack.length > 0) {
        stack[stack.length - 1].endLine = i;
        stack.pop();
      }
    }

    const current = stack.length > 0 ? stack[stack.length - 1] : null;
    if (current) {
      const assignMatch = ASSIGN_RE_SCOPE.exec(line);
      if (assignMatch) {
        const n = assignMatch[1].toLowerCase();
        if (!keywordNames.has(n)) current.vars.add(n);
      }

      const forMatch = FOR_RE_SCOPE.exec(line);
      if (forMatch) current.vars.add(forMatch[1].toLowerCase());

      const dimMatch = DIM_RE_SCOPE.exec(line);
      if (dimMatch) current.vars.add(dimMatch[1].toLowerCase());

      const catchMatch = CATCH_RE_SCOPE.exec(line);
      if (catchMatch) current.vars.add(catchMatch[1].toLowerCase());
    }

    const strippedForScope = stripStringLiterals(line, true);
    const namedDeclMatch = /^\s*(?:function|sub)\s+([a-zA-Z_]\w*)\s*\(/i.exec(strippedForScope);
    const isNamed = namedDeclMatch !== null;
    const isAnon = !isNamed && ANON_FUNC_SCOPE_RE.test(strippedForScope);

    if (isNamed || isAnon) {
      const params = new Set<string>();
      const pm = PARAM_LIST_RE.exec(strippedForScope);
      if (pm && pm[1].trim()) {
        for (const part of pm[1].split(',')) {
          const nm = /^\s*([a-zA-Z_]\w*)/.exec(part.trim());
          if (nm) {
            const p = nm[1].toLowerCase();
            if (!keywordNames.has(p)) params.add(p);
          }
        }
      }
      const kwMatch = /\b(?:function|sub)\b/i.exec(strippedForScope);
      const newScope: FunctionScope = {
        startLine: i,
        endLine: lines.length - 1,
        startColumn: kwMatch ? kwMatch.index : 0,
        name: namedDeclMatch ? namedDeclMatch[1].toLowerCase() : '',
        params,
        vars: new Set(),
      };
      allScopes.push(newScope);
      stack.push(newScope);
    }

    // Handle inline `end sub`/`end function` after `:` separator
    // (e.g. `sub (_e as Object) : end sub` — all on one line)
    const inlineEndCount = (strippedForScope.match(/:\s*(?:end\s*(?:function|sub)|endfunction|endsub)\b/gi) || []).length;
    for (let j = 0; j < inlineEndCount; j++) {
      if (stack.length > 0) {
        stack[stack.length - 1].endLine = i;
        stack.pop();
      }
    }
  }

  return allScopes;
}

export function findScopeAtLine(scopes: FunctionScope[], lineIdx: number): FunctionScope | null {
  let innermost: FunctionScope | null = null;
  for (const s of scopes) {
    if (s.startLine <= lineIdx && lineIdx <= s.endLine) {
      if (!innermost || s.startLine > innermost.startLine) {
        innermost = s;
      }
    }
  }
  return innermost;
}

export function findParentScopeAtLine(
  scopes: FunctionScope[],
  lineIdx: number,
  innermost: FunctionScope,
): FunctionScope | null {
  let parent: FunctionScope | null = null;
  for (const s of scopes) {
    if (s === innermost) continue;
    if (s.startLine <= lineIdx && lineIdx <= s.endLine) {
      if (!parent || s.startLine > parent.startLine) {
        parent = s;
      }
    }
  }
  return parent;
}

export function computeMainBodyLines(lines: string[]): boolean[] {
  const result = new Array<boolean>(lines.length).fill(false);
  let inEntryPoint = false;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || /^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;
    const s = stripStringLiterals(raw, true);

    if (!inEntryPoint) {
      const m = /^\s*(?:function|sub)\s+([a-zA-Z_]\w*)\s*\(/i.exec(s);
      if (m && ENTRY_POINT_NAMES.has(m[1].toLowerCase())) {
        inEntryPoint = true;
        depth = 1;
      }
    } else {
      result[i] = true;

      if (/^\s*(?:end\s*(?:function|sub)|endfunction|endsub)\b/i.test(s)) {
        depth--;
        if (depth === 0) inEntryPoint = false;
      } else {
        if (/^\s*(?:function|sub)\b/i.test(s) || /\b(?:function|sub)\s*\(/i.test(s)) {
          depth++;
        }
      }
    }
  }

  return result;
}

export function countCallArgs(stripped: string, openParenPos: number): number | null {
  if (openParenPos >= stripped.length || stripped[openParenPos] !== '(') return null;
  let parenDepth = 0;
  let squareDepth = 0;
  let braceDepth = 0;
  let topLevelCommas = 0;
  let nonEmpty = false;

  for (let i = openParenPos; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '(') {
      parenDepth++;
    } else if (ch === ')') {
      parenDepth--;
      if (parenDepth === 0) return nonEmpty ? topLevelCommas + 1 : 0;
    } else if (ch === '[') {
      squareDepth++;
    } else if (ch === ']') {
      squareDepth--;
    } else if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      braceDepth--;
    } else if (ch === ',' && parenDepth === 1 && squareDepth === 0 && braceDepth === 0) {
      topLevelCommas++;
      nonEmpty = true;
    } else if (parenDepth === 1 && squareDepth === 0 && braceDepth === 0 && ch !== ' ') {
      nonEmpty = true;
    }
  }
  return null;
}

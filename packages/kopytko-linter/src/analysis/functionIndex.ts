import type { FunctionDefinition } from '../types';

const FUNC_PREFIX_RE = /^\s*(?:function|sub)\s+/i;
const FUNC_FULL_RE = /^\s*(?:function|sub)\s+(\w+)\s*\(/i;
const INNER_METHOD_RE = /^\s*\w+\.(\w+)\s*=\s*(?:function|sub)\s*\(/i;
const INNER_COLON_METHOD_RE = /^\s*(\w+)\s*:\s*(?:function|sub)\s*\(/i;

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
 * Parses all associative-array method assignments of the form
 * `<obj>.<name> = function|sub (...)` from a BrightScript text.
 */
export function parseInnerMethodDefs(text: string, filePath: string): InnerMethodDefinition[] {
  const lines = text.split(/\r?\n/);
  const funcDefs = parseFunctionDefs(text, filePath, lines);
  const defs: InnerMethodDefinition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*'/.test(line)) continue;

    let name: string, column: number;

    const dotMatch = INNER_METHOD_RE.exec(line);
    if (dotMatch) {
      name = dotMatch[1];
      const dotIdx = line.indexOf('.');
      column = line.indexOf(name, dotIdx >= 0 ? dotIdx : 0);
    } else {
      const colonMatch = INNER_COLON_METHOD_RE.exec(line);
      if (!colonMatch) continue;
      name = colonMatch[1];
      column = line.search(/\S/);
    }

    let ownerFunction: string | undefined;
    for (let j = funcDefs.length - 1; j >= 0; j--) {
      if (funcDefs[j].line <= i) { ownerFunction = funcDefs[j].name; break; }
    }

    defs.push({ name, nameLower: name.toLowerCase(), line: i, column, filePath, ownerFunction });
  }
  return defs;
}

import { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS, getKeywordCategory } from './builtins';
import { CasingConfig, DEFAULT_CASING_CONFIG, applyCasing, applyCasingWithOverrides, resolveKeywordCasing } from './casing';
import { FunctionDefinition } from './types';
import { FormattingConfig } from './config';

/** Canonical (catalog-cased) lookup tables, built once at module load. */
const _builtinMap = new Map<string, string>(
  BRIGHTSCRIPT_BUILTINS.map((b) => [b.name.toLowerCase(), b.name])
);
const _keywordSet = new Set(BRIGHTSCRIPT_KEYWORDS.map((k) => k.toLowerCase()));

/** Mapping from compact end-keyword to spaced form. */
const COMPACT_TO_SPACED: Record<string, string> = {
  'endif': 'end if',
  'endfunction': 'end function',
  'endsub': 'end sub',
  'endwhile': 'end while',
  'endfor': 'end for',
  'endtry': 'end try',
};

/** Reverse mapping: spaced form → compact. */
const SPACED_TO_COMPACT: Record<string, string> = Object.fromEntries(
  Object.entries(COMPACT_TO_SPACED).map(([k, v]) => [v, k])
);

/**
 * Formats BrightScript source code using an 11-pass engine.
 *
 * This is the pure, framework-agnostic formatting function.
 * It takes a source string and returns the formatted result.
 *
 * @param source - The raw BrightScript source text.
 * @param config - Formatting rules configuration.
 * @param casing - Casing rules configuration (optional).
 * @param userFunctions - Known user-defined functions for casing normalization (optional).
 * @returns The formatted source text.
 */
export function formatText(
  source: string,
  config: FormattingConfig,
  casing: CasingConfig = DEFAULT_CASING_CONFIG,
  userFunctions: FunctionDefinition[] = [],
): string {
  let lines = source.split(/\r?\n/);

  const detectedEnding = detectLineEnding(source);
  const lineEndStr = resolveLineEnding(config.lineEnding, detectedEnding);

  const userFuncMap = new Map<string, string>();
  for (const fn of userFunctions) {
    if (!userFuncMap.has(fn.nameLower)) userFuncMap.set(fn.nameLower, fn.name);
  }

  // Pass 1 — Import sorting
  lines = passImportSorting(lines, config);

  // Pass 2 — Comment normalization
  lines = passCommentNormalization(lines, config);

  // Pass 3 — End keyword style + function vs sub
  lines = passEndKeywordStyle(lines, config);
  lines = passFunctionVsSub(lines, config);

  // Pass 4 — Then style + parenthesis if case + catch paren style
  lines = passThenStyle(lines, config);
  lines = passParenthesisIfCase(lines, config);
  lines = passCatchParenStyle(lines, config);

  // Pass 5 — Print statement handling
  lines = passPrintStatement(lines, config);

  // Pass 6 — Spacing rules
  lines = passSpacing(lines, config);

  // Pass 7 — Casing
  lines = passCasing(lines, casing, userFuncMap);

  // Pass 7b — Split array open bracket
  lines = passSplitArrayOpenBracket(lines, config);

  // Pass 8 — Indentation
  lines = passIndentation(lines, config);

  // Pass 8b — Trailing commas
  lines = passTrailingCommas(lines, config);

  // Pass 9 — Blank line rules
  lines = passBlankLines(lines, config);

  // Pass 10 — Trailing whitespace
  lines = passTrimTrailing(lines, config);

  // Pass 11 — Comment width
  lines = passCommentWidth(lines, config);

  // Assemble result
  let newText = lines.join(lineEndStr);
  if (config.insertFinalNewline && newText.length > 0 && !newText.endsWith(lineEndStr)) {
    newText += lineEndStr;
  }

  return newText;
}

/**
 * Checks whether source text is already formatted.
 *
 * @returns `true` if the text matches formatted output (no changes needed).
 */
export function checkFormatting(
  source: string,
  config: FormattingConfig,
  casing?: CasingConfig,
  userFunctions?: FunctionDefinition[],
): boolean {
  return formatText(source, config, casing, userFunctions) === source;
}

// ---------------------------------------------------------------------------
// Line ending helpers
// ---------------------------------------------------------------------------

function detectLineEnding(text: string): '\n' | '\r\n' {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfCount = (text.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfCount ? '\r\n' : '\n';
}

function resolveLineEnding(setting: 'lf' | 'crlf' | 'auto', detected: '\n' | '\r\n'): string {
  if (setting === 'lf') return '\n';
  if (setting === 'crlf') return '\r\n';
  return detected;
}

// ---------------------------------------------------------------------------
// Pass 1 — Import sorting
// ---------------------------------------------------------------------------

function passImportSorting(lines: string[], config: FormattingConfig): string[] {
  if (!config.sortImports && !config.emptyLineAfterImports) return lines;

  const importRegex = /^\s*'\s*@import\s+/;
  const mockRegex = /^\s*'\s*@mock\s+/;
  const annotationRegex = /^\s*'\s*@(?:import|mock)\s+/;

  let lastAnnotationIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (annotationRegex.test(lines[i])) {
      lastAnnotationIdx = i;
    } else if (lines[i].trim() !== '') {
      break;
    }
  }
  if (lastAnnotationIdx < 0) return lines;

  const blockEnd = lastAnnotationIdx + 1;

  if (!config.sortImports) {
    if (!config.emptyLineAfterImports) return lines;
    const rest = lines.slice(blockEnd);
    if (rest.length > 0 && rest[0].trim() !== '') {
      return [...lines.slice(0, blockEnd), '', ...rest];
    }
    return lines;
  }

  const importLines: string[] = [];
  const mockLines: string[] = [];
  for (let i = 0; i < blockEnd; i++) {
    const trimmed = lines[i].trim();
    if (mockRegex.test(trimmed)) mockLines.push(trimmed);
    else if (importRegex.test(trimmed)) importLines.push(trimmed);
  }

  const fromImportRegex = /^\s*'\s*@import\s+(.*?)\s+from\s+(\S+)\s*$/;
  const moduleImports: string[] = [];
  const localImports: string[] = [];
  for (const line of importLines) {
    if (fromImportRegex.test(line)) moduleImports.push(line);
    else localImports.push(line);
  }

  moduleImports.sort((a, b) => {
    const am = fromImportRegex.exec(a)!;
    const bm = fromImportRegex.exec(b)!;
    const cmp = am[2].localeCompare(bm[2]);
    return cmp !== 0 ? cmp : am[1].localeCompare(bm[1]);
  });

  localImports.sort((a, b) => {
    const ap = a.replace(/^\s*'\s*@import\s+/, '');
    const bp = b.replace(/^\s*'\s*@import\s+/, '');
    return ap.localeCompare(bp);
  });

  const fromMockRegex = /^\s*'\s*@mock\s+(.*?)\s+from\s+(\S+)\s*$/;
  const moduleMocks: string[] = [];
  const localMocks: string[] = [];
  for (const line of mockLines) {
    if (fromMockRegex.test(line)) moduleMocks.push(line);
    else localMocks.push(line);
  }

  moduleMocks.sort((a, b) => {
    const am = fromMockRegex.exec(a)!;
    const bm = fromMockRegex.exec(b)!;
    const cmp = am[2].localeCompare(bm[2]);
    return cmp !== 0 ? cmp : am[1].localeCompare(bm[1]);
  });

  localMocks.sort((a, b) => {
    const ap = a.replace(/^\s*'\s*@mock\s+/, '');
    const bp = b.replace(/^\s*'\s*@mock\s+/, '');
    return ap.localeCompare(bp);
  });

  const sorted: string[] = [...moduleImports, ...localImports];
  if (mockLines.length > 0) {
    sorted.push(...moduleMocks, ...localMocks);
  }

  if (config.emptyLineAfterImports) {
    const rest = lines.slice(blockEnd);
    if (rest.length > 0 && rest[0].trim() !== '') {
      sorted.push('');
    }
  }

  return [...sorted, ...lines.slice(blockEnd)];
}

// ---------------------------------------------------------------------------
// Pass 2 — Comment normalization
// ---------------------------------------------------------------------------

function passCommentNormalization(lines: string[], config: FormattingConfig): string[] {
  if (config.commentStyle === 'preserve' && !config.spaceAfterCommentMarker) return lines;

  return lines.map(line => {
    const trimmed = line.trim();

    if (/^\s*'\s*@(?:import|mock)\s+/.test(line)) return line;

    const isTickComment = trimmed.startsWith("'");
    const isRemComment = /^rem\b/i.test(trimmed);
    if (!isTickComment && !isRemComment) return line;

    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    let content = isTickComment ? trimmed.slice(1) : trimmed.slice(3);

    let marker: string;
    if (config.commentStyle === 'preserve') {
      marker = isTickComment ? "'" : trimmed.slice(0, 3);
    } else {
      marker = config.commentStyle === "'" ? "'" : 'rem';
    }

    if (config.spaceAfterCommentMarker && content.length > 0 && !content.startsWith(' ')) {
      content = ' ' + content;
    }

    return indent + marker + content;
  });
}

// ---------------------------------------------------------------------------
// Pass 3 — End keyword style
// ---------------------------------------------------------------------------

function passEndKeywordStyle(lines: string[], config: FormattingConfig): string[] {
  if (config.endKeywordStyle === 'preserve') return lines;

  return lines.map(line => {
    const lower = line.trim().toLowerCase();
    const indent = line.match(/^(\s*)/)?.[1] ?? '';

    if (config.endKeywordStyle === 'compact') {
      const compact = SPACED_TO_COMPACT[lower];
      if (compact) return indent + compact;
    } else {
      const spaced = COMPACT_TO_SPACED[lower];
      if (spaced) return indent + spaced;
    }
    return line;
  });
}

// ---------------------------------------------------------------------------
// Pass 3b — function vs sub for void
// ---------------------------------------------------------------------------

function passFunctionVsSub(lines: string[], config: FormattingConfig): string[] {
  if (config.functionVsSubForVoid === 'preserve') return lines;

  const result = [...lines];
  const declRegex = /^(\s*)(function|sub)\s+(\w+)\s*\(([^)]*)\)(?:\s+as\s+(\w+))?\s*$/i;

  for (let i = 0; i < result.length; i++) {
    const m = declRegex.exec(result[i]);
    if (!m) continue;
    const [, indent, keyword, name, params, returnType] = m;
    const kw = keyword.toLowerCase();

    const endIdx = findMatchingEnd(result, i);
    if (endIdx < 0) continue;

    const hasExplicitReturnType = returnType && returnType.toLowerCase() !== 'void';
    const hasValueReturn = hasReturnWithValue(result, i + 1, endIdx);
    const isVoid = !hasExplicitReturnType && !hasValueReturn;

    if (config.functionVsSubForVoid === 'sub' && kw === 'function' && isVoid) {
      result[i] = `${indent}sub ${name}(${params})`;
      const ei = result[endIdx].match(/^(\s*)/)?.[1] ?? '';
      const el = result[endIdx].trim().toLowerCase();
      if (el === 'end function') result[endIdx] = ei + 'end sub';
      else if (el === 'endfunction') result[endIdx] = ei + 'endsub';
    } else if (config.functionVsSubForVoid === 'function' && kw === 'sub') {
      result[i] = `${indent}function ${name}(${params}) as Void`;
      const ei = result[endIdx].match(/^(\s*)/)?.[1] ?? '';
      const el = result[endIdx].trim().toLowerCase();
      if (el === 'end sub') result[endIdx] = ei + 'end function';
      else if (el === 'endsub') result[endIdx] = ei + 'endfunction';
    }
  }
  return result;
}

function hasReturnWithValue(lines: string[], startIdx: number, endIdx: number): boolean {
  let depth = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const trimmed = lines[i].trim().toLowerCase();
    if (/^(?:function|sub)\b/.test(trimmed)) depth++;
    else if (/^(?:end\s*function|end\s*sub|endfunction|endsub)\b/.test(trimmed)) depth--;

    if (depth > 0) continue;

    if (/^return\s+\S/i.test(trimmed)) return true;
  }
  return false;
}

function findMatchingEnd(lines: string[], startIdx: number): number {
  let depth = 1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const lower = lines[i].trim().toLowerCase();
    if (/^(?:function|sub)\b/i.test(lower)) depth++;
    else if (/^(?:end\s*function|end\s*sub|endfunction|endsub)\b/i.test(lower)) {
      if (--depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Pass 4 — Then style
// ---------------------------------------------------------------------------

function passThenStyle(lines: string[], config: FormattingConfig): string[] {
  if (config.thenStyle === 'preserve') return lines;

  return lines.map(line => {
    const trimmed = line.trim();
    if (!/^(?:if|else\s*if|elseif)\b/i.test(trimmed)) return line;

    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    const hasThen = /\bthen\b/i.test(trimmed);

    let isSingleLine = false;
    if (hasThen) {
      const afterThen = trimmed.replace(/^.*?\bthen\b/i, '').trim();
      isSingleLine = afterThen !== '' && !afterThen.startsWith("'") && !/^rem\b/i.test(afterThen);
    }

    const removeThen = (): string => {
      const split = splitTrailingComment(trimmed);
      const codeOnly = split.code.replace(/\s*\bthen\b\s*$/i, '').trimEnd();
      return indent + codeOnly + (split.comment ? ' ' + split.comment : '');
    };

    switch (config.thenStyle) {
      case 'always':
        if (!hasThen) return indent + trimmed + ' then';
        break;
      case 'never':
        if (hasThen && !isSingleLine) return removeThen();
        break;
      case 'multiline-only':
        if (!hasThen) return indent + trimmed + ' then';
        break;
      case 'singleline-only':
        if (hasThen && !isSingleLine) return removeThen();
        break;
    }
    return line;
  });
}

// ---------------------------------------------------------------------------
// Pass 4b — Parenthesis if case
// ---------------------------------------------------------------------------

function passCatchParenStyle(lines: string[], config: FormattingConfig): string[] {
  if (config.catchParenStyle === 'preserve') return lines;

  return lines.map(line => {
    const trimmed = line.trim();
    // Match `catch varname` or `catch (varname)` with optional trailing comment
    const m = /^(catch)\s+\(?([a-zA-Z_]\w*)\)?((?:\s*'.*)?)$/i.exec(trimmed);
    if (!m) return line;

    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    const varName = m[2];
    const trailing = m[3];

    if (config.catchParenStyle === 'always') {
      return indent + 'catch (' + varName + ')' + trailing;
    } else {
      return indent + 'catch ' + varName + trailing;
    }
  });
}

function passParenthesisIfCase(lines: string[], config: FormattingConfig): string[] {
  if (config.parenthesisIfCase === 'preserve') return lines;

  return lines.map(line => {
    const trimmed = line.trim();
    if (!/^(?:if|else\s*if|elseif)\b/i.test(trimmed)) return line;

    const indent = line.match(/^(\s*)/)?.[1] ?? '';

    if (config.parenthesisIfCase === 'always') {
      const mThen = /^((?:if|else\s*if|elseif)\b)\s+(.+?)\s+(then\s*(?:'.*)?)\s*$/i.exec(trimmed);
      if (mThen) {
        let condition = mThen[2];
        if (!isWrappedInParens(condition)) {
          condition = `(${condition})`;
        }
        return indent + mThen[1] + ' ' + condition + ' ' + mThen[3];
      }

      const mNoThen = /^((?:if|else\s*if|elseif)\b)\s+(.+?)\s*$/i.exec(trimmed);
      if (mNoThen) {
        const rest = mNoThen[2];
        const split = splitTrailingComment(rest);
        const codeOnly = split.code;
        const trailingComment = split.comment ? ' ' + split.comment : '';
        const hasThen = /\bthen\b/i.test(codeOnly);
        if (!hasThen) {
          if (isWrappedInParens(codeOnly)) {
            return line;
          }
          if (/\breturn\b/i.test(codeOnly) || /=\s*\S/.test(codeOnly.replace(/[<>!]=?|<>/g, ''))) {
            return line;
          }
          return indent + mNoThen[1] + ' (' + codeOnly + ')' + trailingComment;
        }
      }
    } else {
      const m = /^((?:if|else\s*if|elseif)\b)\s+\((.+)\)(.*?)$/i.exec(trimmed);
      if (m && isWrappedInParens('(' + m[2] + ')')) {
        return indent + m[1] + ' ' + m[2] + m[3];
      }
    }
    return line;
  });
}

function isWrappedInParens(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    if (depth === 0 && i < s.length - 1) return false;
  }
  return depth === 0;
}

/** Splits a code line into code and trailing tick comment, ignoring `'` inside strings. */
function splitTrailingComment(s: string): { code: string; comment: string } {
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (inStr && s[i + 1] === '"') { i++; continue; }
      inStr = !inStr;
    } else if (!inStr && ch === "'") {
      return { code: s.slice(0, i).trimEnd(), comment: s.slice(i) };
    }
  }
  return { code: s, comment: '' };
}

// ---------------------------------------------------------------------------
// Pass 5 — Print statement handling
// ---------------------------------------------------------------------------

function passPrintStatement(lines: string[], config: FormattingConfig): string[] {
  if (config.printStatement !== 'remove') return lines;
  return lines.filter(line => !/^\s*(?:print|\?)\b/i.test(line));
}

// ---------------------------------------------------------------------------
// Pass 6 — Spacing rules
// ---------------------------------------------------------------------------

function passSpacing(lines: string[], config: FormattingConfig): string[] {
  return lines.map(line => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith("'") || /^rem\b/i.test(trimmed)) return line;

    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    const segments = splitCodeSegments(trimmed);
    let result = '';

    for (const seg of segments) {
      if (seg.isCode) {
        result += applySpacingToCode(seg.text, config, trimmed);
      } else {
        result += seg.text;
      }
    }

    // Bracket spacing and AA comma spacing are applied to the full assembled line
    // so that rules work correctly across string-literal segment boundaries
    // (e.g. the space before `}` when the last value is a string literal).
    result = applyBracketAndCommaSpacing(result, config);

    return indent + result;
  });
}

function applySpacingToCode(code: string, config: FormattingConfig, fullLine: string): string {
  let r = code;

  if (config.spaceAroundOperators) {
    r = r.replace(/(\S)\s*([+\-*/\\])=\s*(\S)/g, '$1 $2= $3');
    r = r.replace(/(\S)\s*([+\-*/\\])=$/g, '$1 $2=');

    r = r.replace(/([^\s<>])(<>|<=|>=|<<|>>)/g, '$1 $2');
    r = r.replace(/(<>|<=|>=|<<|>>)([^\s<>=])/g, '$1 $2');

    r = r.replace(/(\S)\s*([*/\\])(?!=)\s*(\S)/g, (_, pre, op, post) => {
      return pre + ' ' + op + ' ' + post;
    });
    // Handle + separately to avoid splitting ++ (increment operator).
    r = r.replace(/(\S)\s*\+(?!\+|=)\s*(\S)/g, (_, pre, post) => {
      return pre + ' + ' + post;
    });
  }

  if (config.spaceAroundAssignment) {
    r = r.replace(/([^\s<>!=+\-*/\\])=/g, '$1 =');
    r = r.replace(/=([^\s<>!=])/g, '= $1');
  }

  if (config.unarySpacing) {
    r = r.replace(/\bnot\b(?=\S)/gi, 'not ');
  }

  if (config.forLoopSpacing && /^for\b/i.test(fullLine.trim())) {
    r = r.replace(/(\S)\s*\b(to|step)\b\s*(\S)/gi, '$1 $2 $3');
  }

  if (/^\s*(?:function|sub)\s+\w+/i.test(fullLine)) {
    if (config.spaceBeforeNamedFunctionParens) {
      r = r.replace(/(\b(?:function|sub)\s+\w+)\(/i, '$1 (');
    } else {
      r = r.replace(/(\b(?:function|sub)\s+\w+)\s+\(/i, '$1(');
    }
  }

  if (/=\s*(?:function|sub)\s*\(/i.test(r)) {
    if (config.spaceBeforeAnonymousFunctionParens) {
      r = r.replace(/(=\s*(?:function|sub))\s*\(/gi, '$1 (');
    } else {
      r = r.replace(/(=\s*(?:function|sub))\s+\(/gi, '$1(');
    }
  }

  const _parenSkipWords = /^(?:if|for|while|print|and|or|not|mod|return|then|else|elseif|to|step|in|each|as|dim|end|exit|catch|throw)$/i;
  if (config.spaceBeforeCallParens) {
    r = r.replace(/(\b(?!function\b|sub\b)[a-zA-Z_]\w*)\(/gi, (match, name) => {
      if (_parenSkipWords.test(name)) return match;
      return name + ' (';
    });
  } else {
    r = r.replace(/(\b(?!function\b|sub\b)[a-zA-Z_]\w*)\s+\(/gi, (match, name) => {
      if (_parenSkipWords.test(name)) return match;
      return name + '(';
    });
  }

  if (config.spaceInsideParens === 'always') {
    r = r.replace(/\(([^\s)][^)]*)\)/g, '( $1 )');
  } else if (config.spaceInsideParens === 'never') {
    r = r.replace(/\(\s+/g, '(');
    r = r.replace(/\s+\)/g, ')');
  }

  return r;
}

/**
 * Applies `bracketSpacing` and `aaCommaSpacing` to a fully-assembled line
 * (code + string-literal segments joined together).
 *
 * This runs after all code segments are assembled so that the rules work
 * correctly across string-literal boundaries — e.g. `{ key: "value"}` → `{ key: "value" }`
 * where the closing `}` lives in a different segment than the preceding `"`.
 *
 * String literal contents are never modified.
 */
function applyBracketAndCommaSpacing(line: string, config: FormattingConfig): string {
  const addBracket = config.bracketSpacing;
  const commaMode = config.aaCommaSpacing ?? 'preserve';
  // Fast path: nothing to process if the line has no braces at all
  if (!line.includes('{') && !line.includes('}')) return line;

  let result = '';
  let inString = false;
  let braceDepth = 0;
  let parenDepth = 0;
  let squareDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    // ── String literal handling ─────────────────────────────────────────────
    if (ch === '"' && !inString) {
      inString = true;
      result += ch;
      continue;
    }
    if (inString) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        result += '""'; i++; // BrightScript escaped quote
      } else if (ch === '"') {
        inString = false;
        result += ch;
      } else {
        result += ch;
      }
      continue;
    }

    // ── Comment: pass through the rest unchanged ────────────────────────────
    if (ch === "'") {
      result += line.slice(i);
      break;
    }

    // ── Depth tracking for non-brace brackets ───────────────────────────────
    if (ch === '(') { parenDepth++; result += ch; continue; }
    if (ch === ')') { parenDepth--; result += ch; continue; }
    if (ch === '[') { squareDepth++; result += ch; continue; }
    if (ch === ']') { squareDepth--; result += ch; continue; }

    // ── Opening brace ────────────────────────────────────────────────────────
    if (ch === '{') {
      braceDepth++;
      result += ch;
      if (addBracket) {
        // Add space after { unless immediately followed by space or }
        const next = i + 1 < line.length ? line[i + 1] : '';
        if (next !== ' ' && next !== '}') result += ' ';
      } else {
        // Remove space(s) after {
        while (i + 1 < line.length && line[i + 1] === ' ') i++;
      }
      continue;
    }

    // ── Closing brace ────────────────────────────────────────────────────────
    if (ch === '}') {
      braceDepth--;
      if (addBracket) {
        // Add space before } unless already preceded by space or {
        const last = result.length > 0 ? result[result.length - 1] : '';
        if (last !== ' ' && last !== '{') result += ' ';
      } else {
        // Remove space(s) before }
        while (result.length > 0 && result[result.length - 1] === ' ') {
          result = result.slice(0, -1);
        }
      }
      result += ch;
      continue;
    }

    // ── AA comma spacing ─────────────────────────────────────────────────────
    if (ch === ',' && commaMode !== 'preserve' && braceDepth > 0 && parenDepth === 0 && squareDepth === 0) {
      const spaceBefore = commaMode === 'before' || commaMode === 'both';
      const spaceAfter  = commaMode === 'after'  || commaMode === 'both';
      // Remove any existing spaces before the comma
      while (result.length > 0 && result[result.length - 1] === ' ') result = result.slice(0, -1);
      if (spaceBefore) result += ' ';
      result += ',';
      // Skip any existing spaces after the comma in the source
      while (i + 1 < line.length && line[i + 1] === ' ') i++;
      if (spaceAfter) result += ' ';
      continue;
    }

    result += ch;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pass 7 — Casing
// ---------------------------------------------------------------------------

function passCasing(lines: string[], casing: CasingConfig, userFuncMap: Map<string, string>): string[] {
  return lines.map(line => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith("'") || /^rem\b/i.test(trimmed)) return line;

    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    return indent + applyCasingToLine(trimmed, casing, userFuncMap);
  });
}

// ---------------------------------------------------------------------------
// Pass 7b — Split array open bracket
// ---------------------------------------------------------------------------

function passSplitArrayOpenBracket(lines: string[], config: FormattingConfig): string[] {
  if (!config.splitArrayOpenBracket) return lines;

  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/\[\{\s*$/.test(trimmed)) {
      let hasMultipleItems = false;
      let depth = 0;
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        for (const ch of t) {
          if (ch === '{' || ch === '[') depth++;
          else if (ch === '}' || ch === ']') depth--;
        }
        if (/^},/.test(t) && depth <= 0) { hasMultipleItems = true; break; }
        if (/^\]/.test(t) && depth < 0) break;
      }

      if (hasMultipleItems) {
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        const prefix = trimmed.slice(0, -1);
        result.push(indent + prefix);
        result.push(indent + '  {');
        continue;
      }
    }

    result.push(line);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pass 8b — Comma handling (trailing commas + array/AA comma style)
// ---------------------------------------------------------------------------

function passTrailingCommas(lines: string[], config: FormattingConfig): string[] {
  const result = [...lines];

  for (let i = 0; i < result.length; i++) {
    const trimmed = result[i].trim();

    if (!/^\s*[}\]]/.test(result[i])) continue;

    const closerChar = trimmed[0];
    const isArray = closerChar === ']';
    const isAA = closerChar === '}';

    const itemStyle = isArray ? config.arrayCommaStyle : isAA ? config.assocArrayCommaStyle : 'preserve';

    const openerChar = isArray ? '[' : '{';
    let depth = 0;
    for (let j = i; j >= 0; j--) {
      const jTrimmed = result[j].trim();

      for (let k = jTrimmed.length - 1; k >= 0; k--) {
        if (jTrimmed[k] === closerChar) depth++;
        else if (jTrimmed[k] === openerChar) depth--;
      }

      if (depth <= 0) break;

      if (j < i && j > 0 && jTrimmed !== '' && !jTrimmed.startsWith("'") && !/^rem\b/i.test(jTrimmed)) {
        if (/\b(?:function|sub)\s*\([^)]*\)(?:\s+as\s+\w+)?\s*$/i.test(jTrimmed)) continue;
        if (jTrimmed === '{' || jTrimmed === '[') continue;
        if (/^return\b/i.test(jTrimmed)) continue;
        if (/^(?:if|else|elseif|else\s+if|end\s*if|end\s*sub|end\s*function|end\s*for|end\s*while|end\s*try|for|while|try|catch|next|exit|throw|dim|print|\?)\b/i.test(jTrimmed)) continue;
        if (isAA && !/^\w+\s*:/.test(jTrimmed) && !/^"[^"]*"\s*:/.test(jTrimmed)) continue;

        const isLastItem = j === i - 1 || (() => {
          for (let k = j + 1; k < i; k++) {
            if (result[k].trim() !== '') return false;
          }
          return true;
        })();

        const codeOnly = stripTrailingComment(jTrimmed);
        const alreadyHasComma = codeOnly.endsWith(',');

        if (isLastItem) {
          if (config.trailingComma === 'always' || config.trailingComma === 'multiline') {
            if (!alreadyHasComma && jTrimmed !== openerChar) {
              result[j] = insertCommaBeforeComment(result[j]);
            }
          } else if (config.trailingComma === 'never') {
            if (alreadyHasComma) {
              result[j] = removeCommaBeforeComment(result[j]);
            }
          }
        } else {
          if (itemStyle === 'always') {
            if (!alreadyHasComma && !codeOnly.endsWith('{') && !codeOnly.endsWith('[')) {
              result[j] = insertCommaBeforeComment(result[j]);
            }
          } else if (itemStyle === 'never') {
            if (alreadyHasComma) {
              result[j] = removeCommaBeforeComment(result[j]);
            }
          }
        }
      }
    }
  }

  return result;
}

function stripTrailingComment(trimmed: string): string {
  let inStr = false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '"') inStr = !inStr;
    else if (trimmed[i] === "'" && !inStr) {
      return trimmed.substring(0, i).trimEnd();
    }
  }
  return trimmed;
}

function insertCommaBeforeComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inStr = !inStr;
    else if (line[i] === "'" && !inStr) {
      const before = line.substring(0, i).trimEnd();
      const after = line.substring(i);
      return before + ', ' + after;
    }
  }
  return line.trimEnd() + ',';
}

function removeCommaBeforeComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inStr = !inStr;
    else if (line[i] === "'" && !inStr) {
      const before = line.substring(0, i).trimEnd();
      const after = line.substring(i);
      return before.replace(/,\s*$/, '') + ' ' + after;
    }
  }
  return line.replace(/,(\s*)$/, '$1');
}

// ---------------------------------------------------------------------------
// Pass 8 — Indentation
// ---------------------------------------------------------------------------

function passIndentation(lines: string[], config: FormattingConfig): string[] {
  const indentUnit = config.useTabs ? '\t' : ' '.repeat(config.indentSize);
  let indentLevel = 0;
  // Chain-continuation indent: when a line starts with `.` it is a method-chain
  // continuation and gets +1 extra indent. The extra persists until the indent
  // level returns to the level recorded when the chain started.
  let chainExtra = 0;
  let chainStartLevel = -1;

  return lines.map(line => {
    const trimmed = line.trim();
    if (trimmed === '') return '';

    // Comments are indented at the current level but never alter indentation state.
    const isComment = trimmed.startsWith("'") || /^rem\b/i.test(trimmed);
    if (isComment) return indentUnit.repeat(indentLevel + chainExtra) + trimmed;

    const isChainCont = /^\.[a-zA-Z_]/.test(trimmed);

    // Exit the chain when a non-chain line returns to the chain's start level.
    if (chainExtra > 0 && !isChainCont && indentLevel === chainStartLevel) {
      chainExtra = 0;
      chainStartLevel = -1;
    }

    // Enter a chain on the first `.`-line after a non-chain line.
    if (isChainCont && chainExtra === 0) {
      chainStartLevel = indentLevel;
      chainExtra = 1;
    }

    if (isDeindentLine(trimmed) && indentLevel > 0) indentLevel--;

    // Count leading ] and } closers for bracket de-indentation
    let leadingClosers = 0;
    if (!isDeindentLine(trimmed)) {
      for (const ch of trimmed) {
        if (ch === '}' || ch === ']') leadingClosers++;
        else break;
      }
      if (leadingClosers > 0) indentLevel = Math.max(0, indentLevel - leadingClosers);
    }

    const result = indentUnit.repeat(indentLevel + chainExtra) + trimmed;

    if (isIndentLine(trimmed)) indentLevel++;

    // Bracket depth: net change in [ ] { } on this line (string-aware).
    // trailingOpens = netDepth + leadingClosers gives the effective opens
    // remaining at the end of the line (leading closers were already applied).
    const netDepth = netContainerDepth(trimmed);
    const trailingOpens = netDepth + leadingClosers;
    if (trailingOpens !== 0) indentLevel = Math.max(0, indentLevel + trailingOpens);

    // Anonymous function expressions: trailing comment after return type is allowed.
    if (/\b(?:function|sub)\s*\([^)]*\)(?:\s+as\s+\w+)?\s*(?:'.*)?$/i.test(trimmed) && !/^(?:function|sub)\b/i.test(trimmed)) {
      indentLevel++;
    }

    return result;
  });
}

// ---------------------------------------------------------------------------
// Pass 9 — Blank line rules
// ---------------------------------------------------------------------------

function passBlankLines(lines: string[], config: FormattingConfig): string[] {
  let result = [...lines];

  if (config.maxEmptyLines > 0) {
    const filtered: string[] = [];
    let consecutive = 0;
    for (const line of result) {
      if (line.trim() === '') {
        consecutive++;
        if (consecutive <= config.maxEmptyLines) filtered.push(line);
      } else {
        consecutive = 0;
        filtered.push(line);
      }
    }
    result = filtered;
  }

  if (config.emptyLinesBetweenFunctions > 0) {
    const out: string[] = [];
    let prevWasEndFuncOrSub = false;
    for (let i = 0; i < result.length; i++) {
      const trimmed = result[i].trim().toLowerCase();
      const isFuncStart = /^(?:function|sub)\b/i.test(trimmed);

      if (isFuncStart && prevWasEndFuncOrSub) {
        while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
        for (let n = 0; n < config.emptyLinesBetweenFunctions; n++) out.push('');
      }

      out.push(result[i]);
      prevWasEndFuncOrSub = /^(?:end\s*function|end\s*sub|endfunction|endsub)\b/i.test(trimmed);
    }
    result = out;
  }

  if (config.blankLineAfterFunctionOpen) {
    const out: string[] = [];
    for (let i = 0; i < result.length; i++) {
      out.push(result[i]);
      if (/^\s*(?:function|sub)\b/i.test(result[i])) {
        if (i + 1 < result.length && result[i + 1].trim() !== '') out.push('');
      }
    }
    result = out;
  }

  if (config.blankLineBeforeFunctionClose) {
    const out: string[] = [];
    for (let i = 0; i < result.length; i++) {
      if (/^\s*(?:end\s*function|end\s*sub|endfunction|endsub)\b/i.test(result[i])) {
        if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
      }
      out.push(result[i]);
    }
    result = out;
  }

  if (config.blankLineBeforeReturn) {
    const out: string[] = [];
    for (let i = 0; i < result.length; i++) {
      if (/^\s*return\b/i.test(result[i])) {
        const isAlone = isReturnAloneInBlock(result, i);
        const shouldAdd = config.blankLineBeforeReturn === 'always' ||
          (config.blankLineBeforeReturn === 'not-alone' && !isAlone);
        if (shouldAdd && out.length > 0) {
          const prevTrimmed = out[out.length - 1].trim();
          // Skip when the preceding line is a comment — the blank line belongs before the comment.
          if (prevTrimmed !== '' && !prevTrimmed.startsWith("'") && !/^rem\b/i.test(prevTrimmed)) {
            out.push('');
          }
        }
        // With 'not-alone', actively remove blank lines before return when it IS alone in its block.
        if (config.blankLineBeforeReturn === 'not-alone' && isAlone) {
          while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
        }
      }
      out.push(result[i]);
    }
    result = out;
  }

  if (config.blankLineBeforeComment) {
    const out: string[] = [];
    for (let i = 0; i < result.length; i++) {
      const trimmed = result[i].trim();
      const isComment = trimmed.startsWith("'") || /^rem\b/i.test(trimmed);
      if (isComment && out.length > 0 && out[out.length - 1].trim() !== '') {
        if (!/^\s*'\s*@(?:import|mock)\s+/.test(result[i])) out.push('');
      }
      out.push(result[i]);
    }
    result = out;
  }

  if (config.emptyLinesAtBlockBoundaries === 'strip') {
    const blockOpeners = /^\s*(?:function|sub|if\b.*\bthen\s*$|else\b|elseif\b|for\b|while\b|try\b|catch\b)/i;
    const blockClosers = /^\s*(?:end\s*function|end\s*sub|end\s*if|end\s*for|end\s*while|end\s*try|endif|endfunction|endsub|endfor|endwhile|endtry|next|else|elseif|catch)\b/i;

    const out: string[] = [];
    for (let i = 0; i < result.length; i++) {
      if (result[i].trim() === '') {
        if (i > 0 && blockOpeners.test(result[i - 1])) continue;
        if (i + 1 < result.length && blockClosers.test(result[i + 1])) continue;
      }
      out.push(result[i]);
    }
    result = out;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pass 10 — Trim trailing whitespace
// ---------------------------------------------------------------------------

function passTrimTrailing(lines: string[], config: FormattingConfig): string[] {
  if (!config.trimTrailingWhitespace) return lines;
  return lines.map(line => line.trimEnd());
}

// ---------------------------------------------------------------------------
// Pass 11 — Comment width
// ---------------------------------------------------------------------------

function passCommentWidth(lines: string[], config: FormattingConfig): string[] {
  if (config.commentWidth <= 0) return lines;

  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const isTickComment = trimmed.startsWith("'");
    const isRemComment = /^rem\b/i.test(trimmed);
    if (!isTickComment && !isRemComment) { result.push(line); continue; }

    if (line.length <= config.commentWidth) { result.push(line); continue; }

    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    const marker = isTickComment ? "' " : 'rem ';
    const content = isTickComment ? trimmed.slice(1).trim() : trimmed.slice(3).trim();
    const prefix = indent + marker;
    const maxContent = config.commentWidth - prefix.length;

    if (maxContent <= 0) { result.push(line); continue; }

    let remaining = content;
    while (remaining.length > 0) {
      if (remaining.length <= maxContent) {
        result.push(prefix + remaining);
        break;
      }
      let breakAt = remaining.lastIndexOf(' ', maxContent);
      if (breakAt <= 0) breakAt = maxContent;
      result.push(prefix + remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Indent tracking helpers
// ---------------------------------------------------------------------------

function isIndentLine(trimmed: string): boolean {
  const lower = trimmed.toLowerCase();

  if (/^(?:if|else\s*if|elseif)\b/i.test(lower)) {
    if (/\bthen\b/i.test(lower)) {
      const afterThen = lower.replace(/^.*?\bthen\b/i, '').trim();
      if (afterThen !== '' && !afterThen.startsWith("'") && !/^rem\b/i.test(afterThen)) {
        return false;
      }
      return true;
    }

    if (/^(?:if|else\s*if|elseif)\s+\(/i.test(lower)) {
      let depth = 0;
      let afterParen = -1;
      for (let i = 0; i < lower.length; i++) {
        if (lower[i] === '(') depth++;
        else if (lower[i] === ')') {
          depth--;
          if (depth === 0) { afterParen = i + 1; break; }
        }
      }
      if (afterParen > 0) {
        const rest = lower.substring(afterParen).trim();
        if (rest !== '' && !rest.startsWith("'") && !/^rem\b/i.test(rest)) {
          return false;
        }
      }
    }

    return true;
  }

  if (/^(?:function|sub)\b/i.test(lower)) return true;
  if (/^(?:else|elseif)\b/i.test(lower)) return true;
  if (/^for\b/i.test(lower)) return true;
  if (/^while\b/i.test(lower)) return true;
  if (/^try\b/i.test(lower)) return true;
  if (/^catch\b/i.test(lower)) return true;

  // Conditional compilation
  if (/^#if\b/i.test(lower)) return true;
  if (/^#else\b/i.test(lower)) return true;
  if (/^#elseif\b/i.test(lower)) return true;
  if (/^#else\s+if\b/i.test(lower)) return true;

  return false;
}

function isDeindentLine(trimmed: string): boolean {
  const lower = trimmed.toLowerCase();

  if (/^end\s*(function|sub|if|for|while|try)\b/i.test(lower)) return true;
  if (/^(?:endfunction|endsub|endif|endfor|endwhile|endtry)\b/i.test(lower)) return true;
  if (/^(?:next|endwhile)\b/i.test(lower)) return true;
  if (/^(?:else|elseif)\b/i.test(lower)) return true;
  if (/^catch\b/i.test(lower)) return true;

  // Conditional compilation
  if (/^#end\s*if\b/i.test(lower)) return true;
  if (/^#endif\b/i.test(lower)) return true;
  if (/^#else\b/i.test(lower)) return true;
  if (/^#elseif\b/i.test(lower)) return true;
  if (/^#else\s+if\b/i.test(lower)) return true;

  return false;
}

function isAnonFunctionOpener(t: string): boolean {
  return /\b(?:function|sub)\s*\([^)]*\)(?:\s+as\s+\w+)?\s*(?:'.*)?$/i.test(t)
    && !/^(?:function|sub)\b/i.test(t)
    && !t.startsWith("'");
}

/** Net change in [], {} depth on a line, ignoring string literals and tick-comments. Does NOT track (). */
function netContainerDepth(line: string): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inStr && line[i + 1] === '"') { i++; continue; }
      inStr = !inStr;
    } else if (!inStr) {
      if (ch === "'") break;
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }
  }
  return depth;
}

/** Net change in (), [], {} depth on a line, ignoring string literals and tick-comments. */
function netBracketDepth(line: string): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inStr && line[i + 1] === '"') { i++; continue; }
      inStr = !inStr;
    } else if (!inStr) {
      if (ch === "'") break;
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
    }
  }
  return depth;
}

function isReturnAloneInBlock(lines: string[], returnIdx: number): boolean {
  let openerIdx = returnIdx - 1;
  while (openerIdx >= 0) {
    const t = lines[openerIdx].trim();
    if (t !== '' && !t.startsWith("'") && !/^rem\b/i.test(t)) {
      if (isIndentLine(t) || isAnonFunctionOpener(t)) break;
      return false;
    }
    openerIdx--;
  }

  // Skip past the return statement's own multi-line expression.
  let exprDepth = netBracketDepth(lines[returnIdx]);
  let closerIdx = returnIdx + 1;
  while (closerIdx < lines.length && exprDepth > 0) {
    exprDepth += netBracketDepth(lines[closerIdx]);
    closerIdx++;
  }
  while (closerIdx < lines.length) {
    const t = lines[closerIdx].trim();
    if (t !== '' && !t.startsWith("'") && !/^rem\b/i.test(t)) {
      if (isDeindentLine(t)) break;
      return false;
    }
    closerIdx++;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Casing helpers
// ---------------------------------------------------------------------------

function applyCasingToLine(line: string, casing: CasingConfig, userFuncMap: Map<string, string>): string {
  const segments = splitCodeSegments(line);
  let result = '';

  for (const seg of segments) {
    if (seg.isCode) {
      result += transformCodeSegment(seg.text, casing, userFuncMap);
    } else {
      result += seg.text;
    }
  }

  return result;
}

interface Segment {
  text: string;
  isCode: boolean;
}

function splitCodeSegments(line: string): Segment[] {
  const segments: Segment[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (!inString) {
        if (current) segments.push({ text: current, isCode: true });
        current = '"';
        inString = true;
      } else if (line[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        current += '"';
        segments.push({ text: current, isCode: false });
        current = '';
        inString = false;
      }
    } else if (!inString && ch === "'") {
      if (current) segments.push({ text: current, isCode: true });
      segments.push({ text: line.slice(i), isCode: false });
      return segments;
    } else {
      current += ch;
    }
  }

  if (current) {
    segments.push({ text: current, isCode: inString ? false : true });
  }

  return segments;
}

function transformCodeSegment(code: string, casing: CasingConfig, userFuncMap: Map<string, string>): string {
  const exactMap = casing.exactCasing ?? {};
  const userFuncCasing = casing.userFunctions ?? 'NoChange';

  return code.replace(/\b([a-zA-Z_]\w*)\b/g, (match, _group, offset) => {
    const afterIdx = offset + match.length;
    const restAfter = code.slice(afterIdx);
    if (/^\s*:/.test(restAfter)) return match;

    if (offset > 0 && code[offset - 1] === '.') return match;

    const lower = match.toLowerCase();

    const exact = Object.prototype.hasOwnProperty.call(exactMap, lower) ? exactMap[lower] : undefined;
    if (exact !== undefined) return exact;

    if (_keywordSet.has(lower)) {
      let category = getKeywordCategory(lower);
      if (lower === 'function' && offset >= 3) {
        const before = code.slice(Math.max(0, offset - 10), offset);
        if (/\bas\s+$/i.test(before)) {
          category = 'type';
        }
      }
      const effectiveCasing = resolveKeywordCasing(category, casing);
      if (effectiveCasing !== 'NoChange') {
        return applyCasingWithOverrides(match, effectiveCasing, exactMap);
      }
      return match;
    }

    if (_builtinMap.has(lower)) {
      const canonical = _builtinMap.get(lower)!;
      if (casing.builtins !== 'NoChange') {
        return applyCasingWithOverrides(canonical, casing.builtins, exactMap);
      }
      return canonical;
    }

    if (userFuncMap.has(lower)) {
      const definitionName = userFuncMap.get(lower)!;
      if (userFuncCasing !== 'NoChange') {
        return applyCasing(definitionName, userFuncCasing);
      }
      return definitionName;
    }

    return match;
  });
}

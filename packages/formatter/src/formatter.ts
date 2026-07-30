
import { CasingConfig, DEFAULT_CASING_CONFIG } from 'kopytko-brightscript-parser';
import { FunctionDefinition } from './types';
import { FormattingConfig } from './config';
import { parse } from 'kopytko-brightscript-parser';
import {
  applyEdits,
  runCstPasses,
  endKeywordStylePass,
  casingPass,
  commentNormalizationPass,
  printStatementRemovalPass,
  thenStylePass,
  functionVsSubPass,
  trailingWhitespacePass,
  observeFieldStylePass,
  mPrefixStylePass,
  fieldAccessConsistencyPass,
  lineCommentPositionPass,
  trailingCommasPass,
  parenthesisIfCasePass,
  stringConcatStylePass,
  elseOnNewLinePass,
  aaThresholdPass,
} from './cst-passes/index';
import type { CstPass } from './cst-passes/index';
import type { ParseResult } from 'kopytko-brightscript-parser';

/**
 * Formats BrightScript source code using a hybrid multi-pass engine —
 * structure-aware CST passes composed with text/regex passes (see the
 * per-pass comments below for which is which, and why).
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
  const parseCache = new Map<string, ParseResult>();

  const detectedEnding = detectLineEnding(source);
  const lineEndStr = resolveLineEnding(config.lineEnding, detectedEnding);

  const userFuncMap = new Map<string, string>();
  for (const fn of userFunctions) {
    if (!userFuncMap.has(fn.nameLower)) userFuncMap.set(fn.nameLower, fn.name);
  }

  // Pass 1 — Import sorting (regex — complex multi-group sorting with trivia)
  lines = passImportSorting(lines, config);

  // Pass 2 — Comment normalization (CST)
  lines = runCstOnLines(lines, lineEndStr,
    commentNormalizationPass({ commentStyle: config.commentStyle, spaceAfterCommentMarker: config.spaceAfterCommentMarker }), parseCache);

  // Pass 3/4a — Consecutive style CST passes share a parse.
  const styleCstPasses: CstPass[] = [];
  if (config.endKeywordStyle !== 'preserve') {
    styleCstPasses.push(endKeywordStylePass(config.endKeywordStyle));
  }
  if (config.functionVsSubForVoid !== 'preserve' && config.functionVsSubForVoid !== 'allow-void') {
    styleCstPasses.push(functionVsSubPass(config.functionVsSubForVoid));
  }
  if (config.thenStyle !== 'preserve') {
    styleCstPasses.push(thenStylePass(config.thenStyle));
  }
  lines = runCstOnLines(lines, lineEndStr, styleCstPasses, parseCache);

  // Pass 4 — Parenthesis if case (CST) + catch paren strip (regex)
  if (config.parenthesisIfCase !== 'preserve') {
    lines = runCstOnLines(lines, lineEndStr, parenthesisIfCasePass(config.parenthesisIfCase), parseCache);
  }
  lines = passStripCatchParens(lines);

  // Pass 4c — Else on new line (CST)
  lines = runCstOnLines(lines, lineEndStr, elseOnNewLinePass(config.elseOnNewLine), parseCache);

  // Pass 5 — Print statement handling (CST)
  if (config.printStatement === 'remove') {
    lines = runCstOnLines(lines, lineEndStr, printStatementRemovalPass(), parseCache);
  }

  // Pass 5b — Line comment position (CST)
  if (config.lineCommentPosition === 'above') {
    lines = runCstOnLines(lines, lineEndStr, lineCommentPositionPass(config.lineCommentPosition), parseCache);
  }

  // Pass 6 — Spacing rules (regex)
  lines = passSpacing(lines, config);

  // Pass 6b — Wrap long strings (regex)
  lines = passWrapLongStrings(lines, config);

  // Pass 6c — String concatenation style (CST)
  if (config.stringConcatStyle !== 'preserve') {
    lines = runCstOnLines(lines, lineEndStr, stringConcatStylePass(config.stringConcatStyle), parseCache);
  }

  // Pass 7b — Split array open bracket (regex)
  lines = passSplitArrayOpenBracket(lines, config);

  // Pass 7c — Associative array single-line threshold (CST)
  if (config.associativeArraySingleLineThreshold > 0) {
    const indentUnit = config.useTabs ? '\t' : ' '.repeat(config.indentSize);
    lines = runCstOnLines(lines, lineEndStr, aaThresholdPass(config.associativeArraySingleLineThreshold, indentUnit), parseCache);
  }

  // Pass 8 — Indentation (regex)
  lines = passIndentation(lines, config);

  // Pass 8b — Trailing commas (CST)
  lines = runCstOnLines(lines, lineEndStr, trailingCommasPass({
    trailingComma: config.trailingComma,
    arrayCommaStyle: config.arrayCommaStyle,
    associativeArrayCommaStyle: config.associativeArrayCommaStyle,
  }), parseCache);

  // Pass 8c — Align assignments (regex)
  lines = passAlignAssignments(lines, config);

  // Pass 8d — Multi-line param alignment (regex)
  lines = passParamAlignment(lines, config);

  // Pass 9 — Blank line rules (regex)
  lines = passBlankLines(lines, config);

  // Pass 9b — Empty lines between methods (regex)
  lines = passEmptyLinesBetweenMethods(lines, config);

  // Pass 10a — Casing (CST). Running this after structural regex passes lets
  // following CST passes reuse the same parse when casing is already correct.
  lines = runCstOnLines(lines, lineEndStr, casingPass(casing, userFuncMap), parseCache);

  // Pass 10 — Trailing whitespace (CST)
  if (config.trimTrailingWhitespace) {
    lines = runCstOnLines(lines, lineEndStr, trailingWhitespacePass(), parseCache);
  }

  // Pass 11 — Comment width (regex)
  lines = passCommentWidth(lines, config);

  // Pass 12 — observeField style (CST)
  if (config.observeFieldStyle !== 'preserve') {
    lines = runCstOnLines(lines, lineEndStr, observeFieldStylePass(config.observeFieldStyle), parseCache);
  }

  // Pass 13 — m prefix style (CST)
  if (config.mPrefixStyle !== 'preserve') {
    lines = runCstOnLines(lines, lineEndStr, mPrefixStylePass(config.mPrefixStyle), parseCache);
  }

  // Pass 14 — Field access consistency (CST)
  if (config.fieldAccessConsistency !== 'preserve') {
    lines = runCstOnLines(lines, lineEndStr, fieldAccessConsistencyPass(config.fieldAccessConsistency), parseCache);
  }

  // Assemble result
  let newText = lines.join(lineEndStr);
  if (config.insertFinalNewline && newText.length > 0 && !newText.endsWith(lineEndStr)) {
    newText += lineEndStr;
  }

  // ── Syntax safety verification ──────────────────────────────────────────
  // Parse the formatted output to detect if formatting broke the syntax.
  // Only fall back to the original if formatting introduced NEW errors — pre-existing
  // parse errors in the source (e.g. unsupported syntax) must not block formatting.
  if (config.verifySyntax !== false) {
    const originalErrorCount = parseCached(source, parseCache).diagnostics.length;
    const result = parseCached(newText, parseCache);
    if (result.diagnostics.length > originalErrorCount) {
      return source;
    }
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
// CST ↔ lines bridge
// ---------------------------------------------------------------------------

/**
 * Runs a CST pass on a string[] lines array.
 * Joins lines → runs CST pass → splits back to lines.
 * Falls back to original lines if the source has parse errors.
 */
function runCstOnLines(
  lines: string[],
  lineEnd: string,
  passOrPasses: CstPass | CstPass[],
  parseCache: Map<string, ParseResult>,
): string[] {
  const passes = Array.isArray(passOrPasses) ? passOrPasses : [passOrPasses];
  if (passes.length === 0) return lines;
  const source = lines.join(lineEnd);
  if (passes.length > 1) {
    const result = runCstPasses(source, passes);
    return result === source ? lines : result.split(/\r?\n/);
  }

  const parseResult = parseCached(source, parseCache);
  if (parseResult.diagnostics.length > 0) return lines; // can't CST-transform broken code
  const edits = passes[0](parseResult.root, source);
  if (edits.length === 0) return lines;
  const result = applyEdits(source, edits);
  return result.split(/\r?\n/);
}

function parseCached(source: string, parseCache: Map<string, ParseResult>): ParseResult {
  let result = parseCache.get(source);
  if (!result) {
    result = parse(source);
    parseCache.set(source, result);
  }
  return result;
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
//
// Deliberately NOT a CST pass, investigated and staying regex: `@import`/
// `@mock` annotations are Kopytko-framework pragmas written as `'`
// tick-comments — they are not BrightScript syntax at all, so this pass
// only ever matches lines already confirmed to start with `' @import`/
// `' @mock` (`annotationRegex`) before touching anything. There is no real
// code for a CST pass to protect from misinterpretation here — the entire
// input domain is comment text by construction. Same class of call as
// `commentWidth`/`blankLines`/`emptyLinesBetweenMethods`.
// ---------------------------------------------------------------------------

function passImportSorting(lines: string[], config: FormattingConfig): string[] {
  if (!config.sortImports && !config.emptyLineAfterImports) return lines;

  const importRegex = /^\s*'\s*@import\s+/;
  const mockRegex = /^\s*'\s*@mock\s+/;
  const annotationRegex = /^\s*'\s*@(?:import|mock)\s+/;
  const suppressionNextLineRegex = /^\s*(?:'|rem\b)\s*kopytko-disable-next-line\b/i;

  // Find the last actual @import/@mock line. disable-next-line suppression comments
  // and blank lines are treated as transparent — they don't end the import block.
  let lastAnnotationIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (annotationRegex.test(lines[i])) {
      lastAnnotationIdx = i;
    } else if (suppressionNextLineRegex.test(lines[i]) || lines[i].trim() === '') {
      // suppression comment or blank line — keep scanning
    } else {
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

  // Collect import units: each unit groups disable-next-line prefix lines with the
  // import line that follows them, so they move together during sorting.
  type ImportUnit = { prefixes: string[]; line: string };
  const importUnits: ImportUnit[] = [];
  const mockUnits: ImportUnit[] = [];

  let pendingPrefixes: string[] = [];
  for (let i = 0; i < blockEnd; i++) {
    const trimmed = lines[i].trim();
    if (suppressionNextLineRegex.test(trimmed)) {
      pendingPrefixes.push(trimmed);
    } else if (mockRegex.test(trimmed)) {
      mockUnits.push({ prefixes: pendingPrefixes, line: trimmed });
      pendingPrefixes = [];
    } else if (importRegex.test(trimmed)) {
      importUnits.push({ prefixes: pendingPrefixes, line: trimmed });
      pendingPrefixes = [];
    } else {
      pendingPrefixes = [];
    }
  }

  const flattenUnits = (units: ImportUnit[]): string[] =>
    units.flatMap(u => [...u.prefixes, u.line]);

  const fromImportRegex = /^\s*'\s*@import\s+(.*?)\s+from\s+(\S+)\s*(?:(?:'|rem\b).*)?$/;
  const moduleImportUnits = importUnits.filter(u => fromImportRegex.test(u.line));
  const localImportUnits = importUnits.filter(u => !fromImportRegex.test(u.line));

  moduleImportUnits.sort((a, b) => {
    const am = fromImportRegex.exec(a.line)!;
    const bm = fromImportRegex.exec(b.line)!;
    const cmp = am[2].localeCompare(bm[2]);
    return cmp !== 0 ? cmp : am[1].localeCompare(bm[1]);
  });

  localImportUnits.sort((a, b) => {
    const ap = a.line.replace(/^\s*'\s*@import\s+/, '');
    const bp = b.line.replace(/^\s*'\s*@import\s+/, '');
    return ap.localeCompare(bp);
  });

  const fromMockRegex = /^\s*'\s*@mock\s+(.*?)\s+from\s+(\S+)\s*(?:(?:'|rem\b).*)?$/;
  const moduleMockUnits = mockUnits.filter(u => fromMockRegex.test(u.line));
  const localMockUnits = mockUnits.filter(u => !fromMockRegex.test(u.line));

  moduleMockUnits.sort((a, b) => {
    const am = fromMockRegex.exec(a.line)!;
    const bm = fromMockRegex.exec(b.line)!;
    const cmp = am[2].localeCompare(bm[2]);
    return cmp !== 0 ? cmp : am[1].localeCompare(bm[1]);
  });

  localMockUnits.sort((a, b) => {
    const ap = a.line.replace(/^\s*'\s*@mock\s+/, '');
    const bp = b.line.replace(/^\s*'\s*@mock\s+/, '');
    return ap.localeCompare(bp);
  });

  const sorted: string[] = [
    ...flattenUnits(moduleImportUnits),
    ...flattenUnits(localImportUnits),
  ];
  if (mockUnits.length > 0) {
    sorted.push(...flattenUnits(moduleMockUnits), ...flattenUnits(localMockUnits));
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
// Pass 4b — Strip catch parentheses (always — BrightScript does not allow them)
//
// Deliberately NOT a CST pass, and never should be: the grammar's CatchClause
// rule requires `catch <Identifier>` with no paren support at all, so
// `catch (e)` is a real parse error (verified: "Expected exception variable
// name"). Every CST pass bails out and returns the source unchanged whenever
// the parse has any diagnostics (see runCstPasses/runCstOnLines) — so a CST
// version of this pass would never fire on the exact input it exists to fix.
// This has to run on raw text before the source can parse cleanly.
// ---------------------------------------------------------------------------

function passStripCatchParens(lines: string[]): string[] {
  return lines.map(line => {
    const trimmed = line.trim();
    const m = /^(catch)\s+\(?([a-zA-Z_]\w*)\)?((?:\s*'.*)?)$/i.exec(trimmed);
    if (!m) return line;

    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    return indent + 'catch ' + m[2] + m[3];
  });
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
// Pass 6 — Spacing rules
//
// Deliberately NOT a CST pass, investigated and staying regex: string-literal
// safety — the specific hazard CST passes exist to remove — is already
// structurally handled here. `splitCodeSegments` (below) separates string
// segments from code before any operator/paren/comma rule runs, and
// `applyBracketAndCommaSpacing` re-walks the assembled line with its own
// `inString` tracker for the AA-brace/comma rules that need to see across
// segment boundaries. A CST port would touch every adjacent token pair in
// the file to re-derive the same spacing decisions this already makes
// safely — effectively a second printer, not a bounded rule — for no
// correctness gain over what's here today. Same call as `indentation` below
// and `alignAssignments` above, at a much larger scale.
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
    r = r.replace(/(?<!\.)\bnot\b(?=\S)/gi, 'not ');
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
 * Applies `associativeArrayBracketSpacing` and `associativeArrayCommaSpacing` to a fully-assembled line
 * (code + string-literal segments joined together).
 *
 * This runs after all code segments are assembled so that the rules work
 * correctly across string-literal boundaries — e.g. `{ key: "value"}` → `{ key: "value" }`
 * where the closing `}` lives in a different segment than the preceding `"`.
 *
 * String literal contents are never modified.
 */
function applyBracketAndCommaSpacing(line: string, config: FormattingConfig): string {
  const addBracket = config.associativeArrayBracketSpacing;
  const commaMode = config.associativeArrayCommaSpacing ?? 'preserve';
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
      const spaceAfter = commaMode === 'after' || commaMode === 'both';
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
// Pass 7b — Split array open bracket
//
// Deliberately NOT a CST pass, investigated and staying regex: its only
// trigger is a line whose trimmed text literally ends with `[{` — an
// unambiguous, already-safe textual check with no string/comment content to
// misinterpret (a `[{` sequence can't appear inside a string literal this
// pass would need to skip; the check is on the line's own trailing
// characters, not a scan through arbitrary text). Low-value, narrow rule;
// porting it would only add an `ArrayLiteral`/`AALiteral`-nesting-shape
// dependency for zero correctness gain.
// ---------------------------------------------------------------------------

function passSplitArrayOpenBracket(lines: string[], config: FormattingConfig): string[] {
  if (!config.arraySplitOpenBracket) return lines;

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
// Pass 8 — Indentation
//
// Deliberately NOT a CST pass, investigated and staying regex: same call as
// `spacing` above, for the same reason. Every helper this pass leans on
// (`isDeindentLine`/`isIndentLine`, `countInlineIndentChange`,
// `countNetAnonFunctionOpeners`, `netContainerDepth`) already tracks string
// literals and `'`/`rem` comments itself before counting a bracket or
// matching a keyword — the string-safety CST passes exist to guarantee is
// already structurally present. What a CST port would actually be doing is
// re-deriving physical-line indent from block/expression nesting depth in
// the tree, including the chain-continuation and inline-`:`-separator state
// this pass tracks by hand — a full indentation engine, not an incremental
// rule migration, with the highest blast radius of any pass in this file
// (every line of every formatted file runs through it). Not attempted here.
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

    if (isIndentLine(trimmed)) {
      indentLevel++;

      // Account for inline block closers after ':' statement separators.
      // e.g. `for i = 0 to 5 : next` — the `for` incremented indent above,
      // but the `next` after `:` should cancel it out.
      const inlineChange = countInlineIndentChange(trimmed);
      if (inlineChange !== 0) indentLevel = Math.max(0, indentLevel + inlineChange);
    }

    // Bracket depth: net change in [ ] { } on this line (string-aware).
    // trailingOpens = netDepth + leadingClosers gives the effective opens
    // remaining at the end of the line (leading closers were already applied).
    const netDepth = netContainerDepth(trimmed);
    const trailingOpens = netDepth + leadingClosers;
    if (trailingOpens !== 0) indentLevel = Math.max(0, indentLevel + trailingOpens);

    // Anonymous function expressions: count net openers accounting for inline closers
    // (e.g. `sub () : end sub` is balanced and should not increase indent).
    if (/\b(?:function|sub)(?:\s+\w+)?\s*\(.*\)(?:\s+as\s+\w+)?\s*(?:'.*)?$/i.test(trimmed) && !/^(?:function|sub)\b/i.test(trimmed)) {
      indentLevel += countNetAnonFunctionOpeners(trimmed);
    }

    return result;
  });
}

// ---------------------------------------------------------------------------
// Pass 8c — Align assignments
//
// Deliberately NOT a CST pass: it already guards against the two failure
// modes CST safety exists to prevent (`findSimpleAssignment` tracks string
// literals and bracket depth itself before ever matching an `=`), so a port
// would buy no correctness gain. What it would cost: every statement-block
// owner in this grammar (`SourceFile`, `FunctionDeclaration`/`Expression`,
// each `IfStatement` branch, `ForStatement`, `WhileStatement`, `TryStatement`/
// `CatchClause`, ...) exposes its statement list with a different child
// shape (see each one's `body` getter in ast.ts) — finding "runs of
// consecutive sibling assignments" structurally means handling all of them,
// for a purely cosmetic column-alignment feature. Not worth it without a
// concrete correctness bug driving it.
// ---------------------------------------------------------------------------

function passAlignAssignments(lines: string[], config: FormattingConfig): string[] {
  if (!config.alignAssignments) return lines;

  const result: string[] = [];
  let group: { idx: number; before: string; after: string; indent: string }[] = [];
  let containerDepth = 0;

  const flushGroup = (): void => {
    if (group.length <= 1) {
      for (const g of group) result.push(lines[g.idx]);
    } else {
      const maxLen = Math.max(...group.map(g => g.before.length));
      for (const g of group) {
        const padding = ' '.repeat(maxLen - g.before.length);
        result.push(g.indent + g.before + padding + ' = ' + g.after);
      }
    }
    group = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed === '') {
      flushGroup();
      result.push(lines[i]);
      continue;
    }

    if (trimmed.startsWith("'") || /^rem\b/i.test(trimmed)) {
      flushGroup();
      result.push(lines[i]);
      continue;
    }

    const prevDepth = containerDepth;
    containerDepth += netContainerDepth(trimmed);

    // Inside a multi-line container — not an independent assignment
    if (prevDepth > 0) {
      flushGroup();
      result.push(lines[i]);
      continue;
    }

    const assignInfo = findSimpleAssignment(trimmed);
    if (!assignInfo) {
      flushGroup();
      result.push(lines[i]);
      continue;
    }

    const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
    group.push({ idx: i, before: assignInfo.before, after: assignInfo.after, indent });
  }

  flushGroup();
  return result;
}

/** Find a simple `=` assignment in a trimmed line, returning the parts before and after `=`. */
function findSimpleAssignment(trimmed: string): { before: string; after: string } | null {
  if (!/^[a-zA-Z_]/.test(trimmed)) return null;
  if (/^(?:if|else|elseif|for|while|end|return|function|sub|print|next|try|catch|throw|exit|stop|dim|goto)\b/i.test(trimmed)) return null;

  let inStr = false;
  let bracketDepth = 0;
  let eqPos = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"') {
      if (inStr && trimmed[i + 1] === '"') { i++; continue; }
      inStr = !inStr;
    } else if (!inStr) {
      if (ch === "'") break;
      if (ch === '(' || ch === '[' || ch === '{') bracketDepth++;
      else if (ch === ')' || ch === ']' || ch === '}') bracketDepth--;
      else if (ch === '=' && bracketDepth === 0 && i > 0) {
        const prev = trimmed[i - 1];
        const next = i + 1 < trimmed.length ? trimmed[i + 1] : '';
        if (next === '=') { i++; continue; }
        if (prev === '<' || prev === '>' || prev === '!' || prev === '+' || prev === '-') continue;
        if (eqPos !== -1) return null;
        eqPos = i;
      }
    }
  }

  if (eqPos < 0) return null;
  return {
    before: trimmed.substring(0, eqPos).trimEnd(),
    after: trimmed.substring(eqPos + 1).trimStart(),
  };
}

// ---------------------------------------------------------------------------
// Pass 9 — Blank line rules
//
// Deliberately NOT a CST pass: every rule here only ever counts or inserts/
// removes *blank* lines, gated on whether an adjacent line's trimmed text
// starts with a keyword (`function`, `end sub`, `return`, ...). It never
// reads or rewrites a single character of real code, and BrightScript has no
// multi-line string literals for a keyword-looking line to hide inside — so
// none of the string/comment-safety a CST pass buys applies here. Porting it
// would mean re-deriving "is this a function boundary" from the tree instead
// of a token's `.line`, for zero behavioral or safety difference. See
// findings/lsp-architecture.md for the fuller reasoning (same call applies
// to passEmptyLinesBetweenMethods and passCommentWidth below).
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

  if (config.emptyLineAfterFunctionOpen) {
    const out: string[] = [];
    for (let i = 0; i < result.length; i++) {
      out.push(result[i]);
      if (/^\s*(?:function|sub)\b/i.test(result[i])) {
        if (i + 1 < result.length && result[i + 1].trim() !== '') out.push('');
      }
    }
    result = out;
  }

  if (config.emptyLineBeforeFunctionClose) {
    const out: string[] = [];
    for (let i = 0; i < result.length; i++) {
      if (/^\s*(?:end\s*function|end\s*sub|endfunction|endsub)\b/i.test(result[i])) {
        if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
      }
      out.push(result[i]);
    }
    result = out;
  }

  if (config.emptyLineBeforeReturn) {
    const out: string[] = [];
    for (let i = 0; i < result.length; i++) {
      if (/^\s*return\b/i.test(result[i])) {
        const isAlone = isReturnAloneInBlock(result, i);
        const shouldAdd = config.emptyLineBeforeReturn === 'always' ||
          (config.emptyLineBeforeReturn === 'not-alone' && !isAlone);
        if (shouldAdd && out.length > 0) {
          const prevTrimmed = out[out.length - 1].trim();
          // Skip when the preceding line is a comment — the blank line belongs before the comment.
          if (prevTrimmed !== '' && !prevTrimmed.startsWith("'") && !/^rem\b/i.test(prevTrimmed)) {
            out.push('');
          }
        }
        // With 'not-alone', actively remove blank lines before return when it IS alone in its block.
        if (config.emptyLineBeforeReturn === 'not-alone' && isAlone) {
          while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
        }
      }
      out.push(result[i]);
    }
    result = out;
  }

  if (config.emptyLineBeforeComment) {
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
// Pass 9b — Empty lines between methods
//
// Deliberately NOT a CST pass — same reasoning as passBlankLines above:
// only blank lines are inserted/removed, gated on a keyword-line pattern
// (`x.y = function(` / `end function`), never on real code content.
// ---------------------------------------------------------------------------

function passEmptyLinesBetweenMethods(lines: string[], config: FormattingConfig): string[] {
  if (config.emptyLinesBetweenMethods <= 0) return lines;

  const methodDefPattern = /^\w+\.\w+\s*=\s*(?:function|sub)\s*\(/i;
  const endPattern = /^(?:end\s*function|end\s*sub|endfunction|endsub)\b/i;

  const out: string[] = [];
  let prevWasEndMethod = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const isMethodDef = methodDefPattern.test(trimmed);

    if (isMethodDef && prevWasEndMethod) {
      while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
      for (let n = 0; n < config.emptyLinesBetweenMethods; n++) out.push('');
    }

    out.push(lines[i]);

    // Blank lines don't reset the flag
    if (trimmed !== '') {
      prevWasEndMethod = endPattern.test(trimmed);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Pass 11 — Comment width
//
// Deliberately NOT a CST pass: every line this pass rewrites was already
// confirmed comment-only by `trimmed.startsWith("'")` / a `rem` check before
// any text is touched, so there's no risk of it reaching into real code or a
// string literal — the exact class of bug CST safety exists to prevent.
// What it does — reflowing one comment's text across several output lines —
// also isn't expressible as position-based token edits the way the other
// passes are: a single trivia comment would need to become several new
// tokens, not just have its text or position changed.
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
// Pass 6b — Wrap long strings
//
// Investigated, staying regex: `stringMatch = code.match(/"([^"]{40,})"/)`
// excludes `"` from the captured content entirely, so a string containing
// BrightScript's `""` escaped-quote sequence never has an escape pair
// *inside* `strContent` — anything from the first embedded `"` onward lands
// in `after`, untouched by the chunking logic. Confirmed empirically this
// is NOT a corruption risk (`formatText(..., {verifySyntax: false})` on a
// string with an embedded `""` still produces valid, semantically-correct
// output — splitting a string token at any position and re-quoting both
// sides always reconstitutes a valid escape at the seam, since two adjacent
// literal `"` characters are read as one escaped quote by the lexer
// regardless of which piece each one came from). The real effect is just
// that `after`'s length isn't counted toward the wrap-width target for
// strings with an embedded escaped quote, a minor completeness gap, not a
// safety one — not worth the size of this pass's transform (chunking string
// content and re-emitting either `+ _` continuation lines or a
// `[...].join("")` restructuring) to fix.
// ---------------------------------------------------------------------------

function passWrapLongStrings(lines: string[], config: FormattingConfig): string[] {
  if (config.wrapLongStrings === 'preserve') return lines;

  const maxLineLength = config.maxLineLength;
  if (maxLineLength <= 0) return lines;

  const result: string[] = [];
  for (const line of lines) {
    if (line.length <= maxLineLength) { result.push(line); continue; }

    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    const { code, comment } = splitTrailingComment(line);

    // Find a long string literal in the line
    const stringMatch = code.match(/"([^"]{40,})"/);
    if (!stringMatch) { result.push(line); continue; }

    const fullStr = stringMatch[0];
    const strContent = stringMatch[1];
    const strStart = code.indexOf(fullStr);
    const before = code.slice(0, strStart);
    const after = code.slice(strStart + fullStr.length);

    const childIndent = indent + ' '.repeat(4);
    const maxChunk = maxLineLength - childIndent.length - 6;
    if (maxChunk <= 10) { result.push(line); continue; }

    const chunks: string[] = [];
    let remaining = strContent;
    while (remaining.length > 0) {
      if (remaining.length <= maxChunk) { chunks.push(remaining); break; }
      let breakAt = remaining.lastIndexOf(' ', maxChunk);
      if (breakAt <= 0) breakAt = maxChunk;
      chunks.push(remaining.slice(0, breakAt + 1));
      remaining = remaining.slice(breakAt + 1);
    }

    if (chunks.length <= 1) { result.push(line); continue; }

    if (config.wrapLongStrings === 'plus') {
      for (let i = 0; i < chunks.length; i++) {
        const piece = `"${chunks[i]}"`;
        if (i === 0) {
          const suffix = i < chunks.length - 1 ? ' + _' : '';
          result.push(before + piece + suffix);
        } else if (i < chunks.length - 1) {
          result.push(childIndent + piece + ' + _');
        } else {
          result.push(childIndent + piece + after + (comment ? ' ' + comment : ''));
        }
      }
    } else {
      // array-join
      result.push(before + '[');
      for (const chunk of chunks) {
        result.push(childIndent + `"${chunk}"`);
      }
      result.push(indent + '].join("")' + after + (comment ? ' ' + comment : ''));
    }
  }
  return result;
}


// ---------------------------------------------------------------------------
// Pass 8d — Multi-line param alignment
//
// Deliberately NOT a CST pass, and never should be: same architectural block
// as passStripCatchParens. This grammar's `parseParameterList` requires every
// parameter to be on the opening paren's line *unless* a default value
// itself contains a multi-line AA/array/function literal (verified:
// `function work(\n  x as String,\n  y as Integer)\n...` — the plain
// wrapped-params case this pass exists to reformat — produces the real parse
// error "Function parameters must be on one line"). Every CST pass bails out
// unchanged whenever `parseResult.diagnostics.length > 0`, so a CST version
// could never fire on the exact input it's meant to fix.
// ---------------------------------------------------------------------------

function passParamAlignment(lines: string[], config: FormattingConfig): string[] {
  if (config.paramAlignmentStyle === 'preserve') return lines;
  const indentStr = config.useTabs ? '\t' : ' '.repeat(config.indentSize);

  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim().toLowerCase();
    // Detect function/sub declaration with ( but no closing )
    const isFuncLine = /^(?:function|sub)\s+/i.test(trimmed) || /^\s*(?:function|sub)\s+/i.test(lines[i]);
    if (!isFuncLine || !lines[i].includes('(') || lines[i].includes(')')) {
      result.push(lines[i]);
      i++;
      continue;
    }

    // Multi-line params: collect lines until we find )
    const funcLine = lines[i];
    const funcIndent = funcLine.match(/^(\s*)/)?.[1] ?? '';
    const parenCol = funcLine.indexOf('(');
    const paramLines: string[] = [funcLine];
    let j = i + 1;
    while (j < lines.length) {
      paramLines.push(lines[j]);
      if (lines[j].includes(')')) break;
      j++;
    }

    if (paramLines.length <= 1) {
      result.push(lines[i]);
      i++;
      continue;
    }

    if (config.paramAlignmentStyle === 'indent') {
      result.push(paramLines[0]);
      const paramIndent = funcIndent + indentStr;
      for (let k = 1; k < paramLines.length; k++) {
        result.push(paramIndent + paramLines[k].trim());
      }
    } else {
      // align-to-paren
      result.push(paramLines[0]);
      const alignStr = ' '.repeat(parenCol + 1);
      for (let k = 1; k < paramLines.length; k++) {
        result.push(alignStr + paramLines[k].trim());
      }
    }
    i = j + 1;
  }
  return result;
}

function isIndentLine(trimmed: string): boolean {
  const lower = trimmed.toLowerCase();

  // A single-word keyword followed by `:` is an associative-array key,
  // not a block opener. E.g. `for: value` inside an AA.
  if (/^\w+\s*:/.test(lower)) return false;

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

  // A single-word keyword followed by `:` is an associative-array key,
  // not a block closer. E.g. `next: { ... }` inside an AA.
  if (/^\w+\s*:/.test(lower)) return false;

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

/**
 * Counts the net indent change from sub-statements after the first `:` separator.
 * Handles braces, parens, brackets, and string literals to avoid false splits.
 */
function countInlineIndentChange(line: string): number {
  // Quick bail: no colon at all
  if (!line.includes(':')) return 0;

  // Split on `:` outside strings, braces, parens, and brackets
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inString && line[i + 1] === '"') { i++; current += '""'; continue; }
      inString = !inString;
    }
    if (inString) { current += ch; continue; }
    if (ch === "'") break; // rest is comment
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === ':' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  // Check sub-statements after the first one
  let change = 0;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    if (isDeindentLine(part)) change--;
    if (isIndentLine(part)) change++;
  }
  return change;
}

/**
 * Count the net anonymous function/sub openers on a line, subtracting
 * inline closers (end sub / end function). Only closers that appear AFTER
 * the first opener are counted — closers before the first opener are regular
 * block closers already handled by isDeindentLine.
 * Returns 0 for lines starting with function/sub (handled by isIndentLine)
 * or comments.
 */
function countNetAnonFunctionOpeners(trimmed: string): number {
  if (/^(?:function|sub)\b/i.test(trimmed)) return 0;
  if (trimmed.startsWith("'") || /^rem\b/i.test(trimmed)) return 0;

  const stripped = trimmed.replace(/"(?:[^"]|"")*"/g, '""').replace(/'.*$/, '');

  const openerRe = /\b(?:function|sub)\b(?:\s+\w+)?\s*\(/gi;
  let firstOpenerPos = -1;
  let openerCount = 0;
  let m;
  while ((m = openerRe.exec(stripped)) !== null) {
    if (firstOpenerPos < 0) firstOpenerPos = m.index;
    openerCount++;
  }
  if (openerCount === 0) return 0;

  // Only count closers after the first opener (inline closers for anonymous scopes).
  const afterFirstOpener = stripped.slice(firstOpenerPos);
  const closers = (afterFirstOpener.match(/\b(?:end\s+(?:function|sub)|endfunction|endsub)\b/gi) || []).length;
  return Math.max(0, openerCount - closers);
}

function isAnonFunctionOpener(t: string): boolean {
  if (!/\b(?:function|sub)\s*\(.*\)(?:\s+as\s+\w+)?\s*(?:'.*)?$/i.test(t)) return false;
  return countNetAnonFunctionOpeners(t) > 0;
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
interface Segment { text: string; isCode: boolean; }
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

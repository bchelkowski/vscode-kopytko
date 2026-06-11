import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoImportResolver, KopytkoImport } from '../kopytko/importResolver';
import { findMatchingGlob, matchesGlob } from '../brightscript/globMatcher';
import { parseFunctionDefs, parseInnerMethodDefs } from '../brightscript/functionIndex';
import fsWrapper from '../utils/fsWrapper';
import { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS } from '../brightscript/builtins';
import { findComponent } from '../brightscript/components';
import { escapeRegex, stripStringLiterals, getDocumentPath } from '../utils/textUtils';
import { findSiblingFiles } from '../brightscript/patternSiblings';
import { findTestSiblings } from '../brightscript/functionIndex';
import { getCachedLines, getCachedImports, getCachedKnownFuncNames } from '../utils/documentCache';
import { isTestFile } from '../kopytko/testFramework';

export interface GeneratedModuleConfig {
  path: string;
  functions: string[];
}

export class BrightScriptDiagnosticsProvider {
  constructor(
    private readonly importResolver: KopytkoImportResolver,
  ) {}

  provideDiagnostics(
    document: TextDocument,
    generatedPaths: string[] = [],
    generatedModules: GeneratedModuleConfig[] = [],
    siblingPatterns: string[][] = [],
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const fileLines = getCachedLines(document);
    const documentPath = getDocumentPath(document);

    const imports = getCachedImports(document, this.importResolver);
    const seenImportKeys = new Set<string>();

    for (const imp of imports) {
      const lineIndex = imp.line - 1;
      const lineText = fileLines[lineIndex] ?? '';
      const annotationType = imp.isMock ? '@mock' : '@import';

      // Duplicate import
      const importKey = `${imp.importPath}|${imp.fromModule ?? ''}`;
      if (seenImportKeys.has(importKey)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: lineRange(lineIndex),
          message: `Kopytko ${annotationType}: duplicate import "${imp.importPath}"${imp.fromModule ? ` from "${imp.fromModule}"` : ''}.`,
          source: 'kopytko',
          code: 'import/duplicate',
        });
        continue;
      }
      seenImportKeys.add(importKey);

      // Malformed import — missing path
      if (!imp.importPath || imp.importPath.trim() === '') {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: lineRange(lineIndex),
          message: `Kopytko ${annotationType}: missing import path.`,
          source: 'kopytko',
          code: 'import/missing-path',
        });
        continue;
      }

      // Import path should start with /
      if (!imp.importPath.startsWith('/')) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: lineRange(lineIndex),
          message: `Kopytko ${annotationType}: path "${imp.importPath}" should start with "/".`,
          source: 'kopytko',
          code: 'import/path-not-absolute',
        });
      }

      // Wrong comment style
      if (lineText.includes('"@import') || lineText.includes('"@mock')) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: lineRange(lineIndex),
          message: `Kopytko ${annotationType} must be written as a line comment starting with an apostrophe ('), not a double quote.`,
          source: 'kopytko',
          code: 'import/wrong-comment-style',
        });
      }

      // File resolution
      const resolved = this.importResolver.resolveImportPath(imp, documentPath);
      if (resolved !== undefined) {
        // Skip unused-import check for @mock — mocks are used via mockFunction(), not direct calls
        if (!imp.isMock) {
          const unusedDiag = checkUnusedImport(resolved, imp, lineIndex, fileLines, documentPath, siblingPatterns);
          if (unusedDiag) diagnostics.push(unusedDiag);
        }
        continue;
      }

      // Check whether the unresolved path is intentionally build-generated
      const matchedPattern = findMatchingGlob(imp.importPath, generatedPaths)
        ?? generatedModules.find((m) => matchesGlob(imp.importPath, m.path))?.path;
      if (matchedPattern) {
        diagnostics.push({
          severity: DiagnosticSeverity.Information,
          range: lineRange(lineIndex),
          message: `Kopytko ${annotationType}: "${imp.importPath}" is not on disk — it is expected to be generated during the build process (matches configured pattern "${matchedPattern}").`,
          source: 'kopytko',
          code: 'import/build-generated',
        });
        continue;
      }

      const label = imp.fromModule
        ? `"${imp.importPath}" from "${imp.fromModule}"`
        : `"${imp.importPath}"`;
      const message = imp.fromModule
        ? `Kopytko ${annotationType}: cannot resolve ${label}. Is "${imp.fromModule}" installed as an NPM dependency?`
        : `Kopytko ${annotationType}: cannot resolve ${label}. Check the file path and the sourceDir configuration.`;

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: lineRange(lineIndex),
        message,
        source: 'kopytko',
        code: 'import/unresolved',
      });
    }

    // ── Build shared function scope (used by both undefined-call and undefined-variable checks) ──
    const cachedKnownFuncNames = getCachedKnownFuncNames(document, documentPath, this.importResolver, siblingPatterns);

    // Extend known names with functions declared in matching generatedModules entries
    let knownFuncNames = cachedKnownFuncNames;
    if (generatedModules.length > 0) {
      const extra = new Set<string>();
      for (const imp of imports) {
        const mod = generatedModules.find((m) => matchesGlob(imp.importPath, m.path));
        if (mod) {
          for (const fn of mod.functions) {
            extra.add(fn.toLowerCase());
          }
        }
      }
      if (extra.size > 0) {
        knownFuncNames = new Set([...cachedKnownFuncNames, ...extra]);
      }
    }

    // ── Undefined function calls ─────────────────────────────────────────────
    // main.brs is the Roku application entry-point file — every function in it
    // runs with global scope and can call any compiled function without @imports.
    const isMainFile = /[/\\]main\.brs$/i.test(documentPath);
    if (!isMainFile) {
      try {
        diagnostics.push(...checkUndefinedCalls(fileLines, knownFuncNames));
      } catch {
        // Never let the undefined-function check crash the entire diagnostic run.
      }
    }

    // ── Undefined variable uses ──────────────────────────────────────────────
    try {
      diagnostics.push(...checkUndefinedVariables(fileLines, knownFuncNames));
    } catch {
      // Never let the undefined-variable check crash the entire diagnostic run.
    }

    // ── Shadowed built-in function names ──────────────────────────────────────
    try {
      diagnostics.push(...checkShadowedBuiltins(fileLines));
    } catch {
      // Never let this check crash the diagnostic run.
    }

    // ── throw statement validation ───────────────────────────────────────────
    try {
      diagnostics.push(...checkThrowStatements(fileLines));
    } catch {
      // Never let this check crash the diagnostic run.
    }

    // ── CreateObject argument validation ──────────────────────────────────────
    try {
      diagnostics.push(...checkCreateObjectArgs(fileLines));
    } catch {
      // Never let CreateObject checking crash the entire diagnostic run.
    }

    // ── Trailing comma syntax errors ──────────────────────────────────────────
    try {
      diagnostics.push(...checkTrailingCommaSyntaxErrors(fileLines));
    } catch {
      // Never let this check crash the diagnostic run.
    }

    // ── Loop flow control errors ──────────────────────────────────────────────
    try {
      diagnostics.push(...checkLoopFlowControl(fileLines));
    } catch {
      // Never let this check crash the diagnostic run.
    }

    // ── Unused function parameters ────────────────────────────────────────────
    try {
      diagnostics.push(...checkUnusedParameters(fileLines));
    } catch {
      // Never let this check crash the diagnostic run.
    }

    // ── Test file structure warnings ──────────────────────────────────────────
    if (isTestFile(document.uri)) {
      try {
        diagnostics.push(...checkTestFileStructure(fileLines, imports, this.importResolver, documentPath));
      } catch {
        // Never let this check crash the diagnostic run.
      }
    }

    return diagnostics;
  }
}

// ---------------------------------------------------------------------------
// Undefined function call checker
// ---------------------------------------------------------------------------

/** Matches a bare identifier immediately followed by `(`, not preceded by `.` or a word char. */
const CALL_RE = /(?<![.\w])([a-zA-Z_]\w*)\s*\(/g;
/** Matches a function/sub declaration line. */
const DECL_RE = /^\s*(?:function|sub)\s+\w+\s*\(/i;

/** Built once at module load; never changes at runtime. */
const _builtinNames = new Set(BRIGHTSCRIPT_BUILTINS.map((b) => b.name.toLowerCase()));
const _keywordNames = new Set(BRIGHTSCRIPT_KEYWORDS.map((k) => k.toLowerCase()));

/** Maps lowercased builtin name → { min, max } expected argument counts. */
const _builtinArity: Map<string, { min: number; max: number }> = (() => {
  const map = new Map<string, { min: number; max: number }>();
  for (const b of BRIGHTSCRIPT_BUILTINS) {
    const m = /\(([^)]*)\)/.exec(b.signature);
    if (!m) { map.set(b.name.toLowerCase(), { min: 0, max: 0 }); continue; }
    const paramsStr = m[1].trim();
    if (!paramsStr) { map.set(b.name.toLowerCase(), { min: 0, max: 0 }); continue; }
    const params = paramsStr.split(',').map((p) => p.trim());
    const hasRest = params.some((p) => p.startsWith('...'));
    let min = 0;
    for (const p of params) {
      if (!p.startsWith('...') && !/=/.test(p)) min++;
    }
    map.set(b.name.toLowerCase(), { min, max: hasRest ? Infinity : params.length });
  }
  return map;
})();

/**
 * Counts the number of top-level arguments in a function call starting with
 * `(` at `openParenPos` in `stripped` (a line with string contents replaced by
 * spaces). Handles nested parens, brackets, and braces. Returns null when the
 * matching `)` cannot be found on the same line.
 */
function countCallArgs(stripped: string, openParenPos: number): number | null {
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
  return null; // no matching close paren on this line
}

/**
 * Roku entry-point function names (case-insensitive). All of these are called
 * directly by the Roku firmware and have access to every globally compiled
 * BrightScript function — no `@import` is needed inside them.
 */
const ENTRY_POINT_NAMES = new Set(['main', 'runuserinterface', 'runscreensaver']);

/**
 * Returns a boolean array where `result[i]` is true when line `i` is inside
 * the body of a Roku entry-point function (`Main`, `RunUserInterface`, or
 * `RunScreenSaver` — all case-insensitive). Anonymous callbacks and nested
 * named functions declared inside the entry point are also covered.
 *
 * Uses a plain depth counter — no scope objects, no regex caching. Works even
 * when `buildFunctionScopes` fails to detect the entry point for any reason.
 */
function computeMainBodyLines(lines: string[]): boolean[] {
  const result = new Array<boolean>(lines.length).fill(false);
  let inEntryPoint = false;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || /^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;
    // Strip string literals and inline comments so neither can false-trigger regexes
    const s = stripStringLiterals(raw, true);

    if (!inEntryPoint) {
      // Look for a Roku entry-point declaration: `function Main(`, `sub RunUserInterface(`, etc.
      const m = /^\s*(?:function|sub)\s+([a-zA-Z_]\w*)\s*\(/i.exec(s);
      if (m && ENTRY_POINT_NAMES.has(m[1].toLowerCase())) {
        inEntryPoint = true;
        depth = 1;
        // The declaration line itself is NOT marked — DECL_RE already skips it
      }
    } else {
      // Mark every line inside the entry point (including nested anonymous functions)
      result[i] = true;

      if (/^\s*(?:end\s*(?:function|sub)|endfunction|endsub)\b/i.test(s)) {
        depth--;
        if (depth === 0) inEntryPoint = false;
      } else {
        // Count any function/sub opener to track nesting depth
        if (/^\s*(?:function|sub)\b/i.test(s) || /\b(?:function|sub)\s*\(/i.test(s)) {
          depth++;
        }
      }
    }
  }

  return result;
}

function checkUndefinedCalls(
  lines: string[],
  knownFuncNames: Set<string>,
): Diagnostic[] {
  const localNames = collectLocalNames(lines);
  // Pre-compute which lines are inside a Roku entry-point function body
  // (Main, RunUserInterface, RunScreenSaver). These entry points can call any
  // globally compiled function without @imports.
  const inMainBody = computeMainBodyLines(lines);

  const diagnostics: Diagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];

    // Skip comment lines (apostrophe-style or REM)
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;
    // Skip conditional compilation directives — variables there are bs_const from manifest
    if (/^\s*#/i.test(raw)) continue;
    // Skip function/sub declaration lines (the name there is a definition, not a call)
    if (DECL_RE.test(raw)) continue;
    // Skip dim statements — `dim arr(10)` looks like a call but is an array declaration
    if (/^\s*dim\b/i.test(raw)) continue;
    // Skip throw statements — `throw (expr)` uses parens for visual grouping, not a function call
    if (/^\s*throw\b/i.test(raw)) continue;
    // Skip lines inside Roku entry points — they can call any project function without @imports
    if (inMainBody[lineIdx]) continue;

    const stripped = stripStringLiterals(raw, true);

    CALL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CALL_RE.exec(stripped)) !== null) {
      const name = match[1];
      const nameLower = name.toLowerCase();

      if (_keywordNames.has(nameLower)) continue;

      if (_builtinNames.has(nameLower)) {
        const arity = _builtinArity.get(nameLower);
        if (arity) {
          const openParenPos = match.index + match[0].length - 1;
          const argCount = countCallArgs(stripped, openParenPos);
          if (argCount !== null && (argCount < arity.min || argCount > arity.max)) {
            const expected = arity.min === arity.max
              ? `${arity.min} argument${arity.min !== 1 ? 's' : ''}`
              : `${arity.min}–${arity.max} arguments`;
            const got = `${argCount} ${argCount !== 1 ? 'were' : 'was'}`;
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: lineIdx, character: match.index },
                end: { line: lineIdx, character: match.index + name.length },
              },
              message: `'${name}' expects ${expected} but ${got} provided.`,
              source: 'kopytko',
              code: 'identifier/wrong-arg-count',
            });
          }
        }
        continue;
      }

      if (knownFuncNames.has(nameLower)) continue;
      if (localNames.has(nameLower)) continue;

      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: lineIdx, character: match.index },
          end: { line: lineIdx, character: match.index + name.length },
        },
        message: `Unknown function '${name}'. It is not defined in this file or any reachable @import.`,
        source: 'kopytko',
        code: 'identifier/undefined-function',
      });
    }
  }

  return diagnostics;
}

/**
 * Scans the document lines and returns a set of all local variable names —
 * identifiers that are definitely variables, not named functions.  These are
 * excluded from the undefined-call check so that patterns like
 *
 *   handler = m._handlers[state]
 *   handler()          ← valid: handler holds a function reference
 *
 * do not produce false positives.
 *
 * Three sources are collected:
 *   1. Assignment targets   — `varName = …`, `varName += …`, `m.varName = …`
 *   2. For-loop variables   — `for i = …`, `for each item in …`
 *   3. Function parameters  — `param as Type` / `param = default as Type`
 *      extracted from declaration lines
 */
function collectLocalNames(lines: string[]): Set<string> {
  const names = new Set<string>();

  // Matches simple and compound assignments at the start of a statement.
  // Strips an optional `m.` prefix so object-field assignments are captured.
  // Does NOT match keyword-led lines (if/while/for/…) because they are excluded
  // via the _keywordNames check below.
  // The [&%!#$]? allows BrightScript type-declaration characters (e.g. nowTimestamp&).
  const ASSIGN_RE = /^\s*(?:m\.)?([a-zA-Z_]\w*)[&%!#$]?(?:\s*\[[^\]]*\])?\s*(?:\+|-|\*|\/|\\|<<|>>)?=/;

  // Matches for-loop iteration variables: `for i = …` and `for each item in …`
  const FOR_RE = /^\s*for\s+(?:each\s+)?([a-zA-Z_]\w*)\b/i;

  // Matches typed parameters in function/sub signatures: `name as Type`
  // and `name = defaultValue as Type`
  const PARAM_RE = /\b([a-zA-Z_]\w*)(?:\s*=[^,)]*?)?\s+as\s+[a-zA-Z_]\w*/gi;

  // Matches catch variable: `catch e` or `catch (e)`
  const CATCH_VAR_RE = /^\s*catch\s+\(?([a-zA-Z_]\w*)\)?/i;

  for (const line of lines) {
    // 1. Assignment targets
    const assignMatch = ASSIGN_RE.exec(line);
    if (assignMatch) {
      const n = assignMatch[1].toLowerCase();
      if (!_keywordNames.has(n)) names.add(n);
    }

    // 2. For-loop variables
    const forMatch = FOR_RE.exec(line);
    if (forMatch) names.add(forMatch[1].toLowerCase());

    // 3. Parameters on function/sub declaration lines
    if (DECL_RE.test(line)) {
      PARAM_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PARAM_RE.exec(line)) !== null) {
        names.add(m[1].toLowerCase());
      }
    }

    // 4. catch variable — `catch e` or `catch (e)` — scoped to the catch block
    const catchMatch = CATCH_VAR_RE.exec(line);
    if (catchMatch) names.add(catchMatch[1].toLowerCase());
  }

  return names;
}

/**
 * Checks whether any function exported by the resolved import file is referenced
 * in the current document. Returns a diagnostic when the import appears unused.
 */
function checkUnusedImport(
  resolvedPath: string,
  imp: KopytkoImport,
  lineIndex: number,
  fileLines: string[],
  documentPath: string,
  siblingPatterns: string[][],
): Diagnostic | null {
  let importedText: string;
  try {
    importedText = fsWrapper.readFileSync(resolvedPath, 'utf-8');
  } catch {
    return null;
  }

  const fns = parseFunctionDefs(importedText, resolvedPath);
  if (fns.length === 0) return null;

  const linesToCorpus = (lines: string[], skipIndex = -1): string =>
    lines
      .filter((_, i) => i !== skipIndex)
      .map((line) => {
        if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) return '';
        return stripStringLiterals(line, true);
      })
      .join('\n');

  // Build corpus from the current file (excluding the import annotation line)
  const corpora = [linesToCorpus(fileLines, lineIndex)];

  // Extend with sibling files that are always loaded alongside this file
  for (const siblingPath of findSiblingFiles(documentPath, siblingPatterns)) {
    try {
      const siblingText = fsWrapper.readFileSync(siblingPath, 'utf-8');
      corpora.push(linesToCorpus(siblingText.split(/\r?\n/)));
    } catch {
      // unreadable sibling — skip silently
    }
  }

  // For test files: also check sibling test files (Foo.test.brs ↔ Foo_Bar.test.brs share scope)
  if (isTestFile(documentPath)) {
    for (const siblingTest of findTestSiblings(documentPath)) {
      try {
        const sibText = fsWrapper.readFileSync(siblingTest, 'utf-8');
        corpora.push(linesToCorpus(sibText.split(/\r?\n/)));
      } catch { /* skip */ }
    }
  }

  const corpus = corpora.join('\n');
  const anyUsed = fns.some(
    (fn) => new RegExp(`\\b${escapeRegex(fn.name)}\\b`, 'i').test(corpus),
  );
  if (anyUsed) return null;

  return {
    severity: DiagnosticSeverity.Warning,
    range: lineRange(lineIndex),
    message: `Kopytko @import: "${imp.importPath}" is imported but none of its exported functions are referenced in this file.`,
    source: 'kopytko',
    code: 'import/unused',
  };
}

function lineRange(lineIndex: number): Range {
  return {
    start: { line: lineIndex, character: 0 },
    end: { line: lineIndex, character: Number.MAX_SAFE_INTEGER },
  };
}

// ---------------------------------------------------------------------------
// Undefined variable checker
// ---------------------------------------------------------------------------

/** Matches all identifiers not preceded by `.` or a word char.
 *  Post-processing filters out calls `(`, AA keys `:`, and object prefixes `.`. */
const EXPR_IDENT_RE = /(?<![.\w])([a-zA-Z_]\w*)/g;

/** Identifiers always valid in any BrightScript scope — not keywords but globally accessible. */
const _alwaysValidVarIdents = new Set(['m']);

function checkUndefinedVariables(
  lines: string[],
  knownFuncNames: Set<string>,
): Diagnostic[] {
  // Build isolated scopes — each function/sub (named or anonymous) has its own scope.
  // Outer variables are NOT accessible in inner functions (BrightScript has no closures).
  const scopes = buildFunctionScopes(lines);

  const diagnostics: Diagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (!raw) continue;
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;
    // Skip conditional compilation directives — variables there are bs_const from manifest
    if (/^\s*#/i.test(raw)) continue;
    if (DECL_RE.test(raw)) continue;
    if (/^\s*dim\b/i.test(raw)) continue;

    // Find the innermost function scope enclosing this line.
    // If outside any function (file-level code), skip — nothing useful to check.
    const scope = findScopeAtLine(scopes, lineIdx);
    if (!scope) continue;

    const scopeVars = new Set([...scope.params, ...scope.vars]);
    const stripped = stripStringLiterals(raw, true);

    // If this line is an assignment statement, the lvalue identifier is being DECLARED
    // (not used), so skip it — assigning to a variable never requires it to pre-exist.
    const LVALUE_RE = /^\s*(?:m\.)?([a-zA-Z_]\w*)[&%!#$]?(?:\s*\[[^\]]*\])?\s*(?:\+|-|\*|\/|\\|<<|>>)?=/;
    const lvalueMatch = LVALUE_RE.exec(stripped);
    const lvalue = lvalueMatch ? lvalueMatch[1].toLowerCase() : null;

    EXPR_IDENT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EXPR_IDENT_RE.exec(stripped)) !== null) {
      const name = match[1];
      const nameLower = name.toLowerCase();

      // Skip calls `name(`, AA keys `name:`, and object prefixes `name.`
      const after = stripped.slice(match.index + name.length).trimStart();
      if (after.startsWith('(') || after.startsWith(':') || after.startsWith('.')) continue;

      if (_keywordNames.has(nameLower)) continue;
      if (_builtinNames.has(nameLower)) continue;
      if (_alwaysValidVarIdents.has(nameLower)) continue;
      if (knownFuncNames.has(nameLower)) continue;
      if (lvalue !== null && nameLower === lvalue) continue; // lvalue — being assigned
      if (scopeVars.has(nameLower)) continue;

      // On scope-boundary lines, part of the code belongs to the outer scope:
      //   start line:  setState({ a: a }, sub ()   → `a` before `sub` is outer-scope
      //   end line:    end function, Invalid, { a: a })  → `a` after `end function` is outer-scope
      // When an identifier is not found in the inner scope, check the parent
      // scope for identifiers in the appropriate position.
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
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: lineIdx, character: match.index },
          end: { line: lineIdx, character: match.index + name.length },
        },
        message: `'${name}' is used but never defined in this scope.`,
        source: 'kopytko',
        code: 'identifier/undefined-variable',
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Shadowed built-in name checker
// ---------------------------------------------------------------------------

/**
 * Flags variables, parameters, and loop iterators whose names shadow a
 * BrightScript built-in global function (e.g. `str`, `len`, `val`).
 * Using such names is legal but hides the built-in, which is almost
 * always a mistake.
 */
function checkShadowedBuiltins(lines: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

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
          const lower = paramName.toLowerCase();
          if (_builtinNames.has(lower)) {
            const col = stripped.indexOf(paramName, paramsStart);
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: i, character: col >= 0 ? col : 0 },
                end: { line: i, character: (col >= 0 ? col : 0) + paramName.length },
              },
              message: `'${paramName}' shadows the built-in global function '${paramName}'. Use a different name to avoid hiding the built-in.`,
              source: 'kopytko',
              code: 'identifier/shadows-builtin',
            });
          }
        }
      }
    }

    // Check variable assignments
    const assignMatch = ASSIGN_RE.exec(stripped);
    if (assignMatch) {
      const varName = assignMatch[1];
      const lower = varName.toLowerCase();
      if (_builtinNames.has(lower)) {
        const col = stripped.indexOf(varName);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: col >= 0 ? col : 0 },
            end: { line: i, character: (col >= 0 ? col : 0) + varName.length },
          },
          message: `'${varName}' shadows the built-in global function '${varName}'. Use a different name to avoid hiding the built-in.`,
          source: 'kopytko',
          code: 'identifier/shadows-builtin',
        });
      }
    }

    // Check for-loop variables
    const forMatch = FOR_RE.exec(stripped);
    if (forMatch) {
      const varName = forMatch[1];
      const lower = varName.toLowerCase();
      if (_builtinNames.has(lower)) {
        const col = stripped.indexOf(varName, forMatch.index);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: col >= 0 ? col : 0 },
            end: { line: i, character: (col >= 0 ? col : 0) + varName.length },
          },
          message: `'${varName}' shadows the built-in global function '${varName}'. Use a different name to avoid hiding the built-in.`,
          source: 'kopytko',
          code: 'identifier/shadows-builtin',
        });
      }
    }

    // Check dim declarations
    const dimMatch = DIM_RE.exec(stripped);
    if (dimMatch) {
      const varName = dimMatch[1];
      const lower = varName.toLowerCase();
      if (_builtinNames.has(lower)) {
        const col = stripped.indexOf(varName, dimMatch.index);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: col >= 0 ? col : 0 },
            end: { line: i, character: (col >= 0 ? col : 0) + varName.length },
          },
          message: `'${varName}' shadows the built-in global function '${varName}'. Use a different name to avoid hiding the built-in.`,
          source: 'kopytko',
          code: 'identifier/shadows-builtin',
        });
      }
    }

    // Check catch variables
    const catchMatch = CATCH_RE.exec(stripped);
    if (catchMatch) {
      const varName = catchMatch[1];
      const lower = varName.toLowerCase();
      if (_builtinNames.has(lower)) {
        const col = stripped.indexOf(varName, catchMatch.index);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: col >= 0 ? col : 0 },
            end: { line: i, character: (col >= 0 ? col : 0) + varName.length },
          },
          message: `'${varName}' shadows the built-in global function '${varName}'. Use a different name to avoid hiding the built-in.`,
          source: 'kopytko',
          code: 'identifier/shadows-builtin',
        });
      }
    }
  }

  return diagnostics;
}

/**
 * A single function/sub scope (named declaration or anonymous expression).
 * Only direct declarations are stored here — nested function scopes are NOT included,
 * mirroring BrightScript's lack of closure/lexical scoping.
 */
interface FunctionScope {
  startLine: number;   // line of the function/sub header
  endLine: number;     // line of end function/sub (defaults to last line for unclosed)
  startColumn: number; // column where the function/sub keyword starts on startLine
  name: string;        // lowercased function/sub name; empty string for anonymous expressions
  params: Set<string>; // parameter names declared in the header
  vars: Set<string>;   // variables assigned/declared directly in this scope body
}

/**
 * Matches anonymous function/sub expressions anywhere on a line: `function(` or `sub(`.
 * Used only when the named declaration regex does not match (to avoid double-counting).
 */
const ANON_FUNC_SCOPE_RE = /\b(?:function|sub)\s*\(/i;

/** Matches end of a function/sub scope. */
const FUNC_END_SCOPE_RE = /^\s*(?:end\s*(?:function|sub)|endfunction|endsub)\b/i;

/** Extracts the params string from a function/sub declaration (named or anonymous). */
const PARAM_LIST_RE = /\b(?:function|sub)\b\s*(?:[a-zA-Z_]\w*\s*)?\(([^)]*)\)/i;

/**
 * Builds an isolated scope for every function/sub declaration in the file.
 * Scopes are NOT hierarchical — outer variables are not inherited by inner scopes,
 * which matches BrightScript's semantics (no closures, each function call frame
 * has its own local variables).
 */
function buildFunctionScopes(lines: string[]): FunctionScope[] {
  const allScopes: FunctionScope[] = [];
  const stack: FunctionScope[] = [];

  const ASSIGN_RE_SCOPE = /^\s*(?:m\.)?([a-zA-Z_]\w*)[&%!#$]?(?:\s*\[[^\]]*\])?\s*(?:\+|-|\*|\/|\\|<<|>>)?=/;
  const FOR_RE_SCOPE = /^\s*for\s+(?:each\s+)?([a-zA-Z_]\w*)\b/i;
  const DIM_RE_SCOPE = /^\s*dim\s+([a-zA-Z_]\w*)\s*\(/i;
  const CATCH_RE_SCOPE = /^\s*catch\s+\(?([a-zA-Z_]\w*)\)?/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) continue;

    // End of scope — pop before processing the line's content.
    // Do NOT continue — the same line may also open a new scope
    // (e.g. `end function, function (b as String) as Void`).
    if (FUNC_END_SCOPE_RE.test(line)) {
      if (stack.length > 0) {
        stack[stack.length - 1].endLine = i;
        stack.pop();
      }
    }

    // Collect direct variable definitions for the CURRENT (innermost) scope.
    // This must happen BEFORE potentially pushing a new inner scope below,
    // so that `callback = function()` adds `callback` to the OUTER scope.
    const current = stack.length > 0 ? stack[stack.length - 1] : null;
    if (current) {
      const assignMatch = ASSIGN_RE_SCOPE.exec(line);
      if (assignMatch) {
        const n = assignMatch[1].toLowerCase();
        if (!_keywordNames.has(n)) current.vars.add(n);
      }

      const forMatch = FOR_RE_SCOPE.exec(line);
      if (forMatch) current.vars.add(forMatch[1].toLowerCase());

      const dimMatch = DIM_RE_SCOPE.exec(line);
      if (dimMatch) current.vars.add(dimMatch[1].toLowerCase());

      const catchMatch = CATCH_RE_SCOPE.exec(line);
      if (catchMatch) current.vars.add(catchMatch[1].toLowerCase());
    }

    // Detect whether this line opens a new function scope.
    // Strip strings AND comments so `' calls function(x)` doesn't false-match ANON_FUNC_SCOPE_RE.
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
            if (!_keywordNames.has(p)) params.add(p);
          }
        }
      }
      // Record where the function/sub keyword starts on this line so that
      // identifiers appearing before the keyword can be attributed to the
      // outer scope (they are evaluated before the inner scope exists).
      const kwMatch = /\b(?:function|sub)\s*(?:\(|[a-zA-Z_])/i.exec(strippedForScope);
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
  }

  return allScopes;
}

/**
 * Returns the innermost function scope that contains `lineIdx`, or null when
 * the line is outside all function scopes (file-level code).
 *
 * The range is `startLine <= lineIdx <= endLine` so that the declaration line
 * itself (e.g. `m.handler = function(event as Object)`) falls inside the new
 * scope and parameter names on that line are considered in-scope.
 * Named function declarations are handled separately — they are skipped by
 * `DECL_RE` in `checkUndefinedVariables` before the scope lookup matters.
 */
function findScopeAtLine(scopes: FunctionScope[], lineIdx: number): FunctionScope | null {
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

/**
 * Returns the second-innermost (parent) scope enclosing `lineIdx`, excluding
 * the given `innermost` scope.  Used on scope-boundary lines where part of
 * the code belongs to the enclosing scope rather than the inner one.
 */
function findParentScopeAtLine(
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

// ---------------------------------------------------------------------------
// throw statement validation
// ---------------------------------------------------------------------------

/**
 * Validates throw statements. BrightScript allows throwing only strings or
 * associative arrays. When an AA is thrown it must have a `message` field.
 * `throw (expr)` with outer parens is valid — they are visual grouping only.
 */
function checkThrowStatements(lines: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    // Match: throw <expression> [trailing comment]
    const throwMatch = /^\s*throw\b\s+(.+?)(?:\s*'.*)?$/i.exec(raw);
    if (!throwMatch) continue;

    let expr = throwMatch[1].trim();

    // Strip a single level of outer parentheses — `throw (expr)` is valid visual grouping
    if (expr.startsWith('(') && expr.endsWith(')')) {
      let depth = 0;
      let isOuterWrapped = true;
      for (let i = 0; i < expr.length - 1; i++) {
        if (expr[i] === '(') depth++;
        else if (expr[i] === ')') {
          depth--;
          if (depth === 0) { isOuterWrapped = false; break; }
        }
      }
      if (isOuterWrapped) expr = expr.slice(1, -1).trim();
    }

    const throwKeywordStart = raw.search(/\bthrow\b/i);
    const throwRange = {
      start: { line: lineIdx, character: throwKeywordStart },
      end: { line: lineIdx, character: throwKeywordStart + 5 },
    };

    // Numeric literal → invalid
    if (/^-?[\d.]/.test(expr)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: throwRange,
        message: '`throw` requires a string or an associative array with a "message" field — numeric literals are not valid throw values.',
        source: 'kopytko',
        code: 'throw/invalid-value',
      });
      continue;
    }

    // Array literal → invalid
    if (expr.startsWith('[')) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: throwRange,
        message: '`throw` requires a string or an associative array with a "message" field — array literals are not valid throw values.',
        source: 'kopytko',
        code: 'throw/invalid-value',
      });
      continue;
    }

    // `invalid` keyword → invalid
    if (/^invalid$/i.test(expr)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: throwRange,
        message: '`throw` requires a string or an associative array with a "message" field — `invalid` is not a valid throw value.',
        source: 'kopytko',
        code: 'throw/invalid-value',
      });
      continue;
    }

    // AA literal on a single line — must contain a `message` field
    if (expr.startsWith('{') && expr.endsWith('}')) {
      if (!/\bmessage\s*:/i.test(expr)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: throwRange,
          message: 'Thrown associative array should include a "message" field (e.g. `{ message: "error description", number: -1 }`).',
          source: 'kopytko',
          code: 'throw/missing-message',
        });
      }
    }

    // String literals, identifiers, and other expressions are valid — no diagnostic.
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// CreateObject argument validation
// ---------------------------------------------------------------------------

/** Matches `CreateObject("componentName"` capturing the string literal and its position. */
const CREATE_OBJECT_ARG_RE = /\bCreateObject\s*\(\s*"([^"]*)"/gi;

/**
 * Checks that the first string argument of every `CreateObject(...)` call
 * is a valid BrightScript component name from the catalog.
 */
function checkCreateObjectArgs(lines: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    CREATE_OBJECT_ARG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CREATE_OBJECT_ARG_RE.exec(raw)) !== null) {
      const componentName = match[1];
      if (!componentName) continue;

      // Skip roSGNode — the second arg is a custom component name, not validatable
      if (componentName.toLowerCase() === 'rosgnode') continue;

      if (!findComponent(componentName)) {
        // Find the position of the string literal (after the opening quote)
        const argStart = raw.indexOf(`"${componentName}"`, match.index);
        if (argStart < 0) continue;
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: lineIdx, character: argStart },
            end: { line: lineIdx, character: argStart + componentName.length + 2 },
          },
          message: `Unknown BrightScript component "${componentName}". Check the component name spelling.`,
          source: 'kopytko',
          code: 'createobject/unknown-component',
        });
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Trailing comma syntax error checker
// ---------------------------------------------------------------------------

/**
 * Flags trailing commas on return statements — these cause BrightScript
 * compilation errors (comma is not valid after a return expression).
 */
function checkTrailingCommaSyntaxErrors(lines: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    // Check for `return <expr>,` — trailing comma after return value
    const returnCommaMatch = /^\s*return\b\s+.+,\s*$/.exec(raw);
    if (returnCommaMatch) {
      const commaPos = raw.lastIndexOf(',');
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: lineIdx, character: commaPos },
          end: { line: lineIdx, character: commaPos + 1 },
        },
        message: 'Trailing comma after return value is a syntax error — the code will not compile.',
        source: 'kopytko',
        code: 'syntax/trailing-comma',
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Loop flow control checker
// ---------------------------------------------------------------------------

/**
 * Flags `continue while` / `exit while` outside a `while` loop body,
 * and `continue for` / `exit for` outside a `for` loop body.
 */
function checkLoopFlowControl(lines: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Stack tracks nesting: 'for' | 'while' | 'other' (function/if/try blocks)
  const stack: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;
    const trimmed = raw.replace(/'.*$/, '').trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();

    // Track block openers
    if (/^for\b/i.test(lower)) {
      stack.push('for');
    } else if (/^while\b/i.test(lower)) {
      stack.push('while');
    } else if (/^(?:sub|function)\b/i.test(lower) && /\(/i.test(lower)) {
      stack.push('other');
    } else if (/^(?:if)\b/i.test(lower) && /\bthen\s*$/i.test(lower)) {
      stack.push('other');
    } else if (/^(?:try)\b/i.test(lower)) {
      stack.push('other');
    }

    // Track block closers
    if (/^end\s*for\b/i.test(lower) || /^endfor\b/i.test(lower) || /^next\b/i.test(lower)) {
      popUntil(stack, 'for');
    } else if (/^end\s*while\b/i.test(lower) || /^endwhile\b/i.test(lower)) {
      popUntil(stack, 'while');
    } else if (/^end\s*(?:sub|function|if|try)\b/i.test(lower) || /^end(?:sub|function|if|try)\b/i.test(lower)) {
      popUntil(stack, 'other');
    }

    // Check flow control statements
    const flowMatch = /^(continue|exit)\s+(for|while)\b/i.exec(lower);
    if (flowMatch) {
      const keyword = flowMatch[1].toLowerCase();
      const loopType = flowMatch[2].toLowerCase();
      const insideCorrectLoop = stack.includes(loopType);
      if (!insideCorrectLoop) {
        const col = raw.search(/\S/);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: i, character: col },
            end: { line: i, character: col + trimmed.length },
          },
          message: `\`${keyword} ${loopType}\` is only valid inside a \`${loopType}\` loop body.`,
          source: 'kopytko',
          code: 'syntax/flow-outside-loop',
        });
      }
    }
  }

  return diagnostics;
}

/** Pop the stack until we remove the topmost entry matching `target`. */
function popUntil(stack: string[], target: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] === target) {
      stack.splice(i, 1);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Unused parameter checker
// ---------------------------------------------------------------------------

const FUNC_DECL_RE = /^\s*(?:function|sub)\s+\w+\s*\(([^)]*)\)/i;
const ANON_FUNC_RE = /(?:function|sub)\s*\(([^)]*)\)/i;

/**
 * Warns when a function/sub parameter is never referenced in the function body.
 * Parameters prefixed with `_` are considered intentionally unused and are skipped.
 */
function checkUnusedParameters(lines: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*'/.test(line) || /^\s*rem\b/i.test(line)) continue;

    const funcMatch = FUNC_DECL_RE.exec(line) || ANON_FUNC_RE.exec(line);
    if (!funcMatch || !funcMatch[1].trim()) continue;

    // Parse parameter names
    const params: { name: string; col: number }[] = [];
    for (const param of funcMatch[1].split(',')) {
      const nameMatch = /^\s*(\w+)/.exec(param.trim());
      if (!nameMatch) continue;
      const name = nameMatch[1];
      // Skip _-prefixed params (intentionally unused)
      if (name.startsWith('_')) continue;
      const col = line.indexOf(name, funcMatch.index);
      params.push({ name, col: col >= 0 ? col : 0 });
    }

    if (params.length === 0) continue;

    // Collect function body lines until matching end function/sub or next top-level function
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
          severity: DiagnosticSeverity.Hint,
          range: {
            start: { line: i, character: param.col },
            end: { line: i, character: param.col + param.name.length },
          },
          message: `Parameter "${param.name}" is never used. Prefix with \`_\` to indicate it is intentionally unused.`,
          source: 'kopytko',
          code: 'identifier/unused-parameter',
        });
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Test file structure checks
// ---------------------------------------------------------------------------

/**
 * Checks test file structure:
 *  - TestSuite__ function (if present) must end with `return ts`
 *  - mockFunction("X") calls must reference functions defined in @mock'ed files
 */
function checkTestFileStructure(
  lines: string[],
  imports: KopytkoImport[],
  importResolver: KopytkoImportResolver,
  documentPath: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let hasTestSuiteFunc = false;
  let testSuiteFuncLine = -1;
  let lastReturnTsLine = -1;

  // Build set of known mocked function/method names from resolved @mock files
  const mockedIdentifiers = new Set<string>();
  for (const imp of imports) {
    if (!imp.isMock) continue;
    const resolved = importResolver.resolveImportPath(imp, documentPath);
    if (!resolved) continue;
    try {
      const text = fsWrapper.readFileSync(resolved, 'utf-8');
      // Add top-level function names (e.g. "MyService", "getData")
      for (const fn of parseFunctionDefs(text, resolved)) {
        mockedIdentifiers.add(fn.nameLower);
      }
      // Add inner method names (e.g. "MyService.getData" → "myservice")
      for (const method of parseInnerMethodDefs(text, resolved)) {
        mockedIdentifiers.add(method.nameLower);
      }
    } catch { /* skip unreadable */ }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*function\s+TestSuite__\w+/i.test(line)) {
      hasTestSuiteFunc = true;
      testSuiteFuncLine = i;
    }

    if (/^\s*return\s+ts\s*$/i.test(line)) {
      lastReturnTsLine = i;
    }

    // Check mockFunction("X") — X should reference a function from a @mock'ed file
    if (mockedIdentifiers.size > 0) {
      const mockFuncRe = /mockFunction\s*\(\s*"([^"]+)"/g;
      let mfMatch: RegExpExecArray | null;
      while ((mfMatch = mockFuncRe.exec(line)) !== null) {
        const mockTarget = mfMatch[1];
        // "Module.method" → check "module", "Module" → check "module"
        const topLevel = mockTarget.includes('.') ? mockTarget.split('.')[0] : mockTarget;
        if (!mockedIdentifiers.has(topLevel.toLowerCase())) {
          const col = line.indexOf(mfMatch[0]);
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: i, character: col },
              end: { line: i, character: col + mfMatch[0].length + 1 },
            },
            message: `"${topLevel}" is not defined in any \`@mock\`'ed file. Add a \`' @mock\` annotation for the file that defines "${topLevel}".`,
            source: 'kopytko',
            code: 'test/missing-mock-annotation',
          });
        }
      }
    }
  }

  if (hasTestSuiteFunc && lastReturnTsLine < 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: lineRange(testSuiteFuncLine),
      message: 'Test suite function should end with `return ts` to return the suite object to the test runner.',
      source: 'kopytko',
      code: 'test/missing-return-ts',
    });
  }

  return diagnostics;
}

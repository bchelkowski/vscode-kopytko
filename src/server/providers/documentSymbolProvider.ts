import { DocumentSymbol, SymbolKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { parseFunctionDefs } from '../brightscript/functionIndex';
import { isTestFile } from '../kopytko/testFramework';

// Matches: <obj>.<method> = function|sub (<params>) [as <type>]
// Captures: (1) object name, (2) method name, (3) keyword, (4) param list with parens, (5) return type
const INNER_DOT_RE = /^\s*(\w+)\.(\w+)\s*=\s*(function|sub)\s*(\([^)]*\))(?:\s+as\s+(\w+))?/i;

// Matches: <name>: function|sub (<params>) [as <type>]  (inline AA literal pattern)
// Captures: (1) method name, (2) keyword, (3) param list with parens, (4) return type
const INNER_COLON_RE = /^\s*(\w+)\s*:\s*(function|sub)\s*(\([^)]*\))(?:\s+as\s+(\w+))?/i;

/**
 * Provides document symbols for BrightScript files.
 *
 * Top-level `function` and `sub` declarations become symbols of kind `Function`.
 * When a function body assigns anonymous functions to associative array properties
 * (the standard BrightScript "class" pattern, e.g. `this.init = function(...)`),
 * those assignments are nested as children with kind `Method`.
 *
 * Symbol ranges:
 *   - `range`          — from the declaration line to just before the next
 *                        top-level symbol (or EOF for top-level), or to the
 *                        matching `end function`/`end sub` (for methods).
 *                        VS Code uses this to track the active symbol as the
 *                        cursor moves.
 *   - `selectionRange` — the name token only, used for outline navigation.
 *
 * The `detail` field holds the parameter list and optional return type extracted
 * from the declaration (e.g. `(x as Integer) as String`).
 */
export class BrightScriptDocumentSymbolProvider {
  provideDocumentSymbols(document: TextDocument): DocumentSymbol[] {
    const text = document.getText();
    const filePath = URI.parse(document.uri).fsPath;
    const defs = parseFunctionDefs(text, filePath);
    if (defs.length === 0) return [];

    const lines = text.split(/\r?\n/);
    const lastLine = lines.length - 1;

    // Build top-level symbols
    const symbols: DocumentSymbol[] = defs.map((def, idx) => {
      const nextFuncLine = defs[idx + 1]?.line ?? (lastLine + 1);
      const rangeEndLine = nextFuncLine - 1;
      const rangeEndChar = lines[rangeEndLine]?.length ?? 0;
      return {
        name: def.name,
        kind: SymbolKind.Function,
        detail: extractSignatureDetail(def.signature),
        range: {
          start: { line: def.line, character: 0 },
          end: { line: rangeEndLine, character: rangeEndChar },
        },
        selectionRange: {
          start: { line: def.line, character: def.column },
          end: { line: def.line, character: def.column + def.name.length },
        },
        children: [],
      };
    });

    // Attach inner method assignments as Method children of their enclosing function
    for (const method of parseInnerMethods(lines)) {
      const parent = symbols.find(
        (s) => method.line > s.range.start.line && method.line <= s.range.end.line
      );
      if (!parent) continue;

      parent.children!.push({
        name: method.name,
        kind: SymbolKind.Method,
        detail: extractSignatureDetail(method.funcSignature),
        range: {
          start: { line: method.line, character: 0 },
          end: { line: method.endLine, character: lines[method.endLine]?.length ?? 0 },
        },
        selectionRange: {
          start: { line: method.line, character: method.nameStart },
          end: { line: method.line, character: method.nameStart + method.name.length },
        },
        children: [],
      });
    }

    // Attach test case names as children (for *.test.brs files)
    if (isTestFile(document.uri)) {
      for (const testCase of parseTestCases(lines)) {
        const parent = symbols.find(
          (s) => testCase.line > s.range.start.line && testCase.line <= s.range.end.line
        );
        if (!parent) continue;
        parent.children!.push({
          name: testCase.name,
          kind: SymbolKind.Event,
          detail: testCase.kind,
          range: {
            start: { line: testCase.line, character: 0 },
            end: { line: testCase.endLine, character: lines[testCase.endLine]?.length ?? 0 },
          },
          selectionRange: {
            start: { line: testCase.line, character: testCase.nameStart },
            end: { line: testCase.line, character: testCase.nameEnd },
          },
          children: [],
        });
      }
    }

    return symbols;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InnerMethodDef {
  name: string;
  line: number;
  endLine: number;
  /** 0-based column of the method name in the assignment line */
  nameStart: number;
  /** The function/sub keyword + params + optional return type, e.g. `function(x as Integer) as Boolean` */
  funcSignature: string;
}

/**
 * Scans all lines for inner method assignments in both BrightScript AA patterns:
 *   - `<obj>.<name> = function|sub (...)` (prototype/field assignment)
 *   - `<name>: function|sub (...)`        (inline AA literal)
 * Returns a descriptor for each, including the matching `end function`/`end sub` line.
 */
function parseInnerMethods(lines: string[]): InnerMethodDef[] {
  const results: InnerMethodDef[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*'/.test(lines[i])) continue; // skip comment lines

    const dotMatch = INNER_DOT_RE.exec(lines[i]);
    if (dotMatch) {
      const name = dotMatch[2];
      const keyword = dotMatch[3];
      const params = dotMatch[4];
      const returnType = dotMatch[5];
      const funcSignature = returnType ? `${keyword}${params} as ${returnType}` : `${keyword}${params}`;
      const dotIdx = lines[i].indexOf('.');
      const nameStart = lines[i].indexOf(name, dotIdx >= 0 ? dotIdx : 0);
      results.push({ name, line: i, endLine: findEndLine(lines, i), nameStart, funcSignature });
      continue;
    }

    const colonMatch = INNER_COLON_RE.exec(lines[i]);
    if (colonMatch) {
      const name = colonMatch[1];
      const keyword = colonMatch[2];
      const params = colonMatch[3];
      const returnType = colonMatch[4];
      const funcSignature = returnType ? `${keyword}${params} as ${returnType}` : `${keyword}${params}`;
      const nameStart = lines[i].search(/\S/);
      results.push({ name, line: i, endLine: findEndLine(lines, i), nameStart, funcSignature });
    }
  }
  return results;
}

/**
 * Given the line index of an opening `function`/`sub` (named or anonymous),
 * returns the 0-based line index of the matching `end function`/`end sub`.
 * Uses depth tracking to handle nested functions correctly.
 */
function findEndLine(lines: string[], funcStartLine: number): number {
  let depth = 1;
  for (let i = funcStartLine + 1; i < lines.length; i++) {
    const line = lines[i];
    // Named declaration opens a new scope
    if (/^\s*(?:function|sub)\s+\w+\s*\(/i.test(line)) depth++;
    // Anonymous assignment opens a new scope (prototype.method = function)
    else if (/=\s*(?:function|sub)\s*\(/i.test(line)) depth++;
    // Inline AA literal method opens a new scope (key: function)
    else if (/:\s*(?:function|sub)\s*\(/i.test(line)) depth++;

    if (/^\s*end\s+(?:function|sub)\b/i.test(line)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return lines.length - 1; // fallback: end of file
}

/**
 * Extracts the parameters and optional return type from a full declaration.
 * `function foo(x as Integer) as Boolean` → `(x as Integer) as Boolean`
 * `sub bar()`                             → `()`
 */
function extractSignatureDetail(signature: string): string {
  const match = /(\([^)]*\)(?:\s+as\s+\w+)?)/i.exec(signature);
  return match?.[1] ?? '';
}

// ---------------------------------------------------------------------------
// Test case parsing
// ---------------------------------------------------------------------------

interface TestCaseDef {
  name: string;
  kind: string;
  line: number;
  endLine: number;
  nameStart: number;
  nameEnd: number;
}

/** Matches it("name", ...) / test("name", ...) / itEach([...], "name", ...) / testEach([...], "name", ...) */
const TEST_CASE_RE = /^\s*(?:it|test)\s*\(\s*"([^"]+)"/i;
const TEST_EACH_RE = /^\s*(?:itEach|testEach)\s*\([\s\S]*?,\s*"([^"]+)"/i;

/**
 * Scans lines for test case registrations (it/test/itEach/testEach calls)
 * and returns their names and locations.
 */
function parseTestCases(lines: string[]): TestCaseDef[] {
  const results: TestCaseDef[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let match = TEST_CASE_RE.exec(line);
    let kind = 'test';
    if (!match) {
      match = TEST_EACH_RE.exec(line);
      kind = 'parameterized';
    }
    if (!match) continue;

    const testName = match[1];
    const nameStart = line.indexOf('"' + testName) + 1;
    const nameEnd = nameStart + testName.length;
    const endLine = findEndLine(lines, i);

    results.push({ name: testName, kind, line: i, endLine, nameStart, nameEnd });
  }
  return results;
}

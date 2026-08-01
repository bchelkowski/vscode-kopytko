import { DocumentSymbol, SymbolKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  walk, SyntaxKind, TokenKind,
  firstToken, lastToken,
  FunctionDeclaration, FunctionExpression, AssignmentStatement, AAField,
  DotExpression, CallExpression, IdentifierExpression, LiteralExpression,
} from 'kopytko-brightscript-parser';
import type { SyntaxNode, Parameter } from 'kopytko-brightscript-parser';
import { isTestFile } from '../kopytko/testFramework';
import { getCachedParseResult, getCachedLines } from '../utils/documentCache';

/**
 * Provides document symbols for BrightScript files.
 *
 * Top-level `function` and `sub` declarations become symbols of kind `Function`.
 * When a function body assigns anonymous functions to associative array properties
 * (the standard BrightScript "class" pattern, e.g. `this.init = function(...)`),
 * those assignments are nested as children with kind `Method`.
 *
 * Symbol ranges:
 *   - `range`          — the declaration's own token span (start of the
 *                        `function`/`sub` keyword through its matching `end
 *                        function`/`end sub`), read directly off the AST.
 *   - `selectionRange` — the name token only, used for outline navigation.
 *
 * The `detail` field holds the parameter list and optional return type,
 * built from the typed AST (`.params`/`.returnType`) rather than re-derived
 * from source text.
 *
 * All of this is AST-driven: no line-by-line regex scanning, and no
 * hand-rolled `end function`/`end sub` depth counting — a `FunctionExpression`
 * node's own last token IS its `end function`/`end sub`.
 */
export class BrightScriptDocumentSymbolProvider {
  provideDocumentSymbols(document: TextDocument): DocumentSymbol[] {
    const parseResult = getCachedParseResult(document);

    const topLevel: { symbol: DocumentSymbol; syntax: SyntaxNode }[] = [];
    walk(parseResult.root, {
      visitFunctionDeclaration: (node) => {
        const entry = topLevelSymbol(node);
        if (entry) topLevel.push(entry);
        return false; // nested functions are handled by the scoped walk below, not this top-level one
      },
    });

    // A top-level symbol's range extends past its own `end function`/`end
    // sub` through to just before the next top-level symbol starts (or EOF
    // for the last one) — a VS Code outline convention so the cursor is
    // still considered "inside" a function while sitting on a trailing
    // blank line before the next declaration. `walk()` visits in document
    // order, so `topLevel` is already sorted by position.
    extendRangesToNextSibling(topLevel.map(t => t.symbol), getCachedLines(document));

    // Attach inner method assignments as Method children of their enclosing
    // top-level function — scoped to that function's own subtree, so a
    // sibling function's inner methods are never picked up.
    for (const { symbol, syntax } of topLevel) {
      walk(syntax, {
        visitFunctionExpression: (node) => {
          const method = innerMethodSymbol(node);
          if (method) symbol.children!.push(method);
        },
      });
    }

    const symbols = topLevel.map(t => t.symbol);

    // Attach test case names as children (for *.test.brs files)
    if (isTestFile(document.uri)) {
      walk(parseResult.root, {
        visitCallExpression: (node) => {
          const testCase = testCaseSymbol(node);
          if (!testCase) return;
          const parent = symbols.find(s =>
            testCase.range.start.line >= s.range.start.line && testCase.range.start.line <= s.range.end.line,
          );
          if (parent) parent.children!.push(testCase);
        },
      });
    }

    return symbols;
  }
}

// ---------------------------------------------------------------------------
// Top-level function/sub symbols
// ---------------------------------------------------------------------------

function topLevelSymbol(node: FunctionDeclaration): { symbol: DocumentSymbol; syntax: SyntaxNode } | undefined {
  const nameToken = node.nameToken;
  if (!nameToken) return undefined;
  const first = firstToken(node.syntax);
  const last = lastToken(node.syntax);
  if (!first || !last) return undefined;

  const symbol: DocumentSymbol = {
    name: nameToken.text,
    kind: SymbolKind.Function,
    detail: signatureDetail(node.params, node.returnType),
    range: {
      start: { line: first.line, character: first.column },
      end: { line: last.line, character: last.column + last.text.length },
    },
    selectionRange: {
      start: { line: nameToken.line, character: nameToken.column },
      end: { line: nameToken.line, character: nameToken.column + nameToken.text.length },
    },
    children: [],
  };
  return { symbol, syntax: node.syntax };
}

// ---------------------------------------------------------------------------
// Inner method symbols: `obj.method = function(...)` and `key: function(...)`
// ---------------------------------------------------------------------------

function innerMethodSymbol(node: FunctionExpression): DocumentSymbol | undefined {
  const parent = node.syntax.parent;
  if (!parent) return undefined;

  let nameToken;
  if (parent.kind === SyntaxKind.AssignmentStatement) {
    const target = new AssignmentStatement(parent).target;
    if (!(target instanceof DotExpression) || target.isAttributeAccess) return undefined;
    nameToken = target.memberToken;
  } else if (parent.kind === SyntaxKind.AAField) {
    nameToken = new AAField(parent).keyToken;
  } else {
    return undefined; // an ordinary callback argument, dim-assigned local, etc. — not an inner method
  }
  if (!nameToken) return undefined;

  const first = firstToken(node.syntax);
  const last = lastToken(node.syntax);
  if (!first || !last) return undefined;

  // A quoted AA-literal key's token text includes its quotes; the name shown
  // in the outline shouldn't.
  const rawName = nameToken.text;
  const name = rawName.length >= 2 && (rawName[0] === '"' || rawName[0] === "'")
    ? rawName.slice(1, -1) : rawName;

  return {
    name,
    kind: SymbolKind.Method,
    detail: signatureDetail(node.params, node.returnType),
    range: {
      start: { line: first.line, character: first.column },
      end: { line: last.line, character: last.column + last.text.length },
    },
    selectionRange: {
      start: { line: nameToken.line, character: nameToken.column },
      end: { line: nameToken.line, character: nameToken.column + name.length },
    },
    children: [],
  };
}

/** Mutates each symbol's `range.end` to reach just before the next symbol (or EOF for the last one). */
function extendRangesToNextSibling(symbols: DocumentSymbol[], lines: string[]): void {
  const lastLine = lines.length - 1;
  for (let i = 0; i < symbols.length; i++) {
    const nextStartLine = symbols[i + 1]?.range.start.line ?? (lastLine + 1);
    const endLine = Math.max(symbols[i].range.end.line, nextStartLine - 1);
    symbols[i].range.end = { line: endLine, character: lines[endLine]?.length ?? 0 };
  }
}

function signatureDetail(params: Parameter[], returnType: string | undefined): string {
  const paramsStr = params.map(p => p.typeName ? `${p.name} as ${p.typeName}` : p.name).join(', ');
  return returnType ? `(${paramsStr}) as ${returnType}` : `(${paramsStr})`;
}

// ---------------------------------------------------------------------------
// Test case symbols: it(...) / test(...) / itEach(...) / testEach(...)
// ---------------------------------------------------------------------------

const TEST_CALL_KINDS = new Set(['it', 'test']);
const TEST_EACH_CALL_KINDS = new Set(['iteach', 'testeach']);

function testNameArgIndex(calleeName: string): number | undefined {
  const lower = calleeName.toLowerCase();
  if (TEST_CALL_KINDS.has(lower)) return 0;
  // itEach(paramsList, testName, func) / testEach(paramsList, testName, func)
  // — per src/server/kopytko/testFramework.ts's signature, the name is
  // always the SECOND argument, not the first.
  if (TEST_EACH_CALL_KINDS.has(lower)) return 1;
  return undefined;
}

function testCaseSymbol(node: CallExpression): DocumentSymbol | undefined {
  const callee = node.callee;
  if (!(callee instanceof IdentifierExpression)) return undefined;
  const argIndex = testNameArgIndex(callee.name);
  if (argIndex === undefined) return undefined;

  const args = node.args;
  const nameArg = args[argIndex];
  if (!(nameArg instanceof LiteralExpression) || nameArg.token?.kind !== TokenKind.StringLiteral) return undefined;
  const nameToken = nameArg.token;
  const rawText = nameToken.text; // includes surrounding quotes
  const name = rawText.length >= 2 ? rawText.slice(1, -1) : rawText;

  const callFirst = firstToken(node.syntax);
  if (!callFirst) return undefined;

  // The test body is whichever argument is the callback function, if any —
  // usually the last one. Falls back to the call's own last token for a
  // pending/unimplemented test with no callback.
  const callbackArg = [...args].reverse().find(
    (a): a is FunctionExpression => a instanceof FunctionExpression,
  );
  const endToken = callbackArg ? lastToken(callbackArg.syntax) : lastToken(node.syntax);
  const endLine = endToken?.line ?? callFirst.line;
  const endChar = endToken ? endToken.column + endToken.text.length : callFirst.column;

  return {
    name,
    kind: SymbolKind.Event,
    detail: TEST_EACH_CALL_KINDS.has(callee.name.toLowerCase()) ? 'parameterized' : 'test',
    range: {
      start: { line: callFirst.line, character: callFirst.column },
      end: { line: endLine, character: endChar },
    },
    selectionRange: {
      start: { line: nameToken.line, character: nameToken.column + 1 },
      end: { line: nameToken.line, character: nameToken.column + 1 + name.length },
    },
    children: [],
  };
}

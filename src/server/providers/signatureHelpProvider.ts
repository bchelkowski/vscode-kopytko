import {
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  Position,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { KopytkoModuleCatalog } from '../kopytko/moduleCatalog';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { stripStringLiterals } from '../utils/textUtils';
import { getCachedLines } from '../utils/documentCache';
import { WorkspaceFunctionIndex } from '../utils/workspaceFunctionIndex';
import { SymbolResolver } from './shared/symbolResolver';

interface ActiveCall {
  funcName: string;
  receiverName: string | null;
  activeParam: number;
}

/**
 * Provides signature help (parameter hints) when the cursor is inside a
 * function call. Covers:
 *   - BrightScript built-in functions
 *   - ro* component methods (type-inferred from CreateObject / typed params)
 *   - Kopytko module exports
 *   - User-defined functions (same file + @import chain + XML siblings)
 */
export class BrightScriptSignatureHelpProvider {
  private readonly symbolResolver: SymbolResolver;

  constructor(
    importResolver: KopytkoImportResolver,
    catalog: KopytkoModuleCatalog,
    workspaceIndex?: WorkspaceFunctionIndex,
  ) {
    this.symbolResolver = new SymbolResolver(catalog, importResolver, workspaceIndex);
  }

  provideSignatureHelp(document: TextDocument, position: Position, siblingPatterns: string[][] = []): SignatureHelp | null {
    const lines = getCachedLines(document);
    const line = lines[position.line] ?? '';

    if (!line.trim() || isInComment(line, position.character)) return null;

    const call = findActiveCall(line, position.character);
    if (!call) return null;

    const { funcName, receiverName, activeParam } = call;

    const resolved = this.symbolResolver.resolveByName(document, funcName, receiverName, siblingPatterns);
    if (!resolved) return null;

    switch (resolved.kind) {
      case 'componentMethod':
        return buildSignatureHelp(resolved.method.signature, activeParam);
      case 'builtin':
        return buildSignatureHelp(resolved.builtin.signature, activeParam);
      case 'kopytkoExport':
        return buildSignatureHelp(resolved.entry.signature, activeParam);
      case 'userFunction':
      case 'sourceFunction':
        return buildSignatureHelp(resolved.definition.signature, activeParam);
      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Scans backwards from charPos to find whether the cursor is inside a function
 * call, returning the function name, optional receiver name, and comma-based
 * active parameter index.
 *
 * String literals in the line are replaced with spaces before scanning so
 * that commas or parens inside strings do not confuse the depth tracker.
 */
function findActiveCall(line: string, charPos: number): ActiveCall | null {
  const stripped = stripStringLiterals(line.slice(0, charPos));
  let depth = 0;
  let commaCount = 0;

  for (let i = stripped.length - 1; i >= 0; i--) {
    const ch = stripped[i];

    if (ch === ')' || ch === ']') {
      depth++;
    } else if (ch === '(' || ch === '[') {
      if (depth > 0) {
        depth--;
      } else if (ch === '(') {
        // Unmatched `(` — this is the opening paren of the active call.
        const before = stripped.substring(0, i).trimEnd();
        const nameMatch = /(\w+)$/.exec(before);
        if (!nameMatch) return null;
        const funcName = nameMatch[1];
        const beforeName = before.slice(0, before.length - nameMatch[0].length);
        const receiverName = beforeName.endsWith('.')
          ? (/(\w+)\.$/.exec(beforeName)?.[1] ?? null)
          : null;
        return { funcName, receiverName, activeParam: commaCount };
      } else {
        // Unmatched `[` — commas counted so far were array indices, reset them
        // and continue scanning outward for an enclosing function call.
        commaCount = 0;
      }
    } else if (ch === ',' && depth === 0) {
      commaCount++;
    }
  }

  return null;
}

/**
 * Returns true when the cursor at charPos is inside a line comment
 * (`'` or `REM` outside of a string literal).
 */
function isInComment(line: string, charPos: number): boolean {
  if (/^\s*rem\b/i.test(line.substring(0, charPos))) return true;
  let inString = false;
  for (let i = 0; i < charPos; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (!inString) {
        inString = true;
      } else if (line[i + 1] === '"') {
        i++; // BrightScript escaped quote ""
      } else {
        inString = false;
      }
    } else if (!inString && ch === "'") {
      return true;
    }
  }
  return false;
}

/**
 * Builds a SignatureHelp from a raw signature string.
 * Strips a leading `function`/`sub` keyword so the label is uniform
 * regardless of whether the source is a built-in, component method, or
 * user-defined function.
 */
function buildSignatureHelp(rawSignature: string, activeParam: number): SignatureHelp {
  const label = rawSignature.trim().replace(/^(?:function|sub)\s+/i, '');
  const params = splitParams(label);
  const parameters: ParameterInformation[] = params.map((p) => ({ label: p }));

  return {
    signatures: [
      {
        label,
        parameters,
      } as SignatureInformation,
    ],
    activeSignature: 0,
    activeParameter: params.length > 0 ? Math.min(activeParam, params.length - 1) : 0,
  };
}

/**
 * Splits the parameter list out of a signature string into individual
 * parameter strings.  Handles default values that contain string literals
 * (e.g. `arg = ""`) and nested parentheses.
 *
 * `Mid(s as String, start as Integer, length = -1 as Integer) as String`
 * → `["s as String", "start as Integer", "length = -1 as Integer"]`
 */
function splitParams(signature: string): string[] {
  const parenStart = signature.indexOf('(');
  const parenEnd = signature.lastIndexOf(')');
  if (parenStart === -1 || parenEnd === -1 || parenEnd <= parenStart) return [];
  const paramStr = signature.slice(parenStart + 1, parenEnd).trim();
  if (!paramStr) return [];

  const params: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;

  for (let i = 0; i < paramStr.length; i++) {
    const ch = paramStr[i];
    if (ch === '"') {
      if (!inString) {
        inString = true;
      } else if (i + 1 < paramStr.length && paramStr[i + 1] === '"') {
        i++; // skip escaped ""
      } else {
        inString = false;
      }
    } else if (!inString) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) {
        params.push(paramStr.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  params.push(paramStr.slice(start).trim());
  return params.filter((p) => p.length > 0);
}

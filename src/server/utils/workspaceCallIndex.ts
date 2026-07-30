import {
  parse, buildCallGraph, walk, SyntaxKind, TokenKind,
  CallExpression, AALiteral,
} from 'kopytko-brightscript-parser';
import type { AstNode } from 'kopytko-brightscript-parser';
import { readCachedFileText, invalidateFileParseCache } from './fileParseCache';
import { walkTree } from './dirWalker';

// Regex constants for XML interface parsing (same patterns as xmlScriptParser.ts).
const INTERFACE_BLOCK_RE = /<interface\b[^>]*>([\s\S]*?)<\/interface>/i;
const FUNCTION_TAG_RE = /<function\b([^>]*)>/gi;
const ATTR_NAME_RE = /\bname\s*=\s*["']([^"']+)["']/i;

/**
 * Workspace-wide index of all function names that are referenced as call targets
 * in any .brs file, or declared in a SceneGraph component XML interface.
 *
 * Built once at startup and updated incrementally when files change. The
 * `getCalledNames()` result is a lazily-built Set<string> union — no work
 * happens at keystroke time.
 *
 * Populated from:
 * - Direct function calls (non-method call expressions)
 * - observeField / observeFieldScoped string callbacks
 * - callFunc string arguments
 * - Kopytko events: { prop: "handlerFn" } AA patterns
 * - SceneGraph XML <interface><function name="..."/> declarations
 */
export class WorkspaceCallIndex {
  private _fileCalledNames = new Map<string, Set<string>>();
  private _allCalledNames: Set<string> | null = null;

  build(roots: string[]): void {
    this._fileCalledNames.clear();
    this._allCalledNames = null;
    for (const root of roots) {
      this._walkDir(root);
    }
  }

  updateFile(filePath: string): void {
    const isBrs = filePath.endsWith('.brs');
    const isXml = filePath.endsWith('.xml');
    if (!isBrs && !isXml) return;

    invalidateFileParseCache(filePath);

    this._fileCalledNames.delete(filePath);
    const names = isBrs
      ? this._extractCalledNames(filePath)
      : this._extractCalledNamesFromXml(filePath);
    if (names && names.size > 0) {
      this._fileCalledNames.set(filePath, names);
    }
    this._allCalledNames = null;
  }

  removeFile(filePath: string): void {
    const isBrs = filePath.endsWith('.brs');
    const isXml = filePath.endsWith('.xml');
    if (!isBrs && !isXml) return;

    invalidateFileParseCache(filePath);
    this._fileCalledNames.delete(filePath);
    this._allCalledNames = null;
  }

  getCalledNames(): Set<string> {
    if (this._allCalledNames !== null) return this._allCalledNames;
    const union = new Set<string>();
    for (const names of this._fileCalledNames.values()) {
      for (const name of names) union.add(name);
    }
    this._allCalledNames = union;
    return union;
  }

  private _extractCalledNames(filePath: string): Set<string> | undefined {
    const text = readCachedFileText(filePath);
    if (!text) return undefined;

    const names = new Set<string>();
    const root = parse(text).root;
    const graph = buildCallGraph(root);

    for (const site of graph.allCalls) {
      if (!site.isMethodCall) {
        names.add(site.calleeName);
      }
    }

    // String callback patterns: observeField, observeFieldScoped, callFunc
    walk(root, {
      visitCallExpression(node: CallExpression) {
        const calleeSyntax = node.syntax.findChild(SyntaxKind.DotExpression);
        if (!calleeSyntax) return;

        const memberToken = calleeSyntax.childTokens[calleeSyntax.childTokens.length - 1];
        if (!memberToken) return;
        const methodName = memberToken.text.toLowerCase();

        if (methodName === 'observefield' || methodName === 'observefieldscoped') {
          // 2nd argument is the callback name string
          const args = node.args;
          if (args.length < 2) return;
          const strName = extractStringLiteral(args[1]);
          if (strName) names.add(strName);
        } else if (methodName === 'callfunc') {
          // 1st argument is the function name string
          const args = node.args;
          if (args.length < 1) return;
          const strName = extractStringLiteral(args[0]);
          if (strName) names.add(strName);
        }
      },

      visitAAField(node) {
        // Kopytko events: { fieldProp: "handlerFn" } pattern
        const key = node.key.toLowerCase().replace(/"/g, '');
        if (key !== 'events') return;
        const value = node.value;
        if (!value || value.syntax.kind !== SyntaxKind.AALiteral) return;
        const aaValue = new AALiteral(value.syntax);
        for (const field of aaValue.fields) {
          const strName = extractStringLiteral(field.value);
          if (strName) names.add(strName);
        }
      },
    });

    return names;
  }

  private _extractCalledNamesFromXml(filePath: string): Set<string> | undefined {
    const text = readCachedFileText(filePath);
    if (!text) return undefined;

    const ifaceMatch = INTERFACE_BLOCK_RE.exec(text);
    if (!ifaceMatch) return undefined;
    const ifaceText = ifaceMatch[1];

    const names = new Set<string>();
    FUNCTION_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FUNCTION_TAG_RE.exec(ifaceText)) !== null) {
      const nameMatch = ATTR_NAME_RE.exec(m[1]);
      if (nameMatch) names.add(nameMatch[1].toLowerCase());
    }
    return names.size > 0 ? names : undefined;
  }

  private _walkDir(dir: string): void {
    walkTree(dir, (full, name) => {
      if (name.endsWith('.brs')) {
        const names = this._extractCalledNames(full);
        if (names && names.size > 0) this._fileCalledNames.set(full, names);
      } else if (name.endsWith('.xml')) {
        const names = this._extractCalledNamesFromXml(full);
        if (names) this._fileCalledNames.set(full, names);
      }
    });
  }
}

function extractStringLiteral(node: AstNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.syntax.kind !== SyntaxKind.LiteralExpression) return undefined;
  const token = node.syntax.childTokens[0];
  if (!token || token.kind !== TokenKind.StringLiteral) return undefined;
  const content = token.text.slice(1, -1);
  return content ? content.toLowerCase() : undefined;
}

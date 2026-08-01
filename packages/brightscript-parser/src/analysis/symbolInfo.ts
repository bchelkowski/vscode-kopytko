/**
 * Symbol information aggregation for BrightScript.
 *
 * Provides rich symbol info for hover, go-to-definition, and find-references:
 * - Full function signature with parameter types and return type
 * - Source location (file, line, column)
 * - Documentation (from builtins catalog for built-in functions)
 * - All references to the symbol
 * - Whether the symbol is a builtin, user-defined, or parameter
 */

import { SyntaxNode } from '../syntaxNode.js';

import { walk } from '../visitor.js';
import { FunctionDeclaration, IdentifierExpression, DotExpression } from '../ast.js';
import { findBuiltin } from '../catalog/builtins.js';
import { Scope, buildScopes, Declaration } from '../scope.js';


export interface SymbolInfo {
  /** Symbol name (original casing). */
  name: string;
  /** Symbol kind. */
  kind: 'function' | 'variable' | 'parameter' | 'builtin' | 'field';
  /** Full signature for functions: `function add(a as Integer, b as Integer) as Integer`. */
  signature?: string;
  /** Parameter names (for functions). */
  params?: string[];
  /** Parameter types (for functions). */
  paramTypes?: (string | undefined)[];
  /** Return type (for functions). */
  returnType?: string;
  /** Human-readable description (from builtins catalog or comments). */
  description?: string;
  /** Documentation URL (for builtins). */
  docsUrl?: string;
  /** Source location. */
  location?: { line: number; column: number };
  /** All reference locations. */
  references: { line: number; column: number }[];
}

/**
 * Gets symbol info for a function by name.
 * Searches builtins first, then user-defined functions in the AST.
 *
 * Does a single combined tree walk to find a matching function declaration
 * AND collect every reference, rather than a separate walk per concern —
 * `buildScopes` (also a full walk) only runs afterward, and only when no
 * function declaration matched.
 */
export function getSymbolInfo(name: string, root: SyntaxNode): SymbolInfo | null {
  const lower = name.toLowerCase();

  let functionMatch: FunctionDeclaration | undefined;
  const references: { line: number; column: number }[] = [];

  walk(root, {
    visitFunctionDeclaration(node: FunctionDeclaration) {
      if (node.name.toLowerCase() === lower) functionMatch = node;
    },
    visitIdentifierExpression(node: IdentifierExpression) {
      if (node.name.toLowerCase() !== lower) return;
      const t = node.nameToken;
      if (t) references.push({ line: t.line, column: t.column });
    },
    visitDotExpression(node: DotExpression) {
      // `obj.add()` / `obj.add` is a reference to `add` — an ordinary member
      // access, not an `@attr` XML attribute access. Without this, go-to-
      // references on a method never finds its call sites, since a method
      // name is never an IdentifierExpression on its own.
      if (node.isAttributeAccess || node.member.toLowerCase() !== lower) return;
      const t = node.memberToken;
      if (t) references.push({ line: t.line, column: t.column });
    },
  });

  const builtin = findBuiltin(lower);
  if (builtin) {
    return {
      name: builtin.name,
      kind: 'builtin',
      signature: `${builtin.name}(${builtin.signature})`,
      returnType: builtin.returnType,
      description: builtin.description,
      docsUrl: builtin.docsUrl,
      references,
    };
  }

  if (functionMatch) {
    const node = functionMatch;
    const params = node.params;
    const paramSigs = params.map(p =>
      p.typeName ? `${p.name} as ${p.typeName}` : p.name
    );
    const retType = node.returnType;
    const keyword = node.isSub ? 'sub' : 'function';
    const sig = retType
      ? `${keyword} ${node.name}(${paramSigs.join(', ')}) as ${retType}`
      : `${keyword} ${node.name}(${paramSigs.join(', ')})`;

    return {
      name: node.name,
      kind: 'function',
      signature: sig,
      params: params.map(p => p.name),
      paramTypes: params.map(p => p.typeName),
      returnType: retType,
      location: node.nameToken ? { line: node.nameToken.line, column: node.nameToken.column } : undefined,
      references,
    };
  }

  // Check scope declarations (variables, parameters)
  const scope = buildScopes(root);
  const decl = findDeclarationInScopes(lower, scope);
  if (decl) {
    return {
      name: decl.name,
      kind: decl.kind === 'parameter' ? 'parameter' : 'variable',
      location: { line: decl.line, column: decl.column },
      references,
    };
  }

  return null;
}

function findDeclarationInScopes(nameLower: string, scope: Scope): Declaration | undefined {
  const decl = scope.declarations.get(nameLower);
  if (decl) return decl;
  for (const child of scope.children) {
    const found = findDeclarationInScopes(nameLower, child);
    if (found) return found;
  }
  return undefined;
}

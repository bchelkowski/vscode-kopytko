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
import {
  FunctionDeclaration, IdentifierExpression,
} from '../ast.js';
import {
} from '../ast.js';
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
 */
export function getSymbolInfo(name: string, root: SyntaxNode): SymbolInfo | null {
  const lower = name.toLowerCase();

  // Check builtins
  const builtin = findBuiltin(lower);
  if (builtin) {
    return {
      name: builtin.name,
      kind: 'builtin',
      signature: `${builtin.name}(${builtin.signature})`,
      returnType: builtin.returnType,
      description: builtin.description,
      docsUrl: builtin.docsUrl,
      references: collectReferences(lower, root),
    };
  }

  // Check user-defined functions
  let found: SymbolInfo | null = null;
  walk(root, {
    visitFunctionDeclaration(node: FunctionDeclaration) {
      if (node.name.toLowerCase() !== lower) return;
      const params = node.params;
      const paramSigs = params.map(p =>
        p.typeName ? `${p.name} as ${p.typeName}` : p.name
      );
      const retType = node.returnType;
      const keyword = node.isSub ? 'sub' : 'function';
      const sig = retType
        ? `${keyword} ${node.name}(${paramSigs.join(', ')}) as ${retType}`
        : `${keyword} ${node.name}(${paramSigs.join(', ')})`;

      found = {
        name: node.name,
        kind: 'function',
        signature: sig,
        params: params.map(p => p.name),
        paramTypes: params.map(p => p.typeName),
        returnType: retType,
        location: node.nameToken ? { line: node.nameToken.line, column: node.nameToken.column } : undefined,
        references: collectReferences(lower, root),
      };
    },
  });

  if (found) return found;

  // Check scope declarations (variables, parameters)
  const scope = buildScopes(root);
  const decl = findDeclarationInScopes(lower, scope);
  if (decl) {
    return {
      name: decl.name,
      kind: decl.kind === 'parameter' ? 'parameter' : 'variable',
      location: { line: decl.line, column: decl.column },
      references: collectReferences(lower, root),
    };
  }

  return null;
}

function collectReferences(nameLower: string, root: SyntaxNode): { line: number; column: number }[] {
  const refs: { line: number; column: number }[] = [];

  walk(root, {
    visitIdentifierExpression(node: IdentifierExpression) {
      if (node.name.toLowerCase() === nameLower) {
        const t = node.nameToken;
        if (t) refs.push({ line: t.line, column: t.column });
      }
    },
  });

  return refs;
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

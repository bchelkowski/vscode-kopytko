/**
 * Scope analysis — builds a scope tree from a parsed BrightScript file.
 *
 * BrightScript scoping rules:
 * - Functions/subs create their own scope.
 * - Parameters are local to their function scope.
 * - Variables assigned with `=` are local to their function scope.
 * - `for` / `for each` loop variables are local to their function scope.
 * - `catch` variables are local to their function scope.
 * - `m` is a special variable: component scope (AA) in SceneGraph,
 *   module-level AA otherwise.
 * - `dim` declares an array variable local to the function scope.
 * - All identifiers are case-insensitive.
 */
import { SyntaxNode } from './syntaxNode.js';
export interface Declaration {
    /** The declared name (original casing). */
    readonly name: string;
    /** The declared name (lowercased for case-insensitive lookup). */
    readonly nameLower: string;
    /** The kind of declaration. */
    readonly kind: DeclarationKind;
    /** 0-based line number of the declaration. */
    readonly line: number;
    /** 0-based column of the declaration. */
    readonly column: number;
    /** The CST node that contains this declaration. */
    readonly node: SyntaxNode;
}
export type DeclarationKind = 'function' | 'parameter' | 'variable' | 'for-variable' | 'catch-variable' | 'dim-variable';
export interface Reference {
    /** The referenced name (original casing). */
    readonly name: string;
    /** Lowercased for lookup. */
    readonly nameLower: string;
    /** 0-based line number. */
    readonly line: number;
    /** 0-based column. */
    readonly column: number;
    /** The CST node containing this reference. */
    readonly node: SyntaxNode;
}
export interface Scope {
    /** The function/sub that owns this scope, or null for the file scope. */
    readonly owner: SyntaxNode | null;
    /** The name of the owning function (lowercased), or '' for file scope. */
    readonly ownerName: string;
    /** Parent scope (null for the file scope). */
    readonly parent: Scope | null;
    /** All declarations in this scope. */
    readonly declarations: Map<string, Declaration>;
    /** All identifier references in this scope (not in child scopes). */
    readonly references: Reference[];
    /** Child scopes (nested functions). */
    readonly children: Scope[];
}
/**
 * Builds a scope tree from a parsed source file.
 *
 * @param root - The SourceFile CST node.
 * @returns The file-level scope with all nested scopes.
 */
export declare function buildScopes(root: SyntaxNode): Scope;
/**
 * Finds the innermost scope that contains the given line.
 */
export declare function findScopeAtLine(scope: Scope, line: number): Scope;
/**
 * Resolves a name in the given scope, searching up the scope chain.
 * Returns the declaration or undefined if not found.
 */
export declare function resolve(name: string, scope: Scope): Declaration | undefined;
//# sourceMappingURL=scope.d.ts.map
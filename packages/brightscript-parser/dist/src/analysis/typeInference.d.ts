/**
 * AST-based type inference for BrightScript.
 *
 * Tracks the possible types of variables through:
 * - CreateObject("roFoo") → type is "roFoo"
 * - Parameter type annotations: `param as Integer` → "Integer"
 * - Numeric/string/boolean literal assignments
 * - Return type annotations on functions
 * - Type designator suffixes: `x$` → String, `x%` → Integer, etc.
 */
import { SyntaxNode } from '../syntaxNode.js';
export interface TypeBinding {
    name: string;
    typeName: string;
    source: 'createobject' | 'param-annotation' | 'literal' | 'return-type' | 'designator';
    line: number;
    column: number;
}
export type TypeMap = Map<string, TypeBinding[]>;
export declare function inferTypesFromAst(root: SyntaxNode): TypeMap;
export declare function getVariableType(typeMap: TypeMap, varName: string): string | undefined;
//# sourceMappingURL=typeInference.d.ts.map
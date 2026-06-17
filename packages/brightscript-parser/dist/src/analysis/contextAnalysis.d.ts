/**
 * Context (`m`) analysis for BrightScript.
 *
 * In BrightScript, `m` is a special variable:
 * - When a function is called from a SceneGraph component → `m` = component scope
 * - When called from an associative array → `m` = that AA
 * - When called standalone → `m` = module-level global AA
 *
 * This module tracks:
 * 1. What fields are assigned to `m` (m.field = value)
 * 2. Where functions are stored in AAs (aa.func = myFunc)
 * 3. The possible `m` contexts for each function based on call patterns
 *
 * This enables the extension to show:
 * - "m.top" is available because this function runs in a component context
 * - "m.data" was assigned in init() → type is roArray
 * - Warnings when m.field types are inconsistent
 */
import { SyntaxNode } from '../syntaxNode.js';
/** A field assignment on `m`: m.fieldName = value */
export interface ContextField {
    /** Field name (lowercased). */
    name: string;
    /** Original casing. */
    originalName: string;
    /** Inferred type of the assigned value (if determinable). */
    typeName?: string;
    /** The function where this assignment occurs. */
    assignedInFunction: string;
    /** Line of the assignment. */
    line: number;
    /** Column. */
    column: number;
}
/** A function stored in an AA: aa.funcField = someFunction */
export interface FunctionBinding {
    /** The AA variable name (lowercased). */
    aaName: string;
    /** The field name in the AA. */
    fieldName: string;
    /** The function name being stored (lowercased). */
    functionName: string;
    /** Line of the binding. */
    line: number;
}
/** Represents the known context for a function. */
export interface FunctionContext {
    /** Function name (lowercased). */
    functionName: string;
    /** Fields known to be available on `m` when this function runs. */
    contextFields: ContextField[];
    /** How this function is invoked: 'component' | 'aa' | 'standalone' | 'unknown'. */
    invocationStyle: 'component' | 'aa' | 'standalone' | 'unknown';
    /** If invoked as aa.func(), the AA name. */
    aaOwner?: string;
}
export interface ContextAnalysis {
    /** All m.field assignments across the file. */
    contextFields: ContextField[];
    /** Functions stored in AAs (e.g., obj.handler = myFunc). */
    functionBindings: FunctionBinding[];
    /** Functions defined inline in AA literals (e.g., { init: function() ... }). */
    inlineAAFunctions: {
        aaFieldName: string;
        line: number;
    }[];
    /** Get all context fields assigned within a specific function. */
    getFieldsInFunction(funcName: string): ContextField[];
    /** Get all context fields across all functions (the full m scope). */
    getAllFields(): ContextField[];
}
/**
 * Analyzes `m` context usage across the file.
 */
export declare function analyzeContext(root: SyntaxNode): ContextAnalysis;
//# sourceMappingURL=contextAnalysis.d.ts.map
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
    location?: {
        line: number;
        column: number;
    };
    /** All reference locations. */
    references: {
        line: number;
        column: number;
    }[];
}
/**
 * Gets symbol info for a function by name.
 * Searches builtins first, then user-defined functions in the AST.
 */
export declare function getSymbolInfo(name: string, root: SyntaxNode): SymbolInfo | null;
//# sourceMappingURL=symbolInfo.d.ts.map
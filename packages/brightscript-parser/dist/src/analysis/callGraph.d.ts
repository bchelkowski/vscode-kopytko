/**
 * Call graph builder for BrightScript.
 *
 * Builds a graph of which functions call which other functions,
 * recording argument expressions at each call site. This enables:
 * - Tracing data flow through function calls
 * - Finding all callers of a function
 * - Understanding argument passing chains
 */
import { SyntaxNode } from '../syntaxNode.js';
export interface CallSite {
    /** Name of the called function (lowercased). */
    calleeName: string;
    /** Original casing of the callee name. */
    calleeOriginal: string;
    /** Number of arguments passed. */
    argCount: number;
    /** Line of the call. */
    line: number;
    /** Column of the call. */
    column: number;
    /** The enclosing function name (lowercased), or '' for file scope. */
    enclosingFunction: string;
    /** Whether this is a method call (obj.method()). */
    isMethodCall: boolean;
    /** The receiver name for method calls (e.g., 'm' in m.doSomething()). */
    receiver?: string;
}
export interface FunctionInfo {
    /** Function name (lowercased). */
    name: string;
    /** Original casing. */
    originalName: string;
    /** Parameter names. */
    params: string[];
    /** Parameter types (if annotated). */
    paramTypes: (string | undefined)[];
    /** Return type (if annotated). */
    returnType: string | undefined;
    /** Whether this is a sub (void). */
    isSub: boolean;
    /** Line of declaration. */
    line: number;
    /** All call sites within this function. */
    calls: CallSite[];
}
export interface CallGraph {
    /** All function declarations in the file. */
    functions: Map<string, FunctionInfo>;
    /** All call sites in the file (including file-scope calls). */
    allCalls: CallSite[];
    /** Find all callers of a function. */
    findCallers(funcName: string): CallSite[];
    /** Find all functions called by a function. */
    findCallees(funcName: string): CallSite[];
}
/**
 * Builds a call graph from a parsed source file.
 */
export declare function buildCallGraph(root: SyntaxNode): CallGraph;
//# sourceMappingURL=callGraph.d.ts.map
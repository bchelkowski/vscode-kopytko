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

import { walk } from '../visitor.js';
import {
  FunctionDeclaration, CallExpression,
  DotExpression, IdentifierExpression,
} from '../ast.js';


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
export function buildCallGraph(root: SyntaxNode): CallGraph {
  const functions = new Map<string, FunctionInfo>();
  const allCalls: CallSite[] = [];
  let currentFunction = '';

  // First pass: collect all function declarations
  walk(root, {
    visitFunctionDeclaration(node: FunctionDeclaration) {
      const name = node.name.toLowerCase();
      functions.set(name, {
        name,
        originalName: node.name,
        params: node.params.map(p => p.name),
        paramTypes: node.params.map(p => p.typeName),
        returnType: node.returnType,
        isSub: node.isSub,
        line: node.nameToken?.line ?? 0,
        calls: [],
      });
    },
  });

  // Second pass: collect all call sites
  walk(root, {
    visitFunctionDeclaration(node: FunctionDeclaration) {
      currentFunction = node.name.toLowerCase();
    },
    visitCallExpression(node: CallExpression) {
      const callee = node.callee;
      if (!callee) return;

      let calleeName = '';
      let calleeOriginal = '';
      let isMethodCall = false;
      let receiver: string | undefined;
      let line = 0, column = 0;

      if (callee instanceof IdentifierExpression) {
        calleeName = callee.name.toLowerCase();
        calleeOriginal = callee.name;
        const t = callee.nameToken;
        if (t) { line = t.line; column = t.column; }
      } else if (callee instanceof DotExpression) {
        calleeName = callee.member.toLowerCase();
        calleeOriginal = callee.member;
        isMethodCall = true;
        const obj = callee.object;
        if (obj instanceof IdentifierExpression) {
          receiver = obj.name.toLowerCase();
        }
        const t = callee.memberToken;
        if (t) { line = t.line; column = t.column; }
      }

      if (!calleeName) return;

      const site: CallSite = {
        calleeName, calleeOriginal,
        argCount: node.args.length,
        line, column,
        enclosingFunction: currentFunction,
        isMethodCall,
        receiver,
      };

      allCalls.push(site);
      const fnInfo = functions.get(currentFunction);
      if (fnInfo) fnInfo.calls.push(site);
    },
  });

  return {
    functions,
    allCalls,
    findCallers(funcName: string): CallSite[] {
      const lower = funcName.toLowerCase();
      return allCalls.filter(c => c.calleeName === lower);
    },
    findCallees(funcName: string): CallSite[] {
      const fn = functions.get(funcName.toLowerCase());
      return fn ? fn.calls : [];
    },
  };
}

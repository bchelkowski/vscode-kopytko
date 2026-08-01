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

import { SyntaxNode, isNode } from '../syntaxNode.js';
import { TokenKind } from '../tokenKind.js';
import { SyntaxKind } from '../syntaxKind.js';

import {
  FunctionDeclaration, AssignmentStatement,
  DotExpression, IdentifierExpression, CallExpression,
  AAField, FunctionExpression, LiteralExpression, AstNode,
} from '../ast.js';

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

/** A function defined inline as an AA literal field: `{ init: function() ... end function }`. */
export interface InlineAAFunction {
  /** The field name (lowercased). */
  aaFieldName: string;
  /** The field name (original casing). */
  aaFieldNameOriginal: string;
  /** Line of the field name. */
  line: number;
  /** Column of the field name. */
  column: number;
  /** Original-casing name of the enclosing function this AA literal appears in, or `''` for file scope. */
  enclosingFunction: string;
}

/** An inline function assigned directly via dot: `aa.methodName = function(...) ... end function`. */
export interface DotAssignedFunction {
  /** The AA variable name (original casing). */
  aaName: string;
  /** The field/method name being assigned (original casing). */
  fieldName: string;
  /** Line of the field name. */
  line: number;
  /** Column of the field name. */
  column: number;
  /** Original-casing name of the enclosing function this assignment appears in, or `''` for file scope. */
  enclosingFunction: string;
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
  inlineAAFunctions: InlineAAFunction[];
  /** Functions assigned inline via dot (e.g., obj.init = function() ... end function). */
  dotAssignedFunctions: DotAssignedFunction[];
  /**
   * Best-effort invocation context per top-level function, derived only from
   * evidence within this file. See `analyzeContext`'s doc comment for what
   * `'component'` deliberately never means here.
   */
  functionContexts: FunctionContext[];
  /** Get all context fields assigned within a specific function. */
  getFieldsInFunction(funcName: string): ContextField[];
  /** Get all context fields across all functions (the full m scope). */
  getAllFields(): ContextField[];
  /** Get the invocation context for a specific top-level function (lowercased lookup). */
  getFunctionContext(funcName: string): FunctionContext | undefined;
}

/**
 * Analyzes `m` context usage across the file.
 *
 * `functionContexts[].invocationStyle` is derived only from evidence visible
 * in this single file:
 * - `'aa'` — the function is bound as an AA field (`obj.field = funcName`),
 *   so it is provably invoked as `obj.field()` and `m` is that AA.
 * - `'standalone'` — the function is called directly as a bare identifier
 *   somewhere in this file (`funcName()`), so `m` is the module-level AA.
 * - `'unknown'` — neither is true. This deliberately covers the SceneGraph
 *   component-callback case (a function referenced only from a component's
 *   XML `<interface>`/`onChange`, e.g. `init`) as well as functions called
 *   only from other files — this module has no XML access and does not
 *   guess. A caller with XML access (cross-referencing `<interface>`
 *   function names) can upgrade `'unknown'` to `'component'` with real
 *   evidence; this module will never fabricate that distinction itself.
 */
export function analyzeContext(root: SyntaxNode): ContextAnalysis {
  const contextFields: ContextField[] = [];
  const functionBindings: FunctionBinding[] = [];
  const inlineAAFunctions: InlineAAFunction[] = [];
  const dotAssignedFunctions: DotAssignedFunction[] = [];
  const functionStack: string[] = [];
  /** Same depth as `functionStack`, original casing — for fields meant as a display name (`enclosingFunction`), not a lookup key. */
  const functionStackOriginal: string[] = [];
  const topLevelFunctionNames: string[] = [];
  const directlyCalledNames = new Set<string>();

  // Use an explicit enter/leave traversal so statements after nested functions
  // are attributed to the enclosing function rather than the nested one.
  collectContext(root);

  function collectContext(node: SyntaxNode): void {
    let pushedFunction = false;
    if (node.kind === SyntaxKind.FunctionDeclaration) {
      const originalName = new FunctionDeclaration(node).name;
      const name = originalName.toLowerCase();
      functionStack.push(name);
      functionStackOriginal.push(originalName);
      if (functionStack.length === 1) topLevelFunctionNames.push(name);
      pushedFunction = true;
    } else if (node.kind === SyntaxKind.FunctionExpression) {
      functionStack.push('');
      functionStackOriginal.push('');
      pushedFunction = true;
    }

    if (node.kind === SyntaxKind.AssignmentStatement) {
      collectAssignment(new AssignmentStatement(node));
    } else if (node.kind === SyntaxKind.AAField) {
      collectAAField(new AAField(node));
    } else if (node.kind === SyntaxKind.CallExpression) {
      collectDirectCall(new CallExpression(node));
    }

    for (const child of node.children) {
      if (isNode(child)) {
        collectContext(child);
      }
    }

    if (pushedFunction) {
      functionStack.pop();
      functionStackOriginal.pop();
    }
  }

  function collectDirectCall(node: CallExpression): void {
    // A bare `funcName(...)` call — not `obj.funcName(...)`, which is a
    // DotExpression callee and doesn't tell us `funcName` runs standalone.
    if (node.callee instanceof IdentifierExpression) {
      directlyCalledNames.add(node.callee.name.toLowerCase());
    }
  }

  function collectAssignment(node: AssignmentStatement): void {
    const target = node.target;
    if (!target) return;

    // m.field = value → context field assignment
    if (target instanceof DotExpression) {
      const obj = target.object;
      if (obj instanceof IdentifierExpression && obj.name.toLowerCase() === 'm') {
        const fieldName = target.member;
        const t = target.memberToken;
        const typeName = inferSimpleType(node.value);
        contextFields.push({
          name: fieldName.toLowerCase(),
          originalName: fieldName,
          typeName,
          assignedInFunction: functionStack[functionStack.length - 1] ?? '',
          line: t?.line ?? 0,
          column: t?.column ?? 0,
        });
      }

      if (obj instanceof IdentifierExpression) {
        const value = node.value;
        // aa.field = someFunction → function binding (a reference to an
        // existing named function). `m` is excluded here on purpose: `m`
        // isn't an ordinary AA the way a ordinary variable is, and nothing
        // consumes an "m is bound to function X" fact today.
        if (obj.name.toLowerCase() !== 'm' && value instanceof IdentifierExpression) {
          functionBindings.push({
            aaName: obj.name.toLowerCase(),
            fieldName: target.member.toLowerCase(),
            functionName: value.name.toLowerCase(),
            line: target.memberToken?.line ?? 0,
          });
        } else if (value instanceof FunctionExpression) {
          // aa.field = function(...) ... end function — an inline function
          // expression, not a reference to a named one. Applies to `m` too
          // (`m.onKeyEvent = function(key, press) ...` is the standard
          // SceneGraph component event-handler pattern), unlike the named-
          // reference case above.
          const t = target.memberToken;
          dotAssignedFunctions.push({
            aaName: obj.name,
            fieldName: target.member,
            line: t?.line ?? 0,
            column: t?.column ?? 0,
            enclosingFunction: functionStackOriginal[functionStackOriginal.length - 1] ?? '',
          });
        }
      }
    }
  }

  function collectAAField(node: AAField): void {
    // { key: function() ... } → inline AA function. `key` is the token's raw
    // text — for a quoted key (`"init": function()`) that includes the
    // quotes, which nothing downstream wants as part of the name.
    const value = node.value;
    if (value instanceof FunctionExpression) {
      const t = node.keyToken;
      const rawKey = node.key;
      const unquotedKey = rawKey.length >= 2 && (rawKey[0] === '"' || rawKey[0] === "'")
        ? rawKey.slice(1, -1) : rawKey;
      inlineAAFunctions.push({
        aaFieldName: unquotedKey.toLowerCase(),
        aaFieldNameOriginal: unquotedKey,
        line: t?.line ?? 0,
        column: t?.column ?? 0,
        enclosingFunction: functionStackOriginal[functionStackOriginal.length - 1] ?? '',
      });
    }
  }

  const aaOwnerByFunction = new Map<string, string>();
  for (const binding of functionBindings) {
    // First binding wins if a function is stored under multiple AA fields —
    // there is no way to prefer one over another from this file alone.
    if (!aaOwnerByFunction.has(binding.functionName)) {
      aaOwnerByFunction.set(binding.functionName, binding.aaName);
    }
  }

  const functionContexts: FunctionContext[] = topLevelFunctionNames.map(functionName => {
    const aaOwner = aaOwnerByFunction.get(functionName);
    const invocationStyle: FunctionContext['invocationStyle'] =
      aaOwner !== undefined ? 'aa'
      : directlyCalledNames.has(functionName) ? 'standalone'
      : 'unknown';
    return {
      functionName,
      contextFields: contextFields.filter(f => f.assignedInFunction === functionName),
      invocationStyle,
      aaOwner,
    };
  });
  const functionContextByName = new Map(functionContexts.map(fc => [fc.functionName, fc]));

  return {
    contextFields,
    functionBindings,
    inlineAAFunctions,
    dotAssignedFunctions,
    functionContexts,

    getFieldsInFunction(funcName: string): ContextField[] {
      return contextFields.filter(f => f.assignedInFunction === funcName.toLowerCase());
    },

    getAllFields(): ContextField[] {
      return contextFields;
    },

    getFunctionContext(funcName: string): FunctionContext | undefined {
      return functionContextByName.get(funcName.toLowerCase());
    },
  };
}

function inferSimpleType(node: AstNode | null): string | undefined {
  if (!node) return undefined;
  if (node instanceof LiteralExpression && node.token) {
    switch (node.token.kind) {
      case TokenKind.StringLiteral: return 'String';
      case TokenKind.IntegerLiteral: return 'Integer';
      case TokenKind.FloatLiteral: return 'Float';
      case TokenKind.True: case TokenKind.False: return 'Boolean';
      case TokenKind.Invalid: return 'Invalid';
    }
  }
  if (node instanceof CallExpression) {
    const callee = node.callee;
    if (callee instanceof IdentifierExpression && callee.name.toLowerCase() === 'createobject') {
      const args = node.args;
      if (args.length > 0 && args[0] instanceof LiteralExpression && args[0].token?.kind === TokenKind.StringLiteral) {
        return args[0].token.text.slice(1, -1);
      }
    }
  }
  return undefined;
}

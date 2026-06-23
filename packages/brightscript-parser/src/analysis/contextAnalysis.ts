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
  inlineAAFunctions: { aaFieldName: string; line: number }[];
  /** Get all context fields assigned within a specific function. */
  getFieldsInFunction(funcName: string): ContextField[];
  /** Get all context fields across all functions (the full m scope). */
  getAllFields(): ContextField[];
}

/**
 * Analyzes `m` context usage across the file.
 */
export function analyzeContext(root: SyntaxNode): ContextAnalysis {
  const contextFields: ContextField[] = [];
  const functionBindings: FunctionBinding[] = [];
  const inlineAAFunctions: { aaFieldName: string; line: number }[] = [];
  const functionStack: string[] = [];

  // Use an explicit enter/leave traversal so statements after nested functions
  // are attributed to the enclosing function rather than the nested one.
  collectContext(root);

  function collectContext(node: SyntaxNode): void {
    let pushedFunction = false;
    if (node.kind === SyntaxKind.FunctionDeclaration) {
      functionStack.push(new FunctionDeclaration(node).name.toLowerCase());
      pushedFunction = true;
    } else if (node.kind === SyntaxKind.FunctionExpression) {
      functionStack.push('');
      pushedFunction = true;
    }

    if (node.kind === SyntaxKind.AssignmentStatement) {
      collectAssignment(new AssignmentStatement(node));
    } else if (node.kind === SyntaxKind.AAField) {
      collectAAField(new AAField(node));
    }

    for (const child of node.children) {
      if (isNode(child)) {
        collectContext(child);
      }
    }

    if (pushedFunction) {
      functionStack.pop();
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

      // aa.field = someFunction → function binding
      if (obj instanceof IdentifierExpression && obj.name.toLowerCase() !== 'm') {
        const value = node.value;
        if (value instanceof IdentifierExpression) {
          functionBindings.push({
            aaName: obj.name.toLowerCase(),
            fieldName: target.member.toLowerCase(),
            functionName: value.name.toLowerCase(),
            line: target.memberToken?.line ?? 0,
          });
        }
      }
    }
  }

  function collectAAField(node: AAField): void {
    // { key: function() ... } → inline AA function
    const value = node.value;
    if (value instanceof FunctionExpression) {
      inlineAAFunctions.push({
        aaFieldName: node.key.toLowerCase(),
        line: node.keyToken?.line ?? 0,
      });
    }
  }

  return {
    contextFields,
    functionBindings,
    inlineAAFunctions,

    getFieldsInFunction(funcName: string): ContextField[] {
      return contextFields.filter(f => f.assignedInFunction === funcName.toLowerCase());
    },

    getAllFields(): ContextField[] {
      return contextFields;
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

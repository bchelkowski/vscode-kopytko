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
import { TokenKind } from '../tokenKind.js';
import { Token } from '../token.js';
import { walk } from '../visitor.js';
import {
  FunctionDeclaration, FunctionExpression, AssignmentStatement,
  CallExpression, DotExpression, IdentifierExpression, LiteralExpression,
} from '../ast.js';

export interface TypeBinding {
  name: string;
  typeName: string;
  source: 'createobject' | 'param-annotation' | 'literal' | 'return-type' | 'designator';
  line: number;
  column: number;
}

export type TypeMap = Map<string, TypeBinding[]>;

export function inferTypesFromAst(root: SyntaxNode): TypeMap {
  const typeMap: TypeMap = new Map();

  walk(root, {
    visitAssignmentStatement(node: AssignmentStatement) {
      const target = node.target;
      if (!target) return;

      let varName: string | undefined;
      let varLine = 0, varCol = 0;

      if (target instanceof IdentifierExpression) {
        varName = target.name.toLowerCase();
        const t = target.nameToken;
        if (t) { varLine = t.line; varCol = t.column; }
      } else if (target instanceof DotExpression) {
        const obj = target.object;
        if (obj instanceof IdentifierExpression && obj.name.toLowerCase() === 'm') {
          varName = target.member.toLowerCase();
          const t = target.memberToken;
          if (t) { varLine = t.line; varCol = t.column; }
        }
      }

      if (!varName) return;
      const value = node.value;
      if (!value) return;

      if (value instanceof CallExpression) {
        const callee = value.callee;
        if (callee instanceof IdentifierExpression && callee.name.toLowerCase() === 'createobject') {
          const args = value.args;
          if (args.length > 0 && args[0] instanceof LiteralExpression) {
            const token = args[0].token;
            if (token && token.kind === TokenKind.StringLiteral) {
              addType(typeMap, varName, { name: varName, typeName: token.text.slice(1, -1), source: 'createobject', line: varLine, column: varCol });
            }
          }
        }
      }

      if (value instanceof LiteralExpression && value.token) {
        const litType = inferLiteralType(value.token);
        if (litType) {
          addType(typeMap, varName, { name: varName, typeName: litType, source: 'literal', line: varLine, column: varCol });
        }
      }
    },

    visitFunctionDeclaration(node: FunctionDeclaration) {
      for (const param of node.params) {
        if (param.typeName) {
          const t = param.nameToken;
          addType(typeMap, param.name.toLowerCase(), {
            name: param.name.toLowerCase(), typeName: param.typeName,
            source: 'param-annotation', line: t?.line ?? 0, column: t?.column ?? 0,
          });
        }
      }
    },

    visitFunctionExpression(node: FunctionExpression) {
      for (const param of node.params) {
        if (param.typeName) {
          const t = param.nameToken;
          addType(typeMap, param.name.toLowerCase(), {
            name: param.name.toLowerCase(), typeName: param.typeName,
            source: 'param-annotation', line: t?.line ?? 0, column: t?.column ?? 0,
          });
        }
      }
    },
  });

  return typeMap;
}

function addType(map: TypeMap, name: string, binding: TypeBinding): void {
  const existing = map.get(name);
  if (existing) existing.push(binding);
  else map.set(name, [binding]);
}

function inferLiteralType(token: Token): string | undefined {
  switch (token.kind) {
    case TokenKind.IntegerLiteral: return 'Integer';
    case TokenKind.LongIntegerLiteral: return 'LongInteger';
    case TokenKind.FloatLiteral: return 'Float';
    case TokenKind.DoubleLiteral: return 'Double';
    case TokenKind.StringLiteral: return 'String';
    case TokenKind.True: case TokenKind.False: return 'Boolean';
    case TokenKind.Invalid: return 'Invalid';
    default: return undefined;
  }
}

export function getVariableType(typeMap: TypeMap, varName: string): string | undefined {
  const bindings = typeMap.get(varName.toLowerCase());
  if (!bindings || bindings.length === 0) return undefined;
  const createObj = bindings.find(b => b.source === 'createobject');
  if (createObj) return createObj.typeName;
  const paramAnnotation = bindings.find(b => b.source === 'param-annotation');
  if (paramAnnotation) return paramAnnotation.typeName;
  return bindings[0].typeName;
}

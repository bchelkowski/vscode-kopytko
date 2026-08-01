/**
 * AST-based type inference for BrightScript.
 *
 * Tracks the possible types of variables through:
 * - CreateObject("roFoo") → type is "roFoo"
 * - Parameter type annotations: `param as Integer` → "Integer"
 * - Numeric/string/boolean literal assignments
 * - Return type annotations on functions
 * - Type designator suffixes: `x$` → String, `x%` → Integer, etc.
 *
 * `TypeMap` stays a flat `Map<name, TypeBinding[]>` — same shape as before —
 * for source compatibility with existing consumers (`getVariableType` reads
 * it exactly as it always has). What changed is that every binding now also
 * records the function scope it was collected in (`scopeOwner`), so a
 * scope-aware caller can use `getVariableTypeInScope` to resolve a name the
 * way BrightScript actually would: `x` in one function must never resolve to
 * an unrelated `x` local to a different function, and neither should resolve
 * to an `m.x` field — those live in a third, distinct namespace. The legacy
 * `getVariableType(typeMap, name)` is unchanged and still doesn't make this
 * distinction; prefer `getVariableTypeInScope` for anything scope-sensitive.
 */

import { SyntaxNode, isNode } from '../syntaxNode.js';
import { SyntaxKind } from '../syntaxKind.js';
import { TokenKind } from '../tokenKind.js';
import { Token } from '../token.js';
import { walk } from '../visitor.js';
import {
  FunctionDeclaration, FunctionExpression, AssignmentStatement,
  CallExpression, DotExpression, IdentifierExpression, LiteralExpression,
} from '../ast.js';
import { Scope } from '../scope.js';

/**
 * The scope a `TypeBinding` was collected in: a function/sub `SyntaxNode`,
 * `null` for file (top-level) scope, or the sentinel `'m-context'` for an
 * `m.field = value` binding — `m` fields live in a namespace of their own,
 * not a particular function's locals, so they never match a plain-variable
 * scope lookup in `getVariableTypeInScope`.
 */
export type TypeScopeOwner = SyntaxNode | 'm-context' | null;

export interface TypeBinding {
  name: string;
  typeName: string;
  source: 'createobject' | 'param-annotation' | 'literal' | 'return-type' | 'designator';
  line: number;
  column: number;
  /** See `TypeScopeOwner`. */
  scopeOwner: TypeScopeOwner;
}

export type TypeMap = Map<string, TypeBinding[]>;

const DESIGNATOR_TYPES: Record<string, string> = {
  '$': 'String',
  '%': 'Integer',
  '!': 'Float',
  '#': 'Double',
  '&': 'LongInteger',
};

/** The type implied by an identifier's own type-designator suffix (`x$` → `String`), if any. */
function designatorType(nameText: string): string | undefined {
  const last = nameText[nameText.length - 1];
  return DESIGNATOR_TYPES[last];
}

export function inferTypesFromAst(root: SyntaxNode): TypeMap {
  const typeMap: TypeMap = new Map();
  const scopeStack: (SyntaxNode | null)[] = [null];

  // First pass: collect same-file function return types so an assignment
  // like `x = someFunc()` can be typed from `someFunc`'s `as Type` clause.
  const functionReturnTypes = new Map<string, string>();
  walk(root, {
    visitFunctionDeclaration(node: FunctionDeclaration) {
      if (node.returnType) functionReturnTypes.set(node.name.toLowerCase(), node.returnType);
    },
  });

  collect(root);

  function currentScope(): SyntaxNode | null {
    return scopeStack[scopeStack.length - 1];
  }

  function collect(node: SyntaxNode): void {
    let pushedScope = false;

    if (node.kind === SyntaxKind.FunctionDeclaration || node.kind === SyntaxKind.FunctionExpression) {
      const fn = node.kind === SyntaxKind.FunctionDeclaration
        ? new FunctionDeclaration(node) : new FunctionExpression(node);
      scopeStack.push(node);
      pushedScope = true;

      for (const param of fn.params) {
        const t = param.nameToken;
        if (param.typeName) {
          addType(typeMap, param.name.toLowerCase(), {
            name: param.name.toLowerCase(), typeName: param.typeName,
            source: 'param-annotation', line: t?.line ?? 0, column: t?.column ?? 0,
            scopeOwner: node,
          });
        } else {
          const dt = designatorType(param.name);
          if (dt) {
            addType(typeMap, param.name.toLowerCase(), {
              name: param.name.toLowerCase(), typeName: dt,
              source: 'designator', line: t?.line ?? 0, column: t?.column ?? 0,
              scopeOwner: node,
            });
          }
        }
      }
    } else if (node.kind === SyntaxKind.AssignmentStatement) {
      collectAssignment(new AssignmentStatement(node), currentScope());
    }

    for (const child of node.children) {
      if (isNode(child)) collect(child);
    }

    if (pushedScope) scopeStack.pop();
  }

  function collectAssignment(node: AssignmentStatement, scopeOwner: SyntaxNode | null): void {
    const target = node.target;
    if (!target) return;

    let varName: string | undefined;
    let varLine = 0, varCol = 0;
    let bindingScope: TypeScopeOwner = scopeOwner;

    if (target instanceof IdentifierExpression) {
      varName = target.name.toLowerCase();
      const t = target.nameToken;
      if (t) { varLine = t.line; varCol = t.column; }

      const dt = designatorType(target.name);
      if (dt) {
        addType(typeMap, varName, {
          name: varName, typeName: dt, source: 'designator',
          line: varLine, column: varCol, scopeOwner,
        });
      }
    } else if (target instanceof DotExpression && !target.isAttributeAccess) {
      const obj = target.object;
      if (obj instanceof IdentifierExpression && obj.name.toLowerCase() === 'm') {
        varName = target.member.toLowerCase();
        const t = target.memberToken;
        if (t) { varLine = t.line; varCol = t.column; }
        bindingScope = 'm-context';
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
            addType(typeMap, varName, {
              name: varName, typeName: token.text.slice(1, -1), source: 'createobject',
              line: varLine, column: varCol, scopeOwner: bindingScope,
            });
          }
        }
      } else if (callee instanceof IdentifierExpression) {
        const retType = functionReturnTypes.get(callee.name.toLowerCase());
        if (retType) {
          addType(typeMap, varName, {
            name: varName, typeName: retType, source: 'return-type',
            line: varLine, column: varCol, scopeOwner: bindingScope,
          });
        }
      }
    }

    if (value instanceof LiteralExpression && value.token) {
      const litType = inferLiteralType(value.token);
      if (litType) {
        addType(typeMap, varName, {
          name: varName, typeName: litType, source: 'literal',
          line: varLine, column: varCol, scopeOwner: bindingScope,
        });
      }
    }
  }

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

/**
 * Legacy, scope-blind lookup: the first matching binding across the WHOLE
 * file, regardless of which function it came from. Two different functions'
 * same-named locals collide here — kept unchanged for existing callers;
 * prefer `getVariableTypeInScope` for anything that needs to be correct
 * across more than one function.
 */
export function getVariableType(typeMap: TypeMap, varName: string): string | undefined {
  const bindings = typeMap.get(varName.toLowerCase());
  if (!bindings || bindings.length === 0) return undefined;
  const createObj = bindings.find(b => b.source === 'createobject');
  if (createObj) return createObj.typeName;
  const paramAnnotation = bindings.find(b => b.source === 'param-annotation');
  if (paramAnnotation) return paramAnnotation.typeName;
  return bindings[0].typeName;
}

/**
 * Scope-correct lookup: resolves `varName` the way BrightScript would,
 * walking from `scope` up through enclosing function scopes (mirroring
 * `resolve()` in scope.ts) and only considering bindings whose `scopeOwner`
 * is one of those scopes' owners. Never matches an `m-context` binding —
 * pass `varName` of `'m'` field name and check `getVariableType`'s
 * `m-context`-scoped bindings separately (or use `analyzeContext` from
 * `contextAnalysis.ts`, the dedicated `m` API) if that's what's needed.
 */
export function getVariableTypeInScope(typeMap: TypeMap, varName: string, scope: Scope): string | undefined {
  const bindings = typeMap.get(varName.toLowerCase());
  if (!bindings || bindings.length === 0) return undefined;

  const validOwners = new Set<SyntaxNode | null>();
  for (let s: Scope | null = scope; s; s = s.parent) validOwners.add(s.owner);

  const inScope = bindings.filter(b => b.scopeOwner !== 'm-context' && validOwners.has(b.scopeOwner));
  if (inScope.length === 0) return undefined;

  const designator = inScope.find(b => b.source === 'designator');
  if (designator) return designator.typeName;
  const createObj = inScope.find(b => b.source === 'createobject');
  if (createObj) return createObj.typeName;
  const paramAnnotation = inScope.find(b => b.source === 'param-annotation');
  if (paramAnnotation) return paramAnnotation.typeName;
  const returnType = inScope.find(b => b.source === 'return-type');
  if (returnType) return returnType.typeName;
  return inScope[0].typeName;
}

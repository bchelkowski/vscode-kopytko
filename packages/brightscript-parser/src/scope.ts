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

import { SyntaxNode, isNode, isToken } from './syntaxNode.js';
import { SyntaxKind } from './syntaxKind.js';
import { TokenKind } from './tokenKind.js';

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

export type DeclarationKind =
  | 'function'
  | 'parameter'
  | 'variable'
  | 'for-variable'
  | 'catch-variable'
  | 'dim-variable';

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
  /**
   * True when this reference is the sole target of a plain `=` assignment (pure write).
   * False for reads and compound assignments (`+=`, `-=`, etc.) which also read the value.
   */
  readonly isWrite: boolean;
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

const ALWAYS_VALID = new Set(['m', 'true', 'false', 'invalid', 'line_num']);

/**
 * Builds a scope tree from a parsed source file.
 *
 * @param root - The SourceFile CST node.
 * @returns The file-level scope with all nested scopes.
 */
export function buildScopes(root: SyntaxNode): Scope {
  const fileScope: Scope = {
    owner: null,
    ownerName: '',
    parent: null,
    declarations: new Map(),
    references: [],
    children: [],
  };

  collectFromNode(root, fileScope);
  return fileScope;
}

/**
 * Finds the innermost scope that contains the given line.
 */
export function findScopeAtLine(scope: Scope, line: number): Scope {
  for (const child of scope.children) {
    if (child.owner) {
      const ownerStart = getNodeLine(child.owner);
      const ownerEnd = getNodeEndLine(child.owner);
      if (line >= ownerStart && line <= ownerEnd) {
        return findScopeAtLine(child, line);
      }
    }
  }
  return scope;
}

/**
 * Resolves a name in the given scope, searching up the scope chain.
 * Returns the declaration or undefined if not found.
 */
export function resolve(name: string, scope: Scope): Declaration | undefined {
  const lower = name.toLowerCase();
  if (ALWAYS_VALID.has(lower)) return undefined; // implicitly valid

  let current: Scope | null = scope;
  while (current) {
    const decl = current.declarations.get(lower);
    if (decl) return decl;
    current = current.parent;
  }
  return undefined;
}

// ─── Internal ───────────────────────────────────────────────────────────────

function collectFromNode(node: SyntaxNode, scope: Scope): void {
  switch (node.kind) {
    case SyntaxKind.FunctionDeclaration:
      collectFunctionDeclaration(node, scope);
      return; // don't recurse — child scope handles body
    case SyntaxKind.FunctionExpression:
      collectFunctionExpression(node, scope);
      return;
    case SyntaxKind.AssignmentStatement: {
      collectAssignment(node, scope);
      // Add the LHS reference with the correct isWrite flag, then recurse only into
      // non-LHS children so the LHS identifier isn't double-counted.
      const lhsNode = node.childNodes[0];
      if (lhsNode?.kind === SyntaxKind.IdentifierExpression) {
        // Plain `=` is a pure write; compound operators (`+=`, `-=`, etc.) also read.
        const opToken = node.children.find(isToken);
        const nameToken = lhsNode.findToken(TokenKind.Identifier);
        if (nameToken) {
          scope.references.push({
            name: nameToken.text,
            nameLower: nameToken.text.toLowerCase(),
            line: nameToken.line,
            column: nameToken.column,
            node: lhsNode,
            isWrite: opToken?.kind === TokenKind.Equal,
          });
        }
        for (const child of node.children) {
          if (isNode(child) && child !== lhsNode) collectFromNode(child, scope);
        }
      } else {
        // Non-identifier LHS (index access, dot access) — all its refs are reads.
        for (const child of node.children) {
          if (isNode(child)) collectFromNode(child, scope);
        }
      }
      return;
    }
    case SyntaxKind.ForStatement:
      collectForVariable(node, scope);
      break;
    case SyntaxKind.ForEachStatement:
      collectForEachVariable(node, scope);
      break;
    case SyntaxKind.CatchClause:
      collectCatchVariable(node, scope);
      break;
    case SyntaxKind.DimStatement:
      collectDimVariable(node, scope);
      break;
    case SyntaxKind.ConditionalCompilation:
      // Process body statements inside #if blocks (they contain real BrightScript)
      // but skip the condition expression (manifest constants like RALE, DEBUG)
      collectConditionalBody(node, scope);
      return;
    case SyntaxKind.HashConstStatement:
    case SyntaxKind.HashErrorStatement:
      // Skip entirely — #const and #error don't contain BrightScript code
      return;
    case SyntaxKind.CallExpression:
    case SyntaxKind.IdentifierExpression:
      collectReferences(node, scope);
      break;
    default:
      break;
  }

  // Recurse into children
  for (const child of node.children) {
    if (isNode(child)) {
      collectFromNode(child, scope);
    }
  }
}

/**
 * Processes a ConditionalCompilation node: skips the condition identifiers
 * (#if RALE, #else if FLAG) but analyzes the body statements normally.
 */
function collectConditionalBody(node: SyntaxNode, scope: Scope): void {
  // The children of ConditionalCompilation are:
  // - HashIf/HashElseIf/HashElse/HashEndIf tokens
  // - Condition expression node (skip — manifest constants)
  // - Body statements (process normally)
  let skipNextExpression = false;
  for (const child of node.children) {
    if (isToken(child)) {
      // After #if or #else if, the next child node is the condition — skip it
      skipNextExpression = (child.kind === TokenKind.HashIf || child.kind === TokenKind.HashElseIf);
      continue;
    }
    if (isNode(child)) {
      if (skipNextExpression) {
        // This is the condition expression (could be IdentifierExpression,
        // UnaryExpression like `NOT flag`, BinaryExpression, etc.) — skip entirely
        skipNextExpression = false;
        continue;
      }
      // Body statement — process normally
      collectFromNode(child, scope);
    }
  }
}

function collectFunctionDeclaration(node: SyntaxNode, parentScope: Scope): void {
  const nameToken = node.findToken(TokenKind.Identifier);
  const name = nameToken?.text ?? '';

  // Register the function in the parent scope
  if (name) {
    parentScope.declarations.set(name.toLowerCase(), {
      name,
      nameLower: name.toLowerCase(),
      kind: 'function',
      line: nameToken!.line,
      column: nameToken!.column,
      node,
    });
  }

  // Create child scope
  const childScope: Scope = {
    owner: node,
    ownerName: name.toLowerCase(),
    parent: parentScope,
    declarations: new Map(),
    references: [],
    children: [],
  };
  parentScope.children.push(childScope);

  // Collect parameters
  const paramList = node.findChild(SyntaxKind.ParameterList);
  if (paramList) {
    for (const param of paramList.findAllChildren(SyntaxKind.Parameter)) {
      const pName = param.findToken(TokenKind.Identifier);
      if (pName) {
        childScope.declarations.set(pName.text.toLowerCase(), {
          name: pName.text,
          nameLower: pName.text.toLowerCase(),
          kind: 'parameter',
          line: pName.line,
          column: pName.column,
          node: param,
        });
      }
    }
  }

  // Collect body
  for (const child of node.children) {
    if (isNode(child) && child.kind !== SyntaxKind.ParameterList
        && child.kind !== SyntaxKind.ReturnTypeClause) {
      collectFromNode(child, childScope);
    }
  }
}

function collectFunctionExpression(node: SyntaxNode, parentScope: Scope): void {
  const childScope: Scope = {
    owner: node,
    ownerName: '',
    parent: parentScope,
    declarations: new Map(),
    references: [],
    children: [],
  };
  parentScope.children.push(childScope);

  const paramList = node.findChild(SyntaxKind.ParameterList);
  if (paramList) {
    for (const param of paramList.findAllChildren(SyntaxKind.Parameter)) {
      const pName = param.findToken(TokenKind.Identifier);
      if (pName) {
        childScope.declarations.set(pName.text.toLowerCase(), {
          name: pName.text,
          nameLower: pName.text.toLowerCase(),
          kind: 'parameter',
          line: pName.line,
          column: pName.column,
          node: param,
        });
      }
    }
  }

  for (const child of node.children) {
    if (isNode(child) && child.kind !== SyntaxKind.ParameterList
        && child.kind !== SyntaxKind.ReturnTypeClause) {
      collectFromNode(child, childScope);
    }
  }
}

function collectAssignment(node: SyntaxNode, scope: Scope): void {
  // The first child is the target — if it's a plain identifier, it's a variable declaration
  const firstChild = node.childNodes[0];
  if (firstChild && firstChild.kind === SyntaxKind.IdentifierExpression) {
    const nameToken = firstChild.findToken(TokenKind.Identifier);
    if (nameToken && !scope.declarations.has(nameToken.text.toLowerCase())) {
      scope.declarations.set(nameToken.text.toLowerCase(), {
        name: nameToken.text,
        nameLower: nameToken.text.toLowerCase(),
        kind: 'variable',
        line: nameToken.line,
        column: nameToken.column,
        node: firstChild,
      });
    }
  }
}

function collectForVariable(node: SyntaxNode, scope: Scope): void {
  const nameToken = node.findToken(TokenKind.Identifier);
  if (!nameToken) return;
  if (!scope.declarations.has(nameToken.text.toLowerCase())) {
    scope.declarations.set(nameToken.text.toLowerCase(), {
      name: nameToken.text,
      nameLower: nameToken.text.toLowerCase(),
      kind: 'for-variable',
      line: nameToken.line,
      column: nameToken.column,
      node,
    });
  }
  // The for-counter is assigned at the start of every loop run — record as a write.
  // For the first declaration this overlaps the decl site and is skipped by the rule's
  // self-reference check; for re-use in a later loop it enables the intermediate-write path.
  scope.references.push({
    name: nameToken.text,
    nameLower: nameToken.text.toLowerCase(),
    line: nameToken.line,
    column: nameToken.column,
    node,
    isWrite: true,
  });
}

function collectForEachVariable(node: SyntaxNode, scope: Scope): void {
  // Iterator variable is the identifier after 'each'
  let foundEach = false;
  for (const child of node.children) {
    if (isToken(child) && child.kind === TokenKind.Each) { foundEach = true; continue; }
    if (foundEach && isToken(child) && child.kind === TokenKind.Identifier) {
      if (!scope.declarations.has(child.text.toLowerCase())) {
        scope.declarations.set(child.text.toLowerCase(), {
          name: child.text,
          nameLower: child.text.toLowerCase(),
          kind: 'for-variable',
          line: child.line,
          column: child.column,
          node,
        });
      }
      // The for-each assigns this variable before each iteration — record as a write.
      scope.references.push({
        name: child.text,
        nameLower: child.text.toLowerCase(),
        line: child.line,
        column: child.column,
        node,
        isWrite: true,
      });
      break;
    }
  }
}

function collectCatchVariable(node: SyntaxNode, scope: Scope): void {
  // `catch e` and `catch (e)` both parse with the identifier as a direct
  // child now (parseCatchClause accepts both forms) — no need to search
  // deeper into a leftover `(e)` grouping expression from a parse error.
  const nameToken = node.findToken(TokenKind.Identifier);
  if (nameToken && !scope.declarations.has(nameToken.text.toLowerCase())) {
    scope.declarations.set(nameToken.text.toLowerCase(), {
      name: nameToken.text,
      nameLower: nameToken.text.toLowerCase(),
      kind: 'catch-variable',
      line: nameToken.line,
      column: nameToken.column,
      node,
    });
  }
}

function collectDimVariable(node: SyntaxNode, scope: Scope): void {
  const nameToken = node.findToken(TokenKind.Identifier);
  if (nameToken && !scope.declarations.has(nameToken.text.toLowerCase())) {
    scope.declarations.set(nameToken.text.toLowerCase(), {
      name: nameToken.text,
      nameLower: nameToken.text.toLowerCase(),
      kind: 'dim-variable',
      line: nameToken.line,
      column: nameToken.column,
      node,
    });
  }
}

function collectReferences(node: SyntaxNode, scope: Scope): void {
  if (node.kind === SyntaxKind.IdentifierExpression) {
    const token = node.findToken(TokenKind.Identifier);
    if (token) {
      scope.references.push({
        name: token.text,
        nameLower: token.text.toLowerCase(),
        line: token.line,
        column: token.column,
        node,
        isWrite: false,
      });
    }
  }
  // For call expressions, collect the callee as a reference
  if (node.kind === SyntaxKind.CallExpression) {
    const callee = node.childNodes[0];
    if (callee && callee.kind === SyntaxKind.IdentifierExpression) {
      const token = callee.findToken(TokenKind.Identifier);
      if (token) {
        scope.references.push({
          name: token.text,
          nameLower: token.text.toLowerCase(),
          line: token.line,
          column: token.column,
          node: callee,
          isWrite: false,
        });
      }
    }
  }
}

function getNodeLine(node: SyntaxNode): number {
  for (const child of node.children) {
    if (isToken(child)) return child.line;
    if (isNode(child)) return getNodeLine(child);
  }
  return 0;
}

function getNodeEndLine(node: SyntaxNode): number {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (isToken(child)) return child.line;
    if (isNode(child)) return getNodeEndLine(child);
  }
  return 0;
}

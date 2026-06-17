/* eslint-disable @typescript-eslint/no-unused-vars *//**
 * CST Pass: Keyword and identifier casing.
 *
 * Applies casing normalization to keywords, builtins, and user functions.
 * Handles edge cases: callable keywords (CreateObject), dot access exclusion,
 * type annotation keywords, and AA keys.
 */

import { SyntaxNode, SyntaxKind, TokenKind, isKeyword, isToken, isNode } from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';
import {
  BRIGHTSCRIPT_BUILTINS, getKeywordCategory,
  CasingConfig, applyCasing, CasingOption, resolveKeywordCasing,
} from 'kopytko-brightscript-parser';

const builtinMap = new Map<string, string>(
  BRIGHTSCRIPT_BUILTINS.map(b => [b.name.toLowerCase(), b.name])
);

// Keywords that are also callable as functions — apply builtin casing to these
const CALLABLE_KEYWORDS = new Set([
  TokenKind.CreateObject, TokenKind.Type, TokenKind.GetGlobalAA,
  TokenKind.Box, TokenKind.Eval, TokenKind.Run,
  TokenKind.GetLastRunCompileError, TokenKind.GetLastRunRunTimeError,
]);

export function casingPass(
  casingConfig: CasingConfig,
  userFunctions: Map<string, string> = new Map(),
): (root: SyntaxNode, source: string) => TextEdit[] {
  return (root: SyntaxNode, _source: string): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode, afterDot: boolean): void {
      let afterAs = false;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];

        if (isToken(child)) {
          processToken(child, afterDot, afterAs, node, edits, casingConfig, userFunctions);
          // Track context for next token
          afterDot = child.kind === TokenKind.Dot;
          afterAs = child.kind === TokenKind.As;
        } else if (isNode(child)) {
          // Don't apply user function casing inside AA field keys
          if (child.kind === SyntaxKind.AAField) {
            visitAAField(child, edits, casingConfig);
          } else {
            // Pass afterDot=true if this node follows a dot token
            visit(child, afterDot);
          }
          afterDot = false;
        }
      }
    }

    visit(root, false);
    return edits;
  };
}

function processToken(
  token: Token, afterDot: boolean, afterAs: boolean, parent: SyntaxNode,
  edits: TextEdit[], config: CasingConfig, userFunctions: Map<string, string>,
): void {
  if (token.kind === TokenKind.StringLiteral || token.kind === TokenKind.Eof) return;

  const lower = token.text.toLowerCase();

  // Exact overrides
  if (config.exact && config.exact[lower]) {
    const desired = config.exact[lower];
    if (desired !== token.text) {
      edits.push({ pos: token.pos, end: token.end, newText: desired });
    }
    return;
  }

  // Callable keywords (CreateObject, Type, etc.) — always normalize to catalog casing
  // BUT skip if after dot (it's a property name, not a function call)
  if (CALLABLE_KEYWORDS.has(token.kind)) {
    if (afterDot) return; // e.g., m.input.type — 'type' is just a field name
    const canonical = builtinMap.get(lower) ?? token.text;
    const newText = config.builtin && config.builtin !== 'preserve'
      ? applyCasing(canonical, config.builtin)
      : canonical; // preserve = use catalog casing
    if (newText !== token.text) {
      edits.push({ pos: token.pos, end: token.end, newText });
    }
    return;
  }

  // Regular keywords — skip if after dot (field name)
  if (isKeyword(token.kind)) {
    if (afterDot) return; // e.g., obj.end, node.next — keywords used as field names
    if (afterAs) {
      // 'as Function', 'as Sub' etc. — use type casing
      const typeOption = resolveKeywordCasing('type', config);
      if (typeOption && typeOption !== 'preserve') {
        const newText = applyCasing(token.text, typeOption);
        if (newText !== token.text) {
          edits.push({ pos: token.pos, end: token.end, newText });
        }
      }
    } else {
      const category = getKeywordCategory(lower);
      const option = resolveKeywordCasing(category, config);
      if (option && option !== 'preserve') {
        const newText = applyCasing(token.text, option);
        if (newText !== token.text) {
          edits.push({ pos: token.pos, end: token.end, newText });
        }
      }
    }
    return;
  }

  // Identifiers
  if (token.kind === TokenKind.Identifier) {
    // After dot — don't apply user function casing (it's a property access)
    if (afterDot) return;

    // After 'as' — this is a type name, apply type casing
    if (afterAs) {
      const typeOption = resolveKeywordCasing('type', config);
      if (typeOption && typeOption !== 'preserve') {
        const newText = applyCasing(token.text, typeOption);
        if (newText !== token.text) {
          edits.push({ pos: token.pos, end: token.end, newText });
        }
      }
      return;
    }

    // Builtin functions — only normalize when used as a call (followed by `(`)
    // Don't normalize parameters/variables that share a builtin name
    const canonical = builtinMap.get(lower);
    if (canonical) {
      // Check if this is being used as a function call by looking ahead
      // in the parent node for a LeftParen or being inside a CallExpression
      const isCall = isBuiltinCall(token, parent);
      if (isCall) {
        const newText = config.builtin && config.builtin !== 'preserve'
          ? applyCasing(canonical, config.builtin)
          : canonical;
        if (newText !== token.text) {
          edits.push({ pos: token.pos, end: token.end, newText });
        }
      }
      return;
    }

    // User-defined functions (only for standalone calls, not after dot)
    // Always normalize to canonical casing from the definition
    const userCanonical = userFunctions.get(lower);
    if (userCanonical) {
      const newText = config.userFunction && config.userFunction !== 'preserve'
        ? applyCasing(userCanonical, config.userFunction)
        : userCanonical; // preserve = use definition casing
      if (newText !== token.text) {
        edits.push({ pos: token.pos, end: token.end, newText });
      }
    }
  }
}

/** Don't apply casing to AA field key names. */
function visitAAField(node: SyntaxNode, edits: TextEdit[], config: CasingConfig): void {
  let isKey = true;
  for (const child of node.children) {
    if (isToken(child) && child.kind === TokenKind.Colon) {
      isKey = false;
      continue;
    }
    if (isKey) continue; // skip the key
    if (isNode(child)) {
      // Process value side normally
      visitNormal(child, edits, config, new Map());
    }
  }
}

/** For DotExpression: apply casing to the object but not the member after dot. */
function visitDotExpression(node: SyntaxNode, edits: TextEdit[], config: CasingConfig, userFunctions: Map<string, string>): void {
  let afterDot = false;
  for (const child of node.children) {
    if (isToken(child)) {
      if (!afterDot) {
        processToken(child, false, false, node, edits, config, userFunctions);
      }
      afterDot = child.kind === TokenKind.Dot;
    } else if (isNode(child)) {
      if (!afterDot) {
        visitNormal(child, edits, config, userFunctions);
      }
      afterDot = false;
    }
  }
}

function visitNormal(node: SyntaxNode, edits: TextEdit[], config: CasingConfig, userFunctions: Map<string, string>): void {
  let afterDot = false;
  let afterAs = false;
  for (const child of node.children) {
    if (isToken(child)) {
      processToken(child, afterDot, afterAs, node, edits, config, userFunctions);
      afterDot = child.kind === TokenKind.Dot;
      afterAs = child.kind === TokenKind.As;
    } else if (isNode(child)) {
      if (child.kind === SyntaxKind.AAField) {
        visitAAField(child, edits, config);
      } else {
        visitNormal(child, edits, config, userFunctions);
      }
      afterDot = false;
      afterAs = false;
    }
  }
}

/** Checks if a builtin-named token is used as a function call (parent is CallExpression or IdentifierExpression inside CallExpression). */
function isBuiltinCall(token: Token, parent: SyntaxNode): boolean {
  // If the parent is an IdentifierExpression inside a CallExpression, it's a call
  if (parent.kind === SyntaxKind.CallExpression) return true;
  // If the parent is an IdentifierExpression, check its parent
  if (parent.kind === SyntaxKind.IdentifierExpression && parent.parent?.kind === SyntaxKind.CallExpression) return true;
  // Check if token is directly inside an expression that's the callee of a call
  return false;
}

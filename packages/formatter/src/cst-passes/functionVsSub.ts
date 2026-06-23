/**
 * CST Pass: Function vs Sub for void.
 *
 * Converts between `function`/`sub` for void procedures:
 * - 'sub': converts `function foo() as Void ... end function` to `sub foo() ... end sub`
 * - 'function': converts `sub foo() ... end sub` to `function foo() as Void ... end function`
 */

import { SyntaxNode, SyntaxKind, TokenKind, isNode } from 'kopytko-brightscript-parser';
import { TextEdit } from './infrastructure';

type FuncVsSub = 'function' | 'sub' | 'preserve';

export function functionVsSubPass(style: FuncVsSub): (root: SyntaxNode, source: string) => TextEdit[] {
  if (style === 'preserve') return () => [];

  return (root: SyntaxNode): TextEdit[] => {
    const edits: TextEdit[] = [];

    function visit(node: SyntaxNode): void {
      if (node.kind === SyntaxKind.FunctionDeclaration || node.kind === SyntaxKind.FunctionExpression) {
        processFunctionNode(node, edits, style);
      }
      for (const child of node.children) {
        if (isNode(child)) visit(child);
      }
    }

    visit(root);
    return edits;
  };
}

function processFunctionNode(node: SyntaxNode, edits: TextEdit[], style: FuncVsSub): void {
  const funcToken = node.findToken(TokenKind.Function);
  const subToken = node.findToken(TokenKind.Sub);
  const keyword = funcToken ?? subToken;
  if (!keyword) return;

  const isFunc = funcToken !== undefined;
  const isSub = subToken !== undefined;

  // Find end keyword
  const endFuncToken = node.findToken(TokenKind.EndFunction);
  const endSubToken = node.findToken(TokenKind.EndSub);
  const endToken = endFuncToken ?? endSubToken;

  // Check if it has a non-void return type
  const returnTypeClause = node.findChild(SyntaxKind.ReturnTypeClause);
  const hasExplicitReturnType = returnTypeClause !== undefined;
  let returnTypeName = '';
  if (returnTypeClause) {
    const tokens = returnTypeClause.childTokens;
    if (tokens.length >= 2) returnTypeName = tokens[1].text.toLowerCase();
  }
  const isVoid = !hasExplicitReturnType || returnTypeName === 'void';

  // Check if body has `return <value>`
  if (!isVoid) return; // has explicit non-void return type — don't touch
  const hasReturnValue = checkReturnWithValue(node);
  if (hasReturnValue) return; // returns a value — not a void function

  if (style === 'sub' && isFunc && isVoid) {
    // Convert function → sub: replace keyword, remove 'as Void' if present, replace end keyword
    edits.push({ pos: keyword.pos, end: keyword.end, newText: 'sub' });
    if (returnTypeClause) {
      // Remove the return type clause text only (not trailing trivia/newline)
      // Find the actual token end (not including trailing trivia)
      const clauseTokens = returnTypeClause.childTokens;
      const lastClauseToken = clauseTokens[clauseTokens.length - 1];
      const clauseStart = returnTypeClause.pos;
      const clauseEnd = lastClauseToken ? lastClauseToken.end : returnTypeClause.end;
      // Also remove the space before 'as' (between closing paren and 'as')
      const adjustedStart = clauseStart > 0 ? clauseStart - 1 : clauseStart;
      edits.push({ pos: adjustedStart, end: clauseEnd, newText: '' });
    }
    if (endToken) {
      const newEnd = endToken.text.toLowerCase().includes(' ') ? 'end sub' : 'endsub';
      edits.push({ pos: endToken.pos, end: endToken.end, newText: newEnd });
    }
  } else if (style === 'function' && isSub) {
    // Convert sub → function: replace keyword, add 'as Void', replace end keyword
    edits.push({ pos: keyword.pos, end: keyword.end, newText: 'function' });
    // Insert ' as Void' after the parameter list closing paren
    const paramList = node.findChild(SyntaxKind.ParameterList);
    if (paramList) {
      const rParen = paramList.findToken(TokenKind.RightParen);
      if (rParen) {
        edits.push({ pos: rParen.end, end: rParen.end, newText: ' as Void' });
      }
    }
    if (endToken) {
      const newEnd = endToken.text.toLowerCase().includes(' ') ? 'end function' : 'endfunction';
      edits.push({ pos: endToken.pos, end: endToken.end, newText: newEnd });
    }
  }
}

function checkReturnWithValue(node: SyntaxNode): boolean {
  for (const child of node.children) {
    if (isNode(child)) {
      if (child.kind === SyntaxKind.ReturnStatement) {
        // Check if return has a value (more than just the 'return' token)
        const childNodes = child.childNodes;
        if (childNodes.length > 0) return true;
      }
      // Don't recurse into nested functions
      if (child.kind === SyntaxKind.FunctionDeclaration || child.kind === SyntaxKind.FunctionExpression) continue;
      if (checkReturnWithValue(child)) return true;
    }
  }
  return false;
}

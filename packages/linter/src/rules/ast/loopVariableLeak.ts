import { SyntaxKind, SyntaxNode, isNode, buildScopes, firstToken, lastToken } from 'kopytko-brightscript-parser';
import type { Scope } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

function getFirstTokenLine(node: SyntaxNode): number {
  return firstToken(node)?.line ?? -1;
}

function getLastTokenLine(node: SyntaxNode): number {
  return lastToken(node)?.line ?? -1;
}

interface LoopRange { startLine: number; endLine: number; }

function collectLoopRanges(funcNode: SyntaxNode): LoopRange[] {
  const ranges: LoopRange[] = [];

  // Manual CST traversal — avoids using walk() so the "stop at nested functions"
  // boundary does not fire on the root FunctionDeclaration node itself.
  function traverseNode(node: SyntaxNode): void {
    for (const child of node.children) {
      if (!isNode(child)) continue;
      const kind = child.kind;
      if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.FunctionExpression) {
        continue; // Do not descend into nested function bodies
      }
      if (
        kind === SyntaxKind.ForStatement ||
        kind === SyntaxKind.ForEachStatement ||
        kind === SyntaxKind.WhileStatement
      ) {
        const start = getFirstTokenLine(child);
        const end = getLastTokenLine(child);
        if (start >= 0 && end >= 0) ranges.push({ startLine: start, endLine: end });
        traverseNode(child); // Recurse into the loop body for nested loops
      } else {
        traverseNode(child);
      }
    }
  }

  traverseNode(funcNode);
  return ranges;
}

/**
 * AST-based: detect variables first assigned inside a loop body that are referenced
 * after the loop ends. BrightScript is function-scoped so the variable is technically
 * accessible, but relying on it is fragile when the loop may not execute.
 *
 * Only checks FunctionDeclaration scopes. FunctionExpression scopes (anonymous functions)
 * cannot capture outer-function variables due to BrightScript's no-closures semantics.
 */
export function checkLoopVariableLeakAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config, parseResult } = ctx;
  if (config['identifier/loop-variable-leak'] === 'off') return [];
  if (!parseResult) return [];

  const diagnostics: LintDiagnostic[] = [];
  const rootScope = ctx.analysis?.rootScope ?? buildScopes(parseResult.root);

  function checkFunctionScope(funcScope: Scope): void {
    if (!funcScope.owner) return;
    if (funcScope.owner.kind !== SyntaxKind.FunctionDeclaration) return;

    const loopRanges = collectLoopRanges(funcScope.owner);
    if (loopRanges.length === 0) return;

    // Pre-build a map of write-reference lines per variable for condition B.
    const writeLinesByName = new Map<string, number[]>();
    for (const ref of funcScope.references) {
      if (!ref.isWrite) continue;
      if (!writeLinesByName.has(ref.nameLower)) writeLinesByName.set(ref.nameLower, []);
      writeLinesByName.get(ref.nameLower)!.push(ref.line);
    }

    for (const [, decl] of funcScope.declarations) {
      if (decl.kind !== 'variable' && decl.kind !== 'for-variable' && decl.kind !== 'dim-variable') continue;

      // Find the INNERMOST (smallest range) loop that contains the declaration line.
      // loopRanges is in outer-first order, so .find() would return the outer loop —
      // causing false negatives for variables used between an inner and outer loop's end.
      let containingLoop: LoopRange | undefined;
      for (const r of loopRanges) {
        if (decl.line >= r.startLine && decl.line <= r.endLine) {
          if (!containingLoop || (r.endLine - r.startLine) < (containingLoop.endLine - containingLoop.startLine)) {
            containingLoop = r;
          }
        }
      }
      if (!containingLoop) continue;

      for (const ref of funcScope.references) {
        if (ref.nameLower !== decl.nameLower) continue;
        if (ref.line === decl.line && ref.column === decl.column) continue;
        if (ref.line > containingLoop.endLine) {
          // Condition A: this reference is a plain `=` write — not a read of a
          // potentially-undefined value, so it is always safe.
          if (ref.isWrite) continue;
          // Condition B: a write to this variable exists between the containing loop's
          // end and this reference — the variable was reset before this point.
          const writeLines = writeLinesByName.get(decl.nameLower);
          if (writeLines?.some(wl => wl > containingLoop!.endLine && wl < ref.line)) continue;
          diagnostics.push({
            severity: (config['identifier/loop-variable-leak'] as LintSeverity) ?? 'warning',
            code: 'identifier/loop-variable-leak',
            message: `'${decl.name}' is first assigned inside a loop body and may be undefined if the loop never executes. Define it before the loop.`,
            line: ref.line, column: ref.column,
            endLine: ref.line, endColumn: ref.column + decl.name.length,
            filePath,
          });
        }
      }
    }
  }

  function walkScopes(scope: Scope): void {
    checkFunctionScope(scope);
    for (const child of scope.children) walkScopes(child);
  }

  walkScopes(rootScope);
  return diagnostics;
}

export const descriptor: RuleDefinition = {
  code: 'identifier/loop-variable-leak',
  defaultSeverity: 'warning',
  fn: checkLoopVariableLeakAst,
};

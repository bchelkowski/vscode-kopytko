import {
  parse, buildCallGraph, walk, SyntaxKind, TokenKind, AALiteral,
  parseXmlInterface,
} from 'kopytko-brightscript-parser';
import type { ParseResult, AstNode, CallExpression } from 'kopytko-brightscript-parser';

/**
 * Collects the project-wide union of function names that are legitimate call
 * targets from outside their own file, for CLI-mode `identifier/unused-function`
 * (see `rules/ast/deadFunctions.ts`), populating `LintContext.calledWorkwideFuncNames`.
 *
 * Deliberately a byte-for-byte mirror of the string-pattern extraction in the VS
 * Code extension's `WorkspaceCallIndex._extractCalledNames`
 * (`src/server/utils/workspaceCallIndex.ts`) — direct calls, `observeField`/
 * `observeFieldScoped`/`callFunc` string-argument dispatch, the Kopytko
 * `{ prop: "handlerFn" }` events-AA pattern, and XML `<interface><function>`
 * declarations. All of this is per-file syntactic extraction (pull a string out
 * of a known call/AA shape, union it into a flat set) — no cross-file scope
 * resolution is needed for it, unlike `known`-function-set building elsewhere in
 * this file's caller (`projectIndexer.ts`), so there was no technical reason to
 * leave it out; it was originally left out purely to keep the first CLI-parity
 * pass small.
 *
 * This is a **deliberate mirror across the package boundary**, same as the
 * historical `duplicateComponents.ts`/XML-parser mirrors documented in
 * `findings/lsp-architecture.md`: the linter package cannot depend on the
 * extension's `src/server/`, and the extraction logic only needs already-published
 * parser primitives (`walk`, `SyntaxKind`, `TokenKind`, `CallExpression`,
 * `AALiteral`), so duplicating it here ships without waiting on a parser publish.
 * If this logic is ever promoted into `kopytko-brightscript-parser` as a shared
 * analysis export (both consumers would use it verbatim), delete this file's
 * string-pattern block and import from there instead — check
 * `src/server/utils/workspaceCallIndex.ts`'s own copy stays in sync with this one
 * until then.
 *
 * `parseResultCache` is an out param: every parsed `.brs` file's `ParseResult`
 * is stored into it (keyed by the same normalized path used in
 * `fileContentsCache`) so `runLint` can reuse it for the per-file lint pass
 * instead of parsing the file a second time.
 */
export function collectCalledWorkwideFuncNames(
  fileContentsCache: Map<string, string>,
  parseResultCache: Map<string, ParseResult>,
): Set<string> {
  const called = new Set<string>();

  for (const [path, text] of fileContentsCache) {
    if (path.endsWith('.xml')) {
      const iface = parseXmlInterface(text);
      for (const fn of iface.functions) called.add(fn.name.toLowerCase());
    } else if (path.endsWith('.brs')) {
      const parseResult = parse(text);
      parseResultCache.set(path, parseResult);
      const root = parseResult.root;

      const graph = buildCallGraph(root);
      for (const site of graph.allCalls) {
        if (!site.isMethodCall) called.add(site.calleeName);
      }

      // String callback patterns: observeField, observeFieldScoped, callFunc.
      walk(root, {
        visitCallExpression(node: CallExpression) {
          const calleeSyntax = node.syntax.findChild(SyntaxKind.DotExpression);
          if (!calleeSyntax) return;

          const memberToken = calleeSyntax.childTokens[calleeSyntax.childTokens.length - 1];
          if (!memberToken) return;
          const methodName = memberToken.text.toLowerCase();

          if (methodName === 'observefield' || methodName === 'observefieldscoped') {
            // 2nd argument is the callback name string.
            const args = node.args;
            if (args.length < 2) return;
            const strName = extractStringLiteral(args[1]);
            if (strName) called.add(strName);
          } else if (methodName === 'callfunc') {
            // 1st argument is the function name string.
            const args = node.args;
            if (args.length < 1) return;
            const strName = extractStringLiteral(args[0]);
            if (strName) called.add(strName);
          }
        },

        visitAAField(node) {
          // Kopytko events: { fieldProp: "handlerFn" } pattern.
          const key = node.key.toLowerCase().replace(/"/g, '');
          if (key !== 'events') return;
          const value = node.value;
          if (!value || value.syntax.kind !== SyntaxKind.AALiteral) return;
          const aaValue = new AALiteral(value.syntax);
          for (const field of aaValue.fields) {
            const strName = extractStringLiteral(field.value);
            if (strName) called.add(strName);
          }
        },
      });
    }
  }

  return called;
}

function extractStringLiteral(node: AstNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.syntax.kind !== SyntaxKind.LiteralExpression) return undefined;
  const token = node.syntax.childTokens[0];
  if (!token || token.kind !== TokenKind.StringLiteral) return undefined;
  const content = token.text.slice(1, -1);
  return content ? content.toLowerCase() : undefined;
}

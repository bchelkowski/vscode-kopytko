import { SemanticTokens, SemanticTokensBuilder, SemanticTokensLegend } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  walk,
  findScopeAtLine,
  resolve,
  IdentifierExpression,
  CallExpression,
  DotExpression,
  FunctionDeclaration,
  FunctionExpression,
} from 'kopytko-brightscript-parser';
import type { Token } from 'kopytko-brightscript-parser';
import { getCachedParseResult, getCachedScopeTree } from '../utils/documentCache';

/**
 * Semantic token types, in legend order. The index of each entry is what the
 * protocol encodes per token.
 *
 * - `function`  — user function/sub declarations and call sites
 * - `parameter` — function/sub parameters (declaration and every use)
 * - `variable`  — locals (`=` assignment, `for`/`for each`, `catch`, `dim`)
 * - `property`  — `m.field` member access
 */
export const SEMANTIC_TOKEN_TYPES = ['function', 'parameter', 'variable', 'property'] as const;

/** Semantic token modifiers, in legend order (bit position = index). */
export const SEMANTIC_TOKEN_MODIFIERS = ['declaration'] as const;

const TYPE_FUNCTION = SEMANTIC_TOKEN_TYPES.indexOf('function');
const TYPE_PARAMETER = SEMANTIC_TOKEN_TYPES.indexOf('parameter');
const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf('variable');
const TYPE_PROPERTY = SEMANTIC_TOKEN_TYPES.indexOf('property');

/** Bit mask for the `declaration` modifier. */
const MOD_DECLARATION = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf('declaration');

interface CollectedToken {
  line: number;
  char: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

/**
 * Provides parser-driven semantic tokens for BrightScript.
 *
 * Where the TextMate grammar can only guess from surrounding characters, this
 * provider classifies each identifier from the parsed scope tree, so the editor
 * can reliably distinguish parameters, locals, user-function calls, and
 * `m`-fields. Semantic highlighting layers on top of TextMate — anything not
 * emitted here (builtins, keywords, non-`m` member access) keeps its TextMate
 * colour.
 *
 * Only `textDocument/semanticTokens/full` is supported.
 */
export class BrightScriptSemanticTokensProvider {
  getLegend(): SemanticTokensLegend {
    return {
      tokenTypes: [...SEMANTIC_TOKEN_TYPES],
      tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
    };
  }

  provideSemanticTokens(document: TextDocument): SemanticTokens {
    const tokens: CollectedToken[] = [];
    // One token per source position: pre-order traversal lets call/dot handlers
    // "claim" a position before the generic identifier handler classifies it,
    // so a callee like `foo` in `foo(x)` is emitted once (as a function), never
    // twice. Overlapping tokens would otherwise break rendering.
    const claimed = new Set<string>();

    const claim = (tok: Token, tokenType: number, tokenModifiers = 0): void => {
      const key = `${tok.line}:${tok.column}`;
      if (claimed.has(key)) return;
      claimed.add(key);
      tokens.push({ line: tok.line, char: tok.column, length: tok.text.length, tokenType, tokenModifiers });
    };

    try {
      const parseResult = getCachedParseResult(document);
      const fileScope = getCachedScopeTree(document);

      walk(parseResult.root, {
        visitFunctionDeclaration: (node: FunctionDeclaration) => {
          const nameTok = node.nameToken;
          if (nameTok) claim(nameTok, TYPE_FUNCTION, MOD_DECLARATION);
          this._claimParams(node.params, claim);
        },

        visitFunctionExpression: (node: FunctionExpression) => {
          this._claimParams(node.params, claim);
        },

        visitCallExpression: (node: CallExpression) => {
          // Highlight the callee of a direct call `foo(...)` as a function.
          // Method calls (`obj.foo()`) have a DotExpression callee and are
          // handled by visitDotExpression / left to TextMate.
          const callee = node.callee;
          if (callee instanceof IdentifierExpression) {
            const tok = callee.nameToken;
            if (tok) claim(tok, TYPE_FUNCTION);
          }
        },

        visitDotExpression: (node: DotExpression) => {
          // `m.field` — tag the member name as a property.
          const obj = node.object;
          if (obj instanceof IdentifierExpression && obj.name.toLowerCase() === 'm') {
            const member = node.memberToken;
            if (member) claim(member, TYPE_PROPERTY);
          }
        },

        visitIdentifierExpression: (node: IdentifierExpression) => {
          const tok = node.nameToken;
          if (!tok) return;
          // `m` is implicit context, not a variable — leave to TextMate.
          if (tok.text.toLowerCase() === 'm') return;
          if (claimed.has(`${tok.line}:${tok.column}`)) return;

          const scope = findScopeAtLine(fileScope, tok.line);
          const decl = resolve(tok.text, scope);
          if (!decl) return; // global / builtin / unknown — leave to TextMate

          let tokenType: number;
          switch (decl.kind) {
            case 'parameter':
              tokenType = TYPE_PARAMETER;
              break;
            case 'function':
              tokenType = TYPE_FUNCTION;
              break;
            default: // variable | for-variable | catch-variable | dim-variable
              tokenType = TYPE_VARIABLE;
              break;
          }

          // The declaration site itself gets the `declaration` modifier.
          const isDecl = decl.line === tok.line && decl.column === tok.column;
          claim(tok, tokenType, isDecl ? MOD_DECLARATION : 0);
        },
      });
    } catch {
      // Highlighting must never crash the request — return whatever was
      // collected before the failure (possibly nothing).
    }

    return this._build(tokens);
  }

  private _claimParams(
    params: { nameToken: Token | undefined }[],
    claim: (tok: Token, tokenType: number, tokenModifiers?: number) => void,
  ): void {
    for (const param of params) {
      const tok = param.nameToken;
      if (tok) claim(tok, TYPE_PARAMETER, MOD_DECLARATION);
    }
  }

  private _build(tokens: CollectedToken[]): SemanticTokens {
    // SemanticTokensBuilder delta-encodes relative to the previous token, so
    // tokens must be pushed in document order.
    tokens.sort((a, b) => (a.line - b.line) || (a.char - b.char));
    const builder = new SemanticTokensBuilder();
    for (const t of tokens) {
      builder.push(t.line, t.char, t.length, t.tokenType, t.tokenModifiers);
    }
    return builder.build();
  }
}

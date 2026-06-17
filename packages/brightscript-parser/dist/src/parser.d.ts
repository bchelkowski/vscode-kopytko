/**
 * Hand-written recursive descent parser for BrightScript.
 *
 * Consumes a token stream from the lexer and produces a lossless Concrete
 * Syntax Tree (CST). Every byte of the original source is represented in
 * the tree — calling `root.getText()` reproduces the original source.
 *
 * Error-tolerant: always produces a tree, even for malformed input.
 * Invalid tokens are wrapped in ErrorNode nodes.
 *
 * BrightScript grammar reference:
 * - https://developer.roku.com/dev/docs/program-statements
 * - https://developer.roku.com/dev/docs/expressions-variables-types
 * - https://developer.roku.com/dev/docs/conditional-compilation
 */
import { Token } from './token.js';
import { SyntaxNode } from './syntaxNode.js';
import { ParseDiagnostic } from './diagnostics.js';
export interface ParseResult {
    /** The root CST node. */
    readonly root: SyntaxNode;
    /** Parse diagnostics (errors). */
    readonly diagnostics: readonly ParseDiagnostic[];
    /** The token stream that was parsed. */
    readonly tokens: readonly Token[];
}
/**
 * Parses BrightScript source code into a lossless CST.
 *
 * @param source - The complete BrightScript source text.
 * @returns The parse result containing the root node, diagnostics, and tokens.
 */
export declare function parse(source: string): ParseResult;
//# sourceMappingURL=parser.d.ts.map
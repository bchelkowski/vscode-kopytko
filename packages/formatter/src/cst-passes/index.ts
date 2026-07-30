/**
 * CST-based formatting passes.
 *
 * Structure-aware alternatives to the regex/text passes in `formatter.ts`,
 * used wherever CST removes a real string/comment-corruption or ambiguous-
 * context risk the regex version had (see `findings/lsp-architecture.md` for
 * the "when is this worth it" reasoning — not every regex pass is). Each
 * pass:
 *   1. Walks the CST to find tokens/nodes matching certain criteria
 *   2. Produces a list of TextEdits (position-based replacements)
 *   3. Edits are applied to produce the transformed source
 */

export { applyEdits, runCstPasses, walkTokens } from './infrastructure';
export type { TextEdit, CstPass } from './infrastructure';
export { endKeywordStylePass } from './endKeywordStyle';
export { casingPass } from './casingPass';
export { commentNormalizationPass } from './commentNormalization';
export { printStatementRemovalPass } from './printStatementRemoval';
export { trailingWhitespacePass } from './trailingWhitespace';
export { thenStylePass } from './thenStyle';
export { functionVsSubPass } from './functionVsSub';
export { observeFieldStylePass } from './observeFieldStyle';
export { mPrefixStylePass } from './mPrefixStyle';
export { fieldAccessConsistencyPass } from './fieldAccessConsistency';
export { lineCommentPositionPass } from './lineCommentPosition';
export { trailingCommasPass } from './trailingCommas';
export type { TrailingCommaConfig } from './trailingCommas';
export { parenthesisIfCasePass } from './parenthesisIfCase';
export { stringConcatStylePass } from './stringConcatStyle';
export { elseOnNewLinePass } from './elseOnNewLine';
export { aaThresholdPass } from './aaThreshold';

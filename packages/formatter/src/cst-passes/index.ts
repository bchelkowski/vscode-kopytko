/**
 * CST-based formatting passes.
 *
 * These passes demonstrate the pattern for migrating regex-based formatting
 * to structure-aware CST transformations. Each pass:
 *   1. Walks the CST to find tokens/nodes matching certain criteria
 *   2. Produces a list of TextEdits (position-based replacements)
 *   3. Edits are applied to produce the transformed source
 *
 * Advantages over regex passes:
 * - Cannot modify text inside string literals (tokens are pre-classified)
 * - Cannot confuse keywords in different contexts (structural awareness)
 * - Position-accurate (no line-splitting heuristics)
 * - Testable in isolation (each pass is a pure function)
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

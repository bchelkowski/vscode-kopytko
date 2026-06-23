/**
 * Identifier casing utilities for the extension.
 *
 * The casing engine (CasingOption, CasingConfig, applyCasing, …) is owned by the
 * canonical `kopytko-brightscript-parser` package and re-exported here so existing
 * imports keep working. Only `applySnippetCasing` — which is specific to VS Code
 * snippet strings — lives in the extension.
 */

import { applyCasing } from 'kopytko-brightscript-parser';
import type { CasingOption } from 'kopytko-brightscript-parser';

// Re-export the canonical casing API (single source of truth = parser package).
export type { CasingOption, CasingConfig } from 'kopytko-brightscript-parser';
export {
  DEFAULT_CASING_CONFIG,
  applyCasing,
  applyCasingWithOverrides,
  resolveKeywordCasing,
} from 'kopytko-brightscript-parser';

/**
 * Applies casing to the identifier portion of a VS Code snippet string,
 * leaving snippet tab-stop syntax (${1:…}) untouched.
 *
 * e.g. applySnippetCasing("SetUrl(${1:url as String})", 'lower-case')
 *      → "seturl(${1:url as String})"
 */
export function applySnippetCasing(snippet: string, option: CasingOption): string {
  if (option === 'preserve') return snippet;
  const parenIdx = snippet.indexOf('(');
  if (parenIdx === -1) return applyCasing(snippet, option);
  return applyCasing(snippet.substring(0, parenIdx), option) + snippet.substring(parenIdx);
}

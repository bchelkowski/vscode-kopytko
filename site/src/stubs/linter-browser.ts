/**
 * Browser-compatible re-export of the kopytko-linter package.
 *
 * Vite aliases 'fs' and 'path' to empty stubs, so all Node.js filesystem
 * operations become no-ops. The rule engine itself is pure TypeScript and
 * works without modification in the browser.
 *
 * Rules that need cross-file context (import resolution, XML, callbacks)
 * simply produce no diagnostics when the stub LintContext returns empty values.
 */

export { lintFile } from '../../../packages/linter/src/lintRunner.js';
export { DEFAULT_RULE_CONFIG } from '../../../packages/linter/src/config.js';
export type { LinterConfig } from '../../../packages/linter/src/config.js';
export type { LintContext } from '../../../packages/linter/src/context.js';
export type { LintDiagnostic, LintSeverity } from '../../../packages/linter/src/types.js';

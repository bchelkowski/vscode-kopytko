import type { LintResult } from './types';
import type { LinterConfig } from './config';
import { resolveConfig } from './config';
import { runLint } from './lintRunner';
import { buildProjectContext, buildProjectContextAsync } from './projectIndexer';
export { lintFile, createFileContext } from './lintRunner';

/**
 * Lints all .brs files in a project directory.
 * Used by the CLI (standalone mode).
 */
export function lintProject(
  projectRoot: string,
  configOverride?: Partial<LinterConfig>,
): LintResult {
  const config = {
    ...resolveConfig(projectRoot),
    ...configOverride,
  };

  const { context, brsFiles, fileContentsCache, parseResultCache } = buildProjectContext(projectRoot, config);

  return runLint(brsFiles, fileContentsCache, context, config, parseResultCache);
}

/**
 * Async version of lintProject — uses parallel I/O for ~6x faster file loading.
 */
export async function lintProjectAsync(
  projectRoot: string,
  configOverride?: Partial<LinterConfig>,
): Promise<LintResult> {
  const config = {
    ...resolveConfig(projectRoot),
    ...configOverride,
  };

  const { context, brsFiles, fileContentsCache, parseResultCache } = await buildProjectContextAsync(projectRoot, config);

  return runLint(brsFiles, fileContentsCache, context, config, parseResultCache);
}


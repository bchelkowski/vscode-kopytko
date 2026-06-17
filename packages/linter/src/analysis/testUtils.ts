import * as nodePath from 'path';
import fsWrapper from './fsWrapper';

/** Check if a file URI or path looks like a test file. */
export function isTestFile(uriOrPath: string): boolean {
  return /[/\\]_tests[/\\].*\.test\.brs$/i.test(uriOrPath) || /\.test\.brs$/i.test(uriOrPath);
}

/** Check if a file URI or path looks like a mock file. */
export function isMockFile(uriOrPath: string): boolean {
  return /[/\\]_mocks[/\\].*\.mock\.brs$/i.test(uriOrPath) || /\.mock\.brs$/i.test(uriOrPath);
}

/** Check if a file is test-related (test or mock) — gets test framework globals. */
export function isTestRelatedFile(uriOrPath: string): boolean {
  return isTestFile(uriOrPath) || isMockFile(uriOrPath);
}

/**
 * Extracts the base test name from a test file path.
 * `Foo.test.brs` → `Foo`, `Foo_Bar.test.brs` → `Foo`
 */
export function getTestBaseName(testFilePath: string): string {
  const basename = testFilePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.test\.brs$/i, '') ?? '';
  const underscoreIdx = basename.indexOf('_');
  return underscoreIdx > 0 ? basename.substring(0, underscoreIdx) : basename;
}

/**
 * Finds sibling test files that share the same base name.
 * `Foo.test.brs` ↔ `Foo_Bar.test.brs` ↔ `Foo_Baz.test.brs` all share scope.
 */
export function findTestSiblings(testFilePath: string): string[] {
  const dir = nodePath.dirname(testFilePath);
  const baseName = getTestBaseName(testFilePath);
  if (!baseName) return [];

  const normalizedSelf = nodePath.normalize(testFilePath);
  const siblings: string[] = [];

  try {
    for (const entry of fsWrapper.readdirSync(dir)) {
      if (!entry.toLowerCase().endsWith('.test.brs')) continue;
      const entryBase = getTestBaseName(entry);
      if (entryBase.toLowerCase() !== baseName.toLowerCase()) continue;
      const fullPath = nodePath.join(dir, entry);
      if (nodePath.normalize(fullPath) !== normalizedSelf) {
        siblings.push(fullPath);
      }
    }
  } catch { /* skip */ }

  return siblings;
}

const COMPONENT_SUFFIXES = ['', '.component', '.view', '.template', '.facade', '.service'];

function splitAtUpperCaseBoundaries(name: string): { base: string; dotSuffix: string }[] {
  const results: { base: string; dotSuffix: string }[] = [];
  for (let i = 1; i < name.length; i++) {
    if (name[i] >= 'A' && name[i] <= 'Z') {
      results.push({
        base: name.slice(0, i),
        dotSuffix: '.' + name.slice(i).toLowerCase(),
      });
    }
  }
  return results;
}

/**
 * Resolves which source files a test file is testing.
 */
export function resolveTestedFiles(testFilePath: string): string[] {
  const normalized = testFilePath.replace(/\\/g, '/');
  const testsIdx = normalized.lastIndexOf('/_tests/');
  const parentDir = testsIdx >= 0
    ? normalized.substring(0, testsIdx)
    : nodePath.dirname(nodePath.dirname(testFilePath));
  const basename = nodePath.basename(testFilePath, '.test.brs');

  const candidates: string[] = [];

  const addCandidates = (name: string): void => {
    for (const suffix of COMPONENT_SUFFIXES) {
      candidates.push(nodePath.join(parentDir, `${name}${suffix}.brs`));
    }
    for (const { base, dotSuffix } of splitAtUpperCaseBoundaries(name)) {
      candidates.push(nodePath.join(parentDir, `${base}${dotSuffix}.brs`));
    }
  };

  addCandidates(basename);

  const underscoreIdx = basename.indexOf('_');
  if (underscoreIdx > 0) {
    addCandidates(basename.substring(0, underscoreIdx));
  }

  return candidates.filter(p => fsWrapper.existsSync(p));
}

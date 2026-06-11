import type { LintContext } from '../src/context';
import type { RuleContext, RuleConfig, KopytkoImport } from '../src/types';
import { DEFAULT_RULE_CONFIG } from '../src/config';
import { parseImports } from '../src/analysis/importParser';

export function createMockContext(overrides?: Partial<LintContext>): LintContext {
  return {
    knownFuncNames: new Set(),
    parseImports: (text: string) => parseImports(text),
    resolveImportPath: () => null,
    importExists: () => false,
    readFile: () => null,
    parseFunctionsFromFile: () => [],
    getSiblingFiles: () => [],
    getTestSiblings: () => [],
    isTestFile: (path: string) => /\.test\.brs$/i.test(path),
    generatedPaths: [],
    generatedModules: [],
    siblingPatterns: [],
    ...overrides,
  };
}

export function createRuleContext(
  content: string,
  overrides?: Partial<RuleContext> & { lintContextOverrides?: Partial<LintContext> },
): RuleContext {
  const filePath = overrides?.filePath ?? '/project/src/Test.brs';
  const lines = content.split(/\r?\n/);
  const lintContext = createMockContext(overrides?.lintContextOverrides);
  const imports = lintContext.parseImports(content);

  return {
    filePath,
    lines,
    imports,
    config: overrides?.config ?? { ...DEFAULT_RULE_CONFIG },
    lintContext,
    ...overrides,
    // Ensure lintContext isn't overwritten by the spread above
  } as RuleContext;
}

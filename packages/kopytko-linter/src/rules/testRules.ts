import type { LintDiagnostic, RuleContext } from '../types';
import { parseFunctionDefs, parseInnerMethodDefs } from '../analysis/functionIndex';

export function checkTestFileStructure(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, imports, config, lintContext } = ctx;
  if (!lintContext.isTestFile(filePath)) return [];
  if (config['test/missing-mock-annotation'] === 'off' && config['test/missing-return-ts'] === 'off') return [];

  const diagnostics: LintDiagnostic[] = [];
  let hasTestSuiteFunc = false;
  let testSuiteFuncLine = -1;
  let lastReturnTsLine = -1;

  // Build set of known mocked function/method names from resolved @mock files
  const mockedIdentifiers = new Set<string>();
  for (const imp of imports) {
    if (!imp.isMock) continue;
    const resolved = lintContext.resolveImportPath(imp.importPath, imp.fromModule);
    if (!resolved) continue;

    const text = lintContext.readFile(resolved);
    if (text === null) continue;

    for (const fn of parseFunctionDefs(text, resolved)) {
      mockedIdentifiers.add(fn.nameLower);
    }
    for (const method of parseInnerMethodDefs(text, resolved)) {
      mockedIdentifiers.add(method.nameLower);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*function\s+TestSuite__\w+/i.test(line)) {
      hasTestSuiteFunc = true;
      testSuiteFuncLine = i;
    }

    if (/^\s*return\s+ts\s*$/i.test(line)) {
      lastReturnTsLine = i;
    }

    // Check mockFunction("X") — X should reference a function from a @mock'ed file
    if (mockedIdentifiers.size > 0 && config['test/missing-mock-annotation'] !== 'off') {
      const mockFuncRe = /mockFunction\s*\(\s*"([^"]+)"/g;
      let mfMatch: RegExpExecArray | null;
      while ((mfMatch = mockFuncRe.exec(line)) !== null) {
        const mockTarget = mfMatch[1];
        const topLevel = mockTarget.includes('.') ? mockTarget.split('.')[0] : mockTarget;
        if (!mockedIdentifiers.has(topLevel.toLowerCase())) {
          const col = line.indexOf(mfMatch[0]);
          diagnostics.push({
            severity: config['test/missing-mock-annotation'] ?? 'warning',
            code: 'test/missing-mock-annotation',
            message: `"${topLevel}" is not defined in any \`@mock\`'ed file. Add a \`' @mock\` annotation for the file that defines "${topLevel}".`,
            line: i,
            column: col,
            endLine: i,
            endColumn: col + mfMatch[0].length + 1,
            filePath,
          });
        }
      }
    }
  }

  if (config['test/missing-return-ts'] !== 'off' && hasTestSuiteFunc && lastReturnTsLine < 0) {
    diagnostics.push({
      severity: config['test/missing-return-ts'] ?? 'warning',
      code: 'test/missing-return-ts',
      message: 'Test suite function should end with `return ts` to return the suite object to the test runner.',
      line: testSuiteFuncLine,
      column: 0,
      endLine: testSuiteFuncLine,
      endColumn: Number.MAX_SAFE_INTEGER,
      filePath,
    });
  }

  return diagnostics;
}

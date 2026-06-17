import type { LintResult, LintSeverity } from '../types';
import { DEFAULT_RULE_CONFIG } from '../config';
import * as nodePath from 'path';

const SEVERITY_TO_SARIF: Record<LintSeverity, string> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
  hint: 'note',
};

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: string };
}

interface SarifResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: {
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId: string };
      region: { startLine: number; startColumn: number; endLine?: number; endColumn?: number };
    };
  }[];
}

export function formatSarif(result: LintResult, projectRoot?: string): string {
  const rules: SarifRule[] = Object.entries(DEFAULT_RULE_CONFIG).map(([code, severity]) => ({
    id: code,
    shortDescription: { text: getRuleDescription(code) },
    defaultConfiguration: { level: SEVERITY_TO_SARIF[severity as LintSeverity] ?? 'warning' },
  }));

  const results: SarifResult[] = result.diagnostics.map(d => ({
    ruleId: d.code,
    level: SEVERITY_TO_SARIF[d.severity] ?? 'warning',
    message: { text: d.message },
    locations: [{
      physicalLocation: {
        artifactLocation: {
          uri: projectRoot ? nodePath.relative(projectRoot, d.filePath).replace(/\\/g, '/') : d.filePath,
          uriBaseId: '%SRCROOT%',
        },
        region: {
          startLine: d.line + 1,
          startColumn: d.column + 1,
          ...(d.endLine !== undefined ? { endLine: d.endLine + 1 } : {}),
          ...(d.endColumn !== undefined ? { endColumn: d.endColumn + 1 } : {}),
        },
      },
    }],
  }));

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0' as const,
    runs: [{
      tool: {
        driver: {
          name: 'kopytko-linter',
          informationUri: 'https://github.com/bchelkowski/vscode-kopytko/tree/main/packages/kopytko-linter',
          rules,
        },
      },
      results,
    }],
  };

  return JSON.stringify(sarif, null, 2);
}

function getRuleDescription(code: string): string {
  const descriptions: Record<string, string> = {
    'import/duplicate': 'Duplicate import detected',
    'import/missing-path': 'Import annotation missing path',
    'import/path-not-absolute': 'Import path should start with /',
    'import/wrong-comment-style': 'Import must use apostrophe comment style',
    'import/build-generated': 'Import path is build-generated',
    'import/unresolved': 'Cannot resolve import path',
    'import/unused': 'Imported file functions are not referenced',
    'identifier/undefined-function': 'Call to unknown function',
    'identifier/wrong-arg-count': 'Built-in function called with wrong argument count',
    'identifier/undefined-variable': 'Variable used but never defined in scope',
    'identifier/shadows-builtin': 'Variable name shadows a built-in function',
    'identifier/unused-parameter': 'Function parameter is never used',
    'throw/invalid-value': 'Invalid throw value type',
    'throw/missing-message': 'Thrown AA missing message field',
    'createobject/unknown-component': 'Unknown BrightScript component name',
    'syntax/trailing-comma': 'Trailing comma after return value',
    'syntax/flow-outside-loop': 'Loop flow control statement outside loop',
    'test/missing-mock-annotation': 'mockFunction target not in any @mock file',
    'test/missing-return-ts': 'Test suite function missing return ts',
  };
  return descriptions[code] ?? code;
}

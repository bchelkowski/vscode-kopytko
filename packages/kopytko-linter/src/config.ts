import * as fs from 'fs';
import * as nodePath from 'path';
import type { LintSeverity, GeneratedModuleConfig, RuleConfig } from './types';
import { parseJsonc } from './jsonc';

export interface LinterConfig {
  rules: RuleConfig;
  sourceDir: string;
  resolveModules: boolean;
  generatedPaths: string[];
  generatedModules: GeneratedModuleConfig[];
  siblingPatterns: string[][];
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  'import/duplicate': 'error',
  'import/missing-path': 'error',
  'import/path-not-absolute': 'warning',
  'import/wrong-comment-style': 'error',
  'import/build-generated': 'info',
  'import/unresolved': 'warning',
  'import/unused': 'warning',
  'identifier/undefined-function': 'error',
  'identifier/wrong-arg-count': 'error',
  'identifier/undefined-variable': 'error',
  'identifier/shadows-builtin': 'error',
  'identifier/unused-parameter': 'hint',
  'throw/invalid-value': 'warning',
  'throw/missing-message': 'warning',
  'createobject/unknown-component': 'warning',
  'syntax/trailing-comma': 'error',
  'syntax/flow-outside-loop': 'error',
  'test/missing-mock-annotation': 'warning',
  'test/missing-return-ts': 'warning',
};

export const DEFAULT_LINTER_CONFIG: LinterConfig = {
  rules: { ...DEFAULT_RULE_CONFIG },
  sourceDir: 'src',
  resolveModules: true,
  generatedPaths: [],
  generatedModules: [],
  siblingPatterns: [],
};

export function parseLinterConfig(raw: Record<string, unknown>): LinterConfig {
  const config = { ...DEFAULT_LINTER_CONFIG };

  if (raw['rules'] && typeof raw['rules'] === 'object') {
    config.rules = { ...DEFAULT_RULE_CONFIG };
    for (const [key, value] of Object.entries(raw['rules'] as Record<string, unknown>)) {
      if (isValidSeverity(value)) {
        config.rules[key] = value;
      }
    }
  }

  if (typeof raw['sourceDir'] === 'string') config.sourceDir = raw['sourceDir'];
  if (typeof raw['resolveModules'] === 'boolean') config.resolveModules = raw['resolveModules'];
  if (Array.isArray(raw['generatedPaths'])) config.generatedPaths = raw['generatedPaths'] as string[];
  if (Array.isArray(raw['generatedModules'])) config.generatedModules = raw['generatedModules'] as GeneratedModuleConfig[];
  if (Array.isArray(raw['siblingPatterns'])) config.siblingPatterns = raw['siblingPatterns'] as string[][];

  return config;
}

function isValidSeverity(value: unknown): value is LintSeverity | 'off' {
  return value === 'error' || value === 'warning' || value === 'info' || value === 'hint' || value === 'off';
}

/**
 * Resolves linter config from the project root.
 *
 * Priority:
 * 1. Explicit config path (--config flag)
 * 2. kopytko-linter.json in project root
 * 3. .vscode/settings.json (kopytko.lint.* keys)
 * 4. Default config
 */
export function resolveConfig(projectRoot: string, configPath?: string): LinterConfig {
  // 1. Explicit config path
  if (configPath) {
    const fullPath = nodePath.isAbsolute(configPath) ? configPath : nodePath.join(projectRoot, configPath);
    try {
      const text = fs.readFileSync(fullPath, 'utf-8');
      return parseLinterConfig(parseJsonc(text));
    } catch {
      throw new Error(`Cannot read config file: ${fullPath}`);
    }
  }

  // 2. kopytko-linter.json
  const linterJsonPath = nodePath.join(projectRoot, 'kopytko-linter.json');
  try {
    const text = fs.readFileSync(linterJsonPath, 'utf-8');
    return parseLinterConfig(parseJsonc(text));
  } catch { /* not found */ }

  // 3. .vscode/settings.json
  const vscodeSettingsPath = nodePath.join(projectRoot, '.vscode', 'settings.json');
  try {
    const text = fs.readFileSync(vscodeSettingsPath, 'utf-8');
    const settings = parseJsonc(text);
    const lintConfig = extractVscodeSettings(settings);
    if (lintConfig) return lintConfig;
  } catch { /* not found */ }

  // 4. Default
  return { ...DEFAULT_LINTER_CONFIG };
}

function extractVscodeSettings(settings: Record<string, unknown>): LinterConfig | null {
  const config = { ...DEFAULT_LINTER_CONFIG };
  let found = false;

  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith('kopytko.lint.')) continue;
    found = true;

    const subKey = key.replace('kopytko.lint.', '');

    if (subKey === 'sourceDir' && typeof value === 'string') {
      config.sourceDir = value;
    } else if (subKey === 'resolveModules' && typeof value === 'boolean') {
      config.resolveModules = value;
    } else if (subKey === 'generatedPaths' && Array.isArray(value)) {
      config.generatedPaths = value as string[];
    } else if (subKey === 'generatedModules' && Array.isArray(value)) {
      config.generatedModules = value as GeneratedModuleConfig[];
    } else if (subKey === 'siblingPatterns' && Array.isArray(value)) {
      config.siblingPatterns = value as string[][];
    } else if (subKey.startsWith('rules.') && isValidSeverity(value)) {
      const ruleKey = subKey.replace('rules.', '');
      config.rules[ruleKey] = value;
    }
  }

  return found ? config : null;
}

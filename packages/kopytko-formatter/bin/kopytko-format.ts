#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { formatText, checkFormatting } from '../src/formatter';
import { FormattingConfig, DEFAULT_FORMATTING_CONFIG, parseFormattingConfig } from '../src/config';
import { CasingConfig, DEFAULT_CASING_CONFIG } from '../src/casing';

const VERSION = require('../../package.json').version;

interface CliOptions {
  check: boolean;
  write: boolean;
  config: string | null;
  ignore: string[];
  patterns: string[];
}

function printUsage(): void {
  console.log(`
kopytko-format v${VERSION}
BrightScript formatter for the Kopytko ecosystem.

USAGE
  kopytko-format [options] <glob ...>

OPTIONS
  --check           Check mode — exit 1 if any file needs formatting.
  --write           Write formatted output back to files (default: print diff).
  --config <path>   Path to config file (JSON). Default: auto-detect.
  --ignore <glob>   Glob pattern of files to skip (repeatable).
  --help, -h        Show this help message.
  --version, -v     Show version.

EXAMPLES
  kopytko-format --check "src/**/*.brs"
  kopytko-format --write "src/**/*.brs"
  kopytko-format --check --config kopytko-formatter.json "components/**/*.brs"

CONFIG
  The formatter reads config from (in priority order):
    1. --config <file>            explicit path
    2. kopytko-formatter.json     in the current directory
    3. .vscode/settings.json      "kopytko.format.*" keys

  Config keys match VS Code settings without the "kopytko.format." prefix.
  Example kopytko-formatter.json:
    {
      "indentSize": 2,
      "endKeywordStyle": "spaced",
      "trimTrailingWhitespace": true,
      "insertFinalNewline": true,
      "keywordCasing": "LowerCase",
      "builtinCasing": "PascalCase",
      "ignore": [
        "**/node_modules/**",
        "**/dist/**",
        "**/_tests/**"
      ]
    }
`);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { check: false, write: false, config: null, ignore: [], patterns: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') { opts.check = true; }
    else if (arg === '--write') { opts.write = true; }
    else if (arg === '--config' && i + 1 < argv.length) { opts.config = argv[++i]; }
    else if (arg === '--ignore' && i + 1 < argv.length) { opts.ignore.push(argv[++i]); }
    else if (arg === '--help' || arg === '-h') { printUsage(); process.exit(0); }
    else if (arg === '--version' || arg === '-v') { console.log(VERSION); process.exit(0); }
    else if (arg.startsWith('-')) { console.error(`Unknown option: ${arg}`); process.exit(1); }
    else { opts.patterns.push(arg); }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// JSONC parser (JSON with Comments)
// ---------------------------------------------------------------------------

/**
 * Strips JSONC features (single-line comments, block comments, trailing commas)
 * while respecting string literals, then parses the result with JSON.parse.
 */
function parseJsonc(text: string): Record<string, unknown> {
  let result = '';
  let i = 0;

  while (i < text.length) {
    // String literal — copy verbatim (including any // or /* inside)
    if (text[i] === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++; // skip escaped char
        i++;
      }
      i++; // closing quote
      result += text.slice(start, i);
      continue;
    }

    // Single-line comment
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    result += text[i];
    i++;
  }

  // Remove trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(result);
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

interface RawConfig {
  settings: Record<string, unknown>;
  source: string;
}

/**
 * Finds the raw config object from the first available source.
 * Priority: --config flag > kopytko-formatter.json > .vscode/settings.json
 */
function findRawConfig(configPath: string | null): RawConfig | null {
  // 1. Explicit config file
  if (configPath) {
    if (!fs.existsSync(configPath)) {
      console.error(`Config file not found: ${configPath}`);
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { settings: raw, source: configPath };
  }

  // 2. kopytko-formatter.json in cwd
  const formatterConfigPath = path.join(process.cwd(), 'kopytko-formatter.json');
  if (fs.existsSync(formatterConfigPath)) {
    const raw = JSON.parse(fs.readFileSync(formatterConfigPath, 'utf-8'));
    return { settings: raw, source: formatterConfigPath };
  }

  // 3. .vscode/settings.json with "kopytko.format.*" keys
  const vscodeSettingsPath = path.join(process.cwd(), '.vscode', 'settings.json');
  if (fs.existsSync(vscodeSettingsPath)) {
    const content = fs.readFileSync(vscodeSettingsPath, 'utf-8');
    const raw = parseJsonc(content);
    const extracted = extractVscodeSettings(raw);
    if (extracted) {
      return { settings: extracted, source: vscodeSettingsPath };
    }
  }

  return null;
}

/**
 * Extracts kopytko.format.* keys from a VS Code settings.json object.
 * Strips the "kopytko.format." prefix from each key.
 *
 * Also extracts kopytko.readOnlyPaths — it lives under "kopytko.*" (not
 * "kopytko.format.*") but the CLI must respect it the same way the extension
 * does: files matching any readOnlyPaths pattern are skipped entirely.
 *
 * Returns null if no relevant kopytko keys are found.
 */
function extractVscodeSettings(raw: Record<string, unknown>): Record<string, unknown> | null {
  const FORMAT_PREFIX = 'kopytko.format.';
  const result: Record<string, unknown> = {};
  let found = false;

  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith(FORMAT_PREFIX)) {
      result[key.slice(FORMAT_PREFIX.length)] = value;
      found = true;
    }
  }

  // readOnlyPaths is under "kopytko.*", not "kopytko.format.*"
  if ('kopytko.readOnlyPaths' in raw) {
    result['readOnlyPaths'] = raw['kopytko.readOnlyPaths'];
    found = true;
  }

  return found ? result : null;
}

/** Maps VS Code casing key names to CasingConfig field names. */
const CASING_KEY_MAP: Record<string, keyof CasingConfig> = {
  'keywordCasing': 'keywords',
  'builtinCasing': 'builtins',
  'methodCasing': 'methods',
  'typeCasing': 'types',
  'literalCasing': 'literals',
  'logicOperatorCasing': 'logicOperators',
  'mathOperatorCasing': 'mathOperators',
  'userFunctionCasing': 'userFunctions',
  'userMethodCasing': 'userMethods',
  'exactCasing': 'exactCasing',
};

function loadConfig(configPath: string | null): FormattingConfig {
  const raw = findRawConfig(configPath);
  if (!raw) return { ...DEFAULT_FORMATTING_CONFIG };

  console.log(`  Config: ${raw.source}`);
  return parseFormattingConfig(raw.settings);
}

/** Loads ignore patterns from the config file. */
function loadIgnorePatterns(configPath: string | null): string[] {
  const raw = findRawConfig(configPath);
  if (!raw) return [];

  const ignore = raw.settings['ignore'];
  if (Array.isArray(ignore)) return ignore.filter((p): p is string => typeof p === 'string');
  return [];
}

/**
 * Loads readOnlyPaths from the config file.
 *
 * In the VS Code extension, `kopytko.readOnlyPaths` prevents the formatter
 * from touching matched files. The CLI treats them the same as `ignore` —
 * matched files are skipped entirely.
 *
 * Supported in both `kopytko-formatter.json` (as a top-level `readOnlyPaths`
 * key) and `.vscode/settings.json` (as `kopytko.readOnlyPaths`).
 */
function loadReadOnlyPaths(configPath: string | null): string[] {
  const raw = findRawConfig(configPath);
  if (!raw) return [];

  const paths = raw.settings['readOnlyPaths'];
  if (Array.isArray(paths)) return paths.filter((p): p is string => typeof p === 'string');
  return [];
}

/**
 * Matches a file path against a glob-like ignore pattern.
 * Supports: `*` (single segment), `**` (any depth), `?` (single char).
 */
function matchesIgnorePattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const regex = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`(?:^|/)${regex}(?:$|/)`).test(normalized) ||
    new RegExp(`^${regex}$`).test(normalized);
}

function isIgnored(filePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => matchesIgnorePattern(filePath, pattern));
}

function loadCasingConfig(configPath: string | null): CasingConfig {
  const raw = findRawConfig(configPath);
  if (!raw) return { ...DEFAULT_CASING_CONFIG };

  const s = raw.settings;
  const result: Record<string, unknown> = {};

  for (const [srcKey, destKey] of Object.entries(CASING_KEY_MAP)) {
    // Support both VS Code key names (keywordCasing) and direct names (keywords)
    if (s[srcKey] !== undefined) result[destKey] = s[srcKey];
    else if (s[destKey] !== undefined) result[destKey] = s[destKey];
  }

  return {
    builtins: (result.builtins as CasingConfig['builtins']) ?? 'NoChange',
    keywords: (result.keywords as CasingConfig['keywords']) ?? 'NoChange',
    methods: (result.methods as CasingConfig['methods']) ?? 'NoChange',
    types: result.types as CasingConfig['types'],
    literals: result.literals as CasingConfig['literals'],
    logicOperators: result.logicOperators as CasingConfig['logicOperators'],
    mathOperators: result.mathOperators as CasingConfig['mathOperators'],
    userFunctions: result.userFunctions as CasingConfig['userFunctions'],
    userMethods: result.userMethods as CasingConfig['userMethods'],
    exactCasing: normalizeExactCasing(result.exactCasing),
  };
}

function collectFiles(patterns: string[]): string[] {
  const files: string[] = [];
  for (const pattern of patterns) {
    // Simple glob: if it's a direct file path, use it
    if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
      files.push(pattern);
      continue;
    }

    // Walk directories for .brs files
    if (fs.existsSync(pattern) && fs.statSync(pattern).isDirectory()) {
      walkDir(pattern, files);
      continue;
    }

    // Basic glob support: **/*.brs patterns
    // For proper glob support, users should pipe from find or use shell expansion
    const resolved = resolveGlob(pattern);
    files.push(...resolved);
  }
  return [...new Set(files)];
}

function walkDir(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walkDir(full, out);
    } else if (entry.name.endsWith('.brs')) {
      out.push(full);
    }
  }
}

function resolveGlob(pattern: string): string[] {
  // Handle simple **/*.brs patterns
  if (pattern.includes('*')) {
    const parts = pattern.split(path.sep === '\\' ? /[\\/]/ : '/');
    const baseIdx = parts.findIndex(p => p.includes('*'));
    const baseDir = baseIdx > 0 ? parts.slice(0, baseIdx).join(path.sep) : '.';
    const ext = path.extname(pattern) || '.brs';

    if (!fs.existsSync(baseDir)) return [];

    const files: string[] = [];
    walkDir(baseDir, files);
    return files.filter(f => f.endsWith(ext));
  }
  return [];
}

/** Normalizes exactCasing keys to lowercase so lookups are case-insensitive (matches VS Code extension behaviour). */
function normalizeExactCasing(raw: unknown): CasingConfig['exactCasing'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => [k.toLowerCase(), v as string]),
  );
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.patterns.length === 0) {
    console.error('Error: No file patterns provided.\n');
    printUsage();
    process.exit(1);
  }

  const config = loadConfig(opts.config);
  const casing = loadCasingConfig(opts.config);
  const ignorePatterns = [...loadIgnorePatterns(opts.config), ...loadReadOnlyPaths(opts.config), ...opts.ignore];
  const allFiles = collectFiles(opts.patterns);
  const files = ignorePatterns.length > 0
    ? allFiles.filter((f) => !isIgnored(f, ignorePatterns))
    : allFiles;

  if (files.length === 0) {
    console.error('No .brs files found matching the given patterns.');
    process.exit(1);
  }

  let unformatted = 0;
  let formatted = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const source = fs.readFileSync(file, 'utf-8');
      const isClean = checkFormatting(source, config, casing);

      if (isClean) {
        formatted++;
        continue;
      }

      unformatted++;

      if (opts.write) {
        const result = formatText(source, config, casing);
        fs.writeFileSync(file, result, 'utf-8');
        console.log(`  ✓ ${file}`);
      } else if (opts.check) {
        console.log(`  ✗ ${file}`);
      } else {
        // Default: print to stdout
        const result = formatText(source, config, casing);
        console.log(`--- ${file} ---`);
        console.log(result);
      }
    } catch (err) {
      errors++;
      console.error(`  ✗ Error processing ${file}: ${(err as Error).message}`);
    }
  }

  // Summary
  const total = files.length;
  console.log(`\n${total} file(s) checked: ${formatted} clean, ${unformatted} need formatting${errors > 0 ? `, ${errors} error(s)` : ''}.`);

  if (opts.check && unformatted > 0) {
    process.exit(1);
  }

  if (errors > 0) {
    process.exit(2);
  }
}

main();

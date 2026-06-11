#!/usr/bin/env node

import * as nodePath from 'path';
import { lintProjectAsync } from '../src/linter';
import { resolveConfig } from '../src/config';
import { formatText } from '../src/output/textFormatter';
import { formatJson } from '../src/output/jsonFormatter';
import { formatSarif } from '../src/output/sarifFormatter';

interface CliOptions {
  format: 'text' | 'json' | 'sarif';
  configPath?: string;
  sourceDir?: string;
  check: boolean;
  noColor: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text',
    check: false,
    noColor: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--format' || arg === '-f') {
      const value = argv[++i];
      if (value === 'text' || value === 'json' || value === 'sarif') {
        options.format = value;
      } else {
        console.error(`Unknown format: ${value}. Use text, json, or sarif.`);
        process.exit(2);
      }
    } else if (arg === '--config' || arg === '-c') {
      options.configPath = argv[++i];
    } else if (arg === '--source-dir') {
      options.sourceDir = argv[++i];
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--no-color') {
      options.noColor = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      printVersion();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}. Use --help for usage.`);
      process.exit(2);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
kopytko-lint — BrightScript linter for the Kopytko ecosystem

Usage:
  kopytko-lint [options]

Options:
  --check             Exit with code 1 if any errors are found (for CI)
  --format, -f        Output format: text (default), json, sarif
  --config, -c        Path to config file (default: kopytko-linter.json)
  --source-dir        Source directory (default: from config or "src")
  --no-color          Disable colored output
  --help, -h          Show this help message
  --version, -v       Show version

Config resolution (priority order):
  1. --config <file>
  2. kopytko-linter.json in project root
  3. .vscode/settings.json (kopytko.lint.* keys)
  4. Default config (all rules enabled)

Examples:
  kopytko-lint                       # lint current project with default config
  kopytko-lint --check               # CI mode — exit 1 on errors
  kopytko-lint --format sarif        # output SARIF for GitHub Code Scanning
  kopytko-lint --config my-rules.json
`);
}

function printVersion(): void {
  try {
    const pkg = require('../../package.json');
    console.log(`kopytko-lint v${pkg.version}`);
  } catch {
    console.log('kopytko-lint (development)');
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  const projectRoot = process.cwd();

  const config = resolveConfig(projectRoot, options.configPath);

  if (options.sourceDir) {
    config.sourceDir = options.sourceDir;
  }

  const result = await lintProjectAsync(projectRoot, config);

  // Output
  switch (options.format) {
    case 'json':
      console.log(formatJson(result));
      break;
    case 'sarif':
      console.log(formatSarif(result, projectRoot));
      break;
    default:
      console.log(formatText(result, !options.noColor));
      break;
  }

  // Exit code
  if (options.check && result.errorCount > 0) {
    process.exit(1);
  }
}

main();

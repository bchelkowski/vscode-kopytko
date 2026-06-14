# kopytko-formatter

BrightScript formatter and code style checker for the [Kopytko ecosystem](https://github.com/bchelkowski/vscode-kopytko).

Use it as a **CLI tool** in CI pipelines, or import it as a **library** in your own tools.

## Installation

```bash
npm install --save-dev kopytko-formatter
```

## Recommended npm Scripts

Add these scripts to your project's `package.json` to run the formatter with the locally installed version — no `npx` needed:

```json
{
  "scripts": {
    "format": "kopytko-format --write \"src/**/*.brs\"",
    "format:check": "kopytko-format --check \"src/**/*.brs\""
  }
}
```

Then run:

```bash
npm run format          # format files in place
npm run format:check    # CI — exit 1 if any file needs formatting
```

> **Why npm scripts over npx?** `npx` may download a different version than what's installed locally. npm scripts resolve binaries from `node_modules/.bin/`, guaranteeing the exact installed version is used.

## CLI Usage

```bash
# Check mode — exit 1 if any file needs formatting (use in CI)
kopytko-format --check "src/**/*.brs"

# Write mode — format files in place
kopytko-format --write "src/**/*.brs"

# With explicit config
kopytko-format --check --config .kopytkorc "components/**/*.brs"
```

### Options

| Flag | Description |
|---|---|
| `--check` | Check mode — exit 1 if any file needs formatting |
| `--write` | Write formatted output back to files |
| `--config <path>` | Path to config file (JSON) |
| `--ignore <glob>` | Glob pattern of files to skip (repeatable) |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

## Configuration

The formatter reads config from (in priority order):

1. `--config <file>` CLI flag
2. `kopytko-formatter.json` in the current directory
3. `.vscode/settings.json` — reads `kopytko.format.*` and `kopytko.casing.*` keys automatically (supports JSONC: inline `//` comments, block `/* */` comments, and trailing commas)

Config keys match the VS Code extension settings without the `kopytko.format.` prefix (for formatting rules) or `kopytko.casing.` prefix (for casing settings).

### Example `kopytko-formatter.json`

The config file can contain both formatting rules and casing settings:

```json
{
  "indentSize": 2,
  "endKeywordStyle": "spaced",
  "trimTrailingWhitespace": true,
  "insertFinalNewline": true,
  "spaceAroundOperators": true,
  "spaceAroundAssignment": true,
  "sortImports": true,
  "emptyLineAfterImports": true,
  "maxEmptyLines": 1,
  "emptyLinesBetweenFunctions": 1,
  "keywordCasing": "lower-case",
  "builtinCasing": "pascal-case",
  "typeCasing": "pascal-case",
  "literalCasing": "lower-case",
  "logicOperatorCasing": "upper-case",
  "ignore": [
    "**/node_modules/**",
    "**/dist/**",
    "**/_tests/**"
  ]
}
```

> **Note:** `keywordCasing`, `builtinCasing`, `typeCasing`, `literalCasing`, and `logicOperatorCasing` are casing settings (see `CasingConfig`). All other keys are formatting rules (see `FormattingConfig`). Casing values use kebab-case: `preserve`, `upper-case`, `lower-case`, `capitalize`, `pascal-case`, `camel-case`.

If your project already has formatting settings in `.vscode/settings.json`, no extra config file is needed — the CLI reads them directly.

### Ignoring files

Exclude paths from formatting via the `ignore` array in your config file or the `--ignore` CLI flag:

```bash
# CLI flag (repeatable)
kopytko-format --check --ignore "**/_tests/**" --ignore "**/dist/**" app

# Or in kopytko-formatter.json / .vscode/settings.json
# "ignore": ["**/_tests/**", "**/dist/**"]
```

Patterns use glob syntax: `*` matches within a path segment, `**` matches any depth.

## Library Usage

```typescript
import { formatText, checkFormatting, DEFAULT_FORMATTING_CONFIG } from 'kopytko-formatter';

// Format a BrightScript source string
const formatted = formatText(source, {
  ...DEFAULT_FORMATTING_CONFIG,
  indentSize: 2,
  endKeywordStyle: 'spaced',
});

// Check if source is already formatted (returns boolean)
const isClean = checkFormatting(source, DEFAULT_FORMATTING_CONFIG);
```

### API

#### `formatText(source, config, casing?, userFunctions?): string`

Formats BrightScript source code using a multi-pass engine (16 pass functions in 11 logical stages).

- `source` — raw BrightScript source text
- `config` — `FormattingConfig` object
- `casing` — optional `CasingConfig` for identifier casing rules
- `userFunctions` — optional array of known function definitions for casing normalization

#### `checkFormatting(source, config, casing?, userFunctions?): boolean`

Returns `true` if the source text is already formatted (no changes needed).

## GitHub Actions

```yaml
# .github/workflows/format-check.yml
name: Format Check
on: [push, pull_request]
jobs:
  format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run format:check
```

> This assumes `format:check` is defined in your `package.json` scripts (see [Recommended npm Scripts](#recommended-npm-scripts) above).

## License

MIT
